/**
 * The core data model.
 *
 * The central idea: a *turn* is one question, and a turn can have N replies —
 * one per lane. A single-column conversation is simply the case where N is 1.
 * Nothing else in the app branches on "am I in compare mode"; the thread
 * renderer reads the lanes and draws either one column or a grid.
 *
 * Conversations are a tree of turns (so editing a question creates a sibling
 * branch), but replies are versioned siblings under a turn rather than tree
 * nodes, because regenerating one model's answer should not fork the whole
 * conversation.
 */

export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Which search backend answered — used to render the step row accurately. */
export type SearchMode = 'native' | 'tavily' | 'brave' | 'exa' | 'none'

export interface ModelRef {
  providerId: string
  modelId: string
}

/**
 * A column. Conversations start with exactly one lane (the "root" lane); adding
 * models to compare appends lanes that descend from it.
 */
export interface Lane {
  id: string
  model: ModelRef
  /**
   * Which lane this one inherited history from. When a lane is added mid-
   * conversation it points at the lane that was active, so `replyFor` can fall
   * back to that ancestor's answers for turns this lane never answered.
   */
  parentLaneId?: string
  /** Set when the user narrows back to one model: history is kept, not shown. */
  hidden?: boolean
}

/**
 * The composer's settings as they stood at this conversation's last send:
 * reasoning depth (the shared one and each column's own), the search mode, and
 * which columns were left out. Reopening the conversation puts them back, so the
 * next message goes out the way the previous one did.
 */
export interface ConversationPrefs {
  reasoning: ReasoningLevel
  laneReasoning?: Record<string, ReasoningLevel>
  search: SearchMode
  excludedLaneIds?: string[]
}

export interface Conversation {
  id: string
  title: string
  pinned: boolean
  createdAt: number
  updatedAt: number
  /**
   * The conversation this one was forked from, and the turn the fork was cut
   * at. Purely provenance: the forked conversation carries copies of the turns
   * up to that point and stands on its own, so a later edit here cannot reach
   * back and change what the ancestor said.
   */
  forkedFrom?: { conversationId: string; turnId: string }
  lanes: Lane[]
  /**
   * Which turn the visible branch ends at. Walking `parentTurnId` up from here
   * yields the messages on screen; sibling turns are the other branches.
   */
  activeLeafTurnId?: string
  /**
   * Absent on a conversation never sent from, and on ones saved before this was
   * recorded; those take their composer state from their last round instead.
   */
  prefs?: ConversationPrefs
}

/**
 * A file the user attached to a question.
 *
 * `text` carries the readable half of the file — for a PDF that is the
 * extracted text rather than the bytes — and is what gets injected into the
 * prompt. `dataUrl` carries the base64 payload for the formats a model reads
 * natively (images, PDFs); it is dropped before persisting, since it would
 * otherwise bloat the database for the sake of a re-send that can be done from
 * the composer instead.
 */
export interface Attachment {
  id: string
  name: string
  /** Lowercase extension without the dot, or 'bin' when there is none. */
  ext: string
  mime: string
  bytes: number
  /** Injected into the prompt. Empty for formats we cannot read as text. */
  text?: string
  /** `data:` URL, in memory only. */
  dataUrl?: string
  /** Set when the file is kept but contributes nothing to the prompt. */
  note?: string
  /**
   * Present when this is an earlier conversation quoted in, not a file. `text`
   * then holds the transcript as it stood when quoted — a copy, so editing the
   * source afterwards cannot change what this conversation was told.
   */
  reference?: ConversationReference
}

export interface ConversationReference {
  conversationId: string
  title: string
  /** How many question/answer rounds were quoted. */
  turns: number
  /** The column whose answers were quoted, when the source compared models. */
  modelId?: string
}

export interface Turn {
  id: string
  conversationId: string
  parentTurnId?: string
  text: string
  attachments?: Attachment[]
  /**
   * Columns this question was deliberately not sent to. A skipped column has no
   * answer here and is not given the question as context later.
   */
  skippedLaneIds?: string[]
  createdAt: number
}

export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

/** One search the model ran, rendered as an expandable step above the answer. */
export interface SearchStep {
  id: string
  query: string
  /** Always 'done' by the time it is persisted; shown mid-flight while live. */
  status: 'running' | 'done' | 'error'
  sourceCount: number
}

export interface Source {
  id: string
  url: string
  title?: string
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}

export interface ReplyOptions {
  reasoning: ReasoningLevel
  search: SearchMode
}

export interface Reply {
  id: string
  turnId: string
  laneId: string
  model: ModelRef
  /** Regenerating this lane's answer increments the version; siblings stay. */
  version: number
  /** At most one reply per (turn, lane) is active at a time. */
  active: boolean
  status: ReplyStatus
  text: string
  reasoning?: string
  /** Wall-clock ms spent reasoning, shown as "Thought for 12s". */
  reasoningMs?: number
  steps: SearchStep[]
  sources: Source[]
  usage?: TokenUsage
  error?: string
  opts: ReplyOptions
  createdAt: number
}

/** Everything the thread needs to render one conversation, loaded together. */
export interface ConversationGraph {
  conversation: Conversation
  turns: Turn[]
  replies: Reply[]
}

// ---------------------------------------------------------------------------
// Graph helpers
//
// These are pure functions over a loaded graph so they can be unit tested
// without touching SQLite or React.
// ---------------------------------------------------------------------------

