import { describe, expect, it } from 'vitest'
import { advance, initialSmootherState, isCaughtUp, visible } from './smoother'
import { graphemeCount, graphemeSlice } from './grapheme'

describe('grapheme handling', () => {
  it('counts CJK characters individually', () => {
    expect(graphemeCount('你好世界')).toBe(4)
  })

  it('keeps an emoji as one grapheme', () => {
    // A ZWJ family is five code points but one user-perceived character.
    expect(graphemeCount('👨‍👩‍👧‍👦')).toBe(1)
    expect(graphemeSlice('👨‍👩‍👧‍👦x', 1)).toBe('👨‍👩‍👧‍👦')
  })

  it('never splits inside a combining sequence', () => {
    const text = 'éclair'
    // "e" + combining accent is two code points, one grapheme.
    expect(graphemeSlice('éclair', 1)).toBe('é')
    expect(graphemeCount(text)).toBe(6)
  })
})

describe('advance', () => {
  it('reveals at least one grapheme per frame while streaming', () => {
    const state = advance(initialSmootherState(), '你好世界', true)
    expect(state.shown).toBeGreaterThan(0)
    expect(state.shown).toBeLessThanOrEqual(4)
  })

  it('never overshoots the available text', () => {
    let state = initialSmootherState()
    const text = '短'
    for (let i = 0; i < 50; i += 1) {
      state = advance(state, text, true)
    }
    expect(state.shown).toBe(1)
    expect(isCaughtUp(state, text)).toBe(true)
  })

  it('accelerates proportionally to the backlog', () => {
    const shortBacklog = advance(initialSmootherState(), 'ab', true).shown
    const longBacklog = advance(initialSmootherState(), 'a'.repeat(300), true).shown
    expect(longBacklog).toBeGreaterThan(shortBacklog)
  })

  it('settles to the full text within the budget once streaming stops', () => {
    const text = '这是一段用来测试收尾速度的比较长的文本'
    const total = graphemeCount(text)
    let state = { shown: 1, text }

    // ~300ms at 16.7ms per frame is 18 frames; allow a couple extra.
    for (let i = 0; i < 20; i += 1) {
      state = advance(state, text, false)
    }
    expect(state.shown).toBe(total)
  })

  it('resets when the text is replaced wholesale', () => {
    // Simulates a regenerate: the lane's text restarts from empty.
    const started = { shown: 40, text: 'x'.repeat(40) }
    const next = advance(started, 'y'.repeat(5), true)
    expect(next.shown).toBeLessThan(40)
  })

  it('is idempotent once caught up', () => {
    const text = 'done'
    const state = { shown: 4, text }
    expect(advance(state, text, true)).toEqual({ shown: 4, text })
  })
})

describe('visible', () => {
  it('returns the revealed prefix', () => {
    const text = 'hello world'
    expect(visible({ shown: 5, text }, text)).toBe('hello')
  })

  it('returns the whole string when fully shown', () => {
    const text = '完整'
    expect(visible({ shown: 2, text }, text)).toBe(text)
  })
})
