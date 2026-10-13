/**
 * Text extraction from the OOXML formats (docx, xlsx, pptx).
 *
 * A .docx is a zip with `word/document.xml` inside; a .xlsx is a zip with
 * `xl/sharedStrings.xml` and `xl/worksheets/*.xml`. Rather than take a parsing
 * dependency for three file types, this reads the zip directory itself — the
 * central directory at the end of the file, then each entry inflated with the
 * platform's own `DecompressionStream`.
 *
 * Deliberately tolerant: a file that fails to parse returns an empty string and
 * its caller records that on the attachment, which is better than either
 * guessing at the content or refusing the file.
 */

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localHeaderOffset: number
}

/** Finds the central directory and lists its entries. */
function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // The end-of-central-directory record is at the tail, after a comment of up
  // to 64 KB; scan backwards for its signature.
  let eocd = -1
  const lowest = Math.max(0, bytes.length - 66_000)
  for (let i = bytes.length - 22; i >= lowest; i -= 1) {
    if (view.getUint32(i, true) === 0x0605_4b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) return []

  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)

  const entries: ZipEntry[] = []
  for (let i = 0; i < count && offset + 46 <= bytes.length; i += 1) {
    if (view.getUint32(offset, true) !== 0x0201_4b50) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    entries.push({ name, method, compressedSize, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Inflates one entry. Returns null for directories and unreadable entries. */
async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string | null> {
  if (entry.name.endsWith('/')) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header = entry.localHeaderOffset
  if (header + 30 > bytes.length || view.getUint32(header, true) !== 0x0403_4b50) return null

  const nameLength = view.getUint16(header + 26, true)
  const extraLength = view.getUint16(header + 28, true)
  const start = header + 30 + nameLength + extraLength
  const payload = bytes.subarray(start, start + entry.compressedSize)

  if (entry.method === 0) return new TextDecoder().decode(payload)
  if (entry.method !== 8) return null

  try {
    const stream = new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return await new Response(stream).text()
  } catch {
    return null
  }
}

/** Reads all the zip entries whose name matches, in directory order. */
async function readMatching(
  bytes: Uint8Array,
  pattern: RegExp,
  limit = 200,
): Promise<Array<{ name: string; text: string }>> {
  const found: Array<{ name: string; text: string }> = []
  for (const entry of readZipDirectory(bytes)) {
    if (!pattern.test(entry.name)) continue
    const text = await readEntry(bytes, entry)
    if (text) found.push({ name: entry.name, text })
    if (found.length >= limit) break
  }
  return found
}

/**
 * The visible text of an XML document: the character data of every element,
 * with block-level elements turned into line breaks so paragraphs survive.
 */
function xmlToText(xml: string): string {
  const withBreaks = xml
    // Word processing: paragraph and line breaks.
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    // Excel: one row per line, one tab per cell.
    .replace(/<\/row>/g, '\n')
    .replace(/<\/c>/g, '\t')
    // PowerPoint: one slide shape per line.
    .replace(/<\/a:p>/g, '\n')

  const text = withBreaks
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    // Word's WordprocessingML uses `_x000D_` for a carriage return.
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .filter((line, index, all) => line.trim() || (index > 0 && all[index - 1].trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const files = await readMatching(bytes, /^word\/(document|header\d*|footer\d*)\.xml$/)
  return xmlToText(files.map((file) => file.text).join('\n'))
}

/**
 * Excel: the shared string table holds most cell text, and each sheet holds the
 * numeric cells and the indexes into that table.
 */
export async function extractXlsxText(bytes: Uint8Array): Promise<string> {
  const shared = await readMatching(bytes, /^xl\/sharedStrings\.xml$/, 1)
  const strings = shared[0]
    ? [...shared[0].text.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => xmlToText(match[1]))
    : []

  const sheets = await readMatching(bytes, /^xl\/worksheets\/sheet\d*\.xml$/)
  const out: string[] = []

  for (const [index, sheet] of sheets.entries()) {
    const lines: string[] = []
    for (const row of sheet.text.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      for (const cell of row[1].matchAll(/<c[^>]*>([\s\S]*?)<\/c>/g)) {
        const isShared = /t="s"/.test(cell[0])
        const value = /<v>([\s\S]*?)<\/v>/.exec(cell[1])?.[1]
        const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell[1])?.[1]
        if (inline !== undefined) cells.push(xmlToText(inline))
        else if (value === undefined) cells.push('')
        else if (isShared) cells.push(strings[Number(value)] ?? '')
        else cells.push(xmlToText(value))
      }
      if (cells.some((cell) => cell.trim())) lines.push(cells.join('\t'))
    }
    if (lines.length) out.push(`# ${sheet.name.replace(/^xl\/worksheets\//, '')}\n${lines.join('\n')}`)
    if (index >= 20) break
  }

  return out.join('\n\n')
}

export async function extractPptxText(bytes: Uint8Array): Promise<string> {
  const slides = await readMatching(bytes, /^ppt\/slides\/slide\d+\.xml$/)
  return slides
    .map((slide) => `# ${slide.name.replace(/^ppt\/slides\//, '')}\n${xmlToText(slide.text)}`)
    .join('\n\n')
}

/** Dispatches on the extension. Returns '' when nothing could be read. */
export async function extractOfficeText(
  ext: string,
  bytes: Uint8Array,
): Promise<string> {
  try {
    if (ext === 'docx') return await extractDocxText(bytes)
    if (ext === 'xlsx') return await extractXlsxText(bytes)
    if (ext === 'pptx') return await extractPptxText(bytes)
  } catch {
    return ''
  }
  return ''
}
