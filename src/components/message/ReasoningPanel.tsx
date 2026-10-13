import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n/core'
import { thread } from '@/i18n'

/**
 * The thinking chain.
 *
 * Three states, because thinking is three different things to the reader:
 *
 * - **While it streams**, a fixed three-line window onto the reasoning, scrolled
 *   to the newest line, with both edges dissolved — a view onto something moving
 *   rather than a paragraph that stops mid-sentence. The height never changes,
 *   so the answer below does not get pushed down the page token by token.
 * - **When it finishes**, it folds to a single line ("已思考 12 秒"), because
 *   reasoning is rarely re-read and the answer always is.
 * - **On click**, it opens to the whole chain, still with the soft edges.
 *
 * A model that streams no reasoning renders nothing here at all, which is the
 * same as before this existed.
 */

interface ReasoningPanelProps {
  text: string
  streaming: boolean
  /** Wall-clock milliseconds, when known. */
  durationMs?: number
  compact?: boolean
}

/** Lines visible in the window while streaming. */
const PREVIEW_LINES = 3
const LINE_HEIGHT_PX = 21
/** Below this many lines there is nothing to scroll, so the fades come off. */
const FADE_FROM_LINES = 3

export function ReasoningPanel({ text, streaming, durationMs, compact }: ReasoningPanelProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // Keep the newest reasoning in view. `scrollTop` is set directly rather than
  // through scrollIntoView, which would also scroll the thread underneath.
  useEffect(() => {
    if (!streaming || open) return
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [text, streaming, open])

  // When the panel opens, land at the end of the chain — the last thing it
  // concluded is what the answer was built from.
  useEffect(() => {
    if (open && endRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [open])

  if (!text.trim()) return null

  const seconds = durationMs ? (durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0) : null
  const label = streaming
    ? t(thread.reasoningStreaming)
    : seconds
      ? t(thread.reasoningDone, { seconds })
      : t(thread.reasoning)

  const lineCount = text.split('\n').length
  const fade = lineCount >= FADE_FROM_LINES

  return (
    <div className={cn('select-none', compact ? 'mb-2' : 'mb-2.5')}>
      <button
        type="button"
        onClick={() => !streaming && setOpen((value) => !value)}
        className={cn(
          'group flex items-center gap-1.5 rounded-[7px] py-1 pr-2 text-left',
          'text-[13px] text-ink-muted transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
          !streaming && 'hover:text-ink-soft',
        )}
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]',
            open && 'rotate-90',
          )}
          strokeWidth={1.75}
        />
        {streaming ? <span className="shimmer">{label}</span> : <span>{label}</span>}
      </button>

      {/*
        While streaming the window is fixed-height; with the panel open, or once
        the answer has arrived and the user asks to see it, it grows to a
        comfortable reading height. Both share the same mask so the transition
        between them is a change in size, not in style.
      */}
      {streaming && !open ? (
        <div
          ref={scrollRef}
          className={cn(
            'ml-[5px] overflow-hidden border-l border-line pl-3',
            'text-[13px] leading-[21px] text-ink-muted',
            fade && 'fade-thinking',
          )}
          style={{ height: PREVIEW_LINES * LINE_HEIGHT_PX }}
        >
          <div className="whitespace-pre-wrap break-words">{text}</div>
        </div>
      ) : null}

      {open ? (
        <div
          ref={scrollRef}
          className={cn(
            'ml-[5px] max-h-72 overflow-y-auto border-l border-line pl-3',
            'text-[13px] leading-[21px] text-ink-muted',
            fade && 'fade-both',
          )}
        >
          <div className="whitespace-pre-wrap break-words py-2">{text}</div>
          <div ref={endRef} />
        </div>
      ) : null}
    </div>
  )
}
