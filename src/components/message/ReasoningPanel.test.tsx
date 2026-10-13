// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ReasoningPanel } from './ReasoningPanel'

const CHAIN = ['用户问的是一个取舍问题。', '先看约束。', '再比较两边的复杂度。', '结论是数据模型优先。'].join('\n')

describe('ReasoningPanel', () => {
  it('renders nothing when the model streamed no reasoning', () => {
    const { container } = render(<ReasoningPanel text="" streaming={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows a fixed-height window with the fading mask while streaming', () => {
    const { container } = render(<ReasoningPanel text={CHAIN} streaming />)

    expect(screen.getByText('正在思考')).toBeTruthy()

    // The window is a fixed three lines, so the answer below it never shifts as
    // tokens arrive — that is the whole reason it is a window and not a block.
    const window = container.querySelector('.fade-thinking') as HTMLElement
    expect(window).not.toBeNull()
    expect(window.style.height).toBe('63px')
    expect(window.className).toContain('overflow-hidden')
  })

  it('does not fade a chain short enough that nothing scrolls', () => {
    const { container } = render(<ReasoningPanel text="一句话的思考" streaming />)
    expect(container.querySelector('.fade-thinking')).toBeNull()
  })

  it('collapses to a one-line summary once the answer arrives', async () => {
    const { container, rerender } = render(<ReasoningPanel text={CHAIN} streaming />)
    rerender(<ReasoningPanel text={CHAIN} streaming={false} durationMs={12_400} />)

    // Collapsed by default: the reasoning text is not on screen any more.
    expect(screen.getByText('已思考 12 秒')).toBeTruthy()
    expect(container.querySelector('.fade-both')).toBeNull()

    await userEvent.click(screen.getByText('已思考 12 秒'))

    // Expanded: the whole chain, still with the soft edges.
    expect(container.querySelector('.fade-both')).not.toBeNull()
    expect(screen.getByText(/结论是数据模型优先/)).toBeTruthy()
  })
})
