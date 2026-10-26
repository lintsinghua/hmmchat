import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, type PanInfo } from 'motion/react'

/**
 * The session list on a phone.
 *
 * The desktop sidebar pushes the thread aside; at phone width there is no
 * aside to push into, so the same list slides in over the chat with a scrim
 * behind it. It follows the finger: dragged left it closes once it is a third
 * of the way out or flicked, and anything less springs back. Opening is the
 * other half — a swipe in from the left edge, wired up by `useEdgeSwipe`.
 */

const SPRING = { type: 'spring', stiffness: 420, damping: 40 } as const

export function Drawer({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const width = panelRef.current?.offsetWidth ?? 300
    if (info.offset.x < -width / 3 || info.velocity.x < -500) onClose()
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="scrim"
            aria-hidden
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-30 bg-ink/25"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={SPRING}
            // Horizontal only, so the list inside still scrolls vertically.
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.9, right: 0.04 }}
            dragMomentum={false}
            onDragEnd={onDragEnd}
            className="fixed inset-y-0 left-0 z-40 w-[min(320px,86vw)] shadow-[var(--shadow-overlay)]"
          >
            {children}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * Opens the drawer with a swipe in from the left edge.
 *
 * The swipe has to start near the edge and travel mostly sideways, so a
 * horizontal scroll inside the thread (a wide table, a code block) is never
 * taken for it. Android reserves the outermost strip for its own back gesture;
 * a swipe starting there never reaches the page, which is why the band is
 * wider than that strip.
 */
export function useEdgeSwipe(enabled: boolean, onOpen: () => void) {
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    if (!enabled) return
    let start: { x: number; y: number } | null = null

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      start = event.touches.length === 1 && touch.clientX <= 32 ? { x: touch.clientX, y: touch.clientY } : null
    }
    const onMove = (event: TouchEvent) => {
      if (!start) return
      const touch = event.touches[0]
      const dx = touch.clientX - start.x
      const dy = Math.abs(touch.clientY - start.y)
      if (dy > 24 && dy > dx) start = null
      else if (dx > 48 && dx > dy * 1.6) {
        start = null
        onOpenRef.current()
      }
    }
    const onEnd = () => {
      start = null
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled])
}
