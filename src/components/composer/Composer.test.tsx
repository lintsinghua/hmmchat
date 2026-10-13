// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Composer } from './Composer'
import { useStore } from '@/chat/store'
import type { ConversationGraph } from '@/chat/types'

/**
 * The composer's Enter handling is the highest-risk interaction in the app for
 * this user: a Chinese IME reports `isComposing === false` but `keyCode === 229`
 * when Enter confirms a candidate, so guarding on `isComposing` alone lets a
 * candidate-selection Enter send a half-typed message. Both are asserted here.
 */

function makeGraph(modelId = 'claude-opus-5-5'): ConversationGraph {
  return {
    conversation: {
      id: 'c',
      title: 't',
      pinned: false,
      createdAt: 0,
      updatedAt: 0,
      lanes: [{ id: 'l1', model: { providerId: 'p', modelId } }],
      activeLeafTurnId: undefined,
    },
    turns: [],
    replies: [],
  }
}

function setState(kind: string, modelId: string) {
  useStore.setState({
    graph: makeGraph(modelId),
    providers: [
      {
        id: 'p',
        kind: kind as 'anthropic' | 'openai-compatible',
        name: 'Test',
        baseUrl: 'https://example.test/v1',
        enabled: true,
        models: [{ id: modelId, enabled: true }],
      },
    ],
    composerModel: { providerId: 'p', modelId },
    composerReasoning: 'medium',
    composerSearch: 'none',
    running: [],
    live: {},
    referencePicker: null,
    settings: {
      theme: 'light',
      systemPrompt: '',
      autoTitle: false,
      sidebarWidth: 248,
      defaultSearch: 'native',
    },
  })
}

function renderComposer(kind = 'anthropic', modelId = 'claude-opus-5-5') {
  setState(kind, modelId)
  return render(<Composer />)
}

