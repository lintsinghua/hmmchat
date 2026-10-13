import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Browser APIs jsdom does not implement, stubbed once for all DOM tests.
 *
 * Each of these is used unconditionally by the app (theme detection, the
 * sidebar width measurement, the opacity transition on the scroll button), so
 * without stubs any component test would fail on an unrelated missing global
 * rather than on the behaviour under test.
 */

// Unmount between tests. Without this, a second `render` leaves the previous
// tree in the document and every query matches twice.
afterEach(() => {
  cleanup()
})

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  if (!('ResizeObserver' in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
  }

  if (!window.scrollTo) {
    window.scrollTo = (() => {}) as unknown as typeof window.scrollTo
  }
}

// Tauri APIs are absent outside the desktop shell; the app already guards on
// `isTauri`, but the IPC module itself is imported eagerly, so it is mocked to
// keep that import from throwing.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  Channel: class {
    onmessage: ((event: unknown) => void) | undefined
    toJSON() {
      return 'channel'
    }
  },
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => undefined),
  openPath: vi.fn(async () => undefined),
  revealItemInDir: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: vi.fn(async () => ({ execute: async () => ({}), select: async () => [] })) },
}))
