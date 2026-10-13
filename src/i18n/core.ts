import { useSyncExternalStore } from 'react'

/**
 * Interface language.
 *
 * Deliberately not a framework: the app has one window, one user and a few
 * hundred strings, so the whole mechanism is a store, a `t()` and a catalog of
 * `{ en, zh }` pairs. Adding a third language means adding a field to every
 * entry — which is the moment to reach for a real i18n library, not before.
 *
 * Defaults to Chinese: it is the language the app was written in, and the one
 * its tests assert against.
 */

export type Language = 'zh' | 'en'

/** One string, in every language the app ships. */
export type Entry = { en: string; zh: string }

const DEFAULT_LANGUAGE: Language = 'zh'

let language: Language = DEFAULT_LANGUAGE
const listeners = new Set<() => void>()

export function getLanguage(): Language {
  return language
}

/** Called by the settings store; notifies every subscribed component. */
export function setLanguage(next: Language): void {
  if (next === language) return
  language = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function interpolate(text: string, values?: Record<string, string | number>): string {
  if (!values) return text
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}

/** Looks a string up outside React — engine, title prompts, provider metadata. */
export function t(entry: Entry, values?: Record<string, string | number>): string {
  return interpolate(entry[language], values)
}

/**
 * A counted string, in both numbers.
 *
 * English needs a singular form and Chinese does not, so the catalog holds a
 * pair and this picks between them — the alternative is a ternary at every call
 * site, which is how "1 rounds" ships.
 */
export type Counted = { one: Entry; many: Entry }

export function counted(entry: Counted, count: number, values?: Record<string, string | number>): string {
  return interpolate((count === 1 ? entry.one : entry.many)[language], { count, ...values })
}

/** The same, for components: re-renders when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLanguage, getLanguage)
  return t
}

/** Non-reactive read, for code that cannot hook (module scope, workers). */
export function currentLanguage(): Language {
  return language
}