describe('Composer', () => {
  it('labels the model chip with the vendor’s own capitalisation', () => {
    renderComposer()
    // `claude-opus-5-5` must not surface as the raw id.
    expect(screen.getByText('Claude Opus 5.5')).toBeDefined()
  })

  it('disables send while the message is empty', () => {
    renderComposer()
    expect(screen.getByLabelText('发送').hasAttribute('disabled')).toBe(true)
  })

  it('enables send once there is text', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.type(screen.getByPlaceholderText(/问点什么/), '你好')
    expect(screen.getByLabelText('发送').hasAttribute('disabled')).toBe(false)
  })

  /**
   * The IME guard. WebKit reports `isComposing === false` on the Enter that
   * confirms a candidate but leaves `keyCode` at 229, so the guard has to check
   * both. Without the `keyCode` check this test sends the message.
   */
  it('does not send on an Enter that confirms an IME candidate', async () => {
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByPlaceholderText(/问点什么/) as HTMLTextAreaElement
    await user.type(textarea, '你好')

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'keyCode', { value: 229 })
    textarea.dispatchEvent(event)

    // Still in the box: nothing was sent, and it was not cleared.
    expect(textarea.value).toBe('你好')
  })

  it('does not send while isComposing is true', () => {
    renderComposer()
    const textarea = screen.getByPlaceholderText(/问点什么/) as HTMLTextAreaElement

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'isComposing', { value: true })
    textarea.dispatchEvent(event)

    expect(textarea.value).toBe('')
  })

  it('hides the reasoning control for a model that does not reason', () => {
    renderComposer('openai-compatible', 'llama-3.3-70b')
    expect(screen.queryByLabelText('思考深度')).toBeNull()
  })

  it('offers the reasoning control for a model that does', () => {
    renderComposer('anthropic', 'claude-opus-5-5')
    expect(screen.getByLabelText('思考深度')).toBeDefined()
  })

  it('disables search only when the model supports no backend at all', () => {
    // A hosted-search-less model reached through OpenRouter, and one the catalog
    // does not credit with tool calling either — so there is genuinely no way to
    // search. Both conditions have to hold: either alone still leaves a path.
    renderComposer('openrouter', 'perplexity/sonar-deep-research')
    expect(screen.getByLabelText('联网搜索').hasAttribute('disabled')).toBe(true)
  })

  it('keeps search available on a custom endpoint, via the tool path', () => {
    // Custom OpenAI-compatible endpoints are assumed to support tool calling,
    // so the bring-your-own adapters remain reachable even with no hosted search.
    renderComposer('openai-compatible', 'llama-3.3-70b')
    expect(screen.getByLabelText('联网搜索').hasAttribute('disabled')).toBe(false)
  })

  it('enables search for a model with hosted search', () => {
    renderComposer('anthropic', 'claude-opus-5-5')
    expect(screen.getByLabelText('联网搜索').hasAttribute('disabled')).toBe(false)
  })

  it('lists only models not already answering in a column', async () => {
    // Adding a lane moves the composer to the new model, so excluding just the
    // composer's model let the first column's model be added a second time.
    const user = userEvent.setup()
    setState('anthropic', 'claude-opus-5-5')
    const state = useStore.getState()
    useStore.setState({
      graph: {
        ...state.graph!,
        conversation: {
          ...state.graph!.conversation,
          lanes: [
            { id: 'l1', model: { providerId: 'p', modelId: 'claude-opus-5-5' } },
            { id: 'l2', model: { providerId: 'p', modelId: 'claude-sonnet-5-5' } },
          ],
        },
      },
      providers: [
        {
          ...state.providers[0],
          models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'].map((id) => ({
            id,
            enabled: true,
          })),
        },
      ],
      composerModel: { providerId: 'p', modelId: 'claude-sonnet-5-5' },
    })
    render(<Composer />)

    await user.click(screen.getByRole('button', { name: /2 列/ }))
    const menu = screen.getByText('再加一个模型').parentElement!
    expect(within(menu).queryByText('Claude Opus 5.5')).toBeNull()
    expect(within(menu).queryByText('Claude Sonnet 5.5')).toBeNull()
    expect(within(menu).getByText('Claude Haiku 4.5')).toBeDefined()
  })

  it('gives each compared column its own depth scale and keeps choices apart', async () => {
    // Columns are different models with different vocabularies; a shared
    // control could only offer what they have in common, and setting one must
    // not move the other.
    const user = userEvent.setup()
    setState('openai', 'gpt-6-astra')
    const state = useStore.getState()
    useStore.setState({
      graph: {
        ...state.graph!,
        conversation: {
          ...state.graph!.conversation,
          lanes: [
            { id: 'l1', model: { providerId: 'p', modelId: 'gpt-6-astra' } },
            { id: 'l2', model: { providerId: 'p', modelId: 'gpt-5' } },
          ],
        },
      },
      providers: [
        {
          ...state.providers[0],
          models: ['gpt-6-astra', 'gpt-5'].map((id) => ({ id, enabled: true })),
        },
      ],
      laneReasoning: {},
    })
    render(<Composer />)

    await user.click(screen.getByLabelText('思考深度'))
    const astra = screen.getByRole('group', { name: 'GPT-6-Astra 思考深度' })
    const gpt5 = screen.getByRole('group', { name: 'GPT-5 思考深度' })
    expect(within(astra).getByRole('button', { name: '最高' })).toBeDefined()
    expect(within(gpt5).queryByRole('button', { name: '最高' })).toBeNull()

    await user.click(within(astra).getByRole('button', { name: '最高' }))
    expect(useStore.getState().laneReasoning).toEqual({ l1: 'max' })
    expect(within(astra).getByRole('button', { name: '最高' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(gpt5).getByRole('button', { name: '中' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the quote picker on an "@" that starts a word, and gives it back on cancel', async () => {
    // An "@" inside a word is an address or a handle, not a request to quote.
    const user = userEvent.setup()
    renderComposer()
    const textarea = screen.getByPlaceholderText(/问点什么/) as HTMLTextAreaElement

    await user.type(textarea, 'mail a@b')
    expect(useStore.getState().referencePicker).toBeNull()
    expect(textarea.value).toBe('mail a@b')

    await user.type(textarea, ' @')
    expect(useStore.getState().referencePicker).toEqual({})
    expect(textarea.value).toBe('mail a@b ')

    await user.keyboard('{Escape}')
    expect(useStore.getState().referencePicker).toBeNull()
    expect(textarea.value).toBe('mail a@b @')
  })
})
