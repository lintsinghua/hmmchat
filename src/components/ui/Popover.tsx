import { Popover as RadixPopover } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Popover wrapper.
 *
 * Overlays scale from 0.96 with a short exponential-out curve and fade at the
 * same time — the standard "materialises from the trigger" feel. Placement is
 * left to Radix; no offset maths is done here.
 */

/**
 * `closeOnSelect` is false for menus whose item *adds* something — picking a
 * model to compare with does not finish the interaction, and closing after each
 * pick made adding two models a two-popover operation. A menu that sets a value
 * (search backend, reasoning depth) closes, which is what makes the pick feel
 * committed.
 */
export function Popover({
  defaultOpen,
  open,
  onOpenChange,
  children,
}: {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <RadixPopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {children}
    </RadixPopover.Root>
  )
}

export const PopoverTrigger = RadixPopover.Trigger
export const PopoverAnchor = RadixPopover.Anchor

interface ContentProps {
  children: ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
  width?: number | string
}

export function PopoverContent({
  children,
  className,
  align = 'start',
  side = 'bottom',
  sideOffset = 6,
  width,
}: ContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        side={side}
        sideOffset={sideOffset}
        style={width ? { width } : undefined}
        className={cn(
          'z-50 origin-[var(--radix-popover-content-transform-origin)]',
          'rounded-[var(--radius-md)] border border-line bg-paper p-1',
          'shadow-[var(--shadow-overlay)]',
          'data-[state=open]:animate-pop-in',
          'data-[state=closed]:opacity-0',
          className,
        )}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
}

/** A row inside a popover. Selected state is a subtle fill, never a border. */
export function PopoverItem({
  children,
  selected,
  onSelect,
  className,
  disabled,
}: {
  children: ReactNode
  selected?: boolean
  onSelect?: () => void
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-sm',
        'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
        'disabled:pointer-events-none disabled:opacity-40',
        selected ? 'bg-surface-active text-ink' : 'text-ink-soft hover:bg-surface-hover hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function PopoverLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
      {children}
    </div>
  )
}

export function PopoverSeparator() {
  return <div className="my-1 h-px bg-line" />
}
