import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryBackend, resetMemoryBackend } from '@/lib/db-memory'
import * as db from '@/lib/db'
import type * as DbModule from '@/lib/db'
import { useStore } from './store'
import {
  addLane,
  createConversation,
  duplicateConversation,
  editTurn,
  forkFromTurn,
  newConversationModels,
  newConversationPrefs,
  openConversation,
  regenerate,
  removeLane,
  restoreLane,
  sendMessage,
} from './session'
import { buildReference } from './reference'
import { laneAnswerCount, laneSkipped, visibleLanes } from './types'
import type { ProviderConfig } from '@/providers/registry'

/**
 * A new turn's rows must be durable before its streams start, and a write that
 * fails must say so. The bug this guards against: a failed write aborted the
 * send after the question was already on screen, the streams never opened, and
 * every column sat on an empty answer with no error anywhere.
 */

const failWrites = vi.hoisted(() => ({ on: false }))
const started = vi.hoisted(() => ({ count: 0 }))

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>()
  return {
    ...actual,
    insertTurnsWithReplies: async (...args: Parameters<typeof actual.insertTurnsWithReplies>) => {
      if (failWrites.on) throw new Error('database is locked')
      return actual.insertTurnsWithReplies(...args)
    },
  }
})

vi.mock('./engine', () => ({
  startTurn: () => {
    started.count += 1
    return { stopAll() {}, stopLane() {} }
  },
}))

const model = { providerId: 'p', modelId: 'claude-opus-5-5' }

async function seed() {
  const conversation = await createConversation(model)
  useStore.getState().setGraph(await db.loadGraph(conversation.id))
  await sendMessage('第一问')
  return { conversation, turnId: useStore.getState().graph!.turns[0].id }
}

const initialSettings = useStore.getState().settings

beforeEach(() => {
  resetMemoryBackend()
  failWrites.on = false
  useStore.setState({
    graph: null,
    live: {},
    running: [],
    summaries: [],
    providers: [],
    settings: initialSettings,
    composerModel: null,
    composerReasoning: 'medium',
    laneReasoning: {},
    excludedLaneIds: [],
    focusedLaneId: null,
    composerSearch: 'none',
  })
  started.count = 0
})

describe('starting a new turn', () => {
  it('persists an edited question and its columns before streaming', async () => {
    const { conversation, turnId } = await seed()
    started.count = 0

    await editTurn(turnId, '第一问（改）')

    const persisted = await db.loadGraph(conversation.id)
    const edited = persisted!.turns.find((turn) => turn.text === '第一问（改）')!
    expect(persisted!.conversation.activeLeafTurnId).toBe(edited.id)
    expect(persisted!.replies.filter((reply) => reply.turnId === edited.id)).toHaveLength(1)
    expect(started.count).toBe(1)
  })

  it('marks every column failed, rather than waiting forever, when the write fails', async () => {
    const { turnId } = await seed()
    started.count = 0
    failWrites.on = true

    await editTurn(turnId, '第一问（改）')

    const state = useStore.getState()
    const edited = state.graph!.turns.find((turn) => turn.text === '第一问（改）')!
    const replies = state.graph!.replies.filter((reply) => reply.turnId === edited.id)
    expect(replies.map((reply) => reply.status)).toEqual(['error'])
    expect(replies[0].error).toContain('database is locked')
    expect(state.running.filter((id) => replies.some((reply) => reply.id === id))).toEqual([])
    expect(started.count).toBe(0)
  })

  it('does the same for an ordinary send', async () => {
    await seed()
    started.count = 0
    failWrites.on = true

    await sendMessage('第二问')

    const state = useStore.getState()
    const turn = state.graph!.turns.find((entry) => entry.text === '第二问')!
    const replies = state.graph!.replies.filter((reply) => reply.turnId === turn.id)
    expect(replies.map((reply) => reply.status)).toEqual(['error'])
    expect(state.running.filter((id) => replies.some((reply) => reply.id === id))).toEqual([])
    expect(started.count).toBe(0)
  })
})

