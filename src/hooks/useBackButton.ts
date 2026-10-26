import { useEffect, useRef } from 'react'
import { isTauri } from '@/lib/env'

/**
 * The Android back button.
 *
 * Left to itself it navigates the webview's history, which this one-page app
 * has none of, so every press closed the app — out of a half-typed settings
 * form, or from under a menu. Back instead peels off whatever is on top: an
 * open dialog or menu first, then whatever `onBack` knows about (the drawer, a
 * column viewed alone). Only with nothing left to close does it leave the app.
 * Only Android has the button, and only Android registers the listener:
 * elsewhere the command does not exist, and asking for it is an error.
 */
export function useBackButton(onBack: () => boolean) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!isTauri || !/Android/i.test(navigator.userAgent)) return
    let disposed = false
    let unregister: (() => void) | undefined

    void import('@tauri-apps/api/app')
      .then(async ({ onBackButtonPress, exit }) => {
        const listener = await onBackButtonPress(() => {
          if (dismissTopLayer()) return
          if (onBackRef.current()) return
          void exit(0)
        })
        if (disposed) void listener.unregister()
        else unregister = () => void listener.unregister()
      })
      // Without it, back keeps its default (closing the app); not worth a crash.
      .catch((error) => console.warn('back button listener unavailable', error))

    return () => {
      disposed = true
      unregister?.()
    }
  }, [])
}

/**
 * Closes the topmost Radix layer — a dialog, popover or menu — the way Esc
 * would, which is the one dismissal every layer already handles. Radix listens
 * in the capture phase, so the event is marked handled before it bubbles to the
 * app's own shortcuts, where Esc would otherwise also stop a running answer.
 */
function dismissTopLayer(): boolean {
  const open = document.querySelector('[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]')
  if (!open) return false
  const claim = (event: Event) => event.preventDefault()
  document.addEventListener('keydown', claim, { once: true })
  ;(document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
  )
  document.removeEventListener('keydown', claim)
  return true
}
