import { ChevronRight, Globe } from 'lucide-react'
import { useState } from 'react'
import type { SearchStep } from '@/chat/types'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n/core'
import { thread } from '@/i18n'

/**
 * The search activity row above an answer.
 *
 * Both native and bring-your-own search render through this one component, so
 * the user sees the same affordance regardless of which path ran — which is the
 * point of having two backends behind one toggle. Finished searches collapse to
 * a summary; a running one says so.
 */
export function SearchSteps({
  steps,
  streaming,
  compact,
}: {
  steps: SearchStep[]
  streaming: boolean
  compact?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)

  if (!steps.length) return null

  const searching = steps.some((step) => step.status === 'running')
  const totalSources = steps.reduce((sum, step) => sum + step.sourceCount, 0)
  const sources = (count: number) =>
    count ? t(count === 1 ? thread.sourceCountOne : thread.sourceCount, { count }) : ''
  const label = searching
    ? t(thread.searching, { query: steps[steps.length - 1]?.query ?? '' })
    : steps.length === 1
      ? t(thread.searchedQuery, { query: steps[0].query }) + sources(totalSources)
      : t(thread.searchedTimes, { count: steps.length }) + sources(totalSources)

  return (
    <div className={cn('select-none', compact ? 'mb-1.5' : 'mb-2')}>
      <button
        type="button"
        onClick={() => steps.length > 1 && setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-1.5 py-1 text-left text-[13px] text-ink-muted',
          'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
          steps.length > 1 && 'hover:text-ink-soft',
        )}
      >
        {steps.length > 1 ? (
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]',
              open && 'rotate-90',
            )}
            strokeWidth={1.75}
          />
        ) : (
          <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        )}
        {searching ? <span className="shimmer">{label}</span> : <span>{label}</span>}
      </button>

      {open ? (
        <ul className="ml-[5px] border-l border-line pl-3">
          {steps.map((step) => (
            <li key={step.id} className="py-0.5 text-[12.5px] text-ink-muted">
              {step.query}
              {sources(step.sourceCount)}
            </li>
          ))}
        </ul>
      ) : null}

      {/* A running search gets a thin indeterminate bar rather than a spinner. */}
      {searching && !streaming ? (
        <div className="ml-[5px] h-px w-24 overflow-hidden bg-line">
          <div className="h-full w-1/3 animate-[shimmer_1.4s_linear_infinite] bg-ink-faint" />
        </div>
      ) : null}
    </div>
  )
}
