import { useEffect } from 'react'

/**
 * Keeps the shell the height of what the keyboard leaves visible.
 *
 * iOS does not resize the page for the keyboard: it slides the keyboard over
 * the page and scrolls the whole document to keep the caret in view, which
 * hides the composer under the keys or pushes the title bar off the top. The
 * visual viewport is the part left uncovered, so its height is published as
 * `--app-height` (which `#root` is sized to — nothing else may set its height)
 * and the document scroll is pinned at zero. Android resizes the layout itself
 * (`interactive-widget=resizes-content`), where this is a no-op.
 *
 * `data-keyboard` on the root says the keyboard is up, for the `keyboard:`
 * variant. "Up" is measured against the tallest height seen at this width,
 * not against `innerHeight`, which WebKit reports inconsistently while the
 * keyboard animates.
 */
export function useViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement

    let full = 0
    let width = 0
    let frame = 0

    const apply = () => {
      const height = viewport?.height ?? window.innerHeight
      // A rotation is a new layout; its full height is learnt again.
      if (window.innerWidth !== width) {
        width = window.innerWidth
        full = 0
      }
      full = Math.max(full, height)
      root.style.setProperty('--app-height', `${Math.round(height)}px`)
      root.toggleAttribute('data-keyboard', full - height > 120)
      // The shell now fits; any document scroll left is WebKit's own nudge.
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }

    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(apply)
    }

    apply()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      root.style.removeProperty('--app-height')
      root.removeAttribute('data-keyboard')
    }
  }, [])
}
