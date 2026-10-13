import { generateText } from 'ai'
import { createModel, type ProviderConfig, capabilitiesFor } from '@/providers/registry'
import { providerOptionsFor } from '@/providers/reasoning'
import { t } from '@/i18n/core'
import { chat } from '@/i18n'
import { cleanTitle, fallbackTitle, titlePrompt } from './context'
import { startTurn, type TurnHandle } from './engine'
import { useStore } from './store'
import * as db from '@/lib/db'
import {
  pathToTurn,
  visibleLanes,
  type Conversation,
  type ConversationPrefs,
  type Attachment,
  type ConversationGraph,
  type Lane,
  type ModelRef,
  type Reply,
  type SearchMode,
  type Turn,
} from './types'
import type { PersistedSettings } from './store'

/** The most models one conversation compares at once. */
export const MAX_LANES = 4

/**
 * Session orchestration.
 *
 * Owns the sequence "persist intent -> build the in-memory graph -> start the
 * stream -> fold the result back". Keeping it out of the components means the
 * UI never has to know the order in which a turn becomes durable.
 */

let currentTurn: TurnHandle | null = null

function uid(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

/** Maps the composer's search mode onto the mode recorded on a reply. */
function resolveSearchMode(requested: SearchMode, capabilities: { nativeSearch: boolean }): SearchMode {
  if (requested === 'none') return 'none'
  if (requested === 'native' && !capabilities.nativeSearch) {
    // Native was preferred but unavailable. The engine falls back to the
    // configured third-party adapter, so record that instead of claiming a
    // native search happened.
    return 'tavily'
  }
  return requested
}

export function stopTurn(): void {
  currentTurn?.stopAll()
  currentTurn = null
}

export function stopLane(laneId: string): void {
  currentTurn?.stopLane(laneId)
}

/**
 * The columns the next message goes to.
 *
 * A focused column alone — what the user is reading is who they are talking
 * to. Otherwise everything not excluded in the composer. Excluding every
 * column — possible after the last included one is removed — falls back to all
 * of them, so a send can never silently go nowhere. The composer renders from
 * the same rule.
 */
export function sendTargets(lanes: Lane[], excludedLaneIds: string[], focusedLaneId: string | null = null): Lane[] {
  const focused = focusedLaneId ? lanes.find((lane) => lane.id === focusedLaneId) : undefined
  if (focused) return [focused]
  const included = lanes.filter((lane) => !excludedLaneIds.includes(lane.id))
  return included.length ? included : lanes
}

/**
 * Ensures a conversation exists to send into.
 *
 * On a fresh install (or after deleting the last conversation) the composer is
 * visible but there is nothing to append to. Rather than making the user press
 * ⌘N first, typing a message and hitting Enter creates the conversation — which
 * is what every vendor app does, and what the empty-state composer implies.
 */
async function ensureConversation(): Promise<ConversationGraph | null> {
  const state = useStore.getState()
  if (state.graph) return state.graph

  // The same models the composer's draft chips show, so the first send answers
  // in exactly the columns the user was looking at.
  const models = newConversationModels(state.providers, state.settings, [state.composerModel, state.settings.defaultModel])
  if (!models.length) return null

  // No prefs here: the composer already holds what the user chose for this
  // first message, and the send records it.
  const conversation = await createConversation(models[0], { compare: models.slice(1) })
  const graph = await db.loadGraph(conversation.id)
  if (!graph) return null

  useStore.getState().setGraph(graph)
  useStore.getState().setComposerModel(models[0])
  // The sidebar lists what is in the database, so it has to be told.
  void refreshSummaries()
  return graph
}

/**
 * The models a new conversation starts with: one to answer, then the default
 * comparison models from the settings.
 *
 * The answering model is the first of `candidates` that is still available —
 * a model can be removed from its provider after being saved as a default —
 * falling back to the first enabled model. The composer's draft chips, a first
 * send, and ⌘N all read this, so what is shown is what gets created.
 */
export function newConversationModels(
  providers: ProviderConfig[],
  settings: PersistedSettings,
  candidates: Array<ModelRef | null | undefined>,
): ModelRef[] {
  const available = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      (provider.models ?? [])
        .filter((entry) => entry.enabled)
        .map((entry) => ({ providerId: provider.id, modelId: entry.id })),
    )
  const same = (a: ModelRef, b: ModelRef) => a.providerId === b.providerId && a.modelId === b.modelId
  const usable = (model: ModelRef | null | undefined): model is ModelRef =>
    Boolean(model && available.some((entry) => same(entry, model)))

  const primary = candidates.find(usable) ?? available[0]
  if (!primary) return []

  const models = [primary]
  for (const model of settings.defaultCompareModels ?? []) {
    if (models.length >= MAX_LANES) break
    if (usable(model) && !models.some((entry) => same(entry, model))) models.push(model)
  }
  return models
}

