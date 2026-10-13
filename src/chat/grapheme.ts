/**
 * Grapheme segmentation, shared by the smoother.
 *
 * Kept in its own module so both the pure smoother and the React hook can use
 * it without the hook importing DOM-only code.
 */

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/**
 * Counts user-perceived characters.
 *
 * `[...text].length` would split a family emoji or a flag into pieces, which is
 * visible as glitchy fragments while text streams in.
 */
export function graphemeCount(text: string): number {
  if (!text) return 0
  if (!segmenter) return [...text].length

  let count = 0
  for (const _ of segmenter.segment(text)) count += 1
  return count
}

/** The first `count` grapheme clusters of `text`. */
export function graphemeSlice(text: string, count: number): string {
  if (count <= 0) return ''
  if (!segmenter) return [...text].slice(0, count).join('')

  let index = 0
  let taken = 0
  for (const { segment } of segmenter.segment(text)) {
    if (taken >= count) break
    index += segment.length
    taken += 1
  }
  return text.slice(0, index)
}
