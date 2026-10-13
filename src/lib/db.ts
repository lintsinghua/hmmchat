import Database from '@tauri-apps/plugin-sql'
import type {
  Attachment,
  Conversation,
  ConversationGraph,
  ConversationPrefs,
  Lane,
  Reply,
  ReplyOptions,
  ReplyStatus,
  SearchStep,
  Source,
  TokenUsage,
  Turn,
} from '@/chat/types'
import { isSearchMode } from '@/chat/types'
import { isTauri } from './env'
import { memoryBackend } from './db-memory'

/**
 * Persistence.
 *
 * Two backends behind one API: SQLite through the Tauri plugin in the desktop
 * app, and an in-memory store when running in a plain browser (`pnpm dev`).
 *
 * The in-memory backend is a real implementation, not a stub. A stub that
 * returned nothing made every scenario in the browser silently do nothing —
 * `loadGraph` came back null, so a typed message vanished with no error — which
 * made the fast dev loop useless for anything but looking at static screens.
 * This one keeps conversations, turns, replies, lanes, providers and settings in
 * Maps for the session, so the whole app is exercisable in a browser without
 * building the desktop binary. It does not survive a reload, which is the
 * intended tradeoff.
 *
 * In SQLite, structured columns (lanes, steps, sources, usage, opts) are stored
 * as JSON text: the schema stays small and can grow a field without a migration,
 * at the cost of those columns not being queryable — which nothing needs them to
 * be. Search runs over `turns.text` with LIKE rather than FTS, because FTS's
 * default tokenizer segments Chinese poorly and this app's search box has to
 * find CJK text.
 */

export const DB_URL = 'sqlite:hmmchat.db'

/**
 * The query surface both backends satisfy: `execute` for writes, `select` for
 * reads. Narrower than the plugin's `Database` type on purpose — `path` and
 * `close` are plugin details no caller here uses, so requiring them of the
 * in-memory backend would be friction with no benefit.
 */
export interface Queryable {
  execute(sql: string, values?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }>
  select<T>(sql: string, values?: unknown[]): Promise<T>
}

let handle: Promise<Queryable> | null = null

function db(): Promise<Queryable> {
  if (!isTauri) return Promise.resolve(memoryBackend() as Queryable)
  handle ??= Database.load(DB_URL) as Promise<Queryable>
  return handle
}

// ---------------------------------------------------------------------------
// Row shapes as they come out of SQLite
// ---------------------------------------------------------------------------

interface ConversationRow {
  forked_from?: string | null
  id: string
  title: string
  pinned: number
  created_at: number
  updated_at: number
  prefs: string
  active_leaf_turn_id: string | null
}

interface TurnRow {
  id: string
  conversation_id: string
  parent_turn_id: string | null
  text: string
  attachments?: string | null
  skipped_lanes?: string | null
  created_at: number
}

interface LaneRow {
  id: string
  conversation_id: string
  provider_id: string
  model_id: string
  parent_lane_id: string | null
  hidden: number
  position: number
}

interface ReplyRow {
  id: string
  turn_id: string
  lane_id: string
  provider_id: string
  model_id: string
  version: number
  active: number
  status: string
  text: string
  reasoning: string | null
  reasoning_ms: number | null
  steps: string
  sources: string
  usage: string | null
  error: string | null
  opts: string
  created_at: number
}

/** Parses a JSON column, falling back rather than throwing on corrupt data. */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toConversation(row: ConversationRow, lanes: Lane[]): Conversation {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    forkedFrom: parseJson<Conversation['forkedFrom']>(row.forked_from ?? 'null', undefined),
    lanes,
    activeLeafTurnId: row.active_leaf_turn_id ?? undefined,
    prefs: readPrefs(row.prefs),
  }
}

/**
 * The stored composer state, or nothing when the row predates it. Older rows
 * hold `{}` or a `{ reasoning, search: boolean }` shape nothing ever wrote to,
 * and treating those as real would restore a composer the user never set.
 */
function readPrefs(raw: string | null): ConversationPrefs | undefined {
  const prefs = parseJson<Partial<ConversationPrefs> | null>(raw, null)
  if (!prefs || !isSearchMode(prefs.search) || !prefs.reasoning) return undefined
  return prefs as ConversationPrefs
}

