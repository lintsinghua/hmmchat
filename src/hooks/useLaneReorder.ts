import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, PointerEvent, RefObject } from 'react'

/**
 * Horizontal drag-to-reorder with 1:1 pointer tracking and FLIP animations.
 *
 * Why pointer events + FLIP instead of native HTML5 drag-and-drop:
 * 1. The dragged item tracks the pointer 1:1 via `translate3d(tx, 0, 0)` on
 *    every frame with zero transition lag.
 * 2. When the dragged item's leading edge crosses 52% of a neighbour, the
 *    order updates in the store; before the browser paints that frame,
 *    `useLayoutEffect` compensates the dragged item's `translate3d` by the DOM
 *    slot shift (so it never jumps under the cursor) and FLIP-animates every
 *    displaced sibling — in both the active container and any synchronised
 *    surface (e.g. composer chips and thread columns moving together).
 * 3. On release, the dragged item glides smoothly from the pointer back into
 *    its settled slot (`220ms cubic-bezier(0.22, 1, 0.36, 1)`).
 *
 * A finger is different: the rows this reorders (composer chips, lane tabs)
 * also scroll sideways on a phone, and a horizontal swipe has to stay a scroll.
 * So a touch only picks the item up after it has been held still for a moment,
 * and from then on the page is kept from scrolling until it is let go.
 */

const DRAG_THRESHOLD_PX = 4
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const FLIP_DURATION_MS = 260
const SETTLE_DURATION_MS = 220
/** How long a finger rests on an item before it lifts for reordering. */
const LONG_PRESS_MS = 380
/** Movement during the press that reads as a scroll instead, and cancels it. */
const LONG_PRESS_SLOP_PX = 8

interface ActiveDrag {
  id: string
  startClientX: number
  initialOffsetLeft: number
  width: number
  minOffsetLeft: number
  maxOffsetLeft: number
  desiredOffsetLeft: number
  currentTx: number
}

export interface UseLaneReorderOptions {
  enabled: boolean
  /**
   * When true, a pointer drag only starts from an element inside
   * `[data-lane-handle]` (or the item container's own background), leaving body
   * text inside a reply column free for normal text selection.
   */
  requireHandle?: boolean
  onMove: (fromId: string, toId: string) => void
  onDragChange?: (draggingId: string | null) => void
}

