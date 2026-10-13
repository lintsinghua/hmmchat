import { describe, expect, it } from 'vitest'
import { buildReference, referenceRounds } from './reference'
import { buildMessages } from './context'
import type { ConversationGraph, Lane, Reply, Turn } from './types'

/**
 * A quote must carry what the chosen column said and nothing else: the wrong
 * column's answers, or rounds the user unticked, would put words in the
 * reader's mouth that were never part of the context they chose.
 */

const opus: Lane = { id: 'a', model: { providerId: 'p', modelId: 'claude-opus-5-5' } }
const astra: Lane = { id: 'b', model: { providerId: 'p', modelId: 'gpt-6-astra' } }

function turn(id: string, parentTurnId: string | undefined, text: string, patch: Partial<Turn> = {}): Turn {
  return { id, conversationId: 'src', parentTurnId, text, createdAt: 0, ...patch }
}

function reply(turnId: string, laneId: string, text: string, patch: Partial<Reply> = {}): Reply {
  return {
    id: `r-${turnId}-${laneId}`,
    turnId,
    laneId,
    model: { providerId: 'p', modelId: laneId },
    version: 1,
    active: true,
    status: 'done',
    text,
    steps: [],
    sources: [],
    opts: { reasoning: 'medium', search: 'none' },
    createdAt: 0,
    ...patch,
  }
}

const source: ConversationGraph = {
  conversation: {
    id: 'src',
    title: '学英语短语',
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    lanes: [opus, astra],
    activeLeafTurnId: 't3',
  },
  turns: [
    turn('t1', undefined, '有什么软件？'),
    turn('t2', 't1', '第二个呢？', { skippedLaneIds: ['b'] }),
    turn('t3', 't2', '怎么安排时间？'),
  ],
  replies: [
    reply('t1', 'a', 'opus 推荐 A'),
    reply('t1', 'b', 'astra 推荐 B'),
    reply('t2', 'a', 'opus 细说 A'),
    reply('t3', 'a', 'opus 排时间', { status: 'error' }),
    reply('t3', 'b', 'astra 排时间'),
  ],
}

describe('referenceRounds', () => {
  it('pairs each question with the chosen column’s usable answer', () => {
    expect(referenceRounds(source, astra)).toEqual([
      { turnId: 't1', question: '有什么软件？', answer: 'astra 推荐 B' },
      // Asked of Opus only: Astra has nothing to say here.
      { turnId: 't2', question: '第二个呢？', answer: undefined },
      { turnId: 't3', question: '怎么安排时间？', answer: 'astra 排时间' },
    ])
    // A failed answer is not something the model said.
    expect(referenceRounds(source, opus)[2].answer).toBeUndefined()
  })
})

describe('buildReference', () => {
  it('quotes only the ticked rounds, in one column’s words', () => {
    const quote = buildReference(source, astra, ['t1', 't3'])

    expect(quote.text).toContain('astra 推荐 B')
    expect(quote.text).toContain('astra 排时间')
    expect(quote.text).not.toContain('opus')
    expect(quote.text).not.toContain('第二个呢？')
    expect(quote.reference).toEqual({ conversationId: 'src', title: '学英语短语', turns: 2, modelId: 'gpt-6-astra' })
  })

  it('reaches the model as context on the turn it was sent with and every later one', () => {
    const quote = buildReference(source, opus, ['t1'])
    const lane: Lane = { id: 'x', model: { providerId: 'p', modelId: 'm' } }
    const current: ConversationGraph = {
      ...source,
      conversation: { ...source.conversation, id: 'cur', lanes: [lane], activeLeafTurnId: 'c2' },
      turns: [turn('c1', undefined, '基于上次的讨论', { attachments: [quote] }), turn('c2', 'c1', '继续')],
      replies: [reply('c1', 'x', '好的')],
    }

    const messages = buildMessages(current, lane)
    expect(String(messages[0].content)).toContain('opus 推荐 A')
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
  })
})