/** How the composer starts in a conversation that has never been sent from. */
export function newConversationPrefs(settings: PersistedSettings): ConversationPrefs {
  return { reasoning: settings.defaultReasoning ?? 'medium', search: settings.defaultSearch ?? 'native' }
}

/** The composer's current settings, as they are recorded with a send. */
function composerPrefs(): ConversationPrefs {
  const state = useStore.getState()
  return {
    reasoning: state.composerReasoning,
    laneReasoning: state.laneReasoning,
    search: state.composerSearch,
    excludedLaneIds: state.excludedLaneIds,
  }
}

/**
 * The composer state a conversation reopens with.
 *
 * Its recorded last send when there is one. A conversation from before that
 * was recorded is read off its last round instead: each column's depth, the
 * columns left out, and the search mode — `native` if any column asked for it,
 * because a column that could not search natively is stored as the fallback it
 * got, not as what the user picked. With no rounds at all, the defaults.
 */
export function composerStateFor(graph: ConversationGraph, settings: PersistedSettings): ConversationPrefs {
  if (graph.conversation.prefs) return graph.conversation.prefs

  const leaf = graph.turns.find((turn) => turn.id === graph.conversation.activeLeafTurnId)
  const replies = leaf ? graph.replies.filter((reply) => reply.turnId === leaf.id && reply.active) : []
  if (!leaf || !replies.length) return newConversationPrefs(settings)

  const modes = replies.map((reply) => reply.opts.search)
  const search: SearchMode = modes.includes('native') ? 'native' : (modes.find((mode) => mode !== 'none') ?? 'none')
  return {
    reasoning: replies[0].opts.reasoning,
    laneReasoning: Object.fromEntries(replies.map((reply) => [reply.laneId, reply.opts.reasoning])),
    search,
    excludedLaneIds: leaf.skippedLaneIds ?? [],
  }
}

/**
 * Sends a message: creates a turn, one pending reply per visible lane, and
 * starts the streams.
 *
 * When only one lane is visible this is an ordinary chat message; the code path
 * is identical for N lanes.
 */
