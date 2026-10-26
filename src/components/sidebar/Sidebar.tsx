import { Copy, MessageSquareQuote, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ConversationSummary } from '@/lib/db'
import { cn } from '@/lib/cn'
import { useStore } from '@/chat/store'
import { resolveShortcuts } from '@/components/palette/CommandPalette'
import { formatBindingText } from '@/lib/shortcuts'
import { Tooltip } from '@/components/ui/Tooltip'
import { Popover, PopoverContent, PopoverItem, PopoverSeparator, PopoverTrigger } from '@/components/ui/Popover'
import { useTouch } from '@/hooks/useMedia'
import { useT, type Entry } from '@/i18n/core'
import { app } from '@/i18n'

/**
 * The session list.
 *
 * Everything that is not a conversation lives at the bottom, behind one gear.
 * There is deliberately no second rail and no right-hand panel: the clutter
 * problem in comparable apps comes from stacking parallel panels, and a chat
 * client only ever needs one column of navigation.
 *
 * Under a finger the list is the same list with taller rows, and the row
 * actions that wait for hover on a Mac sit behind a ⋯ button on each row.
 */

interface SidebarProps {
  summaries: ConversationSummary[]
  activeId: string | null
  query: string
  onQueryChange: (query: string) => void
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  /** Copies the whole conversation into a new one. */
  onDuplicate: (id: string) => void
  /** Quotes the conversation into the one being written. */
  onQuote: (id: string) => void
  onOpenSettings: () => void
  /** Shown as the phone drawer rather than beside the thread. */
  compact?: boolean
}

export function Sidebar({
  summaries,
  activeId,
  query,
  onQueryChange,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onTogglePin,
  onDuplicate,
  onQuote,
  onOpenSettings,
  compact = false,
}: SidebarProps) {
  const t = useT()
  const groups = useMemo(() => groupByDate(summaries), [summaries])
  const shortcuts = useStore((state) => state.settings.shortcuts)

  return (
    <aside
      className={cn(
        'flex h-full w-full flex-col',
        // The drawer lies over the chat, where a see-through material would show
        // the thread's text through the list.
        compact ? 'bg-canvas' : 'glass border-r border-line',
      )}
    >
      {/*
        The title bar is an overlay, so the macOS traffic lights float over this
        region. The top padding reserves their space; the strip itself is a drag
        handle so the window can be moved by the sidebar. In the drawer it only
        clears the status bar.
      */}
      <div data-tauri-drag-region className="pt-safe shrink-0">
        <div className={compact ? 'h-3' : 'h-[38px]'} />
      </div>

      <div className="flex items-center gap-1 px-2.5 pb-2">
        <button
          type="button"
          onClick={onNew}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-[9px] px-2.5 py-[7px]',
            'text-[13.5px] font-medium text-ink',
            'touch:py-2.5 touch:text-[15px]',
            'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
            'hover:bg-surface-hover active:bg-surface-active',
          )}
        >
          <Plus className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span className="truncate">{t(app.newChat)}</span>
          <span className="ml-auto shrink-0 text-[11px] text-ink-faint touch:hidden">
            {formatBindingText(resolveShortcuts(shortcuts).newChat ?? '')}
          </span>
        </button>
      </div>

      <div className="px-2.5 pb-2">
        <div
          className={cn(
            'flex items-center gap-2 rounded-[9px] px-2.5 py-[6px]',
            'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
            'focus-within:bg-surface',
            // Always a field under a finger: a borderless one is hard to find.
            'touch:bg-surface touch:py-2',
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t(app.search)}
            className="min-w-0 flex-1 text-[13px] text-ink placeholder:text-ink-faint touch:text-[15px]"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {groups.length === 0 ? (
          <p className="px-2.5 py-3 text-[12.5px] text-ink-faint">
            {query ? t(app.noMatchingChats) : t(app.noChats)}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label.en} className="mb-1.5">
              <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                {t(group.label)}
              </div>
              {group.items.map((summary) => (
                <SidebarItem
                  key={summary.id}
                  summary={summary}
                  active={summary.id === activeId}
                  onSelect={() => onSelect(summary.id)}
                  onRename={(title) => onRename(summary.id, title)}
                  onDelete={() => onDelete(summary.id)}
                  onTogglePin={() => onTogglePin(summary.id, !summary.pinned)}
                  onDuplicate={() => onDuplicate(summary.id)}
                  onQuote={() => onQuote(summary.id)}
                />
              ))}
            </div>
          ))
        )}
      </nav>

      <div className={cn('flex items-center gap-1 border-t border-line px-2.5 py-2', compact && 'pb-safe')}>
        <button
          type="button"
          onClick={onOpenSettings}
          className={cn(
            'flex flex-1 items-center gap-2 rounded-[9px] px-2.5 py-[7px]',
            'text-[13px] font-medium text-ink-soft',
            'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
            'hover:bg-surface-hover hover:text-ink',
            'touch:py-2.5 touch:text-[15px]',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{t(app.settings)}</span>
          <span className="ml-auto text-[11px] text-ink-faint touch:hidden">⌘,</span>
        </button>
      </div>
    </aside>
  )
}

