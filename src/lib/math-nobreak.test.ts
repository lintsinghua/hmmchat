import { describe, expect, it } from 'vitest'
import { keepMathPunctuation } from './math-nobreak'

const math = (value: string) => ({
  type: 'element',
  tagName: 'code',
  properties: { className: ['language-math'] },
  children: [{ type: 'text', value }],
})
const text = (value: string) => ({ type: 'text', value })
const p = (...children: object[]) => ({ type: 'root', children: [{ type: 'element', tagName: 'p', children }] })

function run(tree: ReturnType<typeof p>) {
  keepMathPunctuation(tree as never)
  return (tree.children[0] as { children: unknown[] }).children
}

/** A full stop must never start a line on its own after a formula. */
describe('keepMathPunctuation', () => {
  it('binds closing punctuation to the formula before it', () => {
    const children = run(p(text('复杂度是 '), math('O(2^n)'), text('。之后')))
    expect(children).toEqual([
      text('复杂度是 '),
      { type: 'element', tagName: 'span', properties: { className: ['md-nobr'] }, children: [math('O(2^n)'), text('。')] },
      text('之后'),
    ])
  })

  it('binds opening punctuation to the formula after it', () => {
    const children = run(p(text('即（'), math('x'), text('）')))
    expect(children).toEqual([
      text('即'),
      { type: 'element', tagName: 'span', properties: { className: ['md-nobr'] }, children: [text('（'), math('x'), text('）')] },
    ])
  })

  it('leaves a formula alone when nothing touches it', () => {
    const children = run(p(text('设 '), math('x'), text(' 为')))
    expect(children).toEqual([text('设 '), math('x'), text(' 为')])
  })

  it('leaves display math alone', () => {
    const tree = { type: 'root', children: [{ type: 'element', tagName: 'pre', children: [math('x'), text('。')] }] }
    keepMathPunctuation(tree as never)
    expect((tree.children[0] as { children: unknown[] }).children).toHaveLength(2)
  })

  it('handles consecutive formulas separated only by punctuation', () => {
    const children = run(p(math('a'), text('，'), math('b'), text('。')))
    expect(children).toHaveLength(2)
    expect(JSON.stringify(children)).not.toContain('"value":""')
  })
})
