import { beforeEach, describe, expect, it } from 'vitest'
import { resetMemoryBackend } from '@/lib/db-memory'
import * as db from '@/lib/db'
import { useStore } from './store'
import { activePath } from './types'
import { createConversation, forkFromTurn } from './session'
import type { Reply, Turn } from './types'

/**
 * Fork runs against the in-memory backend, the same SQL path the app uses. The
 * failures this guards against all looked like "the fork is empty" rather than
 * like an error: a parent chain remapped through the wrong id map, and the
 * copied reply versions deactivating each other.
 */

const model = { providerId: 'p', modelId: 'm' }

function reply(id: string, turnId: string, laneId: string, version: number, active: boolean): Reply {
  return {
    id,
    turnId,
    laneId,
    model,
    version,
    active,
    status: 'done',
    text: `answer ${id}`,
    steps: [],
    sources: [],
    opts: { reasoning: 'medium', search: 'none' },
    createdAt: version,
  }
}

async function seed() {
  const conversation = await createConversation(model)
  const laneId = conversation.lanes[0].id
  const turns: Turn[] = [
    { id: 't1', conversationId: conversation.id, text: 'hi', createdAt: 1 },
    { id: 't2', conversationId: conversation.id, parentTurnId: 't1', text: 'weather', createdAt: 2 },
    { id: 't3', conversationId: conversation.id, parentTurnId: 't2', text: 'later', createdAt: 3 },
  ]
  await db.insertTurnsWithReplies(turns, [
    reply('r1a', 't1', laneId, 1, false),
    reply('r1b', 't1', laneId, 2, true),
    reply('r2', 't2', laneId, 1, true),
    reply('r3', 't3', laneId, 1, true),
  ])
  await db.setActiveLeaf(conversation.id, 't3')
  useStore.getState().setGraph(await db.loadGraph(conversation.id))
  return conversation
}

beforeEach(() => {
  resetMemoryBackend()
  useStore.setState({ graph: null, live: {}, running: [], summaries: [] })
})

describe('forkFromTurn', () => {
  it('opens the fork with every message up to the cut point', async () => {
    const source = await seed()

    const forkId = await forkFromTurn('t2')

    const graph = useStore.getState().graph!
    expect(forkId).toBeTruthy()
    expect(graph.conversation.id).toBe(forkId)
    expect(graph.conversation.forkedFrom).toEqual({ conversationId: source.id, turnId: 't2' })
    expect(activePath(graph).map((turn) => turn.text)).toEqual(['hi', 'weather'])
  })

  it('keeps the active answer when a turn had several versions', async () => {
    await seed()
    await forkFromTurn('t2')

    const graph = useStore.getState().graph!
    const first = activePath(graph)[0]
    const active = graph.replies.filter((entry) => entry.turnId === first.id && entry.active)
    expect(active.map((entry) => entry.text)).toEqual(['answer r1b'])
    expect(graph.replies.filter((entry) => entry.turnId === first.id)).toHaveLength(2)
  })

  it('lists the fork in the sidebar', async () => {
    await seed()
    const forkId = await forkFromTurn('t2')

    expect(useStore.getState().summaries.map((summary) => summary.id)).toContain(forkId)
  })
})