export async function sendMessage(text: string, attachments: Attachment[] = []): Promise<void> {
  const state = useStore.getState()
  if (!text.trim() && !attachments.length) return

  const graph = state.graph ?? (await ensureConversation())
  if (!graph) return

  const lanes = visibleLanes(graph.conversation.lanes)
  const targets = sendTargets(lanes, state.excludedLaneIds, state.focusedLaneId)
  if (!targets.length) return
  const skipped = lanes.filter((lane) => !targets.includes(lane)).map((lane) => lane.id)

  const turn: Turn = {
    id: uid('turn'),
    conversationId: graph.conversation.id,
    parentTurnId: graph.conversation.activeLeafTurnId,
    text: text.trim(),
    attachments: attachments.length ? attachments : undefined,
    skippedLaneIds: skipped.length ? skipped : undefined,
    createdAt: Date.now(),
  }

  const replies: Reply[] = targets.map((lane) => {
    const provider = state.providers.find((entry) => entry.id === lane.model.providerId)
    const capabilities = provider
      ? capabilitiesFor(provider, lane.model.modelId)
      : { nativeSearch: false, thinking: 'none' as const, tools: false, vision: false }

    return {
      id: uid('reply'),
      turnId: turn.id,
      laneId: lane.id,
      model: lane.model,
      version: 1,
      active: true,
      status: 'pending',
      text: '',
      steps: [],
      sources: [],
      opts: {
        reasoning: state.laneReasoning[lane.id] ?? state.composerReasoning,
        search: resolveSearchMode(state.composerSearch, capabilities),
      },
      createdAt: Date.now(),
    }
  })

  // Optimistic graph update: the user sees their message and all N columns
  // immediately, before anything is written to disk.
  const nextGraph: ConversationGraph = {
    conversation: {
      ...graph.conversation,
      activeLeafTurnId: turn.id,
      updatedAt: Date.now(),
    },
    turns: [...graph.turns, turn],
    replies: [...graph.replies, ...replies],
  }
  useStore.getState().setGraph(nextGraph)

  for (const reply of replies) useStore.getState().startLive(reply)

  if (!(await persistAndStart(nextGraph, turn, replies))) return

  // Sending bumps `updated_at`, which reorders the sidebar; reflect it now
  // rather than on the next unrelated refresh.
  void refreshSummaries()

  // Auto-title only on the first turn, and only if the title is still the
  // placeholder — renaming a conversation the user named themselves would be a
  // surprise. A send with no message text — just a file — is named after the
  // file, which is the only thing the conversation is about.
  if (graph.turns.length === 0 && isPlaceholderTitle(graph.conversation.title)) {
    const seed = text.trim() || attachments[0]?.name || ''
    void maybeAutoTitle(graph.conversation, seed, state.settings.autoTitle && Boolean(text.trim()))
  }
}

/**
 * Writes a new turn and its pending replies, then starts the streams.
 *
 * The writes run one at a time. The SQL plugin hands each statement to
 * whichever pooled connection is free, so issuing them together let a reply's
 * INSERT race the turn it references — a lost race failed the whole batch, the
 * streams never started, and the columns sat empty with no error anywhere.
 *
 * A write that still fails marks every column with the reason instead, so the
 * turn is never left waiting on a stream that was never opened.
 */
async function persistAndStart(graph: ConversationGraph, turn: Turn, replies: Reply[]): Promise<boolean> {
  try {
    await db.insertTurnsWithReplies([turn], replies)
    await db.setActiveLeaf(graph.conversation.id, turn.id)
    // Recorded with every send, so reopening the conversation picks up where
    // this message left the composer.
    await db.updateConversationPrefs(graph.conversation.id, composerPrefs())
  } catch (error) {
    const message = t(chat.saveFailed, { reason: error instanceof Error ? error.message : String(error) })
    for (const reply of replies) {
      useStore.getState().finishLive(reply.id, { ...reply, status: 'error', error: message })
    }
    return false
  }
  runEngine(graph, replies)
  return true
}

/** Starts the engine for a set of replies that are already in the store. */
function runEngine(graph: ConversationGraph, replies: Reply[]): void {
  const state = useStore.getState()

  currentTurn = startTurn(graph, replies, {
    providers: state.providers,
    systemPrompt: state.settings.systemPrompt,
    onReplyUpdate(replyId, patch) {
      useStore.getState().patchLive(replyId, patch)
    },
    onReplyDone(replyId) {
      const current = useStore.getState()
      const live = current.live[replyId]
      const reply = current.graph?.replies.find((entry) => entry.id === replyId)
      if (!reply) return

      // Fold the live buffer into the durable reply, then persist.
      const settled: Reply = {
        ...reply,
        text: live?.text ?? reply.text,
        reasoning: live?.reasoning ?? reply.reasoning,
        reasoningMs: live?.reasoningMs ?? reply.reasoningMs,
        steps: live?.steps ?? reply.steps,
        sources: live?.sources ?? reply.sources,
        usage: live?.usage ?? reply.usage,
        status: live?.status === 'pending' ? 'done' : (live?.status ?? reply.status),
      }

      current.finishLive(replyId, settled)

      void db.updateReplyProgress(replyId, {
        text: settled.text,
        reasoning: settled.reasoning,
        reasoningMs: settled.reasoningMs,
        steps: settled.steps,
        sources: settled.sources,
        usage: settled.usage,
        status: settled.status,
      })
    },
    onError(replyId, message) {
      const current = useStore.getState()
      current.patchLive(replyId, { status: 'error', error: message })

      const reply = current.graph?.replies.find((entry) => entry.id === replyId)
      const live = current.live[replyId]
      if (reply) {
        current.finishLive(replyId, {
          ...reply,
          status: 'error',
          error: message,
          text: live?.text ?? '',
        })
      }
      void db.updateReplyProgress(replyId, { status: 'error', error: message })
    },
  })
}

