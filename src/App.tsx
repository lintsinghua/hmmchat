import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Columns2, Hand, PanelLeft, Paperclip, SquarePen } from 'lucide-react'
import { motion } from 'motion/react'

import { useStore, type PersistedSettings } from '@/chat/store'
import {
  createConversation,
  duplicateConversation,
  loadProviders,
  newConversationModels,
  newConversationPrefs,
  openConversation,
  refreshSummaries,
  stopTurn,
  switchLaneModel,
} from '@/chat/session'
import { visibleLanes } from '@/chat/types'
import { displayName } from '@/providers/registry'
import * as db from '@/lib/db'
import { hasTrafficLights } from '@/lib/env'
import { useTheme } from '@/hooks/useTheme'
import { COMPACT_QUERY, matchesNow, useCompact, useTouch } from '@/hooks/useMedia'
import { useViewportHeight } from '@/hooks/useViewportHeight'
import { useBackButton } from '@/hooks/useBackButton'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Tooltip, TooltipProvider } from '@/components/ui/Tooltip'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { Drawer, useEdgeSwipe } from '@/components/sidebar/Drawer'
import { Thread } from '@/components/thread/Thread'
import { Composer } from '@/components/composer/Composer'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { CommandPalette, resolveShortcuts, useGlobalShortcuts } from '@/components/palette/CommandPalette'
import { formatBindingText } from '@/lib/shortcuts'
import { getLanguage, setLanguage, useT } from '@/i18n/core'
import { app } from '@/i18n'

/**
 * Application shell.
 *
 * Layout is one sidebar and one thread — no right-hand panel, no second rail.
 * That is the whole structural argument of the app: the clutter in comparable
 * clients comes from stacking parallel panels, and a chat client needs one
 * column of navigation and one column of content.
 *
 * On a phone the same two pieces stack instead of sitting side by side: the
 * thread fills the screen and the sidebar becomes a drawer over it, opened from
 * the title bar or by swiping in from the left edge.
 */

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 360
const SIDEBAR_DEFAULT = 248

