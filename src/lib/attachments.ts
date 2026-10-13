import type { Attachment } from '@/chat/types'
import { t } from '@/i18n/core'
import { composer } from '@/i18n'
import { extractPdfText } from './pdf'
import { extractOfficeText } from './office-text'

/**
 * Reading attached files.
 *
 * Two levels of support, decided per format:
 *
 * - **Text** is decoded and injected into the prompt as a delimited block, which
 *   works on every model.
 * - **Images and PDFs** are sent as file parts when the model advertises vision;
 *   a PDF additionally gets its text extracted so a non-vision model still gets
 *   something useful.
 *
 * Everything happens in the webview. The app has no backend to upload to, and
 * routing a file through one would be a privacy regression against the rest of
 * the design, where the transcript never leaves the machine except as prompt
 * text.
 */

/** Extensions read as text and injected into the prompt. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'mdx', 'rst', 'log', 'csv', 'tsv',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml', 'html', 'htm', 'svg',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'sql', 'graphql', 'gql', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro',
  'lua', 'pl', 'r', 'jl', 'dart', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'ml', 'nim', 'zig',
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif'])

/** Per-file prompt budget; a big file is truncated with a note rather than dropped. */
const MAX_TEXT_CHARS = 120_000
/** Whole-file read cap. Beyond this the browser's own decode is not worth the wait. */
const MAX_FILE_BYTES = 32 * 1024 * 1024

export interface AttachmentLimits {
  /** Whether an image/PDF may be sent as a file part. */
  nativeFiles: boolean
  /** Prompt budget, lowered when several files are attached at once. */
  maxTextChars: number
}

export function limitsFor(hasVision: boolean, fileCount = 1): AttachmentLimits {
  // Split the budget across files so ten small ones are not each given a large
  // allowance; the floor keeps a single file useful when many are attached.
  const share = Math.max(20_000, Math.floor(MAX_TEXT_CHARS / Math.max(1, fileCount)))
  return { nativeFiles: hasVision, maxTextChars: share }
}

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name)
  return match ? match[1].toLowerCase() : ''
}

export function isImage(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext)
}

export function isPdf(ext: string): boolean {
  return ext === 'pdf'
}

export function isOffice(ext: string): boolean {
  return ext === 'docx' || ext === 'xlsx' || ext === 'pptx'
}

export function isText(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext)
}

/** Whether a picker entry is worth accepting at all. */
export function isSupported(name: string): boolean {
  const ext = extensionOf(name)
  return isText(ext) || isImage(ext) || isPdf(ext) || isOffice(ext)
}

/**
 * Whether files of this kind can be handed to a model as a file part, given
 * what the model can see. Text-only files never need it.
 */
/**
 * Whether this model can be given the file itself rather than its text.
 *
 * Images and PDFs are separate capabilities, not one "vision" flag: the catalog
 * has models that read PDFs but not pictures, and a scanned document sent to one
 * of them would be rejected upstream. Sending the extracted text instead is
 * always a valid fallback, which is why this only decides *how* the file travels.
 */
export function hasNativeInput(ext: string, input: { vision: boolean; pdf: boolean }): boolean {
  if (isImage(ext)) return input.vision
  if (isPdf(ext)) return input.pdf
  return false
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Reads one picked file into an Attachment. Never throws; failures annotate. */
export async function readAttachment(file: File): Promise<Attachment> {
  const ext = extensionOf(file.name)
  const base: Attachment = {
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    ext: ext || 'bin',
    mime: file.type || mimeForExtension(ext),
    bytes: file.size,
  }

  if (file.size > MAX_FILE_BYTES) {
    return { ...base, note: t(composer.fileTooLarge, { size: formatBytes(MAX_FILE_BYTES) }) }
  }

  try {
    if (isImage(ext)) {
      const dataUrl = await readAsDataUrl(file)
      return {
        ...base,
        dataUrl,
        note: t(composer.imageNote),
      }
    }

    if (isPdf(ext)) {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      const dataUrl = `data:${base.mime};base64,${toBase64(buffer)}`
      const { text, note } = await readPdf(bytes)
      return { ...base, dataUrl, text, note }
    }

    if (isOffice(ext)) {
      const text = await extractOfficeText(ext, new Uint8Array(await file.arrayBuffer()))
      return {
        ...base,
        // A .docx is also a valid prompt attachment for a vision model only in
        // the sense that the model cannot see it; the text is the whole value.
        text: text || undefined,
        note: text ? undefined : t(composer.noTextExtracted),
      }
    }

    if (isText(ext)) {
      return { ...base, text: await file.text() }
    }

    // Unknown extension: try to read it as text, but quietly give up if it looks
    // binary. Users drag in files with unusual extensions all the time.
    const text = await file.text()
    if (looksBinary(text)) {
      return { ...base, note: t(composer.binaryFile) }
    }
    return { ...base, text }
  } catch (error) {
    return {
      ...base,
      note: t(composer.readFailedWith, { error: error instanceof Error ? error.message : String(error) }),
    }
  }
}

/**
 * PDF text, with the failure recorded on the attachment rather than thrown.
 *
 * A scanned document has no text layer at all; saying so lets the composer hand
 * the file to a vision-capable model instead of quietly sending an empty prompt.
 */
async function readPdf(bytes: Uint8Array): Promise<{ text?: string; note?: string }> {
  try {
    const text = await extractPdfText(bytes)
    if (text) return { text }
    return { note: t(composer.pdfNoText) }
  } catch (error) {
    return {
      note: t(composer.pdfParseFailed, { error: error instanceof Error ? error.message : String(error) }),
    }
  }
}

function mimeForExtension(ext: string): string {
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  return 'text/plain'
}

function looksBinary(text: string): boolean {
  // A NUL in the first few KB is the cheap, reliable tell.
  return text.slice(0, 4096).includes('\u0000')
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(t(composer.readFailed)))
    reader.readAsDataURL(file)
  })
}

/** Chunked so a multi-megabyte PDF does not blow the argument limit. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}
