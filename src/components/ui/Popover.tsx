import { Popover as RadixPopover } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { matchesNow, TOUCH_QUERY } from '@/hooks/useMedia'

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
  /** Radix's hook for where focus goes on close; prevent it to keep focus where an item put it. */
  onCloseAutoFocus?: (event: Event) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
  width?: number | string
  /**
   * The tallest the panel gets. It is also never taller than the room Radix
   * finds beside its trigger, so a long list over a phone's keyboard scrolls
   * inside the panel instead of running off the top of the screen.
   */
  maxHeight?: number
}

export function PopoverContent({
  children,
  className,
  align = 'start',
  side = 'bottom',
  sideOffset = 6,
  width,
  onCloseAutoFocus,
  maxHeight,
}: ContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        side={side}
        sideOffset={sideOffset}
        // Radix focuses the first item on open, and WebKit draws that as a focus
        // ring around a row nobody chose — after a tap and after a click alike.
        // The panel itself takes focus instead; Tab still walks into the items.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
        }}
        // Handing focus back to the trigger is for keyboard navigation. After a
        // tap it only draws a focus ring around the button just let go of.
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (matchesNow(TOUCH_QUERY)) event.preventDefault()
        }}
        // A 340px panel on a 375px phone: kept off the screen edges, and never
        // wider than the screen less that margin.
        collisionPadding={8}
        style={{
          ...(width ? { width: typeof width === 'number' ? `min(${width}px, calc(100vw - 16px))` : width } : null),
          maxHeight: maxHeight
            ? `min(${maxHeight}px, var(--radix-popover-content-available-height))`
            : 'var(--radix-popover-content-available-height)',
        }}
        className={cn(
          'z-50 origin-[var(--radix-popover-content-transform-origin)] outline-none',
          'overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-line bg-paper p-1',
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

/**
 * A row inside a popover. Selected state is a subtle fill, never a border.
 *
 * Picking a row closes the popover, unless `closeOnSelect` is false (see the
 * note at the top). A menu left open after a pick looked like the pick had not
 * registered, and on a phone it also needed a second tap outside to dismiss.
 */
export function PopoverItem({
  children,
  selected,
  onSelect,
  className,
  disabled,
  closeOnSelect = true,
}: {
  children: ReactNode
  selected?: boolean
  onSelect?: () => void
  className?: string
  disabled?: boolean
  closeOnSelect?: boolean
}) {
  const item = (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-sm touch:py-2.5',
        'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
        'disabled:pointer-events-none disabled:opacity-40',
        selected ? 'bg-surface-active text-ink' : 'text-ink-soft hover:bg-surface-hover hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
  return closeOnSelect ? <RadixPopover.Close asChild>{item}</RadixPopover.Close> : item
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