function toLane(row: LaneRow): Lane {
  return {
    id: row.id,
    model: { providerId: row.provider_id, modelId: row.model_id },
    parentLaneId: row.parent_lane_id ?? undefined,
    hidden: row.hidden === 1 || undefined,
  }
}

function toTurn(row: TurnRow): Turn {
  const attachments = parseJson<Attachment[]>(row.attachments ?? '[]', [])
  const skipped = parseJson<string[]>(row.skipped_lanes ?? '[]', [])
  return {
    id: row.id,
    conversationId: row.conversation_id,
    parentTurnId: row.parent_turn_id ?? undefined,
    text: row.text,
    attachments: attachments.length ? attachments : undefined,
    skippedLaneIds: skipped.length ? skipped : undefined,
    createdAt: row.created_at,
  }
}

function toReply(row: ReplyRow): Reply {
  return {
    id: row.id,
    turnId: row.turn_id,
    laneId: row.lane_id,
    model: { providerId: row.provider_id, modelId: row.model_id },
    version: row.version,
    active: row.active === 1,
    status: row.status as ReplyStatus,
    text: row.text,
    reasoning: row.reasoning ?? undefined,
    reasoningMs: row.reasoning_ms ?? undefined,
    steps: parseJson<SearchStep[]>(row.steps, []),
    sources: parseJson<Source[]>(row.sources, []),
    usage: parseJson<TokenUsage | undefined>(row.usage, undefined),
    error: row.error ?? undefined,
    opts: parseJson<ReplyOptions>(row.opts, { reasoning: 'medium', search: 'none' }),
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string
  title: string
  pinned: boolean
  updatedAt: number
  createdAt: number
  /**
   * Where the search query matched, when it did not match the title: the
   * question or the answer that contains it, trimmed around the hit so the
   * sidebar can show *why* a conversation is in the results.
   */
  match?: { kind: 'question' | 'answer'; text: string }
}

export async function listConversations(query?: string): Promise<ConversationSummary[]> {
  const database = await db()

  const trimmed = query?.trim()
  if (!trimmed) {
    const rows = await database.select<ConversationRow[]>(
      'SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC',
    )
    return rows.map(toSummary)
  }

  // LIKE across the title, the questions and the answers: FTS would be faster
  // but its default tokenizer does not segment Chinese, so it would silently
  // fail to match most of this user's history. The replies are included because
  // searching a chat client for something you remember reading is nearly always
  // something the *model* said, and searching only what you typed finds nothing.
  const pattern = `%${trimmed}%`
  const rows = await database.select<ConversationRow[]>(
    `SELECT DISTINCT c.* FROM conversations c
     LEFT JOIN turns t ON t.conversation_id = c.id
     LEFT JOIN replies r ON r.turn_id = t.id
     WHERE c.title LIKE ? OR t.text LIKE ? OR r.text LIKE ?
     ORDER BY c.pinned DESC, c.updated_at DESC`,
    [pattern, pattern, pattern],
  )

  // A second pass for the surrounding text of each hit. Two statements rather
  // than one because a snippet needs the matching row's text on its own, which
  // DISTINCT across three joined tables cannot give.
  const [questions, answers] = await Promise.all([
    database.select<Array<{ conversation_id: string; text: string }>>(
      'SELECT conversation_id, text FROM turns WHERE text LIKE ? ORDER BY created_at DESC',
      [pattern],
    ),
    database.select<Array<{ id: string; text: string }>>(
      `SELECT t.conversation_id AS id, r.text AS text FROM replies r
       JOIN turns t ON t.id = r.turn_id
       WHERE r.text LIKE ? ORDER BY r.created_at DESC`,
      [pattern],
    ),
  ])

  const snippet = new Map<string, ConversationSummary['match']>()
  for (const row of answers) {
    if (!row.text || snippet.has(row.id)) continue
    snippet.set(row.id, { kind: 'answer', text: around(row.text, trimmed) })
  }
  for (const row of questions) {
    // A question hit is the more useful label when both match, so it wins.
    if (!row.text) continue
    snippet.set(row.conversation_id, { kind: 'question', text: around(row.text, trimmed) })
  }

  return rows.map((row) => {
    const summary = toSummary(row)
    // No snippet needed when the title already shows the match.
    if (row.title?.toLowerCase().includes(trimmed.toLowerCase())) return summary
    return { ...summary, match: snippet.get(row.id) }
  })
}

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** One line around the hit, with a leading ellipsis when it is from mid-text. */
function around(text: string, query: string, width = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  if (at === -1) return flat.slice(0, width)

  const start = Math.max(0, at - Math.floor((width - query.length) / 2))
  const body = flat.slice(start, start + width).trim()
  return `${start > 0 ? '…' : ''}${body}${start + width < flat.length ? '…' : ''}`
}

export async function createConversation(
  id: string,
  title: string,
  lanes: Lane[],
  prefs: ConversationPrefs | undefined,
  options: { forkedFrom?: Conversation['forkedFrom']; updatedAt?: number } = {},
): Promise<void> {
  const database = await db()
  const now = options.updatedAt ?? Date.now()

  await database.execute(
    `INSERT INTO conversations
       (id, title, pinned, created_at, updated_at, prefs, active_leaf_turn_id, forked_from)
     VALUES (?, ?, 0, ?, ?, ?, NULL, ?)`,
    [id, title, now, now, JSON.stringify(prefs ?? {}), options.forkedFrom ? JSON.stringify(options.forkedFrom) : null],
  )

  for (const [index, lane] of lanes.entries()) {
    await database.execute(
      `INSERT INTO lanes (id, conversation_id, provider_id, model_id, parent_lane_id, hidden, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [lane.id, id, lane.model.providerId, lane.model.modelId, lane.parentLaneId ?? null, lane.hidden ? 1 : 0, index],
    )
  }
}

export async function loadGraph(conversationId: string): Promise<ConversationGraph | null> {
  const database = await db()

  const conversationRows = await database.select<ConversationRow[]>(
    'SELECT * FROM conversations WHERE id = ?',
    [conversationId],
  )
  const conversationRow = conversationRows[0]
  if (!conversationRow) return null

  const laneRows = await database.select<LaneRow[]>(
    'SELECT * FROM lanes WHERE conversation_id = ? ORDER BY position',
    [conversationId],
  )
  const turnRows = await database.select<TurnRow[]>(
    'SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at',
    [conversationId],
  )
  const replyRows = await database.select<ReplyRow[]>(
    `SELECT r.* FROM replies r
     JOIN turns t ON t.id = r.turn_id
     WHERE t.conversation_id = ?
     ORDER BY r.created_at`,
    [conversationId],
  )

  return {
    conversation: toConversation(conversationRow, laneRows.map(toLane)),
    turns: turnRows.map(toTurn),
    replies: replyRows.map(toReply),
  }
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const database = await db()
  await database.execute('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [
    title,
    Date.now(),
    id,
  ])
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const database = await db()
  await database.execute('UPDATE conversations SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id])
}

export async function deleteConversation(id: string): Promise<void> {
  const database = await db()
  // turns/replies/lanes cascade via the foreign keys declared in the migration,
  // which requires PRAGMA foreign_keys = ON (set in the migration file).
  await database.execute('PRAGMA foreign_keys = ON')
  await database.execute('DELETE FROM conversations WHERE id = ?', [id])
}

export async function updateConversationPrefs(
  id: string,
  prefs: ConversationPrefs,
): Promise<void> {
  const database = await db()
  await database.execute('UPDATE conversations SET prefs = ? WHERE id = ?', [
    JSON.stringify(prefs),
    id,
  ])
}

export async function setActiveLeaf(conversationId: string, turnId: string | null): Promise<void> {
  const database = await db()
  await database.execute(
    'UPDATE conversations SET active_leaf_turn_id = ?, updated_at = ? WHERE id = ?',
    [turnId, Date.now(), conversationId],
  )
}

/**
 * Replaces a conversation's lane set outright.
 *
 * Fork uses this instead of `addLane` per lane because `createConversation` has
 * already written a placeholder root lane (the schema needs one before the
 * first message) which the copied lanes supersede.
 */
export async function replaceLanes(
  conversationId: string,
  lanes: Lane[],
): Promise<void> {
  // No BEGIN/COMMIT: the plugin runs each statement on whichever pooled
  // connection is free, so a transaction opened by one call is not the one the
  // next call sees — the BEGIN leaks and later writes fail with "database is
  // locked". The fork caller deletes the conversation if any step fails.
  const database = await db()
  await database.execute('DELETE FROM lanes WHERE conversation_id = ?', [conversationId])
  for (const [index, lane] of lanes.entries()) {
    await database.execute(
      `INSERT INTO lanes (id, conversation_id, provider_id, model_id, parent_lane_id, hidden, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        lane.id,
        conversationId,
        lane.model.providerId,
        lane.model.modelId,
        lane.parentLaneId ?? null,
        lane.hidden ? 1 : 0,
        index,
      ],
    )
  }
}

export async function addLane(conversationId: string, lane: Lane, position: number): Promise<void> {
  const database = await db()
  await database.execute(
    `INSERT INTO lanes (id, conversation_id, provider_id, model_id, parent_lane_id, hidden, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      lane.id,
      conversationId,
      lane.model.providerId,
      lane.model.modelId,
      lane.parentLaneId ?? null,
      lane.hidden ? 1 : 0,
      position,
    ],
  )
}

export async function updateLaneVisibility(laneId: string, hidden: boolean): Promise<void> {
  const database = await db()
  await database.execute('UPDATE lanes SET hidden = ? WHERE id = ?', [hidden ? 1 : 0, laneId])
}

/** Points an existing lane at a different model. */
export async function updateLaneModel(
  laneId: string,
  model: { providerId: string; modelId: string },
): Promise<void> {
  const database = await db()
  await database.execute('UPDATE lanes SET provider_id = ?, model_id = ? WHERE id = ?', [
    model.providerId,
    model.modelId,
    laneId,
  ])
}

// ---------------------------------------------------------------------------
// Turns and replies
// ---------------------------------------------------------------------------

/**
 * Writes turns and their replies, as they stand, one statement at a time.
 *
 * Sending, editing and forking all go through this. Turns go first so every
 * reply's turn exists; replies keep their own `active` flag rather than going
 * through `insertReply`'s deactivate-the-others step, which would leave a
 * forked turn with two versions showing neither. Sequential and not a
 * transaction for the same reason (see `replaceLanes`): the caller handles a
 * partial write.
 */
export async function insertTurnsWithReplies(
  turns: Turn[],
  replies: Reply[],
): Promise<void> {
  for (const turn of turns) await insertTurn(turn)
  for (const reply of replies) await insertReply(reply, { keepOthers: true })
}

export async function insertTurn(turn: Turn): Promise<void> {
  const database = await db()
  // The base64 payloads are stripped here, not at the call site: a decoded PDF
  // would be megabytes of text in a column nothing ever reads back for display.
  const attachments = (turn.attachments ?? []).map(({ dataUrl: _dataUrl, ...rest }) => rest)
  await database.execute(
    `INSERT INTO turns (id, conversation_id, parent_turn_id, text, attachments, skipped_lanes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      turn.id,
      turn.conversationId,
      turn.parentTurnId ?? null,
      turn.text,
      JSON.stringify(attachments),
      JSON.stringify(turn.skippedLaneIds ?? []),
      turn.createdAt,
    ],
  )
}

export async function insertReply(
  reply: Reply,
  options: { keepOthers?: boolean } = {},
): Promise<void> {
  const database = await db()

  // Only one reply per (turn, lane) may be active; clear the flag first so a
  // regenerate does not briefly violate that.
  if (!options.keepOthers) {
    await database.execute('UPDATE replies SET active = 0 WHERE turn_id = ? AND lane_id = ?', [
      reply.turnId,
      reply.laneId,
    ])
  }

  await database.execute(
    `INSERT INTO replies
       (id, turn_id, lane_id, provider_id, model_id, version, active, status, text,
        reasoning, reasoning_ms, steps, sources, usage, error, opts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reply.id,
      reply.turnId,
      reply.laneId,
      reply.model.providerId,
      reply.model.modelId,
      reply.version,
      reply.active ? 1 : 0,
      reply.status,
      reply.text,
      reply.reasoning ?? null,
      reply.reasoningMs ?? null,
      JSON.stringify(reply.steps),
      JSON.stringify(reply.sources),
      reply.usage ? JSON.stringify(reply.usage) : null,
      reply.error ?? null,
      JSON.stringify(reply.opts),
      reply.createdAt,
    ],
  )
}

/**
 * Persists streaming progress for one reply.
 *
 * Called on a throttle while a reply streams, so a crash mid-answer loses at
 * most a second of text rather than the whole response.
 */
export async function updateReplyProgress(
  replyId: string,
  patch: {
    text?: string
    reasoning?: string
    status?: ReplyStatus
    steps?: SearchStep[]
    sources?: Source[]
    usage?: TokenUsage
    error?: string
    reasoningMs?: number
  },
): Promise<void> {
  const database = await db()

  const assignments: string[] = []
  const values: unknown[] = []

  if (patch.text !== undefined) {
    assignments.push('text = ?')
    values.push(patch.text)
  }
  if (patch.reasoning !== undefined) {
    assignments.push('reasoning = ?')
    values.push(patch.reasoning)
  }
  if (patch.reasoningMs !== undefined) {
    assignments.push('reasoning_ms = ?')
    values.push(patch.reasoningMs)
  }
  if (patch.status !== undefined) {
    assignments.push('status = ?')
    values.push(patch.status)
  }
  if (patch.steps !== undefined) {
    assignments.push('steps = ?')
    values.push(JSON.stringify(patch.steps))
  }
  if (patch.sources !== undefined) {
    assignments.push('sources = ?')
    values.push(JSON.stringify(patch.sources))
  }
  if (patch.usage !== undefined) {
    assignments.push('usage = ?')
    values.push(JSON.stringify(patch.usage))
  }
  if (patch.error !== undefined) {
    assignments.push('error = ?')
    values.push(patch.error)
  }

  if (!assignments.length) return
  values.push(replyId)

  await database.execute(`UPDATE replies SET ${assignments.join(', ')} WHERE id = ?`, values)
}

export async function activateReplyVersion(
  turnId: string,
  laneId: string,
  replyId: string,
): Promise<void> {
  const database = await db()
  await database.execute('UPDATE replies SET active = 0 WHERE turn_id = ? AND lane_id = ?', [
    turnId,
    laneId,
  ])
  await database.execute('UPDATE replies SET active = 1 WHERE id = ?', [replyId])
}

export async function nextReplyVersion(turnId: string, laneId: string): Promise<number> {
  const database = await db()
  const rows = await database.select<{ max_version: number | null }[]>(
    'SELECT MAX(version) AS max_version FROM replies WHERE turn_id = ? AND lane_id = ?',
    [turnId, laneId],
  )
  return (rows[0]?.max_version ?? 0) + 1
}

export async function deleteTurnsFrom(conversationId: string, turnId: string): Promise<void> {
  // Used when editing a question: the branch being replaced is discarded whole.
  const database = await db()
  await database.execute('DELETE FROM turns WHERE id = ? AND conversation_id = ?', [
    turnId,
    conversationId,
  ])
}

// ---------------------------------------------------------------------------
// Providers and settings
// ---------------------------------------------------------------------------

export interface ProviderRow {
  id: string
  kind: string
  name: string
  base_url: string
  enabled: number
  models: string
  reasoning_wire?: string | null
  created_at: number
}

export async function listProviders(): Promise<ProviderRow[]> {
  const database = await db()
  return database.select<ProviderRow[]>('SELECT * FROM providers ORDER BY created_at')
}

export async function upsertProvider(row: {
  id: string
  kind: string
  name: string
  baseUrl: string
  enabled: boolean
  models: unknown[]
  reasoningWire?: string
}): Promise<void> {
  const database = await db()
  await database.execute(
    `INSERT INTO providers (id, kind, name, base_url, enabled, models, reasoning_wire, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       name = excluded.name,
       base_url = excluded.base_url,
       enabled = excluded.enabled,
       models = excluded.models,
       reasoning_wire = excluded.reasoning_wire`,
    [
      row.id,
      row.kind,
      row.name,
      row.baseUrl,
      row.enabled ? 1 : 0,
      JSON.stringify(row.models),
      row.reasoningWire ?? null,
      Date.now(),
    ],
  )
}

export async function deleteProvider(id: string): Promise<void> {
  const database = await db()
  await database.execute('DELETE FROM providers WHERE id = ?', [id])
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const database = await db()
  const rows = await database.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  )
  return rows[0] ? parseJson<T>(rows[0].value, fallback) : fallback
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const database = await db()
  await database.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  )
}

/**
 * Whether a real database is reachable.
 *
 * In the browser dev loop (no Tauri) there is no SQL plugin, so callers fall
 * back to an in-memory store. This keeps `pnpm dev` usable for UI work.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  if (!isTauri) return false
  try {
    await db()
    return true
  } catch {
    return false
  }
}