/**
 * Regenerates one lane's answer for a turn.
 *
 * A new version is inserted rather than replacing the old one, so the user can
 * page between attempts — and only this lane is affected, leaving the other
 * columns' answers intact for comparison.
 */
export async function regenerate(turnId: string, laneId: string): Promise<void> {
  const state = useStore.getState()
  const graph = state.graph
  if (!graph) return

  const lane = graph.conversation.lanes.find((entry) => entry.id === laneId)
  if (!lane) return

  const version = await db.nextReplyVersion(turnId, laneId)
  const provider = state.providers.find((entry) => entry.id === lane.model.providerId)
  const capabilities = provider
    ? capabilitiesFor(provider, lane.model.modelId)
    : { nativeSearch: false, thinking: 'none' as const, tools: false, vision: false }

  const reply: Reply = {
    id: uid('reply'),
    turnId,
    laneId,
    model: lane.model,
    version,
    active: true,
    status: 'pending',
    text: '',
    steps: [],
    sources: [],
    // Like every send, a regenerate goes out as the composer is set now.
    opts: {
      reasoning: state.laneReasoning[laneId] ?? state.composerReasoning,
      search: resolveSearchMode(state.composerSearch, capabilities),
    },
    createdAt: Date.now(),
  }

  const nextGraph: ConversationGraph = {
    ...graph,
    replies: [
      // Deactivate the previous version for this lane only.
      ...graph.replies.map((existing) =>
        existing.turnId === turnId && existing.laneId === laneId
          ? { ...existing, active: false }
          : existing,
      ),
      reply,
    ],
  }

  useStore.getState().setGraph(nextGraph)
  useStore.getState().startLive(reply)
  await db.insertReply(reply)

  // Refresh the persisted active flags to match.
  await db.activateReplyVersion(turnId, laneId, reply.id)
  await db.updateConversationPrefs(graph.conversation.id, composerPrefs())

  runEngine(nextGraph, [reply])
}

/** Switches a lane to a different model and regenerates that column. */
export async function switchLaneModel(
  laneId: string,
  model: { providerId: string; modelId: string },
): Promise<void> {
  const state = useStore.getState()
  const graph = state.graph
  if (!graph) return

  const nextLanes = graph.conversation.lanes.map((lane) =>
    lane.id === laneId ? { ...lane, model } : lane,
  )

  useStore.getState().setGraph({
    ...graph,
    conversation: { ...graph.conversation, lanes: nextLanes },
  })

  await db.updateLaneModel(laneId, model)
}

/**
 * Adds a column comparing another model in the same conversation.
 *
 * A model the conversation already has a removed column for gets that column
 * back — with its answers — rather than a second, empty one: one column per
 * model, so "add GPT-5 again" can only mean the GPT-5 that was here.
 */
export async function addLane(model: { providerId: string; modelId: string }): Promise<void> {
  const graph = useStore.getState().graph
  if (!graph) return
  if (visibleLanes(graph.conversation.lanes).length >= MAX_LANES) return

  const removed = graph.conversation.lanes.find(
    (lane) => lane.hidden && lane.model.providerId === model.providerId && lane.model.modelId === model.modelId,
  )
  if (removed) return restoreLane(removed.id)

  // New lanes descend from the first visible lane, inheriting its history.
  const parent = visibleLanes(graph.conversation.lanes)[0]
  const lane: Lane = {
    id: uid('lane'),
    model,
    parentLaneId: parent?.id,
  }

  const nextGraph: ConversationGraph = {
    ...graph,
    conversation: {
      ...graph.conversation,
      lanes: [...graph.conversation.lanes, lane],
    },
  }

  // A column added while one is focused is meant to be seen.
  useStore.getState().setFocusedLane(null)
  useStore.getState().setGraph(nextGraph)
  useStore.getState().setComposerModel(model)
  await db.addLane(graph.conversation.id, lane, graph.conversation.lanes.length)
}