describe('sending to only some of the compared models', () => {
  async function threeLanes() {
    const { conversation } = await seed()
    await addLane({ providerId: 'p', modelId: 'gpt-6-astra' })
    await addLane({ providerId: 'p', modelId: 'gemini-3.8-flash' })
    const lanes = visibleLanes(useStore.getState().graph!.conversation.lanes)
    return { conversation, lanes }
  }

  const lastTurn = () => {
    const graph = useStore.getState().graph!
    return graph.turns.find((turn) => turn.id === graph.conversation.activeLeafTurnId)!
  }
  const answeredBy = (turnId: string) =>
    useStore
      .getState()
      .graph!.replies.filter((reply) => reply.turnId === turnId)
      .map((reply) => reply.laneId)
      .sort()

  it('asks only the included columns, and keeps doing so until widened', async () => {
    const { conversation, lanes } = await threeLanes()
    useStore.getState().toggleLaneExcluded(lanes[1].id)
    useStore.getState().toggleLaneExcluded(lanes[2].id)

    await sendMessage('只问第一个')
    const first = lastTurn()
    await sendMessage('再问第一个')
    expect(answeredBy(first.id)).toEqual([lanes[0].id])
    expect(answeredBy(lastTurn().id)).toEqual([lanes[0].id])

    // The omission is durable, not just a missing reply.
    const persisted = await db.loadGraph(conversation.id)
    const stored = persisted!.turns.find((turn) => turn.id === first.id)!
    expect(stored.skippedLaneIds?.sort()).toEqual([lanes[1].id, lanes[2].id].sort())

    useStore.getState().includeAllLanes()
    await sendMessage('大家都答')
    expect(answeredBy(lastTurn().id)).toEqual(lanes.map((lane) => lane.id).sort())
  })

  it('never sends nowhere when every column ends up excluded', async () => {
    const { lanes } = await threeLanes()
    for (const lane of lanes) useStore.getState().toggleLaneExcluded(lane.id)

    await sendMessage('还是要发出去')

    expect(answeredBy(lastTurn().id)).toEqual(lanes.map((lane) => lane.id).sort())
  })

  it('re-asks an edited question of whichever columns the composer has selected now', async () => {
    const { lanes } = await threeLanes()
    useStore.getState().toggleLaneExcluded(lanes[2].id)
    await sendMessage('问前两个')
    const original = lastTurn()
    useStore.getState().includeAllLanes()
    useStore.getState().toggleLaneExcluded(lanes[0].id)

    await editTurn(original.id, '问后两个')

    const edited = lastTurn()
    expect(edited.text).toBe('问后两个')
    expect(answeredBy(edited.id)).toEqual([lanes[1].id, lanes[2].id].sort())
    expect(laneSkipped(useStore.getState().graph!, edited, lanes[0])).toBe(true)
  })

  it('keeps who sat out a turn when the conversation is forked', async () => {
    const { lanes } = await threeLanes()
    useStore.getState().toggleLaneExcluded(lanes[1].id)
    await sendMessage('不问第二个')
    const cut = lastTurn()

    await forkFromTurn(cut.id)

    const fork = useStore.getState().graph!
    const copied = fork.turns.find((turn) => turn.text === '不问第二个')!
    expect(visibleLanes(fork.conversation.lanes).map((lane) => laneSkipped(fork, copied, lane))).toEqual([
      false,
      true,
      false,
    ])
  })

  it('asks only the focused column while one is shown on its own', async () => {
    const { lanes } = await threeLanes()
    // Exclusions are kept, but focus wins: what is on screen is who answers.
    useStore.getState().toggleLaneExcluded(lanes[1].id)
    useStore.getState().setFocusedLane(lanes[1].id)

    await sendMessage('只问它')

    const turn = lastTurn()
    expect(answeredBy(turn.id)).toEqual([lanes[1].id])
    expect(turn.skippedLaneIds?.sort()).toEqual([lanes[0].id, lanes[2].id].sort())

    useStore.getState().setFocusedLane(null)
    await sendMessage('回到并排')
    expect(answeredBy(lastTurn().id)).toEqual([lanes[0].id, lanes[2].id].sort())
  })

  it('drops the focus when another conversation opens', async () => {
    const { conversation, lanes } = await threeLanes()
    const other = await createConversation(model)
    useStore.getState().setFocusedLane(lanes[2].id)

    await openConversation(other.id)
    await openConversation(conversation.id)

    expect(useStore.getState().focusedLaneId).toBeNull()
  })
})

