import { Command } from 'cmdk'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, MessageSquareQuote } from 'lucide-react'

import { useStore } from '@/chat/store'
import { buildReference, referenceRounds } from '@/chat/reference'
import { visibleLanes, type Attachment, type ConversationGraph } from '@/chat/types'
import * as db from '@/lib/db'
import { cn } from '@/lib/cn'
import { displayName } from '@/providers/registry'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHiddenTitle } from '@/components/ui/Dialog'
import { ModelIcon } from '@/components/icons/BrandIcon'
import { useT } from '@/i18n/core'
import { composer } from '@/i18n'

/**
 * Quote an earlier conversation into this one.
 *
 * Two steps in one dialog: pick the conversation, then pick the rounds. Every
 * round with an answer starts ticked, because "the whole thing" is the usual
 * intent and unticking the irrelevant rounds is quicker than ticking the
 * relevant ones. A compared conversation also asks which column to quote; the
 * first one is the default, matching how its columns read left to right.
 *
 * Opened from the sidebar the conversation is already chosen, so the dialog
 * starts on the rounds and offers no way back to a list nobody asked for.
 */

/** Past this many characters a vision model's per-turn budget clips the quote. */
const LONG_QUOTE = 40_000

export function ReferencePicker({
  conversationId,
  onPick,
  onClose,
}: {
  /** Skip the list and quote this conversation. */
  conversationId?: string
  onPick: (attachment: Attachment) => void
  onClose: () => void
}) {
  const t = useT()
  const summaries = useStore((state) => state.summaries)
  const currentId = useStore((state) => state.graph?.conversation.id)
  const [sourceId, setSourceId] = useState(conversationId)

  // The conversation being written in is already context; quoting it would only
  // repeat it.
  const candidates = summaries.filter((summary) => summary.id !== currentId)

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent width={600} className="p-0">
        <DialogHiddenTitle>{t(composer.quoteDialogTitle)}</DialogHiddenTitle>
        {sourceId ? (
          <RoundPicker
            conversationId={sourceId}
            onBack={conversationId ? undefined : () => setSourceId(undefined)}
            onPick={onPick}
            onClose={onClose}
          />
        ) : (
          <Command loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
              <MessageSquareQuote className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
              <Command.Input
                autoFocus
                placeholder={t(composer.searchChatsToQuote)}
                className="min-w-0 flex-1 text-[14px] text-ink placeholder:text-ink-faint"
              />
            </div>
            <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-muted">
                {candidates.length ? t(composer.noMatchingChats) : t(composer.noOtherChats)}
              </Command.Empty>
              {candidates.map((summary) => (
                <Command.Item
                  key={summary.id}
                  value={`${summary.title} ${summary.id}`}
                  onSelect={() => setSourceId(summary.id)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-2 text-[13.5px] text-ink-soft',
                    'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                    'data-[selected=true]:bg-surface-active data-[selected=true]:text-ink',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{summary.title || t(composer.untitledChat)}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-faint">
                    {new Date(summary.updatedAt).toLocaleDateString()}
                  </span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RoundPicker({
  conversationId,
  onBack,
  onPick,
  onClose,
}: {
  conversationId: string
  onBack?: () => void
  onPick: (attachment: Attachment) => void
  onClose: () => void
}) {
  const t = useT()
  const [graph, setGraph] = useState<ConversationGraph | null | undefined>(undefined)
  const [laneId, setLaneId] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void db.loadGraph(conversationId).then((loaded) => {
      if (cancelled) return
      setGraph(loaded)
      setLaneId(loaded ? (visibleLanes(loaded.conversation.lanes)[0]?.id ?? null) : null)
    })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  const lanes = graph ? visibleLanes(graph.conversation.lanes) : []
  const lane = lanes.find((entry) => entry.id === laneId) ?? lanes[0]
  const rounds = useMemo(() => (graph && lane ? referenceRounds(graph, lane) : []), [graph, lane])

  // Switching column re-ticks what that column answered: its rounds differ when
  // some were sent to other models only.
  useEffect(() => {
    setPicked(rounds.filter((round) => round.answer).map((round) => round.turnId))
  }, [rounds])

  // Built here rather than on click, so the size in the footer is the size of
  // what will be sent — header and speaker labels included.
  const quote = useMemo(
    () => (graph && lane && picked.length ? buildReference(graph, lane, picked) : null),
    [graph, lane, picked],
  )

  if (graph === undefined) {
    return <div className="px-4 py-10 text-center text-[13px] text-ink-muted">{t(composer.loadingChat)}</div>
  }
  if (!graph || !lane) {
    return <div className="px-4 py-10 text-center text-[13px] text-ink-muted">{t(composer.chatGone)}</div>
  }

  const chosen = rounds.filter((round) => picked.includes(round.turnId))
  const chars = quote?.text?.length ?? 0
  const toggle = (turnId: string) =>
    setPicked((current) => (current.includes(turnId) ? current.filter((id) => id !== turnId) : [...current, turnId]))

  return (
    <div className="flex max-h-[min(640px,calc(100vh-120px))] flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        {onBack ? (
          <Button size="icon-sm" onClick={onBack} aria-label={t(composer.backToChatList)}>
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        ) : (
          <MessageSquareQuote className="ml-1 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink">{graph.conversation.title}</div>
          <div className="text-[11.5px] text-ink-faint">{t(composer.pickRoundsHint)}</div>
        </div>
        <button
          type="button"
          onClick={() =>
            setPicked(chosen.length === rounds.length ? [] : rounds.map((round) => round.turnId))
          }
          className="shrink-0 rounded-[6px] px-2 py-1 text-[12px] text-ink-muted hover:bg-surface-hover hover:text-ink"
        >
          {chosen.length === rounds.length ? t(composer.selectNone) : t(composer.selectAll)}
        </button>
      </div>

      {lanes.length > 1 ? (
        <div
          className="flex items-center gap-2 border-b border-line px-4 py-2"
          role="radiogroup"
          aria-label={t(composer.quoteWhichColumn)}
        >
          <span className="shrink-0 text-[12px] text-ink-faint">{t(composer.quote)}</span>
          <div className="flex min-w-0 flex-wrap gap-0.5 rounded-[8px] bg-surface p-0.5">
            {lanes.map((entry) => {
              const selected = entry.id === lane.id
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setLaneId(entry.id)}
                  className={cn(
                    'flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-medium',
                    'transition-[background-color,color,box-shadow] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                    selected ? 'bg-paper text-ink shadow-[var(--shadow-raised)]' : 'text-ink-muted hover:text-ink-soft',
                  )}
                >
                  <ModelIcon modelId={entry.model.modelId} className="h-3.5 w-3.5" />
                  {displayName(entry.model.modelId)}
                </button>
              )
            })}
          </div>
          <span className="shrink-0 text-[12px] text-ink-faint">{t(composer.columnAnswersSuffix)}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rounds.length === 0 ? (
          <div className="px-3 py-8 text-center text-[13px] text-ink-muted">{t(composer.emptyChat)}</div>
        ) : (
          rounds.map((round, index) => {
            const selected = picked.includes(round.turnId)
            return (
              <button
                key={round.turnId}
                type="button"
                role="checkbox"
                aria-checked={selected}
                aria-label={t(composer.roundLabel, { n: index + 1, question: round.question })}
                onClick={() => toggle(round.turnId)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left',
                  'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                  'hover:bg-surface-hover',
                )}
              >
                <span
                  className={cn(
                    'mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px]',
                    selected ? 'bg-ink text-paper' : 'border border-line-strong',
                  )}
                >
                  {selected ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn('line-clamp-2 text-[13px]', selected ? 'text-ink' : 'text-ink-muted')}>
                    {round.question || t(composer.attachmentsOnly)}
                  </span>
                  <span className="line-clamp-1 text-[12px] text-ink-faint">
                    {round.answer ?? t(composer.roundUnanswered, { model: displayName(lane.model.modelId) })}
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">
          {chosen.length
            ? t(composer.quoteSize, { count: chosen.length, chars: chars.toLocaleString() })
            : t(composer.noRoundsSelected)}
          {chars > LONG_QUOTE ? t(composer.quoteTooLong) : ''}
        </span>
        <Button size="sm" onClick={onClose}>
          {t(composer.cancel)}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!quote}
          onClick={() => quote && onPick(quote)}
        >
          {t(composer.quote)}
        </Button>
      </div>
    </div>
  )
}
