/**
 * Turns a short bold line standing alone into a heading.
 *
 * Models mark sections with `**一、背景**` or `**Step 2: Configure**` on a
 * line of their own far more often than with `###`. Rendered as written it is
 * a paragraph, and gets a paragraph's spacing — the section it opens runs into
 * the one before. As an h6 (styled as bold body text) it gets a heading's room
 * above and stays close to its content below.
 *
 * Only lines that read like labels qualify: short, and not ending as a
 * sentence does. `**注意：这一步不可逆。**` stays an emphasised paragraph.
 */

interface MdNode {
  type: string
  value?: string
  depth?: number
  children?: MdNode[]
}

const MAX_LENGTH = 40
const SENTENCE_END = /[。．.!！?？；;…]$/

function textOf(node: MdNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(textOf).join('')
}

function isLead(node: MdNode): boolean {
  if (node.type !== 'paragraph' || node.children?.length !== 1) return false
  const [only] = node.children
  if (only.type !== 'strong') return false
  const text = textOf(only).trim()
  return text.length > 0 && text.length <= MAX_LENGTH && !SENTENCE_END.test(text)
}

export function leadHeadings() {
  return (tree: MdNode) => {
    // Top level only: a bold line inside a list item or quote is part of it.
    for (const node of tree.children ?? []) {
      if (isLead(node)) {
        node.type = 'heading'
        node.depth = 6
        node.children = node.children![0].children
      }
    }
  }
}
