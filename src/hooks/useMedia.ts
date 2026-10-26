import { useEffect, useState } from 'react'

/**
 * Layout breakpoints, decided by the screen rather than the platform.
 *
 * "Compact" is phone width: the sidebar becomes a drawer, dialogs fill the
 * screen and the composer drops its labels. The same rule as Tailwind's `md`
 * breakpoint, so a `max-md:` class and this hook never disagree about which
 * layout is showing. An iPad, or a narrow desktop window, stays on the regular
 * layout — the regular layout already gives way to tabs when columns get thin.
 */
export const COMPACT_QUERY = '(max-width: 767px)'

/**
 * A finger rather than a pointer: no hover, and a coarse hit area. Decides
 * touch behaviour (actions that would wait for hover are shown, Enter makes a
 * newline), independent of the width — a phone in landscape is still touch.
 */
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'

/** Tracks a media query, and keeps tracking it if it changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesNow(query))

  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])

  return matches
}

export function useCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY)
}

export function useTouch(): boolean {
  return useMediaQuery(TOUCH_QUERY)
}

/** For event handlers, which read the current value rather than subscribing. */
export function matchesNow(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/**
 * Whether Enter sends. On a hardware keyboard it does, and Shift+Enter makes a
 * line; a phone's keyboard has no Shift+Enter, so there Enter makes a line and
 * the send button sends — the convention of every messaging app on a phone.
 */
export function enterSends(): boolean {
  return !matchesNow(TOUCH_QUERY)
}
