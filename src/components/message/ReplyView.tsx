import { memo, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Maximize2,
  RefreshCw,
  Square,
} from 'lucide-react'

import type { Lane, Reply, ReplyStatus } from '@/chat/types'
import { displayName } from '@/providers/registry'
import { ModelIcon } from '@/components/icons/BrandIcon'
import { useSmoothedText } from '@/hooks/useSmoothedText'
import { useStore, type LiveReply } from '@/chat/store'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { useT } from '@/i18n/core'
import { thread } from '@/i18n'
import { Markdown } from './Markdown'
import { ReasoningPanel } from './ReasoningPanel'
import { SearchSteps } from './SearchSteps'
import { Sources } from './Sources'

/**
 * One assistant answer.
 *
 * The component subscribes to *only* its own live entry, so a token arriving in
 * one column does not re-render the others. Text is passed through the smoother
 * so reveals are paced, and the answer's container never animates on insert
 * once streaming has begun — a per-token enter animation is the classic way to
 * make streaming look broken.
 */

interface ReplyViewProps {
  reply: Reply
  lane: Lane
  /** Compare mode: tighter type and a column header. */
  compact?: boolean
  /** Position among visible lanes, for the header label. */
  laneIndex: number
  laneCount: number
  /** Set when this answer came from an ancestor lane rather than this model. */
  inheritedFrom?: Lane
  onRegenerate: () => void
  /** Shows this column on its own (compare mode only). */
  onFocus?: () => void
  onStop: () => void
  /** Version navigation, when this lane has more than one attempt. */
  versions?: Reply[]
  onSelectVersion?: (replyId: string) => void
}

/** Resolves the live entry for a reply, falling back to its persisted state. */
function useReplyContent(reply: Reply): {
  text: string
  reasoning?: string
  reasoningMs?: number
  steps: LiveReply['steps']
  sources: LiveReply['sources']
  status: ReplyStatus
  usage?: LiveReply['usage']
  error?: string
} {
  // Narrow subscription: the selector returns one object, and zustand's default
  // identity comparison re-renders only when that entry is replaced.
  const live = useStore((state) => state.live[reply.id])

  if (!live) {
    return {
      text: reply.text,
      reasoning: reply.reasoning,
      reasoningMs: reply.reasoningMs,
      steps: reply.steps,
      sources: reply.sources,
      status: reply.status,
      usage: reply.usage,
      error: reply.error,
    }
  }

  return {
    text: live.text,
    reasoning: live.reasoning,
    reasoningMs: live.reasoningMs,
    steps: live.steps,
    sources: live.sources,
    status: live.status,
    usage: live.usage,
    error: live.error,
  }
}

