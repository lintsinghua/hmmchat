import { create } from 'zustand'
import type {
  ConversationGraph,
  ConversationPrefs,
  Lane,
  ModelRef,
  ReasoningLevel,
  Reply,
  SearchStep,
  Source,
  TokenUsage,
} from './types'
import { visibleLanes } from './types'
import type { ConversationSummary } from '@/lib/db'
import type { ProviderConfig } from '@/providers/registry'
import type { SearchMode } from './types'
import { defaultShortcuts, type ShortcutMap } from '@/lib/shortcuts'
import type { Language } from '@/i18n/core'

/**
 * Application state.
 *
 * The one non-obvious decision: **streaming text does not live in the graph**.
 * It lives in a separate `live` map keyed by reply id. Patching the graph on
 * every frame would replace the replies array, re-rendering every column; with
 * the live map, a column subscribes to exactly its own entry and the other
 * columns do not re-render at all. That is what keeps four simultaneous streams
 * smooth.
 *
 * When a reply settles, its text is written into the graph once and the live
 * entry is dropped.
 */

export interface LiveReply {
  text: string
  reasoning?: string
  reasoningMs?: number
  steps: SearchStep[]
  sources: Source[]
  status: Reply['status']
  usage?: TokenUsage
  error?: string
}

export interface PersistedSettings {
  theme: 'light' | 'dark' | 'system'
  /**
   * Interface language. Absent means Chinese — the language the app was written
   * in, so an install that predates this setting does not change on upgrade.
   */
  uiLanguage?: Language
  systemPrompt: string
  /** Names a new conversation from its first message. */
  autoTitle: boolean
  sidebarWidth: number
  /** Binding per action; a missing entry means the action's default. */
  shortcuts?: ShortcutMap
  /**
   * The model that answers a new conversation; absent means the last one used.
   * These `default*` fields only start new conversations — an existing one
   * carries on from its own last send.
   */
  defaultModel?: ModelRef
  /** Models compared alongside it from the first message. */
  defaultCompareModels?: ModelRef[]
  defaultSearch: SearchMode
  defaultReasoning?: ReasoningLevel
  /** Custom instructions appended to the turn's system prompt per lane. */
  transcriptPrefs?: never
}

const DEFAULT_SETTINGS: PersistedSettings = {
  theme: 'system',
  uiLanguage: 'zh',
  systemPrompt: '',
  autoTitle: true,
  sidebarWidth: 248,
  defaultSearch: 'native',
  defaultReasoning: 'medium',
  shortcuts: defaultShortcuts(),
}

interface State {
  // --- Conversations -------------------------------------------------------
  summaries: ConversationSummary[]
  graph: ConversationGraph | null
  loadingGraph: boolean

  // --- Providers -----------------------------------------------------------
  providers: ProviderConfig[]
  settings: PersistedSettings

  // --- Live streaming ------------------------------------------------------
  live: Record<string, LiveReply>
  /** replyIds currently streaming, for the stop button and composer state. */
  running: string[]

  // --- Composer state for the active conversation --------------------------
  /** The model shown in the composer's model chip. */
  composerModel: { providerId: string; modelId: string } | null
  composerReasoning: ReasoningLevel
  /**
   * Depth chosen for one column, keyed by lane id. A lane with no entry uses
   * `composerReasoning`, which is also what a single-column chat sets.
   */
  laneReasoning: Record<string, ReasoningLevel>
  /**
   * Columns the next message will not be sent to. Stays until changed, so a
   * follow-up with one model can run for several turns; see `sendTargets`.
   */
  excludedLaneIds: string[]
  /**
   * The one column shown on its own, when the user asks to read a single
   * model's conversation. A view, not a removal: the other columns are kept,
   * and only sends while focused leave them out. Session-only; cleared when the
   * conversation changes or the column stops being visible.
   */
  focusedLaneId: string | null
  /** Column currently being dragged in the composer or transcript. */
  draggingLaneId: string | null
  /**
   * The quote-a-conversation dialog, when open. `conversationId` skips straight
   * to choosing rounds — the sidebar's quote action knows which one it means.
   */
  referencePicker: { conversationId?: string } | null
  composerSearch: SearchMode

  // --- UI ------------------------------------------------------------------
  sidebarOpen: boolean
  commandPaletteOpen: boolean
  settingsOpen: boolean

  // --- Actions -------------------------------------------------------------
  setSummaries: (summaries: ConversationSummary[]) => void
  setGraph: (graph: ConversationGraph | null) => void
  setLoadingGraph: (loading: boolean) => void
  setProviders: (providers: ProviderConfig[]) => void
  setSettings: (settings: Partial<PersistedSettings>) => void

  startLive: (reply: Reply) => void
  patchLive: (replyId: string, patch: Partial<LiveReply>) => void
  finishLive: (replyId: string, reply: Reply) => void

  setComposerModel: (model: { providerId: string; modelId: string } | null) => void
  setComposerReasoning: (level: ReasoningLevel) => void
  setLaneReasoning: (laneId: string, level: ReasoningLevel) => void
  toggleLaneExcluded: (laneId: string) => void
  includeAllLanes: () => void
  setFocusedLane: (laneId: string | null) => void
  setDraggingLane: (laneId: string | null) => void
  setReferencePicker: (picker: { conversationId?: string } | null) => void
  setComposerSearch: (mode: SearchMode) => void
  /** Puts the composer back the way a conversation was last sent. */
  restoreComposer: (prefs: ConversationPrefs) => void