describe('taking a column out of the comparison', () => {
  async function answeredThreeLanes() {
    const { conversation } = await seed()
    await addLane({ providerId: 'p', modelId: 'gpt-6-astra' })
    await addLane({ providerId: 'p', modelId: 'gemini-3.8-flash' })
    await sendMessage('三个都答')
    // The engine is mocked, so settle each answer the way a stream would.
    for (const reply of useStore.getState().graph!.replies.filter((entry) => entry.status === 'pending')) {
      useStore.getState().finishLive(reply.id, { ...reply, status: 'done', text: `${reply.laneId} 的回答` })
    }
    return { conversation, lanes: visibleLanes(useStore.getState().graph!.conversation.lanes) }
  }
  const visibleIds = () => visibleLanes(useStore.getState().graph!.conversation.lanes).map((lane) => lane.id)
  const answerOf = (laneId: string) =>
    useStore.getState().graph!.replies.find((reply) => reply.laneId === laneId && reply.text)?.text

  it('brings a removed column back with the answers it gave', async () => {
    const { conversation, lanes } = await answeredThreeLanes()

    await removeLane(lanes[1].id)
    expect(visibleIds()).toEqual([lanes[0].id, lanes[2].id])
    // Hidden in memory exactly as on disk, so it can come back this session.
    expect(laneAnswerCount(useStore.getState().graph!, { ...lanes[1], hidden: true })).toBe(1)
    expect((await db.loadGraph(conversation.id))!.conversation.lanes.find((lane) => lane.id === lanes[1].id)?.hidden).toBe(true)

    await restoreLane(lanes[1].id)
    expect(visibleIds()).toEqual(lanes.map((lane) => lane.id))
    expect(answerOf(lanes[1].id)).toBe(`${lanes[1].id} 的回答`)
    expect((await db.loadGraph(conversation.id))!.conversation.lanes.find((lane) => lane.id === lanes[1].id)?.hidden).toBeUndefined()
  })

  it('adding a removed model again returns its column rather than an empty one', async () => {
    const { lanes } = await answeredThreeLanes()
    await removeLane(lanes[2].id)

    await addLane(lanes[2].model)

    const all = useStore.getState().graph!.conversation.lanes
    expect(all.filter((lane) => lane.model.modelId === lanes[2].model.modelId)).toHaveLength(1)
    expect(visibleIds()).toContain(lanes[2].id)
    expect(answerOf(lanes[2].id)).toBe(`${lanes[2].id} 的回答`)
  })

  it('never removes the last visible column', async () => {
    const { lanes } = await answeredThreeLanes()
    await removeLane(lanes[0].id)
    await removeLane(lanes[1].id)
    await removeLane(lanes[2].id)
    expect(visibleIds()).toEqual([lanes[2].id])
  })
})

