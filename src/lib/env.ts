/// <reference types="vite/client" />

/** True when running inside the Tauri webview rather than a plain browser. */
export const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * True when the window's title bar is an overlay with the macOS traffic lights
 * floating over the top-left corner. An iPad also reports "Macintosh" in its
 * user agent, so a touch screen rules it out.
 */
export const hasTrafficLights: boolean =
  isTauri && /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints === 0

/**
 * Base URL of the local mock provider used by `pnpm mock`.
 *
 * In the browser (no Tauri) there is no Rust proxy, so provider requests are
 * expected to be pointed at the mock instead. This keeps the whole streaming
 * path exercisable in a fast browser dev loop.
 */
export const MOCK_BASE_URL = 'http://127.0.0.1:8787'
