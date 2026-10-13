/**
 * Text smoothing for streaming output.
 *
 * Network chunks arrive in bursts — a stall, then 200 characters at once. Paint
 * that verbatim and the answer visibly stutters. This paces the reveal: a
 * steady drip while the backlog is small, accelerating proportionally when the
 * model runs ahead, and a bounded catch-up once the stream ends.
 *
 * The core is a pure function so it can be tested without a DOM; the hook
 * adapts it to React.
 */

import { graphemeCount, graphemeSlice } from './grapheme'

/** Fraction of the outstanding backlog released per frame while streaming. */
const BACKLOG_FRACTION = 0.22

/** Milliseconds allowed to finish the text once streaming has stopped. */
const SETTLE_MS = 300

/** Assumed frame budget; 60fps. Only used to size the settle step. */
const FRAME_MS = 16.7

export interface SmootherState {
  /** Number of graphemes currently displayed. */
  shown: number
  /** Source text this state has been tracking. */
  text: string
}

export function initialSmootherState(): SmootherState {
  return { shown: 0, text: '' }
}

/**
 * Advances the reveal by one frame.
 *
 * Returns the new grapheme count. Fast-forwards (rather than restarting) when
 * `text` shrinks, which happens when a reply resets for a regenerate.
 */
export function advance(
  state: SmootherState,
  text: string,
  streaming: boolean,
  frameMs = FRAME_MS,
): SmootherState {
  const total = graphemeCount(text)

  // Reset when the text is replaced wholesale (new reply on the same lane).
  if (state.text && total < state.shown && !text.startsWith(graphemeSlice(state.text, state.shown))) {
    return { shown: 0, text }
  }

  if (state.shown >= total) {
    // Streaming finished and we are caught up — nothing left to reveal.
    return { shown: total, text }
  }

  if (!streaming) {
    // Settle: reach the end within SETTLE_MS, at least one grapheme per frame.
    const frames = Math.max(1, Math.round(SETTLE_MS / frameMs))
    const step = Math.max(1, Math.ceil((total - state.shown) / frames))
    return { shown: Math.min(total, state.shown + step), text }
  }

  const backlog = total - state.shown
  // At least one grapheme per frame, so a slow trickle still animates; more
  // when the model is far ahead, so the reveal never lags behind badly.
  const step = Math.max(1, Math.ceil(backlog * BACKLOG_FRACTION))
  return { shown: Math.min(total, state.shown + step), text }
}

/** The visible prefix of `text` for a given state. */
export function visible(state: SmootherState, text: string): string {
  return graphemeSlice(text, state.shown)
}

/** True when everything received so far is on screen. */
export function isCaughtUp(state: SmootherState, text: string): boolean {
  return state.shown >= graphemeCount(text)
}
