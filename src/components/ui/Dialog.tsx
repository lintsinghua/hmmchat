import { Dialog as RadixDialog } from 'radix-ui'
import { X } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n/core'
import { app } from '@/i18n'

/**
 * Modal dialog.
 *
 * The overlay is a light scrim rather than a heavy black one: the app is a
 * desktop window, and a dark wash over the whole thing reads as a web page
 * modal. The panel itself rises 8px and scales from 0.98.
 *
 * At phone width a floating panel is a card with a few pixels of margin and a
 * keyboard covering half of it, so the dialog fills the screen instead and
 * comes up from below. There is no Esc on a phone, so it carries its own close
 * button in the top-right corner; a dialog's top row leaves room for it with
 * `DIALOG_CLOSE_GUTTER`.
 */

/** Right padding a dialog's first row needs to clear the phone close button. */
export const DIALOG_CLOSE_GUTTER = 'max-md:pr-12'

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
  const t = useT()
  // Sizes go through variables rather than inline width/height, which would
  // beat the full-screen classes below.
  const size = {
    '--dialog-w': `min(${width}px, calc(100vw - 96px))`,
    '--dialog-h': height === undefined ? 'auto' : typeof height === 'number' ? `${height}px` : height,
  } as CSSProperties

  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        style={size}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'h-[var(--dialog-h)] w-[var(--dialog-w)]',
          'overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper',
          'shadow-[var(--shadow-overlay)]',
          'data-[state=open]:animate-dialog-in',
          'data-[state=closed]:opacity-0',
          className,
          // Last, so a dialog's own sizing classes cannot undo the sheet.
          'max-md:inset-x-0 max-md:bottom-0 max-md:top-0 max-md:h-auto max-md:w-full',
          'max-md:flex max-md:translate-x-0 max-md:translate-y-0 max-md:flex-col',
          'max-md:rounded-none max-md:border-0 max-md:shadow-none',
          'max-md:pt-safe max-md:pb-[env(safe-area-inset-bottom)] max-md:pl-safe max-md:pr-safe',
        )}
      >
        {children}
        <RadixDialog.Close
          aria-label={t(app.close)}
          className={cn(
            'absolute right-2 top-[calc(env(safe-area-inset-top,0px)+6px)] z-10 hidden h-9 w-9',
            'items-center justify-center rounded-full text-ink-muted active:bg-surface-active',
            'max-md:flex',
          )}
        >
          <X className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </RadixDialog.Close>
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
