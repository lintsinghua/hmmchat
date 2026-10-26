import { Command } from 'cmdk'
import { useEffect, useMemo } from 'react'
import {
  Columns2,
  Maximize2,
  MessageSquarePlus,
  PanelLeft,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react'

import { useStore } from '@/chat/store'
import { visibleLanes } from '@/chat/types'
import { displayName } from '@/providers/registry'
import { ModelIcon } from '@/components/icons/BrandIcon'
import { useAvailableModels } from '@/components/model/ModelPicker'
import { openConversation } from '@/chat/session'
import {
  SHORTCUTS,
  matchesBinding,
  type ShortcutId,
  type ShortcutMap,
} from '@/lib/shortcuts'
import { cn } from '@/lib/cn'
import { Dialog, DialogContent, DialogHiddenTitle, DIALOG_CLOSE_GUTTER } from '@/components/ui/Dialog'
import { getLanguage, useT } from '@/i18n/core'
import { app } from '@/i18n'

/**
 * The ⌘K palette.
 *
 * Commands and models live in one list: the two things a keyboard-first user
 * reaches for are "start something" and "switch what answers", and splitting
 * them across two overlays would be one overlay too many.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onNewChat,
  onOpenSettings,
  onSelectModel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewChat: () => void
  onOpenSettings: () => void
  onSelectModel: (model: { providerId: string; modelId: string }) => void
}) {
  const t = useT()
  const language = getLanguage()
  const summaries = useStore((state) => state.summaries)
  const models = useAvailableModels()
  const toggleSidebar = useStore((state) => state.toggleSidebar)
  const graph = useStore((state) => state.graph)
  const focusedLaneId = useStore((state) => state.focusedLaneId)
  const setFocusedLane = useStore((state) => state.setFocusedLane)

  // While comparing: each column can be shown on its own, and a focused one
  // can go back to the row — the keyboard path to the column headers' control.
  const columns = useMemo(() => {
    const lanes = graph ? visibleLanes(graph.conversation.lanes) : []
    if (lanes.length < 2) return []
    const focused = lanes.find((lane) => lane.id === focusedLaneId)
    if (focused) {
      return [{ id: 'unfocus', label: t(app.paletteUnfocus, { count: lanes.length }), hint: 'Esc', icon: Columns2, run: () => setFocusedLane(null) }]
    }
    return lanes.map((lane) => ({
      id: `focus-${lane.id}`,
      label: t(app.paletteFocusLane, { name: displayName(lane.model.modelId) }),
      hint: '',
      icon: Maximize2,
      run: () => setFocusedLane(lane.id),
    }))
    // `language` re-derives the labels when the interface language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, focusedLaneId, setFocusedLane, language])

  const actions = useMemo(
    () => [
      { id: 'new', label: t(app.newChat), hint: '⌘N', icon: MessageSquarePlus, run: onNewChat },
      { id: 'settings', label: t(app.settings), hint: '⌘,', icon: SettingsIcon, run: onOpenSettings },
      { id: 'sidebar', label: t(app.paletteToggleSidebar), hint: '⌘\\', icon: PanelLeft, run: toggleSidebar },
      ...columns,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onNewChat, onOpenSettings, toggleSidebar, columns, language],
  )

  // Close on navigation so the palette never lingers over the result.
  const close = () => onOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width={560} className="p-0">
        <DialogHiddenTitle>{t(app.paletteTitle)}</DialogHiddenTitle>

        <Command
          loop
          className="flex flex-col max-md:min-h-0 max-md:flex-1"
          filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <div className={cn('flex items-center gap-2 border-b border-line px-3.5 py-3', DIALOG_CLOSE_GUTTER)}>
            <Search className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
            <Command.Input
              autoFocus
              placeholder={t(app.palettePlaceholder)}
              className="min-w-0 flex-1 text-[14px] text-ink placeholder:text-ink-faint"
            />
          </div>

          <Command.List className="max-h-[380px] overflow-y-auto p-1.5 max-md:max-h-none max-md:flex-1">
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-muted">
              {t(app.paletteEmpty)}
            </Command.Empty>

            <Command.Group
              heading={t(app.paletteActions)}
              className={cn(
                '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
                '[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium',
                '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider',
                '[&_[cmdk-group-heading]]:text-ink-faint',
              )}
            >
              {actions.map((action) => (
                <PaletteItem
                  key={action.id}
                  value={action.label}
                  onSelect={() => {
                    action.run()
                    close()
                  }}
                >
                  <action.icon className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.75} />
                  <span className="flex-1">{action.label}</span>
                  <span className="text-[11.5px] text-ink-faint">{action.hint}</span>
                </PaletteItem>
              ))}
            </Command.Group>

            {models.length ? (
              <Command.Group
                heading={t(app.paletteModels)}
                className={cn(
                  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
                  '[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium',
                  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider',
                  '[&_[cmdk-group-heading]]:text-ink-faint',
                )}
              >
                {models.map((model) => (
                  <PaletteItem
                    key={`${model.providerId}:${model.modelId}`}
                    value={`${displayName(model.modelId)} ${model.providerName} ${model.modelId}`}
                    onSelect={() => {
                      onSelectModel({ providerId: model.providerId, modelId: model.modelId })
                      close()
                    }}
                  >
                    <ModelIcon modelId={model.modelId} className="text-ink-muted" />
                    <span className="min-w-0 flex-1 truncate">{displayName(model.modelId)}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-faint">
                      {model.providerName}
                    </span>
                  </PaletteItem>
                ))}
              </Command.Group>
            ) : null}

            {summaries.length ? (
              <Command.Group
                heading={t(app.paletteChats)}
                className={cn(
                  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
                  '[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium',
                  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider',
                  '[&_[cmdk-group-heading]]:text-ink-faint',
                )}
              >
                {summaries.map((summary) => (
                  <PaletteItem
                    key={summary.id}
                    value={summary.title || t(app.newChat)}
                    onSelect={() => {
                      void openConversation(summary.id)
                      close()
                    }}
                  >
                    <Search className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">{summary.title || t(app.newChat)}</span>
                  </PaletteItem>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function PaletteItem({
  value,
  onSelect,
  children,
}: {
  value: string
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-2 text-[13.5px] text-ink-soft',
        'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
        // The selection is a fill, not an outline — the same rule as every
        // other selected state in the app.
        'data-[selected=true]:bg-surface-active data-[selected=true]:text-ink',
      )}
    >
      {children}
    </Command.Item>
  )
}

/** Registers the global keyboard shortcuts. Kept here so App stays declarative. */
/**
 * The shortcuts the app is actually listening for.
 *
 * Settings may carry a partial map — an old install has none at all — so a
 * missing or empty binding falls back to the action's default rather than
 * leaving the action unreachable.
 */
export function resolveShortcuts(map: ShortcutMap | undefined): ShortcutMap {
  const resolved: ShortcutMap = {}
  for (const entry of SHORTCUTS) {
    const stored = map?.[entry.id]
    resolved[entry.id] = stored === undefined ? entry.defaultKeys : stored
  }
  return resolved
}

export function useGlobalShortcuts(handlers: {
  onNewChat: () => void
  onTogglePalette: () => void
  onToggleSidebar: () => void
  onOpenSettings: () => void
  onStop: () => void
}) {
  // Read rather than passed in: the handler is installed once, and a rebind in
  // settings should take effect without reinstalling it.
  const shortcuts = useStore((state) => state.settings.shortcuts)
  const resolved = useMemo(() => resolveShortcuts(shortcuts), [shortcuts])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // While a dialog owns the keyboard, only the fixed Escape reaches the app;
      // otherwise ⌘K inside settings would stack a second overlay on top of it.
      const inDialog = Boolean(document.querySelector('[role="dialog"]'))

      if (matchesBinding(event, resolved.stop ?? 'Escape')) {
        // Escape must not fire while the user is mid-IME-composition, or while
        // something has already claimed it (a popover closing, an input
        // cancelling an edit).
        if (event.defaultPrevented || event.isComposing) return
        if (inDialog) return
        handlers.onStop()
        return
      }

      if (inDialog) return

      const actions: Array<[ShortcutId, () => void]> = [
        ['newChat', handlers.onNewChat],
        ['palette', handlers.onTogglePalette],
        ['toggleSidebar', handlers.onToggleSidebar],
        ['settings', handlers.onOpenSettings],
      ]

      for (const [id, run] of actions) {
        const binding = resolved[id]
        if (!binding) continue
        if (!matchesBinding(event, binding)) continue
        event.preventDefault()
        run()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handlers, resolved])
}