describe('duplicating a conversation', () => {
  it('copies every branch and column, leaving the original untouched', async () => {
    const { conversation, turnId } = await seed()
    await addLane({ providerId: 'p', modelId: 'gpt-6-astra' })
    const lanes = visibleLanes(useStore.getState().graph!.conversation.lanes)
    useStore.getState().toggleLaneExcluded(lanes[1].id)
    useStore.getState().setLaneReasoning(lanes[0].id, 'high')
    await sendMessage('只问第一个')
    // A second branch: the copy must keep both, not just the visible one.
    useStore.getState().includeAllLanes()
    useStore.getState().toggleLaneExcluded(lanes[1].id)
    await editTurn(turnId, '第一问（改）')
    const before = await db.loadGraph(conversation.id)

    const copyId = await duplicateConversation(conversation.id)

    const copy = (await db.loadGraph(copyId!))!
    expect(copy.conversation.id).not.toBe(conversation.id)
    expect(copy.conversation.title).toBe(`${before!.conversation.title}（副本）`)
    expect(copy.conversation.forkedFrom).toBeFalsy()
    // The composer state comes along, pointed at the copy's own columns.
    const copyLaneIds = visibleLanes(copy.conversation.lanes).map((lane) => lane.id)
    expect(copy.conversation.prefs?.excludedLaneIds).toEqual([copyLaneIds[1]])
    expect(copy.conversation.prefs?.laneReasoning).toEqual({ [copyLaneIds[0]]: 'high' })
    expect(copy.turns.map((turn) => turn.text).sort()).toEqual(before!.turns.map((turn) => turn.text).sort())
    expect(copy.replies).toHaveLength(before!.replies.length)
    // The same branch is showing, and the column that sat a turn out still did.
    const leaf = copy.turns.find((turn) => turn.id === copy.conversation.activeLeafTurnId)!
    expect(leaf.text).toBe('第一问（改）')
    const skippedTurn = copy.turns.find((turn) => turn.text === '只问第一个')!
    const copyLanes = visibleLanes(copy.conversation.lanes)
    expect(copyLanes.map((lane) => laneSkipped(copy, skippedTurn, lane))).toEqual([false, true])
    // Opened, and nothing in the source changed.
    expect(useStore.getState().graph!.conversation.id).toBe(copyId)
    expect(await db.loadGraph(conversation.id)).toEqual(before)
  })
})

describe('quoting a conversation', () => {
  it('keeps the quoted text with the turn it was sent on', async () => {
    const { conversation: source } = await seed()
    const sourceGraph = (await db.loadGraph(source.id))!
    const quote = buildReference(sourceGraph, sourceGraph.conversation.lanes[0], [sourceGraph.turns[0].id])

    const target = await createConversation(model)
    useStore.getState().setGraph(await db.loadGraph(target.id))
    await sendMessage('接着上次的说', [quote])

    const persisted = (await db.loadGraph(target.id))!
    const [stored] = persisted.turns[0].attachments!
    expect(stored.text).toBe(quote.text)
    expect(stored.reference).toEqual(quote.reference)
  })
})

