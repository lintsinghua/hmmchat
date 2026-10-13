import { useEffect, useRef, useState } from 'react'

/**
 * Measures an element's width.
 *
 * Used to decide whether a compare-mode turn can fit real columns or has to
 * fall back to tabs. A ResizeObserver rather than a window resize listener,
 * because the thread's width also changes when the sidebar is toggled.
 */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    setWidth(node.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
