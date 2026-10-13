import { t } from '@/i18n/core'
import { chat } from '@/i18n'
import { displayName } from '@/providers/registry'
import {
  activePath,
  laneSkipped,
  replyFor,
  visibleLanes,
  type Attachment,
  type ConversationGraph,
  type Lane,
} from './types'

/**
 * Quoting an earlier conversation into this one.
 *
 * The quote is an attachment rather than a new kind of message: it rides on the
 * turn it was sent with, travels to every later turn as context the way a file
 * does, and is persisted with the turn. Its text is a transcript taken when the
 * user quoted it — a snapshot, for the same reason a fork is a copy: editing the
 * source afterwards must not change what this conversation was already told.
 *
 * One column's answers are quoted, never all of them. A compared conversation
 * holds several models' answers to each question; handing all of them over
 * would multiply the context and leave the reader to guess which one to trust.
 */

/** One round of the source conversation, as the picker offers it. */
export interface ReferenceRound {
  turnId: string
  question: string
  /** The chosen column's answer; absent when it sat the round out or failed. */
  answer?: string
}

/** The rounds on the source's visible branch, with `lane`'s answer to each. */
export function referenceRounds(graph: ConversationGraph, lane: Lane): ReferenceRound[] {
  return activePath(graph).map((turn) => {
    const reply = laneSkipped(graph, turn, lane) ? undefined : replyFor(graph, turn.id, lane)
    const answered = reply && (reply.status === 'done' || reply.status === 'stopped') && reply.text.trim()
    return { turnId: turn.id, question: turn.text, answer: answered ? reply.text.trim() : undefined }
  })
}

/** Builds the attachment that carries the chosen rounds into this conversation. */
export function buildReference(graph: ConversationGraph, lane: Lane, turnIds: string[]): Attachment {
  const title = graph.conversation.title
  const model = displayName(lane.model.modelId)
  const rounds = referenceRounds(graph, lane).filter((round) => turnIds.includes(round.turnId))

  const lines = [t(chat.quoteHeader, { title, rounds: rounds.length }), '']
  for (const round of rounds) {
    lines.push(`${t(chat.quoteUser)}：${round.question}`)
    if (round.answer) lines.push(`${model}：${round.answer}`)
    lines.push('')
  }
  const text = lines.join('\n').trim()

  const compared = visibleLanes(graph.conversation.lanes).length > 1
  return {
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: t(chat.quoteChipName, { title }),
    ext: 'conversation',
    mime: 'text/plain',
    bytes: new TextEncoder().encode(text).length,
    text,
    reference: {
      conversationId: graph.conversation.id,
      title,
      turns: rounds.length,
      modelId: compared ? lane.model.modelId : undefined,
    },
  }
}