/**
 * Takes a column out of the comparison.
 *
 * The column is hidden, not deleted: its answers stay in the conversation and
 * `restoreLane` brings them back. It also stays in the lane chain, so columns
 * that inherited history from it keep resolving to the same answers they were
 * given as context.
 */
export async function removeLane(laneId: string): Promise<void> {
  const state = useStore.getState()
  const graph = state.graph
  if (!graph) return

  const lanes = visibleLanes(graph.conversation.lanes)
  // Never remove the last column: a conversation with no lanes has no composer.
  if (!lanes.some((lane) => lane.id === laneId) || lanes.length < 2) return

  // An answer still streaming into it is stopped and kept as it stands.
  stopLane(laneId)
  if (state.excludedLaneIds.includes(laneId)) state.toggleLaneExcluded(laneId)

  useStore.getState().setGraph(setLaneHidden(graph, laneId, true))
  await db.updateLaneVisibility(laneId, true)
}

/** Brings a removed column back, with every answer it gave. */
export async function restoreLane(laneId: string): Promise<void> {
  const graph = useStore.getState().graph
  if (!graph) return
  const lane = graph.conversation.lanes.find((entry) => entry.id === laneId)
  if (!lane?.hidden || visibleLanes(graph.conversation.lanes).length >= MAX_LANES) return

  useStore.getState().setFocusedLane(null)
  useStore.getState().setGraph(setLaneHidden(graph, laneId, false))
  await db.updateLaneVisibility(laneId, false)
}

function setLaneHidden(graph: ConversationGraph, laneId: string, hidden: boolean): ConversationGraph {
  return {
    ...graph,
    conversation: {
      ...graph.conversation,
      lanes: graph.conversation.lanes.map((lane) => (lane.id === laneId ? { ...lane, hidden: hidden || undefined } : lane)),
    },
  }
}

/** Edits a previous question, branching the conversation from that point. */
export async function editTurn(turnId: string, newText: string): Promise<void> {
  const state = useStore.getState()
  const graph = state.graph
  if (!graph || !newText.trim()) return

  const original = graph.turns.find((turn) => turn.id === turnId)
  if (!original) return

  // An edit is sent like a new message: to the columns and with the search
  // mode the composer shows now.
  const lanes = visibleLanes(graph.conversation.lanes)
  const targets = sendTargets(lanes, state.excludedLaneIds, state.focusedLaneId)
  if (!targets.length) return
  const skipped = lanes.filter((lane) => !targets.includes(lane)).map((lane) => lane.id)

  const turn: Turn = {
    id: uid('turn'),
    conversationId: graph.conversation.id,
    parentTurnId: original.parentTurnId,
    text: newText.trim(),
    // An edit replaces the question, not the files it was asked about.
    attachments: original.attachments,
    skippedLaneIds: skipped.length ? skipped : undefined,
    createdAt: Date.now(),
  }

  const replies: Reply[] = targets.map((lane) => {
    const provider = state.providers.find((entry) => entry.id === lane.model.providerId)
    const capabilities = provider
      ? capabilitiesFor(provider, lane.model.modelId)
      : { nativeSearch: false, thinking: 'none' as const, tools: false, vision: false }
    return {
      id: uid('reply'),
      turnId: turn.id,
      laneId: lane.id,
      model: lane.model,
      version: 1,
      active: true,
      status: 'pending',
      text: '',
      steps: [],
      sources: [],
      opts: {
        reasoning: state.laneReasoning[lane.id] ?? state.composerReasoning,
        search: resolveSearchMode(state.composerSearch, capabilities),
      },
      createdAt: Date.now(),
    }
  })

  const nextGraph: ConversationGraph = {
    conversation: {
      ...graph.conversation,
      activeLeafTurnId: turn.id,
      updatedAt: Date.now(),
    },
    turns: [...graph.turns, turn],
    replies: [...graph.replies, ...replies],
  }

  useStore.getState().setGraph(nextGraph)
  for (const reply of replies) useStore.getState().startLive(reply)

  await persistAndStart(nextGraph, turn, replies)
}

