import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * Applies the theme by toggling a `dark` class on the root element.
 *
 * Only the class is set here; the actual colours live in CSS variables under
 * `.dark`, so a theme switch is one attribute change rather than a re-render of
 * the tree.
 */
export function useTheme(preference: ThemePreference): 'light' | 'dark' {
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    preference === 'system' ? systemTheme() : preference,
  )

  useEffect(() => {
    if (preference !== 'system') {
      setResolved(preference)
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    setResolved(media.matches ? 'dark' : 'light')

    const onChange = (event: MediaQueryListEvent) => {
      setResolved(event.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    // The window material follows the theme, so a light app does not sit on a
    // dark vibrancy backdrop.
    root.style.colorScheme = resolved
  }, [resolved])

  return resolved
}

function systemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** True when the user has asked the OS to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return reduced
}