export interface LaneReorderItemProps {
  'data-lane-item': string
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

function readInFlightTranslateX(el: HTMLElement, container: HTMLElement): number {
  const containerRect = container.getBoundingClientRect()
  if (containerRect.width === 0) return 0
  const elRect = el.getBoundingClientRect()
  const layoutLeftInViewport =
    containerRect.left - container.scrollLeft + (el.offsetLeft - container.offsetLeft)
  return elRect.left - layoutLeftInViewport
}

export function useLaneReorder<T extends HTMLElement = HTMLDivElement>({
  enabled,
  requireHandle = false,
  onMove,
  onDragChange,
}: UseLaneReorderOptions): {
  containerRef: RefObject<T | null>
  draggingId: string | null
  getItemProps: (id: string) => LaneReorderItemProps
} {
  const containerRef = useRef<T | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const activeDragRef = useRef<ActiveDrag | null>(null)
  const htmlDragSourceRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const prevOrderRef = useRef<string>('')
  const prevOffsetsRef = useRef<Map<string, number>>(new Map())

  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const onDragChangeRef = useRef(onDragChange)
  onDragChangeRef.current = onDragChange

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  const updateDragState = useCallback((id: string | null) => {
    setDraggingId(id)
    onDragChangeRef.current?.(id)
  }, [])

  // FLIP layout pass: runs synchronously after React reorders DOM nodes and
  // before the browser paints, so displaced items glide and the actively
  // dragged item stays locked to the pointer.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-lane-item]'))
    if (items.length < 2) {
      prevOrderRef.current = items.map((el) => el.dataset.laneItem ?? '').join(',')
      prevOffsetsRef.current.clear()
      for (const el of items) {
        if (el.dataset.laneItem) prevOffsetsRef.current.set(el.dataset.laneItem, el.offsetLeft)
      }
      return
    }

    const currentOrder = items.map((el) => el.dataset.laneItem ?? '').join(',')
    const orderChanged = Boolean(prevOrderRef.current && prevOrderRef.current !== currentOrder)
    const activeDrag = activeDragRef.current

    if (orderChanged) {
      for (const el of items) {
        const itemId = el.dataset.laneItem
        if (!itemId) continue
        const oldOffsetLeft = prevOffsetsRef.current.get(itemId)
        const newOffsetLeft = el.offsetLeft

        if (activeDrag && activeDrag.id === itemId) {
          // Compensate for the new DOM slot so the dragged element stays at the
          // exact same visual coordinate under the pointer.
          activeDrag.currentTx = activeDrag.desiredOffsetLeft - newOffsetLeft
          el.style.transition = 'none'
          el.style.transform = `translate3d(${activeDrag.currentTx}px, 0, 0)`
          el.style.zIndex = '20'
          el.style.position = 'relative'
          continue
        }

        if (oldOffsetLeft !== undefined && oldOffsetLeft !== newOffsetLeft) {
          const inFlightTx = readInFlightTranslateX(el, container)
          const invertX = oldOffsetLeft - newOffsetLeft + inFlightTx
          if (Math.abs(invertX) > 0.5) {
            el.style.transition = 'none'
            el.style.transform = `translate3d(${invertX}px, 0, 0)`
            void el.offsetWidth
            el.style.transition = `transform ${FLIP_DURATION_MS}ms ${FLIP_EASING}`
            el.style.transform = 'translate3d(0px, 0, 0)'
          }
        }
      }
    }

    prevOrderRef.current = currentOrder
    prevOffsetsRef.current.clear()
    for (const el of items) {
      if (el.dataset.laneItem) prevOffsetsRef.current.set(el.dataset.laneItem, el.offsetLeft)
    }
  })

  const getItemProps = useCallback(
    (id: string): LaneReorderItemProps => ({
      'data-lane-item': id,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (!enabled || event.button !== 0) return
        const target = event.target as HTMLElement | null
        if (target?.closest?.('[data-no-drag]')) return
        if (
          requireHandle &&
          !target?.closest?.('[data-lane-handle]') &&
          event.target !== event.currentTarget
        ) {
          return
        }

        cleanupRef.current?.()

        const startX = event.clientX
        const startY = event.clientY
        const prevUserSelect = document.body.style.userSelect
        const prevCursor = document.body.style.cursor
        let active = false
        let lastOverTarget: EventTarget | null = null
        const touch = event.pointerType === 'touch'
        let pressTimer = 0

        const startDrag = () => {
          const container = containerRef.current
          if (!container) return false
          const items = Array.from(container.querySelectorAll<HTMLElement>('[data-lane-item]'))
          const draggedEl = items.find((el) => el.dataset.laneItem === id)
          if (!draggedEl || items.length < 2) return false

          // Snapshot every item's layout offset before any movement begins.
          prevOrderRef.current = items.map((el) => el.dataset.laneItem ?? '').join(',')
          prevOffsetsRef.current.clear()
          for (const el of items) {
            if (el.dataset.laneItem) prevOffsetsRef.current.set(el.dataset.laneItem, el.offsetLeft)
          }

          const firstEl = items[0]
          const lastEl = items[items.length - 1]
          const minOffsetLeft = firstEl.offsetLeft
          const maxOffsetLeft = Math.max(
            minOffsetLeft,
            lastEl.offsetLeft + lastEl.offsetWidth - draggedEl.offsetWidth,
          )

          // If the element was mid-settle when grabbed again, fold its current
          // visual offset into initialOffsetLeft so there is no jump.
          const inFlightTx = readInFlightTranslateX(draggedEl, container)
          const initialOffsetLeft = draggedEl.offsetLeft + inFlightTx

          activeDragRef.current = {
            id,
            startClientX: startX,
            initialOffsetLeft,
            width: draggedEl.offsetWidth,
            minOffsetLeft,
            maxOffsetLeft,
            desiredOffsetLeft: initialOffsetLeft,
            currentTx: inFlightTx,
          }

          draggedEl.style.transition = 'none'
          draggedEl.style.zIndex = '20'
          draggedEl.style.position = 'relative'
          return true
        }

        const activate = () => {
          if (!startDrag()) return false
          active = true
          updateDragState(id)
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'grabbing'
          window.getSelection?.()?.removeAllRanges?.()
          return true
        }

        // Only once an item is held does the page stop scrolling under the
        // finger; before that a swipe is left to scroll the row.
        const holdScroll = (touchEvent: TouchEvent) => {
          if (active) touchEvent.preventDefault()
        }
        // Android opens a context menu on a long press, iOS a callout.
        const holdMenu = (menuEvent: Event) => menuEvent.preventDefault()

        const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
          const dx = moveEvent.clientX - startX
          const dy = moveEvent.clientY - startY

          if (!active) {
            if (touch) {
              // Moved before the press completed: this is a scroll.
              if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) finish()
              return
            }
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
            if (Math.abs(dy) > Math.abs(dx) * 1.5) return
            if (!activate()) return
          }

          const container = containerRef.current
          const drag = activeDragRef.current
          if (!container || !drag) return

          const items = Array.from(container.querySelectorAll<HTMLElement>('[data-lane-item]'))
          const fromIndex = items.findIndex((el) => el.dataset.laneItem === id)
          if (fromIndex === -1) return

          // JSDOM fallback (where layout widths are all 0).
          const allZeroWidth = items.every((el) => el.offsetWidth === 0 && el.getBoundingClientRect().width === 0)
          if (allZeroWidth) {
            if (moveEvent.target === lastOverTarget) return
            lastOverTarget = moveEvent.target
            const overEl = (moveEvent.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-lane-item]')
            if (overEl && container.contains(overEl) && overEl.dataset.laneItem && overEl.dataset.laneItem !== id) {
              onMoveRef.current(id, overEl.dataset.laneItem)
            }
            return
          }

          // 1:1 pointer tracking with gentle rubber-band damping past the ends.
          let desired = drag.initialOffsetLeft + dx
          if (desired < drag.minOffsetLeft) {
            desired = drag.minOffsetLeft + (desired - drag.minOffsetLeft) * 0.22
          } else if (desired > drag.maxOffsetLeft) {
            desired = drag.maxOffsetLeft + (desired - drag.maxOffsetLeft) * 0.22
          }
          drag.desiredOffsetLeft = desired

          const draggedEl = items[fromIndex]
          drag.currentTx = desired - draggedEl.offsetLeft
          draggedEl.style.transition = 'none'
          draggedEl.style.transform = `translate3d(${drag.currentTx}px, 0, 0)`
          draggedEl.style.zIndex = '20'
          draggedEl.style.position = 'relative'

          // Check whether the dragged item's visual box has crossed a neighbour's
          // layout midpoint (using `offsetLeft`/`offsetWidth` so in-flight FLIP
          // transitions on siblings never cause oscillation).
          const visualLeft = desired
          const visualRight = desired + drag.width
          let targetId: string | undefined

          for (let i = items.length - 1; i > fromIndex; i -= 1) {
            const sib = items[i]
            const threshold = sib.offsetLeft + sib.offsetWidth * 0.52
            if (visualRight > threshold) {
              targetId = sib.dataset.laneItem
              break
            }
          }
          if (!targetId) {
            for (let i = 0; i < fromIndex; i += 1) {
              const sib = items[i]
              const threshold = sib.offsetLeft + sib.offsetWidth * 0.48
              if (visualLeft < threshold) {
                targetId = sib.dataset.laneItem
                break
              }
            }
          }

          if (targetId && targetId !== id) {
            onMoveRef.current(id, targetId)
          }
        }

        const settleDraggedElement = () => {
          const container = containerRef.current
          const drag = activeDragRef.current
          activeDragRef.current = null
          if (!container || !drag) return

          const items = Array.from(container.querySelectorAll<HTMLElement>('[data-lane-item]'))
          const draggedEl = items.find((el) => el.dataset.laneItem === drag.id)
          if (!draggedEl) return

          if (Math.abs(drag.currentTx) > 0.5) {
            draggedEl.style.transition = `transform ${SETTLE_DURATION_MS}ms ${FLIP_EASING}`
            draggedEl.style.transform = 'translate3d(0px, 0, 0)'
            const clearStyles = () => {
              draggedEl.style.transition = ''
              draggedEl.style.transform = ''
              draggedEl.style.zIndex = ''
              draggedEl.style.position = ''
            }
            draggedEl.addEventListener('transitionend', clearStyles, { once: true })
            window.setTimeout(clearStyles, SETTLE_DURATION_MS + 30)
          } else {
            draggedEl.style.transition = ''
            draggedEl.style.transform = ''
            draggedEl.style.zIndex = ''
            draggedEl.style.position = ''
          }
        }

        const finish = () => {
          window.clearTimeout(pressTimer)
          window.removeEventListener('touchmove', holdScroll)
          window.removeEventListener('contextmenu', holdMenu)
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          window.removeEventListener('keydown', onKeyDown)
          cleanupRef.current = null

          if (active) {
            settleDraggedElement()
            document.body.style.userSelect = prevUserSelect
            document.body.style.cursor = prevCursor
            updateDragState(null)

            const suppressClick = (clickEvent: MouseEvent) => {
              clickEvent.preventDefault()
              clickEvent.stopPropagation()
            }
            window.addEventListener('click', suppressClick, { capture: true, once: true })
            window.setTimeout(() => window.removeEventListener('click', suppressClick, true), 50)
          }
        }

        const onKeyDown = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key === 'Escape' && active) {
            keyEvent.preventDefault()
            finish()
          }
        }

        cleanupRef.current = () => finish()
        if (touch) {
          window.addEventListener('touchmove', holdScroll, { passive: false })
          window.addEventListener('contextmenu', holdMenu)
          pressTimer = window.setTimeout(() => {
            if (!activate()) {
              finish()
              return
            }
            // A short tick, where the platform offers one, says it has lifted.
            navigator.vibrate?.(8)
          }, LONG_PRESS_MS)
        }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
        window.addEventListener('keydown', onKeyDown)
      },

      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (!enabled) return
        const target = event.target as HTMLElement | null
        if (target?.closest?.('[data-no-drag]')) {
          event.preventDefault()
          return
        }
        event.stopPropagation()
        htmlDragSourceRef.current = id
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', id)
        }
        updateDragState(id)
      },

      onDragOver: (event: DragEvent<HTMLElement>) => {
        const fromId = htmlDragSourceRef.current
        if (!enabled || !fromId) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      },

      onDrop: (event: DragEvent<HTMLElement>) => {
        const fromId = htmlDragSourceRef.current || event.dataTransfer?.getData('text/plain')
        if (!enabled || !fromId) return
        event.preventDefault()
        event.stopPropagation()
        if (fromId !== id) {
          onMoveRef.current(fromId, id)
        }
        htmlDragSourceRef.current = null
        updateDragState(null)
      },

      onDragEnd: () => {
        htmlDragSourceRef.current = null
        updateDragState(null)
      },
    }),
    [enabled, requireHandle, updateDragState],
  )

  return { containerRef, draggingId, getItemProps }
}