/** Moves the visible branch to one of a turn's siblings (‹1/2› navigation). */
export async function selectBranch(turnId: string): Promise<void> {
  const state = useStore.getState()
  const graph = state.graph
  if (!graph) return

  useStore.getState().setGraph({
    ...graph,
    conversation: { ...graph.conversation, activeLeafTurnId: turnId },
  })
  await db.setActiveLeaf(graph.conversation.id, turnId)
}

/** Switches which version of one lane's answer is shown. */
export async function selectReplyVersion(turnId: string, laneId: string, replyId: string): Promise<void> {
  const state = useStore.getState()
  const graph = state.graph
  if (!graph) return

  const nextGraph: ConversationGraph = {
    ...graph,
    replies: graph.replies.map((reply) =>
      reply.turnId === turnId && reply.laneId === laneId
        ? { ...reply, active: reply.id === replyId }
        : reply,
    ),
  }

  useStore.getState().setGraph(nextGraph)
  await db.activateReplyVersion(turnId, laneId, replyId)
}

/**
 * Creates a conversation answered by `model`, plus a column for each of
 * `compare`. The compared columns descend from the first, as if added with 对比.
 */
export async function createConversation(
  model: ModelRef,
  options: {
    compare?: ModelRef[]
    prefs?: ConversationPrefs
    forkedFrom?: Conversation['forkedFrom']
    now?: number
  } = {},
): Promise<Conversation> {
  const first: Lane = { id: uid('lane'), model }
  const lanes: Lane[] = [
    first,
    ...(options.compare ?? []).map((entry) => ({ id: uid('lane'), model: entry, parentLaneId: first.id })),
  ]
  const conversation: Conversation = {
    id: uid('conv'),
    title: placeholderTitle(),
    pinned: false,
    createdAt: options.now ?? Date.now(),
    updatedAt: options.now ?? Date.now(),
    forkedFrom: options.forkedFrom,
    lanes,
    prefs: options.prefs,
  }

  await db.createConversation(conversation.id, conversation.title, lanes, conversation.prefs, {
    forkedFrom: options.forkedFrom,
    updatedAt: options.now,
  })
  return conversation
}

/**
 * The title a conversation carries until it is named.
 *
 * Read at the moment it is used, not once at module load: a conversation
 * created while the app is in English would otherwise be filed under a Chinese
 * placeholder, and the "has it been named yet?" checks below compare against
 * whichever language was current when the conversation was made.
 */
export function placeholderTitle(): string {
  return t(chat.placeholderTitle)
}

/**
 * Whether `title` is still the unnamed placeholder — in either language, since
 * the interface can be switched after a conversation exists.
 */
function isPlaceholderTitle(title: string): boolean {
  const entry = chat.placeholderTitle
  return title === entry.en || title === entry.zh
}

/**
 * Names a new conversation from its first message.
 *
 * With auto-titling on, the conversation's own model writes a short summary;
 * with it off, or if that call fails, the question itself (truncated) is the
 * title. Either way the conversation never stays 新对话 — a sidebar full of
 * identical placeholders is the bug this exists to prevent.
 *
 * Reasoning models spend output tokens thinking before they write, so the
 * budget is generous and reasoning is turned down where the provider allows;
 * a 40-token cap used to be exhausted before the title began.
 */