describe('the composer across sends and conversations', () => {
  const lanesOf = () => visibleLanes(useStore.getState().graph!.conversation.lanes)
  const activeOf = (turnText: string) => {
    const graph = useStore.getState().graph!
    const turn = graph.turns.find((entry) => entry.text === turnText)!
    return graph.replies.filter((reply) => reply.turnId === turn.id && reply.active)
  }

  it('regenerates and re-sends an edit as the composer is set now', async () => {
    const { turnId } = await seed()
    const lane = lanesOf()[0]
    useStore.setState({ composerSearch: 'none', composerReasoning: 'low', laneReasoning: {} })

    await regenerate(turnId, lane.id)
    expect(activeOf('第一问')[0].opts).toEqual({ reasoning: 'low', search: 'none' })

    useStore.setState({ composerReasoning: 'high' })
    await editTurn(turnId, '第一问（改）')
    expect(activeOf('第一问（改）')[0].opts).toEqual({ reasoning: 'high', search: 'none' })
  })

  it('reopens a conversation with the composer as its last send left it', async () => {
    const { conversation } = await seed()
    await addLane({ providerId: 'p', modelId: 'gpt-6-astra' })
    const lanes = lanesOf()
    useStore.setState({ composerSearch: 'brave', composerReasoning: 'low' })
    useStore.getState().setLaneReasoning(lanes[1].id, 'max')
    useStore.getState().toggleLaneExcluded(lanes[0].id)
    await sendMessage('只问第二个')

    // Somewhere else, with the composer changed.
    const other = await createConversation(model)
    await openConversation(other.id)
    useStore.setState({ composerSearch: 'none', composerReasoning: 'off', laneReasoning: {}, excludedLaneIds: [] })

    await openConversation(conversation.id)

    const state = useStore.getState()
    expect(state.composerSearch).toBe('brave')
    expect(state.composerReasoning).toBe('low')
    expect(state.laneReasoning).toEqual({ [lanes[1].id]: 'max' })
    expect(state.excludedLaneIds).toEqual([lanes[0].id])
  })

  it('reads the last round of a conversation saved before the composer was recorded', async () => {
    // A column that cannot search natively stores the fallback it got; the
    // user's choice was still 模型自带, which the other column shows.
    useStore.setState({
      providers: [
        {
          id: 'p',
          kind: 'anthropic',
          name: 'A',
          enabled: true,
          baseUrl: '',
          models: [
            { id: 'claude-opus-5-5', enabled: true },
            { id: 'deepseek-v4-pro', enabled: true },
          ],
        },
      ],
    })
    const { conversation } = await seed()
    await addLane({ providerId: 'p', modelId: 'deepseek-v4-pro' })
    const lanes = lanesOf()
    useStore.setState({ composerSearch: 'native', composerReasoning: 'high' })
    await sendMessage('搜一下')
    expect(activeOf('搜一下').map((reply) => reply.opts.search).sort()).toEqual(['native', 'tavily'])
    await memoryBackend().execute('UPDATE conversations SET prefs = ? WHERE id = ?', [
      JSON.stringify({ reasoning: 'medium', search: false }),
      conversation.id,
    ])
    useStore.setState({ composerSearch: 'none', composerReasoning: 'off' })

    await openConversation(conversation.id)

    const state = useStore.getState()
    expect(state.composerSearch).toBe('native')
    expect(state.laneReasoning).toEqual({ [lanes[0].id]: 'high', [lanes[1].id]: 'high' })
    expect(state.excludedLaneIds).toEqual([])
  })

  it('starts a conversation that was never sent from at the settings defaults', async () => {
    useStore.getState().setSettings({ defaultSearch: 'exa', defaultReasoning: 'xhigh' })
    const fresh = await createConversation(model, { prefs: newConversationPrefs(useStore.getState().settings) })
    useStore.setState({ composerSearch: 'none', composerReasoning: 'off' })

    await openConversation(fresh.id)

    expect(useStore.getState().composerSearch).toBe('exa')
    expect(useStore.getState().composerReasoning).toBe('xhigh')
  })
})

describe('newConversationModels', () => {
  const a = { providerId: 'p', modelId: 'a' }
  const b = { providerId: 'p', modelId: 'b' }
  const c = { providerId: 'q', modelId: 'c' }
  const gone = { providerId: 'p', modelId: 'removed' }
  const providers: ProviderConfig[] = [
    { id: 'p', kind: 'anthropic', name: 'P', baseUrl: '', enabled: true, models: ['a', 'b'].map((id) => ({ id, enabled: true })) },
    { id: 'q', kind: 'openai', name: 'Q', baseUrl: '', enabled: true, models: [{ id: 'c', enabled: true }] },
  ]
  const settings = (patch: object) => ({ ...useStore.getState().settings, ...patch })

  it('answers with the first candidate still available, then the default comparisons', () => {
    expect(newConversationModels(providers, settings({ defaultCompareModels: [c, a, gone] }), [gone, b])).toEqual([b, c, a])
  })

  it('falls back to the first enabled model and never lists one twice', () => {
    expect(newConversationModels(providers, settings({ defaultCompareModels: [a, a] }), [null])).toEqual([a])
    expect(newConversationModels([], settings({}), [a])).toEqual([])
  })
})
