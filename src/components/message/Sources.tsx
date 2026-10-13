import type { Source } from '@/chat/types'
import { openExternal } from '@/lib/open'
import { cn } from '@/lib/cn'

/**
 * Citation chips below an answer.
 *
 * Numbered to match the `[n]` markers models write inline, so a claim in the
 * prose can be traced to a source without leaving the column. Favicons are
 * deliberately absent — image requests per source would leak which links were
 * read, and the domain alone is enough to judge a source.
 */
export function Sources({ sources, compact }: { sources: Source[]; compact?: boolean }) {
  if (!sources.length) return null

  return (
    <div className={cn('flex flex-wrap gap-1.5', compact ? 'mt-2' : 'mt-3')}>
      {sources.map((source, index) => (
        <button
          key={source.id}
          type="button"
          onClick={() => void openExternal(source.url)}
          title={source.url}
          className={cn(
            'group flex max-w-full items-center gap-1.5 rounded-[var(--radius-full)]',
            'border border-line bg-surface px-2 py-[3px]',
            'text-[12px] text-ink-soft',
            'transition-[background-color,border-color,transform] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
            'hover:border-line-strong hover:bg-surface-hover active:scale-[0.97]',
          )}
        >
          <span className="shrink-0 tabular-nums text-ink-faint">{index + 1}</span>
          <span className="truncate">{source.title || hostOf(source.url)}</span>
        </button>
      ))}
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