async function maybeAutoTitle(
  conversation: Conversation,
  firstMessage: string,
  useModel: boolean,
): Promise<void> {
  let title = fallbackTitle(firstMessage)

  if (useModel) {
    const state = useStore.getState()
    const lane = conversation.lanes[0]
    const provider = state.providers.find((entry) => entry.id === lane.model.providerId)
    if (provider) {
      try {
        const { instructions, prompt } = titlePrompt(firstMessage)
        const capabilities = capabilitiesFor(provider, lane.model.modelId)
        const result = await generateText({
          model: createModel(provider, lane.model.modelId),
          instructions,
          prompt,
          maxOutputTokens: capabilities.thinking === 'none' ? 64 : 1024,
          providerOptions: providerOptionsFor(provider.kind, 'off', capabilities.thinking),
        })
        title = cleanTitle(result.text) || title
      } catch (error) {
        // Cosmetic: keep the fallback, but leave a trace for whoever debugs it.
        console.warn('[hmmchat] auto-title failed', error)
      }
    }
  }

  if (!title) return

  // The user may have renamed it while the call was in flight.
  const current = useStore.getState()
  const listed = current.summaries.find((entry) => entry.id === conversation.id)
  if (listed && !isPlaceholderTitle(listed.title)) return

  await db.renameConversation(conversation.id, title)

  const graph = useStore.getState().graph
  if (graph?.conversation.id === conversation.id) {
    useStore.getState().setGraph({ ...graph, conversation: { ...graph.conversation, title } })
  }
  await refreshSummaries()
}

/**
 * Forks a conversation at one turn.
 *
 * "Fork" here means: take the questions and answers up to and including this
 * turn — the exact context the model had at that point — and start a new
 * conversation from it, so the user can take a different direction without
 * losing the thread they were on.
 *
 * The copy itself, and why it is one, is `copyConversation`.
 */
export async function forkFromTurn(turnId: string): Promise<string | null> {
  const graph = useStore.getState().graph
  if (!graph) return null

  const path = pathToTurn(graph, turnId)
  if (!path.length) return null

  // The title is the fork's most useful label: where it came from, and the
  // point it was cut at.
  const sourceTitle = graph.conversation.title
  const cutTitle = fallbackTitle(path[path.length - 1].text || sourceTitle)
  const id = await copyConversation(graph, path, {
    title: `${sourceTitle} · ${cutTitle}`,
    activeLeafTurnId: turnId,
    forkedFrom: { conversationId: graph.conversation.id, turnId },
    // A fork carries on from the same composer the source was last sent with.
    prefs: graph.conversation.prefs,
  })

  await openConversation(id)
  await refreshSummaries()
  return id
}

/**
 * Duplicates a whole conversation: every branch, every answer version, every
 * column, and the conversation's own settings. Unlike a fork it is not cut at
 * a point and records no provenance — it is the same conversation twice, so
 * one copy can be taken somewhere new while the other stays as it was.
 */
export async function duplicateConversation(conversationId: string): Promise<string | null> {
  const graph = await db.loadGraph(conversationId)
  if (!graph) return null

  const id = await copyConversation(graph, graph.turns, {
    title: `${graph.conversation.title}（${t(chat.duplicateSuffix)}）`,
    activeLeafTurnId: graph.conversation.activeLeafTurnId,
    prefs: graph.conversation.prefs,
  })

  await openConversation(id)
  await refreshSummaries()
  return id
}

/**
 * Writes a copy of `turns` from `graph` as a new conversation and returns its id.
 *
 * A copy rather than a pointer into the original's history. The graph model is
 * a tree per conversation, so sharing turns between two conversations would mean
 * either a second tree or a rewrite of every ancestor walk (`activePath`,
 * `replyFor`, `siblingTurns`) to span conversations. A copy costs a few hundred
 * rows once, keeps every one of those walks correct and untouched, and — the
 * part that matters to a user — means editing the original afterwards cannot
 * silently change what the copy already contains.
 *
 * Replies are copied as they stand, including the alternative versions, so the
 * ‹1/2› pager still works in the copy.
 */
