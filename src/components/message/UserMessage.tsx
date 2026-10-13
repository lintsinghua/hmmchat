import { useState } from 'react'
import { FileText, GitBranch, Image as ImageIcon, MessageSquareQuote, Pencil } from 'lucide-react'
import { openConversation } from '@/chat/session'
import type { Turn } from '@/chat/types'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { useT } from '@/i18n/core'
import { thread } from '@/i18n'

/**
 * The user's message.
 *
 * The only element in the thread with a bubble — which is what makes the
 * assistant's output read as a document rather than a chat log. Right-aligned
 * because that is the convention every vendor app has trained users on.
 */
export function UserMessage({
  turn,
  onEdit,
  onFork,
  siblingInfo,
}: {
  turn: Turn
  onEdit: (text: string) => void
  /** Starts a new conversation carrying the context up to this question. */
  onFork: () => void
  /** Present when this question has alternative branches. */
  siblingInfo?: { index: number; total: number; onSelect: (turnId: string) => void; ids: string[] }
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(turn.text)

  const submit = () => {
    const next = draft.trim()
    // An unchanged or emptied edit is a no-op rather than a destructive branch.
    if (!next || next === turn.text) {
      setEditing(false)
      setDraft(turn.text)
      return
    }
    onEdit(next)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[85%]">
          <textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Same IME guard as the composer: a candidate-selecting Enter must
              // not submit.
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
              if (event.key === 'Escape') {
                setEditing(false)
                setDraft(turn.text)
              }
            }}
            rows={Math.min(8, draft.split('\n').length)}
            className={cn(
              'w-full rounded-[var(--radius-md)] border border-line-strong bg-paper',
              'px-3.5 py-2.5 text-[15px] leading-[1.6]',
            )}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              onClick={() => {
                setEditing(false)
                setDraft(turn.text)
              }}
            >
              {t(thread.cancel)}
            </Button>
            <Button size="sm" variant="primary" onClick={submit}>
              {t(thread.resend)}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const attachments = turn.attachments ?? []

  return (
    <div className="group/user flex flex-col items-end gap-1">
      <div
        className={cn(
          'max-w-[85%] rounded-[var(--radius-lg)] rounded-br-[6px]',
          'bg-surface px-4 py-2.5',
          'text-[15px] leading-[1.65] text-ink',
          'whitespace-pre-wrap break-words',
        )}
      >
        {/*
          Attachments are shown as named chips above the question rather than as
          thumbnails: the file is what was sent, the question is what was asked,
          and a row of previews would push the text — the part being read back —
          out of the bubble. The image bytes are not kept in the database, so
          there is nothing to preview on a reopened conversation anyway.
        */}
        {attachments.length ? (
          <div className={cn('flex flex-wrap gap-1.5', turn.text.trim() && 'mb-2')}>
            {attachments.map((file) =>
              file.reference ? (
                // A quote opens the conversation it came from. The text sent is
                // the snapshot on this turn; the source may have moved on since.
                <button
                  key={file.id}
                  type="button"
                  onClick={() => void openConversation(file.reference!.conversationId)}
                  className={cn(
                    'flex max-w-[260px] items-center gap-1.5 rounded-[7px] px-2 py-1',
                    'bg-paper/70 text-ink-soft transition-colors hover:text-ink',
                  )}
                  title={t(thread.quoteTitle, { title: file.reference.title, count: file.reference.turns })}
                >
                  <MessageSquareQuote className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                  <span className="truncate text-[11.5px] font-medium">{file.reference.title}</span>
                </button>
              ) : (
                <span
                  key={file.id}
                  className={cn(
                    'flex max-w-[220px] items-center gap-1.5 rounded-[7px] px-2 py-1',
                    'bg-paper/70 text-ink-soft',
                  )}
                  title={
                    file.note ??
                    `${file.name} · ${file.text ? t(thread.characters, { count: file.text.length }) : t(thread.binary)}`
                  }
                >
                  {file.ext === 'png' || ['jpg', 'jpeg', 'gif', 'webp'].includes(file.ext) ? (
                    <ImageIcon className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                  )}
                  <span className="truncate text-[11.5px] font-medium">{file.name}</span>
                </span>
              ),
            )}
          </div>
        ) : null}

        {turn.text}
      </div>

      <div
        className={cn(
          'flex items-center gap-0.5',
          'opacity-0 transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)]',
          'group-hover/user:opacity-100 focus-within:opacity-100',
        )}
      >
        {siblingInfo && siblingInfo.total > 1 ? (
          <div className="flex items-center gap-0.5 text-[12px] text-ink-faint">
            <Button
              size="icon-sm"
              disabled={siblingInfo.index <= 0}
              aria-label={t(thread.previousQuestionVersion)}
              onClick={() => siblingInfo.onSelect(siblingInfo.ids[siblingInfo.index - 1])}
            >
              ‹
            </Button>
            <span className="tabular-nums">
              {siblingInfo.index + 1}/{siblingInfo.total}
            </span>
            <Button
              size="icon-sm"
              disabled={siblingInfo.index >= siblingInfo.total - 1}
              aria-label={t(thread.nextQuestionVersion)}
              onClick={() => siblingInfo.onSelect(siblingInfo.ids[siblingInfo.index + 1])}
            >
              ›
            </Button>
          </div>
        ) : null}

        <Tooltip label={t(thread.forkHere)} shortcut={t(thread.forkHereHint)}>
          <Button size="icon-sm" onClick={onFork} aria-label={t(thread.forkHere)}>
            <GitBranch className="h-[14px] w-[14px]" strokeWidth={1.75} />
          </Button>
        </Tooltip>

        <Tooltip label={t(thread.editAndResend)}>
          <Button size="icon-sm" onClick={() => setEditing(true)} aria-label={t(thread.editMessage)}>
            <Pencil className="h-[14px] w-[14px]" strokeWidth={1.75} />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