export function App() {
  const graph = useStore((state) => state.graph)
  const summaries = useStore((state) => state.summaries)
  const settings = useStore((state) => state.settings)
  const providers = useStore((state) => state.providers)
  const sidebarOpen = useStore((state) => state.sidebarOpen)
  const paletteOpen = useStore((state) => state.commandPaletteOpen)
  const settingsOpen = useStore((state) => state.settingsOpen)

  const setCommandPaletteOpen = useStore((state) => state.setCommandPaletteOpen)
  const setSettingsOpen = useStore((state) => state.setSettingsOpen)
  const toggleSidebar = useStore((state) => state.toggleSidebar)
  const setSidebarOpen = useStore((state) => state.setSidebarOpen)
  const composerModel = useStore((state) => state.composerModel)
  const setComposerModel = useStore((state) => state.setComposerModel)
  const focusedModelId = useStore((state) => {
    const lanes = state.graph ? visibleLanes(state.graph.conversation.lanes) : []
    return lanes.length > 1 ? lanes.find((lane) => lane.id === state.focusedLaneId)?.model.modelId : undefined
  })

  const [query, setQuery] = useState('')
  const [booted, setBooted] = useState(false)

  useTheme(settings.theme)
  useViewportHeight()

  const compact = useCompact()
  // Crossing the breakpoint — a window resized, a tablet rotated — puts the list
  // where that layout keeps it: beside the thread, or tucked behind the drawer.
  const wasCompact = useRef(compact)
  useEffect(() => {
    if (wasCompact.current === compact) return
    wasCompact.current = compact
    setSidebarOpen(!compact && !useStore.getState().settings.sidebarCollapsed)
  }, [compact, setSidebarOpen])
  // On a wide window, hiding the list is a preference and outlasts a restart.
  // The drawer's open and shut is not: a phone always opens on the chat.
  useEffect(() => {
    if (!booted || compact) return
    if (Boolean(settings.sidebarCollapsed) !== !sidebarOpen) {
      useStore.getState().setSettings({ sidebarCollapsed: !sidebarOpen })
    }
  }, [sidebarOpen, compact, booted, settings.sidebarCollapsed])
  // On a phone the drawer covers the chat, so anything picked in it closes it.
  const closeDrawer = useCallback(() => {
    if (compact) setSidebarOpen(false)
  }, [compact, setSidebarOpen])
  useEdgeSwipe(compact && !sidebarOpen, () => setSidebarOpen(true))
  useBackButton(() => {
    const state = useStore.getState()
    if (compact && state.sidebarOpen) {
      setSidebarOpen(false)
      return true
    }
    if (state.focusedLaneId) {
      state.setFocusedLane(null)
      return true
    }
    return false
  })

  // The interface language lives in settings but is read from the i18n module,
  // so the two are kept in step here: restored settings on boot, and whatever
  // 设置 → 通用 was last set to on every change.
  useEffect(() => {
    setLanguage(settings.uiLanguage === 'en' ? 'en' : 'zh')
  }, [settings.uiLanguage])
  // --- Bootstrap ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false

    void (async () => {
      // Settings first: the theme should be right on the first paint.
      const stored = await db.getSetting<PersistedSettings>('settings', settings)
      if (cancelled) return
      useStore.getState().setSettings(stored)
      if (stored.sidebarCollapsed && !matchesNow(COMPACT_QUERY)) setSidebarOpen(false)

      await loadProviders()
      await refreshSummaries()

      const list = useStore.getState().summaries
      if (list[0]) await openConversation(list[0].id)
      // Nothing to reopen: the composer starts as a new conversation would.
      else useStore.getState().restoreComposer(newConversationPrefs(useStore.getState().settings))

      if (!cancelled) setBooted(true)
    })()

    return () => {
      cancelled = true
    }
    // Runs once on mount; `settings` is only the fallback value here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist settings changes, debounced by the store's own batching.
  useEffect(() => {
    if (!booted) return
    void db.setSetting('settings', settings)
  }, [settings, booted])

  // --- Search filtering ---------------------------------------------------
  useEffect(() => {
    if (!booted) return
    const timer = window.setTimeout(() => {
      void refreshSummaries(query || undefined)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [query, booted])

  // --- Actions ------------------------------------------------------------
  const newChat = useCallback(async () => {
    // The configured default model first; without one, the model in use.
    const models = newConversationModels(providers, settings, [settings.defaultModel, composerModel])

    if (!models.length) {
      // With no provider configured there is nothing to chat with; the honest
      // response is to open settings rather than create an unusable chat.
      setSettingsOpen(true)
      return
    }

    const conversation = await createConversation(models[0], {
      compare: models.slice(1),
      prefs: newConversationPrefs(settings),
    })
    setComposerModel(models[0])
    await openConversation(conversation.id)
    await refreshSummaries()
    setQuery('')
  }, [composerModel, providers, settings, setComposerModel, setSettingsOpen])

  const selectModel = useCallback(
    (model: { providerId: string; modelId: string }) => {
      setComposerModel(model)
      // With a conversation open, switching the model replaces the active
      // lane's model — a plain "change the model" action for a single-column
      // chat, and a per-column switch when comparing.
      const lanes = graph?.conversation.lanes ?? []
      if (lanes.length === 1) void switchLaneModel(lanes[0].id, model)
      else if (lanes.length === 0) void newChat()
    },
    [graph, setComposerModel, newChat],
  )
  const shortcuts = useStore((state) => state.settings.shortcuts)
  const stopHint = useMemo(() => formatBindingText(resolveShortcuts(shortcuts).stop ?? 'Escape'), [shortcuts])
  const sidebarHint = useMemo(
    () => formatBindingText(resolveShortcuts(shortcuts).toggleSidebar ?? ''),
    [shortcuts],
  )

  useGlobalShortcuts(
    useMemo(
      () => ({
        onNewChat: () => void newChat(),
        onTogglePalette: () => setCommandPaletteOpen(!paletteOpen),
        onToggleSidebar: toggleSidebar,
        onOpenSettings: () => setSettingsOpen(true),
        onStop: stopTurn,
      }),
      [newChat, paletteOpen, setCommandPaletteOpen, toggleSidebar, setSettingsOpen],
    ),
  )

  const sidebar = (
    <Sidebar
      summaries={summaries}
      activeId={graph?.conversation.id ?? null}
      query={query}
      onQueryChange={setQuery}
      compact={compact}
      onCollapse={() => setSidebarOpen(false)}
      collapseShortcut={sidebarHint}
      onSelect={(id) => {
        closeDrawer()
        void openConversation(id)
      }}
      onNew={() => {
        closeDrawer()
        void newChat()
      }}
      onRename={async (id, title) => {
        await db.renameConversation(id, title)
        await refreshSummaries(query || undefined)
        if (graph?.conversation.id === id) {
          useStore
            .getState()
            .setGraph({ ...graph, conversation: { ...graph.conversation, title } })
        }
      }}
      onDelete={async (id) => {
        await db.deleteConversation(id)
        const remaining = (await db.listConversations()).filter((entry) => entry.id !== id)
        useStore.getState().setSummaries(remaining)
        if (graph?.conversation.id === id) {
          if (remaining[0]) await openConversation(remaining[0].id)
          else {
            useStore.getState().setGraph(null)
            useStore.getState().restoreComposer(newConversationPrefs(useStore.getState().settings))
          }
        }
      }}
      onTogglePin={async (id, pinned) => {
        await db.setPinned(id, pinned)
        await refreshSummaries(query || undefined)
      }}
      onDuplicate={(id) => {
        closeDrawer()
        void duplicateConversation(id)
      }}
      onQuote={(id) => {
        closeDrawer()
        useStore.getState().setReferencePicker({ conversationId: id })
      }}
      onOpenSettings={() => {
        closeDrawer()
        setSettingsOpen(true)
      }}
    />
  )

  const sidebarWidth = Math.min(
    SIDEBAR_MAX,
    Math.max(SIDEBAR_MIN, settings.sidebarWidth || SIDEBAR_DEFAULT),
  )

  return (
    <TooltipProvider>
      {/* Side insets: a phone on its side keeps the notch out of the content. */}
      <div className="flex h-full w-full overflow-hidden bg-canvas pl-safe pr-safe">
        {compact ? (
          <Drawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
            {sidebar}
          </Drawer>
        ) : (
          /*
            Width animates on a spring with no bounce. The content inside is not
            re-laid-out, so the labels do not reflow as it moves.
          */
          <motion.div
            initial={false}
            animate={{ width: sidebarOpen ? sidebarWidth : 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className="relative z-20 h-full shrink-0 overflow-hidden"
            style={{ minWidth: 0 }}
          >
            <div style={{ width: sidebarWidth }} className="h-full">
              {sidebar}
            </div>
          </motion.div>
        )}

        <main className="relative flex min-w-0 flex-1 flex-col">
          <TitleBar
            compact={compact}
            onNewChat={() => void newChat()}
            onToggleSidebar={toggleSidebar}
            sidebarOpen={sidebarOpen}
            sidebarShortcut={sidebarHint}
            title={graph?.conversation.title ?? ''}
            focus={focusedModelId ? displayName(focusedModelId) : undefined}
          />

          {graph && graph.turns.length > 0 ? (
            <Thread graph={graph} />
          ) : (
            <EmptyState hasProviders={providers.length > 0} onOpenSettings={() => setSettingsOpen(true)} />
          )}

          <Composer stopShortcut={stopHint} />
        </main>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onNewChat={() => void newChat()}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelectModel={selectModel}
      />
    </TooltipProvider>
  )
}

/**
 * The title strip: sidebar toggle, conversation title, drag region.
 *
 * On a phone it is a navigation bar instead — taller, under the status bar, with
 * the chat list on the left and a new chat on the right, because the sidebar's
 * own 新对话 is behind the drawer there and starting over is the commonest act.
 */
function TitleBar({
  title,
  focus,
  compact,
  sidebarOpen,
  sidebarShortcut,
  onToggleSidebar,
  onNewChat,
}: {
  title: string
  /** The model whose column is shown on its own, if any. */
  focus?: string
  compact: boolean
  sidebarOpen: boolean
  sidebarShortcut: string
  onToggleSidebar: () => void
  onNewChat: () => void
}) {
  const t = useT()
  if (compact) {
    return (
      <div className="pt-safe shrink-0">
        <div className="relative flex h-12 items-center justify-between px-1.5">
          <Button size="icon" onClick={onToggleSidebar} aria-label={t(app.showChats)} className="h-10 w-10">
            <PanelLeft className="h-[19px] w-[19px]" strokeWidth={1.75} />
          </Button>
          <div className="pointer-events-none absolute inset-x-14 flex justify-center">
            <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-medium text-ink">
              <span className="truncate">{title}</span>
              {focus ? (
                <>
                  <span className="shrink-0 text-ink-faint">/</span>
                  <span className="max-w-[40%] shrink-0 truncate text-ink-muted">{focus}</span>
                </>
              ) : null}
            </span>
          </div>
          <Button size="icon" onClick={onNewChat} aria-label={t(app.newChat)} className="h-10 w-10">
            <SquarePen className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div
      data-tauri-drag-region
      // A tablet has a status bar over the top edge, where a Mac has none.
      // With the sidebar hidden the traffic lights sit over this strip, so the
      // show toggle starts after them.
      className={cn(
        'pt-safe flex h-[calc(38px+env(safe-area-inset-top,0px))] shrink-0 items-center gap-1 px-3',
        hasTrafficLights && !sidebarOpen && 'pl-[78px]',
      )}
    >
      {!sidebarOpen ? (
        <Tooltip label={t(app.showSidebar)} shortcut={sidebarShortcut}>
          <Button size="icon-sm" onClick={onToggleSidebar} aria-label={t(app.showSidebar)}>
            <PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.75} />
          </Button>
        </Tooltip>
      ) : null}

      {/*
        The title is centred over the thread, macOS toolbar style: absolute so
        the toggle stays at the left edge regardless of title length. A focused
        column reads as a breadcrumb — whose side of the conversation this is —
        so it is still plain once the composer's pill has scrolled out of mind.
      */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <span className="flex max-w-[46%] items-center gap-1.5 text-[13px] font-medium text-ink-soft">
          <span className="truncate">{title}</span>
          {focus ? (
            <>
              <span className="shrink-0 text-ink-faint">/</span>
              <span className="shrink-0 text-ink-muted">{focus}</span>
            </>
          ) : null}
        </span>
      </div>
    </div>
  )
}

/**
 * The first-run and empty-conversation screen.
 *
 * The app's one piece of decoration, and the only place it uses a serif face.
 * The greeting types itself in and cycles through variants: a still headline on
 * the screen a user opens twenty times a day stops being read at all, while a
 * line that is still arriving is read again every time — which is the slot
 * where the hint about what to do belongs.
 *
 * Every phrase is something you would ask an assistant, not something about the
 * app. "想比较哪个模型" describes the product; "今天的股市怎么样" describes a
 * reason to be here. The second kind is what makes an empty screen feel like an
 * invitation rather than a control panel with nothing in it.
 */
const GREETINGS = [
  app.greetingAskAnything,
  app.greetingStockMarket,
  app.greetingSortMaterials,
  app.greetingBrokenCode,
  app.greetingDinner,
  app.greetingSchedule,
  app.greetingEmailReply,
  app.greetingContract,
] as const

function EmptyState({
  hasProviders,
  onOpenSettings,
}: {
  hasProviders: boolean
  onOpenSettings: () => void
}) {
  const t = useT()
  const language = getLanguage()
  // `t` is a stable reference; the language is what changes the phrases.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const greetings = useMemo(() => GREETINGS.map((entry) => t(entry)), [language])
  if (!hasProviders) return <SetupState onOpenSettings={onOpenSettings} />

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="animate-rise-in -mt-16 flex flex-col items-center gap-5">
        <Typewriter
          phrases={greetings}
          className="text-[30px] font-normal leading-tight tracking-[-0.01em] text-ink max-md:text-[24px]"
        />
        <HintChips />
      </div>
    </div>
  )
}

/**
 * The greeting, typed out and retyped.
 *
 * Two details make it read as intentional rather than as a broken animation.
 * The caret is a real element with a blink of its own, so it keeps ticking
 * between phrases instead of vanishing; and the whole thing is disabled under
 * `prefers-reduced-motion`, where it becomes the first phrase, static.
 *
 * Typing speed is not linear — a constant 60ms per character reads as a machine
 * printing. It is faster in the middle of a phrase and slower at its ends, which
 * is how a person writes.
 */
function Typewriter({ phrases, className }: { phrases: readonly string[]; className?: string }) {
  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState('')
  const [phase, setPhase] = useState<'typing' | 'holding' | 'deleting'>('typing')

  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced) {
      setShown(phrases[0])
      return
    }

    const phrase = phrases[index]

    if (phase === 'typing') {
      if (shown.length === phrase.length) {
        const hold = window.setTimeout(() => setPhase('deleting'), 2200)
        return () => window.clearTimeout(hold)
      }
      const next = phrase.slice(0, shown.length + 1)
      // Ease in from the start of a phrase and out at the end of one.
      const at = shown.length
      const speed = at < 3 ? 90 : at > phrase.length - 3 ? 70 : 46
      const timer = window.setTimeout(() => setShown(next), speed)
      return () => window.clearTimeout(timer)
    }

    if (phase === 'deleting') {
      if (!shown.length) {
        setIndex((value) => (value + 1) % phrases.length)
        setPhase('typing')
        return
      }
      // Deleting is quicker than typing; a symmetric delete reads as slow.
      const timer = window.setTimeout(() => setShown(shown.slice(0, -1)), 26)
      return () => window.clearTimeout(timer)
    }

    return
  }, [shown, phase, index, phrases, reduced])

  return (
    <h1 className={cn(className, 'flex items-center justify-center text-center')} aria-live="polite">
      {/* Wraps on a phone, where a long phrase is wider than the screen. */}
      <span className="whitespace-pre max-md:whitespace-pre-wrap">{shown}</span>
      <span className="tw-caret" aria-hidden />
    </h1>
  )
}

/** Tracks the reduced-motion preference, and keeps tracking it if it changes. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/**
 * What the app can do, as three quiet hints under the greeting.
 *
 * The affordances are named by the icons the composer actually uses — the
 * paperclip, the columns — because those are what the user has to find. Each
 * chip points at the control rather than describing it in prose, which is the
 * difference between a hint that is used and one that is read once.
 */
function HintChips() {
  const t = useT()
  const touch = useTouch()
  const compact = useCompact()
  const shortcuts = useStore((state) => state.settings.shortcuts)
  const paletteKeys = formatBindingText(resolveShortcuts(shortcuts).palette ?? '')

  // A finger has no files to drop and no keyboard for the palette, so the hints
  // name what it can do instead: the + button, Compare, the drawer swipe.
  const hints: Array<{ icon: React.ReactNode; text: string }> = touch
    ? [
        { icon: <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />, text: t(app.hintAttachTouch) },
        { icon: <Columns2 className="h-3.5 w-3.5" strokeWidth={1.75} />, text: t(app.hintCompareTouch) },
        ...(compact ? [{ icon: <Hand className="h-3.5 w-3.5" strokeWidth={1.75} />, text: t(app.hintSwipe) }] : []),
      ]
    : [
    { icon: <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />, text: t(app.hintDropFiles) },
    { icon: <Columns2 className="h-3.5 w-3.5" strokeWidth={1.75} />, text: t(app.hintCompare) },
    // The binding is the one the user actually has, not the shipped default.
    { icon: <Kbd>{paletteKeys}</Kbd>, text: t(app.hintPalette) },
      ]

  return (
    <ul className="flex flex-wrap items-center justify-center gap-2 max-md:flex-col max-md:gap-1">
      {hints.map((hint) => (
        <li
          key={hint.text}
          className="flex items-center gap-1.5 rounded-[var(--radius-full)] px-2.5 py-1 text-[12px] text-ink-muted"
        >
          <span className="text-ink-faint">{hint.icon}</span>
          {hint.text}
        </li>
      ))}
    </ul>
  )
}

/** A keycap, for hint chips that name a binding rather than an icon. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-line bg-surface px-1.5 py-px font-mono text-[10.5px] text-ink-muted">
      {children}
    </kbd>
  )
}

/**
 * First run: no provider yet.
 *
 * One sentence, one button. The card that stood here listed what the app does
 * with the key and which vendors it speaks — true, but it is an onboarding
 * screen, and a user who has not yet decided to use the app reads none of it.
 * The key's handling is stated at the point it is asked for, in settings, where
 * it is a fact about the field rather than a reason to trust a stranger.
 */
function SetupState({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useT()
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="animate-rise-in -mt-16 flex flex-col items-center">
        <h1
          className="text-[26px] font-normal leading-tight tracking-[-0.01em] text-ink"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {t(app.setupTitle)}
        </h1>

        <Button className="mt-5" variant="primary" size="sm" onClick={onOpenSettings}>
          {t(app.setupAction)}
        </Button>
      </div>
    </div>
  )
}

export { cn }
