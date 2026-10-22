import { describe, expect, it } from 'vitest'
import { normalizeMath } from './math'

/**
 * Models write math with whichever delimiters they were trained on. Each one
 * must reach the renderer as `$$…$$`, and nothing that is not math — a price,
 * a shell variable, an escaped citation — may be turned into a formula.
 */

describe('normalizeMath', () => {
  it('promotes single-dollar inline math', () => {
    expect(normalizeMath('Euler: $e^{i\\pi}+1=0$ done')).toBe('Euler: $$e^{i\\pi}+1=0$$ done')
    expect(normalizeMath('中文：$\\alpha$，好')).toBe('中文：$$\\alpha$$，好')
  })

  it('leaves prices alone', () => {
    expect(normalizeMath('Price $5 and $10 total.')).toBe('Price $5 and $10 total.')
    expect(normalizeMath('From $5-$10, or $ 3 $')).toBe('From $5-$10, or $ 3 $')
    expect(normalizeMath('Costs \\$5 and \\$6')).toBe('Costs \\$5 and \\$6')
  })

  it('converts backslash delimiters', () => {
    expect(normalizeMath('Inline \\(a^2+b^2\\) here')).toBe('Inline $$a^2+b^2$$ here')
    expect(normalizeMath('\\[\n\\int_0^1 x\\,dx\n\\]')).toBe('$$\n\\int_0^1 x\\,dx\n$$')
    expect(normalizeMath('\\[ x = 1 \\]')).toBe('$$\nx = 1\n$$')
    // Not alone on its line: kept inline so a list item is not split apart.
    expect(normalizeMath('- item: \\[ y=2 \\]')).toBe('- item: $$y=2$$')
  })

  it('does not treat escaped citations as math', () => {
    expect(normalizeMath('See \\[1\\] and \\[2, 3\\]')).toBe('See \\[1\\] and \\[2, 3\\]')
  })

  it('copies existing $$ math and code through untouched', () => {
    expect(normalizeMath('$$\nE=mc^2\n$$')).toBe('$$\nE=mc^2\n$$')
    expect(normalizeMath('`$PATH` and `$x$`')).toBe('`$PATH` and `$x$`')
    const fenced = '```sh\necho $HOME $x$ \\(y\\)\n```\nthen $z$'
    expect(normalizeMath(fenced)).toBe('```sh\necho $HOME $x$ \\(y\\)\n```\nthen $$z$$')
  })

  it('leaves unclosed delimiters as text while streaming', () => {
    expect(normalizeMath('unclosed $x+')).toBe('unclosed $x+')
    expect(normalizeMath('so \\(a + ')).toBe('so \\(a + ')
    expect(normalizeMath('```py\nx = "$a$"')).toBe('```py\nx = "$a$"')
  })

  it('does not join a formula across paragraphs', () => {
    expect(normalizeMath('$a\n\nb$')).toBe('$a\n\nb$')
  })
})
