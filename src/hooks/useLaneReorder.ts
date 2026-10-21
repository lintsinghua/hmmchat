import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, PointerEvent, RefObject } from 'react'

/**
 * Horizontal drag-to-reorder for model columns, tabs and composer chips.
 *
 * Driven by pointer events rather than native HTML5 `draggable` so that:
 * - Tauri's native window file-drop handler on macOS WKWebView never intercepts
 *   the gesture.
 * - Pressing directly on a `<button>` (such as a composer model chip's picker
 *   trigger) initiates a drag once moved past the threshold, while a plain
 *   click (< 5px) still opens the popover normally.
 * - Columns and chips swap in place as the cursor crosses a neighbour's
 *   horizontal midpoint, with no browser drag-ghost flyback delay.
 */

const DRAG_THRESHOLD_PX = 5

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
  const dragSourceRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

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

  const resolveTargetAt = useCallback((currentId: string, clientX: number, eventTarget: EventTarget | null): string | undefined => {
    const container = containerRef.current
    if (!container) return undefined

    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-lane-item]'))
    const fromIndex = items.findIndex((el) => el.dataset.laneItem === currentId)
    if (fromIndex === -1 || items.length < 2) return undefined

    const allZeroWidth = items.every((el) => el.getBoundingClientRect().width === 0)
    if (allZeroWidth) {
      const overEl = (eventTarget as HTMLElement | null)?.closest?.<HTMLElement>('[data-lane-item]')
      if (overEl && container.contains(overEl) && overEl.dataset.laneItem !== currentId) {
        return overEl.dataset.laneItem
      }
      return undefined
    }

    for (let i = items.length - 1; i > fromIndex; i -= 1) {
      const rect = items[i].getBoundingClientRect()
      if (clientX > rect.left + rect.width / 2) {
        return items[i].dataset.laneItem
      }
    }
    for (let i = 0; i < fromIndex; i += 1) {
      const rect = items[i].getBoundingClientRect()
      if (clientX < rect.left + rect.width / 2) {
        return items[i].dataset.laneItem
      }
    }
    return undefined
  }, [])

  const getItemProps = useCallback(
    (id: string): LaneReorderItemProps => ({
      'data-lane-item': id,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (!enabled || event.button !== 0) return
        const target = event.target as HTMLElement | null
        if (target?.closest?.('[data-no-drag]')) return
        if (requireHandle && !target?.closest?.('[data-lane-handle]') && event.target !== event.currentTarget) {
          return
        }

        cleanupRef.current?.()

        const startX = event.clientX
        const startY = event.clientY
        const prevUserSelect = document.body.style.userSelect
        const prevCursor = document.body.style.cursor
        let active = false
        let lastOverTarget: EventTarget | null = null

        const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
          const dx = moveEvent.clientX - startX
          const dy = moveEvent.clientY - startY

          if (!active) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
            if (Math.abs(dy) > Math.abs(dx) * 1.5) return
            active = true
            dragSourceRef.current = id
            updateDragState(id)
            document.body.style.userSelect = 'none'
            document.body.style.cursor = 'grabbing'
            window.getSelection?.()?.removeAllRanges?.()
          }

          const container = containerRef.current
          const allZeroWidth =
            container !== null &&
            Array.from(container.querySelectorAll<HTMLElement>('[data-lane-item]')).every(
              (el) => el.getBoundingClientRect().width === 0,
            )
          if (allZeroWidth) {
            if (moveEvent.target === lastOverTarget) return
            lastOverTarget = moveEvent.target
          }

          const targetId = resolveTargetAt(id, moveEvent.clientX, moveEvent.target)
          if (targetId && targetId !== id) {
            onMoveRef.current(id, targetId)
          }
        }

        const finish = () => {
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          window.removeEventListener('keydown', onKeyDown)
          cleanupRef.current = null

          if (active) {
            document.body.style.userSelect = prevUserSelect
            document.body.style.cursor = prevCursor
            dragSourceRef.current = null
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
        dragSourceRef.current = id
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', id)
        }
        updateDragState(id)
      },

      onDragOver: (event: DragEvent<HTMLElement>) => {
        const fromId = dragSourceRef.current
        if (!enabled || !fromId) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      },

      onDrop: (event: DragEvent<HTMLElement>) => {
        const fromId = dragSourceRef.current || event.dataTransfer?.getData('text/plain')
        if (!enabled || !fromId) return
        event.preventDefault()
        event.stopPropagation()
        if (fromId !== id) {
          onMoveRef.current(fromId, id)
        }
        dragSourceRef.current = null
        updateDragState(null)
      },

      onDragEnd: () => {
        dragSourceRef.current = null
        updateDragState(null)
      },
    }),
    [enabled, requireHandle, resolveTargetAt, updateDragState],
  )

  return { containerRef, draggingId, getItemProps }
}
