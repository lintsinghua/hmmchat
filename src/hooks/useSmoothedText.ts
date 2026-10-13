import { useEffect, useRef, useState } from 'react'
import {
  advance,
  initialSmootherState,
  isCaughtUp,
  visible,
  type SmootherState,
} from '@/chat/smoother'
import { graphemeCount } from '@/chat/grapheme'

/**
 * Reveals `text` at a paced rate rather than in network-sized bursts.
 *
 * Reads the latest `text` through a ref each frame so the animation loop is not
 * restarted on every chunk — restarting it per token is exactly the re-render
 * storm this exists to avoid.
 */
export function useSmoothedText(text: string, streaming: boolean): string {
  const stateRef = useRef<SmootherState | null>(null)
  const latestRef = useRef({ text, streaming })
  latestRef.current = { text, streaming }

  // History renders instantly; only text that streams in this session animates.
  if (stateRef.current === null) {
    stateRef.current = streaming
      ? initialSmootherState()
      : { shown: graphemeCount(text), text }
  }

  const [display, setDisplay] = useState(() =>
    streaming ? '' : text,
  )

  useEffect(() => {
    let frame = 0

    const tick = () => {
      const { text: current, streaming: isStreaming } = latestRef.current
      const next = advance(stateRef.current!, current, isStreaming)
      stateRef.current = next

      const nextVisible = visible(next, current)
      setDisplay((previous) => (previous === nextVisible ? previous : nextVisible))

      if (isStreaming || !isCaughtUp(next, current)) {
        frame = requestAnimationFrame(tick)
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // Intentionally keyed on `streaming` alone: `text` changes every chunk, and
    // depending on it would tear down and rebuild the loop each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming])

  return display
}