/** The root lane: the one nothing descends from. */
export function rootLane(lanes: Lane[]): Lane | undefined {
  return lanes.find((lane) => !lane.parentLaneId) ?? lanes[0]
}

/** Lanes currently rendered as columns, in display order. */
export function visibleLanes(lanes: Lane[]): Lane[] {
  return lanes.filter((lane) => !lane.hidden)
}

/**
 * Walks up from the active leaf to the root, returning the visible branch in
 * chronological order.
 */
export function activePath(graph: ConversationGraph): Turn[] {
  const byId = new Map(graph.turns.map((turn) => [turn.id, turn]))
  const path: Turn[] = []
  const seen = new Set<string>()

  let cursor = graph.conversation.activeLeafTurnId
  while (cursor) {
    // Guard against a cycle from a corrupted file rather than hanging the UI.
    if (seen.has(cursor)) break
    seen.add(cursor)

    const turn = byId.get(cursor)
    if (!turn) break
    path.push(turn)
    cursor = turn.parentTurnId
  }

  return path.reverse()
}

export function repliesForTurn(graph: ConversationGraph, turnId: string): Reply[] {
  return graph.replies.filter((reply) => reply.turnId === turnId)
}

export function activeReply(
  graph: ConversationGraph,
  turnId: string,
  laneId: string,
): Reply | undefined {
  return graph.replies.find(
    (reply) => reply.turnId === turnId && reply.laneId === laneId && reply.active,
  )
}

/**
 * The reply that represents `lane` at `turnId`, falling back to the lane it
 * descends from.
 *
 * This is what makes adding a model mid-conversation work: a lane created at
 * turn 5 has no replies for turns 1-4, so its context for those turns is
 * whatever the lane it branched from said. Without the fallback the new model
 * would see a conversation with no history.
 */
export function replyFor(
  graph: ConversationGraph,
  turnId: string,
  lane: Lane,
): Reply | undefined {
  const laneById = new Map(graph.conversation.lanes.map((entry) => [entry.id, entry]))

  // Bound the walk so a malformed parent chain cannot loop forever.
  let current: Lane | undefined = lane
  for (let depth = 0; current && depth < 32; depth += 1) {
    const found = activeReply(graph, turnId, current.id)
    if (found) return found
    const parentId: string | undefined = current.parentLaneId
    current = parentId ? laneById.get(parentId) : undefined
  }
  return undefined
}

/**
 * Whether `lane` sat out `turn`.
 *
 * Walks up the lane chain like `replyFor`: a column added after the turn
 * inherits its parent's history, so it sat out exactly when its parent did.
 * Without the walk, a column added later would see a question its parent was
 * never asked.
 */
export function laneSkipped(graph: ConversationGraph, turn: Turn, lane: Lane): boolean {
  const skipped = turn.skippedLaneIds
  if (!skipped?.length) return false
  const laneById = new Map(graph.conversation.lanes.map((entry) => [entry.id, entry]))

  let current: Lane | undefined = lane
  for (let depth = 0; current && depth < 32; depth += 1) {
    if (skipped.includes(current.id)) return true
    // A lane with its own answer here took part, whatever its parent did.
    if (activeReply(graph, turn.id, current.id)) return false
    current = current.parentLaneId ? laneById.get(current.parentLaneId) : undefined
  }
  return false
}

/**
 * How many rounds on the visible branch `lane` answered itself.
 *
 * Inherited answers do not count: this is what a removed column would bring
 * back if restored, and an answer it only inherited is its parent's to show.
 */
export function laneAnswerCount(graph: ConversationGraph, lane: Lane): number {
  return activePath(graph).filter((turn) => {
    const reply = activeReply(graph, turn.id, lane.id)
    return reply && (reply.status === 'done' || reply.status === 'stopped') && reply.text.trim()
  }).length
}

/**
 * The turns up to and including `turnId`, in order.
 *
 * Used by fork: cutting at a node means keeping everything the model saw at
 * that point — the question and every answer before it — so the copy carries
 * the same context rather than starting from an empty conversation.
 */
export function pathToTurn(graph: ConversationGraph, turnId: string): Turn[] {
  const byId = new Map(graph.turns.map((turn) => [turn.id, turn]))
  const path: Turn[] = []
  const seen = new Set<string>()

  let cursor: string | undefined = turnId
  while (cursor) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const turn = byId.get(cursor)
    if (!turn) break
    path.push(turn)
    cursor = turn.parentTurnId
  }

  return path.reverse()
}

/** Sibling branches for a turn: alternatives the user can page between. */
export function siblingTurns(graph: ConversationGraph, turn: Turn): Turn[] {
  return graph.turns
    .filter((candidate) => candidate.parentTurnId === turn.parentTurnId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Alternative versions of one lane's answer, for the ‹1/2› control. */
export function replyVersions(
  graph: ConversationGraph,
  turnId: string,
  laneId: string,
): Reply[] {
  return graph.replies
    .filter((reply) => reply.turnId === turnId && reply.laneId === laneId)
    .sort((a, b) => a.version - b.version)
}

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return (
    value === 'off' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  )
}

export function isSearchMode(value: unknown): value is SearchMode {
  return value === 'native' || value === 'tavily' || value === 'brave' || value === 'exa' || value === 'none'
}
