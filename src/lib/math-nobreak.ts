/**
 * Keeps an inline formula together with the punctuation that touches it.
 *
 * A rendered formula is an inline box, and browsers allow a line break on
 * either side of one — even before `。` or after `（`, where Chinese typesetting
 * never breaks. The result is a full stop orphaned at the start of a line. The
 * formula and the punctuation hugging it are wrapped in one `.md-nobr` span,
 * which does not break inside.
 *
 * Runs on the HTML tree before KaTeX, while a formula is still the
 * `code.language-math` that remark-math produced. (Its `math-inline` class does
 * not survive Streamdown's sanitizer; display math is the one inside a `pre`.)
 */

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

/** Punctuation that must not start a line. */
const CLOSING = /^[，。、；：？！）」』》〉】〕…—”’,.;:!?)\]]+/
/** Punctuation that must not end one. */
const OPENING = /[（「『《〈【〔“‘(\[]+$/

function isInlineMath(node: HastNode, parent: HastNode): boolean {
  const className = node.properties?.className
  return (
    node.type === 'element' &&
    node.tagName === 'code' &&
    parent.tagName !== 'pre' &&
    Array.isArray(className) &&
    className.includes('language-math')
  )
}

function text(value: string): HastNode {
  return { type: 'text', value }
}

function wrapIn(parent: HastNode) {
  const children = parent.children
  if (!children) return
  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    if (!isInlineMath(node, parent)) {
      wrapIn(node)
      continue
    }
    const before = children[i - 1]
    const after = children[i + 1]
    const open = before?.type === 'text' ? OPENING.exec(before.value!)?.[0] : undefined
    const close = after?.type === 'text' ? CLOSING.exec(after.value!)?.[0] : undefined
    if (!open && !close) continue

    const inner: HastNode[] = []
    let start = i
    if (open) {
      const rest = before!.value!.slice(0, -open.length)
      inner.push(text(open))
      if (rest) before!.value = rest
      else start = i - 1
    }
    inner.push(node)
    let end = i + 1
    if (close) {
      const rest = after!.value!.slice(close.length)
      inner.push(text(close))
      if (rest) after!.value = rest
      else end = i + 2
    }
    const span: HastNode = { type: 'element', tagName: 'span', properties: { className: ['md-nobr'] }, children: inner }
    children.splice(start, end - start, span)
    i = start
  }
}

export function keepMathPunctuation(tree: HastNode) {
  wrapIn(tree)
}