  toggleSidebar: () => void
  setCommandPaletteOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void

  reset: () => void
}

export const useStore = create<State>((set, get) => ({
  summaries: [],
  graph: null,
  loadingGraph: false,
  providers: [],
  settings: DEFAULT_SETTINGS,
  live: {},
  running: [],
  composerModel: null,
  composerReasoning: 'medium',
  laneReasoning: {},
  excludedLaneIds: [],
  focusedLaneId: null,
  draggingLaneId: null,
  referencePicker: null,
  // Overwritten at boot from the settings, and on every open from the
  // conversation's own last send; this is only the value before either runs.
  composerSearch: 'native',
  sidebarOpen: true,
  commandPaletteOpen: false,
  settingsOpen: false,

  setSummaries: (summaries) => set({ summaries }),
  setGraph: (graph) => {
    const previous = get().graph
    set({ graph, loadingGraph: false })

    // Keep the composer pointing at a lane that exists.
    const lanes = graph ? visibleLanes(graph.conversation.lanes) : []
    const current = get().composerModel
    const stillValid =
      current && lanes.some((lane) => lane.model.modelId === current.modelId && lane.model.providerId === current.providerId)

    if (!stillValid && lanes[0]) set({ composerModel: lanes[0].model })

    // Focus belongs to one conversation and one visible column of it.
    const focused = get().focusedLaneId
    if (
      focused &&
      (previous?.conversation.id !== graph?.conversation.id || lanes.length < 2 || !lanes.some((lane) => lane.id === focused))
    ) {
      set({ focusedLaneId: null })
    }
    if (previous?.conversation.id !== graph?.conversation.id) {
      set({ draggingLaneId: null })
    }
  },
  setLoadingGraph: (loadingGraph) => set({ loadingGraph }),
  setProviders: (providers) => set({ providers }),
  setSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

  startLive: (reply) =>
    set((state) => ({
      live: {
        ...state.live,
        [reply.id]: {
          text: '',
          steps: [],
          sources: [],
          status: 'pending',
        },
      },
      running: state.running.includes(reply.id)
        ? state.running
        : [...state.running, reply.id],
    })),

  patchLive: (replyId, patch) =>
    set((state) => {
      const existing = state.live[replyId]
      if (!existing) return state
      return {
        live: {
          ...state.live,
          [replyId]: { ...existing, ...patch, status: patch.status ?? 'streaming' },
        },
      }
    }),

  finishLive: (replyId, reply) =>
    set((state) => {
      const { [replyId]: _dropped, ...rest } = state.live
      const graph = state.graph

      // Fold the settled reply into the graph once, so the live entry can go.
      const nextGraph = graph
        ? {
            ...graph,
            replies: graph.replies.map((existing) =>
              existing.id === reply.id ? reply : existing,
            ),
          }
        : graph

      return {
        live: rest,
        running: state.running.filter((id) => id !== replyId),
        graph: nextGraph,
      }
    }),

  setComposerModel: (composerModel) => set({ composerModel }),
  setComposerReasoning: (composerReasoning) => set({ composerReasoning }),
  setLaneReasoning: (laneId, level) =>
    set((state) => ({ laneReasoning: { ...state.laneReasoning, [laneId]: level } })),
  toggleLaneExcluded: (laneId) =>
    set((state) => ({
      excludedLaneIds: state.excludedLaneIds.includes(laneId)
        ? state.excludedLaneIds.filter((id) => id !== laneId)
        : [...state.excludedLaneIds, laneId],
    })),
  includeAllLanes: () => set({ excludedLaneIds: [] }),
  setFocusedLane: (focusedLaneId) => set({ focusedLaneId }),
  setDraggingLane: (draggingLaneId) => set({ draggingLaneId }),
  setReferencePicker: (referencePicker) => set({ referencePicker }),
  setComposerSearch: (composerSearch) => set({ composerSearch }),
  restoreComposer: (prefs) =>
    set({
      composerReasoning: prefs.reasoning,
      laneReasoning: prefs.laneReasoning ?? {},
      composerSearch: prefs.search,
      excludedLaneIds: prefs.excludedLaneIds ?? [],
    }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  reset: () =>
    set({
      graph: null,
      live: {},
      running: [],
      composerModel: null,
      focusedLaneId: null,
      draggingLaneId: null,
    }),
}))

// ---------------------------------------------------------------------------
// Selectors
//
// Exported as functions so components can subscribe narrowly.
// ---------------------------------------------------------------------------

export const selectLive = (replyId: string) => (state: State): LiveReply | undefined =>
  state.live[replyId]

export const selectIsRunning = (state: State): boolean => state.running.length > 0

export const selectProviderFor =
  (providerId: string) =>
  (state: State): ProviderConfig | undefined =>
    state.providers.find((provider) => provider.id === providerId)

/** Lanes currently rendered as columns. */
export const selectVisibleLanes = (state: State): Lane[] =>
  state.graph ? visibleLanes(state.graph.conversation.lanes) : []
