import type { PDFDocumentProxy } from 'pdfjs-dist'

import { t } from '@/i18n/core'
import { chat } from '@/i18n'

/**
 * PDF text extraction, on Mozilla's pdf.js.
 *
 * Hand-rolling this was tried and abandoned: a content stream draws glyph *ids*
 * in the font's own encoding, and turning those back into characters means
 * parsing the font's `ToUnicode` CMap. An English sample decodes fine without
 * it; a Chinese document — the case this app is built for — comes out as
 * garbage. pdf.js already solves that, and is the one extraction dependency
 * worth its weight.
 *
 * The library and its worker are loaded on demand inside the picker's own
 * thread, so a build that never attaches a PDF never parses them.
 */

const MAX_PAGES = 300

type PdfModule = typeof import('pdfjs-dist')

let modulePromise: Promise<PdfModule> | null = null

async function loadPdfjs(): Promise<PdfModule> {
  modulePromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    // The worker is bundled by Vite as its own chunk; without this the library
    // tries to fetch it from a CDN path that does not exist in a desktop build.
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })()
  return modulePromise
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs()
  let document: PDFDocumentProxy | null = null

  try {
    document = await pdfjs.getDocument({
      // A copy: pdf.js takes ownership of the buffer and detaches it.
      data: Uint8Array.from(bytes),
      // Bundled fonts and standard fonts are not needed for text extraction.
      disableFontFace: true,
      useSystemFonts: false,
    }).promise

    const pages: string[] = []
    const count = Math.min(document.numPages, MAX_PAGES)

    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const lines: string[] = []
      let line = ''

      for (const item of content.items) {
        if (!('str' in item)) continue
        line += item.str
        // `hasEOL` marks the end of a rendered line; without honouring it every
        // page collapses into one paragraph.
        if (item.hasEOL) {
          lines.push(line)
          line = ''
        }
      }
      if (line) lines.push(line)
      pages.push(lines.join('\n').replace(/[ \t]+\n/g, '\n').trim())
      page.cleanup()
    }

    return pages
      .filter(Boolean)
      .map((text, index) => (count > 1 ? `${t(chat.pdfPage, { page: index + 1 })}\n${text}` : text))
      .join('\n\n')
      .trim()
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  } finally {
    await document?.cleanup()
  }
}
