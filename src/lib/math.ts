/**
 * Rewrites the math delimiters models actually emit into the one form
 * remark-math parses without ambiguity: `$$…$$`.
 *
 * Providers disagree on delimiters. OpenAI and DeepSeek models favour `\(…\)`
 * and `\[…\]`; Claude, Gemini and most open models write `$…$`. remark-math
 * understands neither the backslash forms nor — safely — the single dollar: its
 * `singleDollarTextMath` option turns "costs $5 and $10" into a formula. So the
 * parser runs with single dollars off, and this pass promotes only the `$…$`
 * pairs that look like math by pandoc's rule: the opener is followed by a
 * non-space, the closer is preceded by a non-space and not followed by a digit.
 *
 * Code is left exactly as written: fenced blocks and inline code spans are
 * copied through, so `$PATH` in a shell snippet stays `$PATH`.
 *
 * Unclosed delimiters (common mid-stream) are left as text; they become math
 * once the closing half arrives.
 */
export function normalizeMath(markdown: string): string {
  if (!/[$\\]/.test(markdown)) return markdown

  const lines = markdown.split('\n')
  const out: string[] = []
  let prose: string[] = []
  let fence: { char: string; size: number } | null = null

  const flushProse = () => {
    if (prose.length) out.push(normalizeProse(prose.join('\n')))
    prose = []
  }

  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      out.push(line)
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.size && !line.slice(marker[0].length).trim()) {
        fence = null
      }
    } else if (marker && !(marker[1][0] === '`' && line.slice(marker[0].length).includes('`'))) {
      flushProse()
      fence = { char: marker[1][0], size: marker[1].length }
      out.push(line)
    } else {
      prose.push(line)
    }
  }
  flushProse()
  return out.join('\n')
}

/** Display math on a line of its own becomes a block; anywhere else, inline. */
function displayMath(text: string, start: number, end: number, inner: string): string {
  const before = text.slice(text.lastIndexOf('\n', start - 1) + 1, start)
  const nl = text.indexOf('\n', end)
  const after = text.slice(end, nl === -1 ? text.length : nl)
  if (!before.trim() && !after.trim()) return `$$\n${inner.trim()}\n$$`
  return `$$${inner.trim()}$$`
}

function normalizeProse(text: string): string {
  let result = ''
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    // Inline code: copy through to the matching run of backticks.
    if (ch === '`') {
      let run = 1
      while (text[i + run] === '`') run++
      const ticks = '`'.repeat(run)
      let close = text.indexOf(ticks, i + run)
      while (close !== -1 && text[close + run] === '`') {
        let skip = close
        while (text[skip] === '`') skip++
        close = text.indexOf(ticks, skip)
      }
      const end = close === -1 ? i + run : close + run
      result += text.slice(i, end)
      i = end
      continue
    }

    if (ch === '\\') {
      const next = text[i + 1]
      if (next === '[' || next === '(') {
        const closer = next === '[' ? '\\]' : '\\)'
        const close = text.indexOf(closer, i + 2)
        const inner = close === -1 ? '' : text.slice(i + 2, close)
        // `\(…\)` must stay within a paragraph; `\[…\]` may span lines. A
        // bare number is an escaped citation like `\[1\]`, not a formula.
        if (close !== -1 && /[^\d\s,.-]/.test(inner) && (next === '[' || !/\n\s*\n/.test(inner))) {
          const end = close + 2
          result += next === '[' ? displayMath(text, i, end, inner) : `$$${inner.trim()}$$`
          i = end
          continue
        }
      }
      // Any other escape, including `\$`, is copied as a pair so the escaped
      // character is never read as a delimiter.
      result += text.slice(i, i + 2)
      i += 2
      continue
    }

    if (ch === '$') {
      // Already `$$…$$`: copy through to its closer.
      if (text[i + 1] === '$') {
        const close = text.indexOf('$$', i + 2)
        const end = close === -1 ? text.length : close + 2
        result += text.slice(i, end)
        i = end
        continue
      }
      const close = findInlineClose(text, i)
      if (close !== -1) {
        result += `$$${text.slice(i + 1, close)}$$`
        i = close + 1
        continue
      }
    }

    result += ch
    i++
  }
  return result
}

/** The index of the `$` closing an inline formula opened at `open`, or -1. */
function findInlineClose(text: string, open: number): number {
  const first = text[open + 1]
  if (first === undefined || /\s/.test(first)) return -1
  for (let j = open + 1; j < text.length; j++) {
    const c = text[j]
    if (c === '\\') {
      j++
      continue
    }
    // A blank line ends the paragraph, and the chance of a formula with it.
    if (c === '\n' && /^\n[ \t]*\n/.test(text.slice(j))) return -1
    if (c !== '$') continue
    if (text[j + 1] === '$') return -1
    if (/\s/.test(text[j - 1]) || /\d/.test(text[j + 1] ?? '')) continue
    return j
  }
  return -1
}
