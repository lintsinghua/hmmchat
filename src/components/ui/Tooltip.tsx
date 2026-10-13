import { Tooltip as RadixTooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Tooltips, used mainly to surface keyboard shortcuts beside icon buttons.
 *
 * Delayed on open (400ms) so sweeping the pointer across a toolbar does not
 * spray labels, and instant on close.
 */

export const TooltipProvider = RadixTooltip.Provider

export function Tooltip({
  children,
  label,
  side = 'bottom',
  shortcut,
}: {
  children: ReactNode
  label: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  shortcut?: string
}) {
  return (
    <RadixTooltip.Root delayDuration={400}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 flex max-w-[320px] items-center gap-1.5 rounded-[7px] px-2 py-1',
            'bg-ink text-[12px] font-medium text-paper',
            'shadow-[var(--shadow-raised)]',
            'data-[state=delayed-open]:animate-pop-in',
            'data-[state=closed]:opacity-0',
          )}
        >
          <span className="break-words">{label}</span>
          {shortcut && <span className="text-[11px] opacity-55">{shortcut}</span>}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