async function copyConversation(
  graph: ConversationGraph,
  turns: Turn[],
  options: {
    title: string
    activeLeafTurnId?: string
    forkedFrom?: Conversation['forkedFrom']
    prefs?: Conversation['prefs']
  },
): Promise<string> {
  const now = Date.now()
  const idMap = new Map<string, string>()

  // Lanes are copied first so the replies can point at the new ones. A lane's
  // parent must be remapped too, or `replyFor` would look up a lane that lives
  // in the original conversation.
  const lanes: Lane[] = graph.conversation.lanes.map((lane) => {
    const nextId = uid('lane')
    idMap.set(lane.id, nextId)
    return { ...lane, id: nextId }
  })
  for (const lane of lanes) {
    if (lane.parentLaneId) lane.parentLaneId = idMap.get(lane.parentLaneId)
  }

  // Turn ids get their own map: the parent chain must point at the copied
  // turns, not be looked up among the lanes (which silently dropped every
  // parent and left the fork showing only its last question).
  const turnIds = new Map(turns.map((turn) => [turn.id, uid('turn')]))
  const copiedTurns: Turn[] = turns.map((turn) => ({
    ...turn,
    id: turnIds.get(turn.id)!,
    parentTurnId: turn.parentTurnId ? turnIds.get(turn.parentTurnId) : undefined,
    skippedLaneIds: turn.skippedLaneIds?.flatMap((laneId) => idMap.get(laneId) ?? []),
  }))

  const replies: Reply[] = graph.replies
    .filter((reply) => turnIds.has(reply.turnId) && idMap.has(reply.laneId))
    .map((reply) => ({
      ...reply,
      id: uid('reply'),
      turnId: turnIds.get(reply.turnId)!,
      laneId: idMap.get(reply.laneId)!,
      // A copy has no work in flight; a reply frozen at `streaming` would never
      // finish and would render as a live column forever.
      status: reply.status === 'pending' || reply.status === 'streaming' ? 'stopped' : reply.status,
    }))

  const conversation = await createConversation(
    lanes[0]?.model ?? { providerId: '', modelId: '' },
    { forkedFrom: options.forkedFrom, now },
  )
  // The copies are built before the conversation exists, so they are pointed
  // at its id here — `createConversation` picks the id, not this function.
  for (const turn of copiedTurns) turn.conversationId = conversation.id

  try {
    await db.renameConversation(conversation.id, options.title)
    // The composer state names lanes by id, and every lane was given a new one.
    const prefs = options.prefs && {
      ...options.prefs,
      laneReasoning: Object.fromEntries(
        Object.entries(options.prefs.laneReasoning ?? {}).flatMap(([laneId, level]) =>
          idMap.has(laneId) ? [[idMap.get(laneId)!, level]] : [],
        ),
      ),
      excludedLaneIds: options.prefs.excludedLaneIds?.flatMap((laneId) => idMap.get(laneId) ?? []),
    }
    if (prefs) await db.updateConversationPrefs(conversation.id, prefs)
    await db.replaceLanes(conversation.id, lanes)
    await db.insertTurnsWithReplies(copiedTurns, replies)
    const leaf = options.activeLeafTurnId ? turnIds.get(options.activeLeafTurnId) : undefined
    await db.setActiveLeaf(conversation.id, leaf ?? null)
  } catch (error) {
    // A half-written copy — a title with no messages — is worse than none.
    await db.deleteConversation(conversation.id).catch(() => undefined)
    await refreshSummaries()
    throw error
  }

  return conversation.id
}

/** Reloads the sidebar list. */
export async function refreshSummaries(query?: string): Promise<void> {
  const summaries = await db.listConversations(query)
  useStore.getState().setSummaries(summaries)
}

/** Loads a conversation's full graph into the store. */
export async function openConversation(conversationId: string): Promise<void> {
  stopTurn()
  useStore.getState().setLoadingGraph(true)
  const graph = await db.loadGraph(conversationId)
  useStore.getState().setGraph(graph)
  if (graph) useStore.getState().restoreComposer(composerStateFor(graph, useStore.getState().settings))
}

/** The provider list, as the engine needs it. */
export async function loadProviders(): Promise<void> {
  const rows = await db.listProviders()
  const providers: ProviderConfig[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind as ProviderConfig['kind'],
    name: row.name,
    baseUrl: row.base_url,
    enabled: row.enabled === 1,
    models: parseModels(row.models),
    reasoningWire: (row.reasoning_wire as ProviderConfig['reasoningWire']) ?? undefined,
  }))
  useStore.getState().setProviders(providers)
}

function parseModels(raw: string): ProviderConfig['models'] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ProviderConfig['models']) : []
  } catch {
    return []
  }
}
