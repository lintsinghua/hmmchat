import { describe, expect, it } from 'vitest'
import {
  activePath,
  activeReply,
  replyFor,
  replyVersions,
  siblingTurns,
  visibleLanes,
  type ConversationGraph,
  type Lane,
  type Reply,
  type Turn,
} from './types'

/**
 * The context rules are the part of the design most likely to be subtly wrong:
 * a lane that inherits history has to resolve *something* for turns it never
 * answered, and getting that wrong produces a model that sees a broken
 * conversation without any visible symptom.
 */

function lane(id: string, parentLaneId?: string, hidden?: boolean): Lane {
  return { id, model: { providerId: 'p', modelId: `m-${id}` }, parentLaneId, hidden }
}

function turn(id: string, parentTurnId?: string, text = id): Turn {
  return { id, conversationId: 'c', parentTurnId, text, createdAt: id.charCodeAt(0) }
}

function reply(
  id: string,
  turnId: string,
  laneId: string,
  patch: Partial<Reply> = {},
): Reply {
  return {
    id,
    turnId,
    laneId,
    model: { providerId: 'p', modelId: `m-${laneId}` },
    version: 1,
    active: true,
    status: 'done',
    text: `answer-${id}`,
    steps: [],
    sources: [],
    opts: { reasoning: 'medium', search: 'none' },
    createdAt: 0,
    ...patch,
  }
}

function graph(
  lanes: Lane[],
  turns: Turn[],
  replies: Reply[],
  activeLeafTurnId?: string,
): ConversationGraph {
  return {
    conversation: {
      id: 'c',
      title: 't',
      pinned: false,
      createdAt: 0,
      updatedAt: 0,
      lanes,
      activeLeafTurnId,
    },
    turns,
    replies,
  }
}

describe('activePath', () => {
  it('walks from the leaf back to the root in order', () => {
    const g = graph(
      [lane('a')],
      [turn('t1'), turn('t2', 't1'), turn('t3', 't2')],
      [],
      't3',
    )
    expect(activePath(g).map((entry) => entry.id)).toEqual(['t1', 't2', 't3'])
  })

  it('follows the active branch, not the newest turn', () => {
    // t2b is a branch off t1 and is newer, but the leaf points at t2a's child.
    const g = graph(
      [lane('a')],
      [turn('t1'), turn('t2a', 't1'), turn('t2b', 't1')],
      [],
      't2a',
    )
    expect(activePath(g).map((entry) => entry.id)).toEqual(['t1', 't2a'])
  })

  it('stops rather than looping on a cyclic parent chain', () => {
    const g = graph([lane('a')], [turn('t1', 't2'), turn('t2', 't1')], [], 't1')
    expect(activePath(g).length).toBeLessThanOrEqual(2)
  })

  it('is empty when no leaf is set', () => {
    expect(activePath(graph([lane('a')], [turn('t1')], []))).toEqual([])
  })
})

describe('replyFor', () => {
  it('uses the lane’s own reply when it has one', () => {
    const lanes = [lane('a'), lane('b', 'a')]
    const g = graph(lanes, [turn('t1')], [reply('r1', 't1', 'a'), reply('r2', 't1', 'b')], 't1')
    expect(replyFor(g, 't1', lanes[1])?.id).toBe('r2')
  })

  it('falls back to the lane it branched from', () => {
    // This is the case that makes adding a model mid-conversation work: lane b
    // did not exist for t1, so its history for t1 is whatever lane a said.
    const lanes = [lane('a'), lane('b', 'a')]
    const g = graph(lanes, [turn('t1')], [reply('r1', 't1', 'a')], 't1')
    expect(replyFor(g, 't1', lanes[1])?.id).toBe('r1')
  })

  it('walks multiple levels up the chain', () => {
    const lanes = [lane('a'), lane('b', 'a'), lane('c', 'b')]
    const g = graph(lanes, [turn('t1')], [reply('r1', 't1', 'a')], 't1')
    expect(replyFor(g, 't1', lanes[2])?.id).toBe('r1')
  })

  it('returns undefined when nothing in the chain answered', () => {
    const lanes = [lane('a'), lane('b', 'a')]
    const g = graph(lanes, [turn('t1')], [], 't1')
    expect(replyFor(g, 't1', lanes[1])).toBeUndefined()
  })

  it('prefers the active version over an inactive one', () => {
    const lanes = [lane('a')]
    const g = graph(
      lanes,
      [turn('t1')],
      [
        reply('old', 't1', 'a', { version: 1, active: false }),
        reply('new', 't1', 'a', { version: 2, active: true }),
      ],
      't1',
    )
    expect(replyFor(g, 't1', lanes[0])?.id).toBe('new')
  })

  it('ignores a reply from a lane that is not in the chain', () => {
    const lanes = [lane('a'), lane('sibling')]
    const g = graph(lanes, [turn('t1')], [reply('r', 't1', 'sibling')], 't1')
    expect(replyFor(g, 't1', lanes[0])).toBeUndefined()
  })
})

describe('visibleLanes', () => {
  it('hides lanes the user narrowed away from', () => {
    const lanes = [lane('a'), lane('b', 'a', true)]
    expect(visibleLanes(lanes).map((entry) => entry.id)).toEqual(['a'])
  })
})

describe('activeReply', () => {
  it('finds only the active reply for a turn and lane', () => {
    const g = graph(
      [lane('a')],
      [turn('t1')],
      [reply('old', 't1', 'a', { active: false })],
      't1',
    )
    expect(activeReply(g, 't1', 'a')).toBeUndefined()
  })
})

describe('replyVersions', () => {
  it('returns versions in order', () => {
    const g = graph(
      [lane('a')],
      [turn('t1')],
      [
        reply('v2', 't1', 'a', { version: 2, active: true }),
        reply('v1', 't1', 'a', { version: 1, active: false }),
      ],
      't1',
    )
    expect(replyVersions(g, 't1', 'a').map((entry) => entry.id)).toEqual(['v1', 'v2'])
  })
})

describe('siblingTurns', () => {
  it('groups branches that share a parent', () => {
    const g = graph(
      [lane('a')],
      [turn('t1'), turn('t2a', 't1'), turn('t2b', 't1'), turn('other')],
      [],
      't2a',
    )
    const siblings = siblingTurns(g, g.turns[1])
    expect(siblings.map((entry) => entry.id)).toEqual(['t2a', 't2b'])
  })
})


