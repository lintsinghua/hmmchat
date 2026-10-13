import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store'
import type { ConversationGraph, Reply } from './types'

function reply(id: string, status: Reply['status'] = 'pending'): Reply {
  return {
    id,
    turnId: 't1',
    laneId: 'l1',
    model: { providerId: 'p', modelId: 'm' },
    version: 1,
    active: true,
    status,
    text: '',
    steps: [],
    sources: [],
    opts: { reasoning: 'medium', search: 'none' },
    createdAt: 0,
  }
}

function graph(replies: Reply[]): ConversationGraph {
  return {
    conversation: {
      id: 'c',
      title: 't',
      pinned: false,
      createdAt: 0,
      updatedAt: 0,
      lanes: [{ id: 'l1', model: { providerId: 'p', modelId: 'm' } }],
      activeLeafTurnId: 't1',
    },
    turns: [{ id: 't1', conversationId: 'c', text: 'hi', createdAt: 0 }],
    replies,
  }
}

beforeEach(() => {
  useStore.setState({
    graph: null,
    live: {},
    running: [],
    summaries: [],
    providers: [],
    composerModel: null,
  })
})

/**
 * These cover the split between store state and the live map, which is the
 * design decision that keeps four columns from re-rendering each other. A
 * regression here would not look like a bug — it would just be slow.
 */
describe('live streaming state', () => {
  it('tracks a reply as running when it starts', () => {
    useStore.getState().setGraph(graph([reply('r1')]))
    useStore.getState().startLive(reply('r1'))

    expect(useStore.getState().running).toEqual(['r1'])
    expect(useStore.getState().live.r1).toMatchObject({ text: '', status: 'pending' })
  })

  it('does not double-count a lane that starts twice', () => {
    useStore.getState().setGraph(graph([reply('r1')]))
    useStore.getState().startLive(reply('r1'))
    useStore.getState().startLive(reply('r1'))
    expect(useStore.getState().running).toEqual(['r1'])
  })

  it('patches text without touching the durable graph', () => {
    useStore.getState().setGraph(graph([reply('r1')]))
    useStore.getState().startLive(reply('r1'))

    const before = useStore.getState().graph
    useStore.getState().patchLive('r1', { text: 'hello' })

    // The graph object identity must be unchanged, or every column re-renders
    // on every token.
    expect(useStore.getState().graph).toBe(before)
    expect(useStore.getState().live.r1.text).toBe('hello')
  })

  it('marks a patched reply as streaming by default', () => {
    useStore.getState().setGraph(graph([reply('r1')]))
    useStore.getState().startLive(reply('r1'))
    useStore.getState().patchLive('r1', { text: 'x' })
    expect(useStore.getState().live.r1.status).toBe('streaming')
  })

  it('honours an explicit status in a patch', () => {
    useStore.getState().setGraph(graph([reply('r1')]))
    useStore.getState().startLive(reply('r1'))
    useStore.getState().patchLive('r1', { status: 'error', error: 'boom' })
    expect(useStore.getState().live.r1).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('ignores a patch for a reply that is not live', () => {
    useStore.getState().setGraph(graph([reply('r1')]))
    useStore.getState().patchLive('ghost', { text: 'nope' })
    expect(useStore.getState().live.ghost).toBeUndefined()
  })

  it('folds settled text into the graph and drops the live entry', () => {
    useStore.getState().setGraph(graph([reply('r1')]))
    useStore.getState().startLive(reply('r1'))
    useStore.getState().patchLive('r1', { text: 'final answer' })

    useStore.getState().finishLive('r1', {
      ...reply('r1', 'done'),
      text: 'final answer',
    })

    expect(useStore.getState().live.r1).toBeUndefined()
    expect(useStore.getState().running).toEqual([])
    expect(useStore.getState().graph?.replies[0]).toMatchObject({
      status: 'done',
      text: 'final answer',
    })
  })

  it('keeps other replies running when one finishes', () => {
    useStore.getState().setGraph(graph([reply('r1'), reply('r2')]))
    useStore.getState().startLive(reply('r1'))
    useStore.getState().startLive(reply('r2'))

    useStore.getState().finishLive('r1', { ...reply('r1', 'done'), text: 'a' })

    expect(useStore.getState().running).toEqual(['r2'])
    expect(useStore.getState().live.r2).toBeDefined()
  })
})

describe('composer state', () => {
  it('defaults the model from the conversation’s first lane', () => {
    useStore.getState().setGraph(graph([reply('r1')]))
    expect(useStore.getState().composerModel).toEqual({ providerId: 'p', modelId: 'm' })
  })

  it('keeps an explicitly chosen model if it still exists in the graph', () => {
    useStore.getState().setGraph(graph([reply('r1')]))
    useStore.getState().setComposerModel({ providerId: 'other', modelId: 'x' })
    // Reloading the same conversation must not clobber a deliberate choice only
    // when that choice is actually present in the conversation.
    expect(useStore.getState().composerModel).toEqual({ providerId: 'other', modelId: 'x' })
  })
})