function SidebarItem({
  summary,
  active,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onDuplicate,
  onQuote,
}: {
  summary: ConversationSummary
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
  onTogglePin: () => void
  onDuplicate: () => void
  onQuote: () => void
}) {
  const t = useT()
  const touch = useTouch()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(summary.title)
  const [confirming, setConfirming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // iOS opens the keyboard only for a focus made inside the tap itself, so the
  // field is put on screen and focused synchronously rather than by autoFocus
  // on a later render, which on a phone gave a focused field and no keyboard.
  const startEditing = () => {
    flushSync(() => {
      setDraft(summary.title)
      setEditing(true)
    })
    inputRef.current?.focus()
    inputRef.current?.select()
  }

  const commit = () => {
    const next = draft.trim()
    if (next && next !== summary.title) onRename(next)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="px-1 py-0.5">
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') {
              setDraft(summary.title)
              setEditing(false)
            }
          }}
          className={cn(
            'w-full rounded-[7px] border border-line-strong bg-paper px-2 py-1',
            'text-[13px] text-ink touch:py-2 touch:text-[15px]',
          )}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group/item relative flex items-center rounded-[9px]',
        'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
        active ? 'bg-surface-active' : 'hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={startEditing}
        className="min-w-0 flex-1 px-2.5 py-[7px] text-left touch:py-[11px]"
      >
        <span
          className={cn(
            'block truncate text-[13px] touch:text-[15px]',
            active ? 'font-medium text-ink' : 'text-ink-soft',
          )}
        >
          {summary.pinned ? '· ' : ''}
          {summary.title || t(app.newChat)}
        </span>

        {/*
          Why this conversation is in the results. A match buried in an answer
          is invisible otherwise — the title gives no clue, and the user has to
          open each result to find the one they meant.
        */}
        {summary.match ? (
          <span className="mt-0.5 flex items-baseline gap-1 text-[11.5px] leading-[1.35] text-ink-faint">
            <span className="shrink-0 text-ink-muted/70">
              {summary.match.kind === 'answer' ? t(app.matchAnswer) : t(app.matchQuestion)}
            </span>
            <span className="line-clamp-2 min-w-0">{summary.match.text}</span>
          </span>
        ) : null}
      </button>

      {/*
        Row actions stay hidden until hover so the list reads as a list of
        titles. The delete confirmation replaces the row inline rather than
        opening a dialog — a modal for one item is heavier than the action.
      */}
      {confirming ? (
        <div className="absolute inset-0 flex items-center justify-end gap-1 rounded-[9px] bg-surface-active px-2">
          <span className="mr-auto text-[12px] text-ink-soft touch:text-[14px]">{t(app.confirmDelete)}</span>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium text-danger hover:bg-danger/10 touch:px-3 touch:py-1.5 touch:text-[14px]"
          >
            {t(app.delete)}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-[6px] px-1.5 py-0.5 text-[12px] text-ink-soft hover:bg-surface-hover touch:px-3 touch:py-1.5 touch:text-[14px]"
          >
            {t(app.cancel)}
          </button>
        </div>
      ) : touch ? (
        // No hover to reveal the row's actions, so one button holds them all.
        // In flow, unlike the overlay below: it is always there, and a title
        // running under it would read as cut off.
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t(app.chatActions)}
              className="mr-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink-faint active:bg-surface-active"
            >
              <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </PopoverTrigger>
          {/* Closing hands focus back to the ⋯ button, which would take it from the rename field. */}
          <PopoverContent align="end" width={208} onCloseAutoFocus={(event) => event.preventDefault()}>
            {(
              [
                {
                  icon: summary.pinned ? PinOff : Pin,
                  label: summary.pinned ? t(app.unpin) : t(app.pin),
                  run: onTogglePin,
                },
                // The open conversation is already this one's context.
                ...(active ? [] : [{ icon: MessageSquareQuote, label: t(app.quoteIntoCurrent), run: onQuote }]),
                { icon: Copy, label: t(app.duplicate), run: onDuplicate },
                { icon: Pencil, label: t(app.rename), run: startEditing },
              ] as const
            ).map((action) => (
              <PopoverItem
                key={action.label}
                onSelect={() => {
                  setMenuOpen(false)
                  action.run()
                }}
              >
                <action.icon className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
                <span className="flex-1">{action.label}</span>
              </PopoverItem>
            ))}
            <PopoverSeparator />
            <PopoverItem
              className="text-danger hover:text-danger"
              onSelect={() => {
                setMenuOpen(false)
                setConfirming(true)
              }}
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              <span className="flex-1">{t(app.delete)}</span>
            </PopoverItem>
          </PopoverContent>
        </Popover>
      ) : (
        // Overlaid rather than in flow: hidden actions that keep their width
        // truncate every title by ~100px. The fade lets a long title run under.
        <div
          className={cn(
            'absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-[9px] pl-5 pr-1.5',
            'bg-linear-to-l from-70% to-transparent',
            active ? 'from-surface-active' : 'from-surface-hover',
            'pointer-events-none opacity-0 transition-opacity duration-[var(--dur-instant)]',
            'group-hover/item:pointer-events-auto group-hover/item:opacity-100',
            'group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100',
          )}
        >
          <Tooltip label={summary.pinned ? t(app.unpin) : t(app.pin)}>
            <button
              type="button"
              onClick={onTogglePin}
              aria-label={summary.pinned ? t(app.unpin) : t(app.pin)}
              className="rounded-[5px] px-1 text-[13px] leading-none text-ink-faint hover:text-ink"
            >
              {summary.pinned ? '★' : '☆'}
            </button>
          </Tooltip>
          {/*
            The open conversation is already this conversation's context, so it
            offers no quote action of its own.
          */}
          {!active ? (
            <Tooltip label={t(app.quoteIntoCurrent)}>
              <button
                type="button"
                onClick={onQuote}
                aria-label={t(app.quoteIntoCurrent)}
                className="rounded-[5px] px-1 text-[13px] leading-none text-ink-faint hover:text-ink"
              >
                ❝
              </button>
            </Tooltip>
          ) : null}
          <Tooltip label={t(app.duplicate)}>
            <button
              type="button"
              onClick={onDuplicate}
              aria-label={t(app.duplicateChat)}
              className="rounded-[5px] px-1 text-[13px] leading-none text-ink-faint hover:text-ink"
            >
              ⧉
            </button>
          </Tooltip>
          <Tooltip label={t(app.rename)}>
            <button
              type="button"
              onClick={startEditing}
              aria-label={t(app.rename)}
              className="rounded-[5px] px-1 text-[13px] leading-none text-ink-faint hover:text-ink"
            >
              ✎
            </button>
          </Tooltip>
          <Tooltip label={t(app.delete)}>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={t(app.deleteChat)}
              className="rounded-[5px] px-1 text-[13px] leading-none text-ink-faint hover:text-danger"
            >
              ×
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

/**
 * Buckets conversations into pinned / today / yesterday / earlier.
 *
 * Date grouping is preferred over relative timestamps in the list itself: it
 * gives a sense of recency at a glance without every row carrying metadata.
 */
function groupByDate(summaries: ConversationSummary[]): Array<{
  label: Entry
  items: ConversationSummary[]
}> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000

  const pinned: ConversationSummary[] = []
  const today: ConversationSummary[] = []
  const yesterday: ConversationSummary[] = []
  const week: ConversationSummary[] = []
  const earlier: ConversationSummary[] = []

  for (const summary of summaries) {
    if (summary.pinned) pinned.push(summary)
    else if (summary.updatedAt >= startOfToday) today.push(summary)
    else if (summary.updatedAt >= startOfYesterday) yesterday.push(summary)
    else if (summary.updatedAt >= startOfWeek) week.push(summary)
    else earlier.push(summary)
  }

  return [
    { label: app.groupPinned, items: pinned },
    { label: app.groupToday, items: today },
    { label: app.groupYesterday, items: yesterday },
    { label: app.groupLastWeek, items: week },
    { label: app.groupEarlier, items: earlier },
  ].filter((group) => group.items.length > 0)
}
