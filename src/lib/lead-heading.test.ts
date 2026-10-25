import { describe, expect, it } from 'vitest'
import { leadHeadings } from './lead-heading'

function paragraph(...children: object[]) {
  return { type: 'paragraph', children }
}
function strong(value: string) {
  return { type: 'strong', children: [{ type: 'text', value }] }
}
function run(...nodes: object[]) {
  const tree = { type: 'root', children: nodes } as { type: string; children: Array<{ type: string; depth?: number }> }
  leadHeadings()(tree)
  return tree.children
}

describe('leadHeadings', () => {
  it('promotes a short bold line standing alone', () => {
    const [node] = run(paragraph(strong('一、背景')))
    expect(node).toEqual({ type: 'heading', depth: 6, children: [{ type: 'text', value: '一、背景' }] })
    expect(run(paragraph(strong('Step 2: Configure')))[0].type).toBe('heading')
    expect(run(paragraph(strong('注意事项：')))[0].type).toBe('heading')
  })

  it('leaves emphasised sentences and mixed lines as paragraphs', () => {
    expect(run(paragraph(strong('注意：这一步不可逆。')))[0].type).toBe('paragraph')
    expect(run(paragraph(strong('是的!')))[0].type).toBe('paragraph')
    expect(run(paragraph(strong('原因'), { type: 'text', value: '：缓存失效' }))[0].type).toBe('paragraph')
    expect(run(paragraph(strong('很'.repeat(41))))[0].type).toBe('paragraph')
  })
})