export const ReplyView = memo(function ReplyView({
  reply,
  lane,
  compact,
  laneIndex,
  laneCount,
  inheritedFrom,
  onRegenerate,
  onFocus,
  onStop,
  versions,
  onSelectVersion,
}: ReplyViewProps) {
  const t = useT()
  const content = useReplyContent(reply)
  const streaming = content.status === 'streaming' || content.status === 'pending'

  // The smoother owns the visible prefix; it settles to the full text when the
  // stream ends, so a stopped reply still shows everything that arrived.
  const visibleText = useSmoothedText(content.text, streaming)
  const [copied, setCopied] = useState(false)
  const [entered, setEntered] = useState(false)
  const initialIndexRef = useRef(laneIndex)
  const reordered = laneIndex !== initialIndexRef.current

  const versionIndex = useMemo(
    () => (versions ? versions.findIndex((entry) => entry.id === reply.id) : -1),
    [versions, reply.id],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard can be blocked; silently doing nothing is better than an alert.
    }
  }

  const showHeader = laneCount > 1
  const isStreaming = content.status === 'streaming'

  return (
    <div
      onAnimationEnd={() => setEntered(true)}
      className={cn(
        'group/reply flex min-w-0 flex-col',
        !entered && !reordered && 'message-enter',
      )}
    >
      {showHeader ? (
        <div
          data-lane-handle={lane.id}
          title={t(thread.dragToReorder)}
          className={cn(
            'mb-2 -mx-1 flex cursor-grab select-none flex-wrap items-center gap-1.5 rounded-[6px] px-1 py-0.5',
            'transition-colors duration-[var(--dur-instant)] hover:bg-surface-hover/70 active:cursor-grabbing',
          )}
        >
          <ModelIcon modelId={lane.model.modelId} className="h-3.5 w-3.5 text-ink-soft" />
          <span className="truncate text-[12px] font-medium text-ink-soft">
            {displayName(lane.model.modelId)}
          </span>
          <StatusDot status={content.status} />

          {/*
            An inherited answer is shown in the new column rather than left
            blank, because that is the context this model was actually given.
            Labelling it is what keeps that honest: the text is another model's,
            and the user is one click from having it answer for itself.
          */}
          {inheritedFrom ? (
            <>
              <span className="rounded-[5px] bg-surface-active px-1.5 py-px text-[10.5px] text-ink-muted">
                {t(thread.inheritedFrom, { model: displayName(inheritedFrom.model.modelId) })}
              </span>
              <button
                type="button"
                data-no-drag
                onClick={onRegenerate}
                className={cn(
                  'rounded-[5px] px-1.5 py-px text-[10.5px] font-medium',
                  'text-ink-muted underline underline-offset-2',
                  'transition-colors duration-[var(--dur-instant)] hover:text-ink',
                )}
              >
                {t(thread.answerItself)}
              </button>
            </>
          ) : null}

          {/*
            Quiet until the column is hovered, like the rest of a reply's
            actions: the header's job is to say whose answer this is.
          */}
          {onFocus ? (
            <Tooltip label={t(thread.viewAlone, { model: displayName(lane.model.modelId) })}>
              <button
                type="button"
                data-no-drag
                onClick={onFocus}
                aria-label={t(thread.viewAlone, { model: displayName(lane.model.modelId) })}
                className={cn(
                  'ml-auto flex h-5 w-5 items-center justify-center rounded-[5px] text-ink-faint',
                  'opacity-0 transition-opacity duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                  'hover:bg-surface-hover hover:text-ink group-hover/reply:opacity-100 focus-visible:opacity-100',
                )}
              >
                <Maximize2 className="h-3 w-3" strokeWidth={2} />
              </button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      {content.steps.length ? (
        <SearchSteps steps={content.steps} streaming={isStreaming} compact={compact} />
      ) : null}

      {content.reasoning ? (
        <ReasoningPanel
          text={content.reasoning}
          // Reasoning is over once answer text exists; folding then, rather
          // than when the whole reply ends, is what keeps the thinking window
          // from sitting above an answer that is already streaming.
          streaming={isStreaming && !content.text}
          durationMs={content.reasoningMs}
          compact={compact}
        />
      ) : null}

      {content.status === 'pending' && !content.text ? (
        <div className="py-0.5">
          <span className="shimmer text-[13px]">{t(thread.thinking)}</span>
        </div>
      ) : null}

      {content.error ? (
        <div className="mb-2 flex items-start gap-2 rounded-[var(--radius-sm)] border border-danger/25 bg-danger/[0.06] px-3 py-2">
          <AlertCircle className="mt-[2px] h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-5 text-danger break-words">{content.error}</p>
            <button
              type="button"
              onClick={onRegenerate}
              className="mt-1.5 text-[12.5px] font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              {t(thread.retry)}
            </button>
          </div>
        </div>
      ) : null}

      {content.text ? (
        <Markdown streaming={isStreaming} compact={compact}>
          {visibleText}
        </Markdown>
      ) : null}

      {/* Sources close the answer, so they wait for it: chips arriving mid-stream
          would sit between the text and where it is still growing. */}
      {content.sources.length && !streaming ? <Sources sources={content.sources} compact={compact} /> : null}

      {/* Actions appear on hover for mouse users and are always reachable by
          keyboard — no persistent toolbar competing with the text. */}
      {!streaming && (content.text || content.error) ? (
        <div
          className={cn(
            'mt-2 flex items-center gap-0.5',
            'opacity-0 transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)]',
            'group-hover/reply:opacity-100 focus-within:opacity-100',
          )}
        >
          <Tooltip label={copied ? t(thread.copied) : t(thread.copy)}>
            <Button size="icon-sm" onClick={copy} aria-label={t(thread.copyAnswer)}>
              {copied ? (
                <Check className="h-[15px] w-[15px]" strokeWidth={1.75} />
              ) : (
                <Copy className="h-[15px] w-[15px]" strokeWidth={1.75} />
              )}
            </Button>
          </Tooltip>

          <Tooltip label={t(thread.regenerate)}>
            <Button size="icon-sm" onClick={onRegenerate} aria-label={t(thread.regenerate)}>
              <RefreshCw className="h-[15px] w-[15px]" strokeWidth={1.75} />
            </Button>
          </Tooltip>

          {versions && versions.length > 1 ? (
            <div className="ml-0.5 flex items-center gap-0.5 text-[12px] text-ink-faint">
              <Button
                size="icon-sm"
                disabled={versionIndex <= 0}
                onClick={() => onSelectVersion?.(versions[versionIndex - 1].id)}
                aria-label={t(thread.previousVersion)}
              >
                <ChevronLeft className="h-[15px] w-[15px]" strokeWidth={1.75} />
              </Button>
              <span className="tabular-nums">
                {versionIndex + 1}/{versions.length}
              </span>
              <Button
                size="icon-sm"
                disabled={versionIndex >= versions.length - 1}
                onClick={() => onSelectVersion?.(versions[versionIndex + 1].id)}
                aria-label={t(thread.nextVersion)}
              >
                <ChevronRight className="h-[15px] w-[15px]" strokeWidth={1.75} />
              </Button>
            </div>
          ) : null}

          {content.usage?.outputTokens ? (
            <span className="ml-1 text-[12px] tabular-nums text-ink-faint">
              {t(thread.outputTokens, { count: content.usage.outputTokens })}
            </span>
          ) : null}
        </div>
      ) : null}

      {streaming && content.text ? (
        <div className="mt-2 flex items-center gap-0.5 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover/reply:opacity-100">
          <Tooltip label={t(thread.stop)}>
            <Button size="icon-sm" onClick={onStop} aria-label={t(thread.stopGenerating)}>
              <Square className="h-[13px] w-[13px] fill-current" strokeWidth={1.75} />
            </Button>
          </Tooltip>
        </div>
      ) : null}

      {/* Compare columns get their own stop control in the header, since the
          user is watching several at once and reaching for hover is slower. */}
      {showHeader && streaming && !content.text ? (
        <div className="mt-2">
          <Button size="sm" variant="ghost" onClick={onStop}>
            {t(thread.stop)}
          </Button>
        </div>
      ) : null}

      {showHeader ? (
        <span className="sr-only">
          {t(thread.columnPosition, { n: laneIndex + 1, count: laneCount })}
        </span>
      ) : null}
    </div>
  )
})

/** A small status indicator: working, done, stopped, or failed. */
function StatusDot({ status }: { status: ReplyStatus }) {
  const tone =
    status === 'error'
      ? 'bg-danger'
      : status === 'stopped'
        ? 'bg-ink-faint'
        : status === 'done'
          ? 'bg-success'
          : 'bg-working'

  return (
    <span
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        tone,
        (status === 'streaming' || status === 'pending') && 'animate-pulse',
      )}
    />
  )
}
