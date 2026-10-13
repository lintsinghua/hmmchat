import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Modal dialog.
 *
 * The overlay is a light scrim rather than a heavy black one: the app is a
 * desktop window, and a dark wash over the whole thing reads as a web page
 * modal. The panel itself rises 8px and scales from 0.98.
 */

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogClose = RadixDialog.Close
export const DialogPortal = RadixDialog.Portal

export function DialogOverlay() {
  return (
    <RadixDialog.Overlay
      className={cn(
        'fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px]',
        'data-[state=open]:animate-fade-in',
        'data-[state=closed]:opacity-0',
      )}
    />
  )
}

export function DialogContent({
  children,
  className,
  width = 640,
  height,
}: {
  children: ReactNode
  className?: string
  width?: number
  height?: number | string
}) {
  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        style={{ width: `min(${width}px, calc(100vw - 96px))`, height }}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper',
          'shadow-[var(--shadow-overlay)]',
          'data-[state=open]:animate-dialog-in',
          'data-[state=closed]:opacity-0',
          className,
        )}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return (
    <RadixDialog.Title className="text-base font-semibold tracking-[-0.01em] text-ink">
      {children}
    </RadixDialog.Title>
  )
}

/** Visually hidden, for labelling dialogs that show their title in the body. */
export function DialogHiddenTitle({ children }: { children: ReactNode }) {
  return (
    <RadixDialog.Title className="sr-only">{children}</RadixDialog.Title>
  )
}
