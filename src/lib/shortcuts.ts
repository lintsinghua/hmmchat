/**
 * User-configurable shortcuts.
 *
 * A shortcut is stored as a normalised string rather than a keycode pair, so it
 * can be shown back to the user, compared against an incoming event, and written
 * into settings without a schema. The format is `mod+shift+k`-style: modifiers in
 * a fixed order, then the key, lowercased.
 *
 * `mod` rather than `meta` is deliberate. On macOS ⌘ is the convention and the
 * app is a macOS app, but a stored `mod` also means a shortcut typed on one
 * keyboard layout or platform matches on another instead of silently not firing.
 */

import type { Entry } from '@/i18n/core'
import { settings } from '@/i18n'

export interface ShortcutBinding {
  id: ShortcutId
  /** Normalised binding, or '' when the action has no shortcut. */
  keys: string
}

export type ShortcutId =
  | 'newChat'
  | 'palette'
  | 'modelPicker'
  | 'toggleSidebar'
  | 'settings'
  | 'stop'

export interface ShortcutDefinition {
  id: ShortcutId
  /** Catalog entries; translated with `t()` where they are shown. */
  label: Entry
  /** What the action does, shown under its row in settings. */
  hint: Entry
  defaultKeys: string
  /** Escape is a fixed affordance for stopping; a dialog needs it to close. */
  fixed?: boolean
}

export const SHORTCUTS: ShortcutDefinition[] = [
  {
    id: 'newChat',
    label: settings.shortcutNewChat,
    hint: settings.shortcutNewChatHint,
    defaultKeys: 'mod+n',
  },
  {
    id: 'palette',
    label: settings.shortcutPalette,
    hint: settings.shortcutPaletteHint,
    defaultKeys: 'mod+k',
  },
  {
    id: 'modelPicker',
    label: settings.shortcutModelPicker,
    hint: settings.shortcutModelPickerHint,
    defaultKeys: 'mod+p',
  },
  {
    id: 'toggleSidebar',
    label: settings.shortcutToggleSidebar,
    hint: settings.shortcutToggleSidebarHint,
    defaultKeys: 'mod+\\',
  },
  {
    id: 'settings',
    label: settings.shortcutSettings,
    hint: settings.shortcutSettingsHint,
    defaultKeys: 'mod+,',
  },
  {
    id: 'stop',
    label: settings.shortcutStop,
    hint: settings.shortcutStopHint,
    defaultKeys: 'Escape',
    fixed: true,
  },
]

export type ShortcutMap = Partial<Record<ShortcutId, string>>

/** The defaults, as a map settings can be seeded with. */
export function defaultShortcuts(): ShortcutMap {
  return Object.fromEntries(SHORTCUTS.map((entry) => [entry.id, entry.defaultKeys]))
}

/** Modifier keys, which are never a binding on their own. */
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Dead'])

/**
 * Turns a keydown into a binding string, or null when the event is only
 * modifiers or otherwise not usable.
 *
 * The key itself is normalised: a space becomes `Space` and punctuation is kept
 * as typed, so `⌘,` round-trips, while letters fold to lowercase so a binding
 * recorded with caps lock on still matches.
 */
export function bindingFromEvent(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    // A bare letter would swallow typing; a bare Escape is the one exception,
    // and it is fixed rather than configurable.
    if (event.key !== 'Escape') return null
  }

  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')

  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toLowerCase() : event.key
  parts.push(key)
  return parts.join('+')
}

/** Whether a keydown matches a stored binding. */
export function matchesBinding(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
  binding: string,
): boolean {
  const candidate = bindingFromEvent(event)
  return candidate !== null && candidate.toLowerCase() === binding.toLowerCase()
}

/** The platform glyphs for a binding, for display in menus and settings. */
export function formatBinding(binding: string): string[] {
  if (!binding) return []

  return binding.split('+').map((part) => {
    switch (part.toLowerCase()) {
      case 'mod':
        return '⌘'
      case 'alt':
        return '⌥'
      case 'shift':
        return '⇧'
      case 'escape':
        return 'Esc'
      case 'enter':
        return '↵'
      case 'space':
        return 'Space'
      case 'arrowup':
        return '↑'
      case 'arrowdown':
        return '↓'
      case 'backspace':
        return '⌫'
      default:
        return part.length === 1 ? part.toUpperCase() : part
    }
  })
}

export function formatBindingText(binding: string): string {
  return formatBinding(binding).join('')
}

/** True when two actions would answer the same keystroke. */
export function findConflict(map: ShortcutMap, binding: string, except: ShortcutId): ShortcutId | null {
  const target = binding.toLowerCase()
  for (const [id, keys] of Object.entries(map) as Array<[ShortcutId, string]>) {
    if (id !== except && keys && keys.toLowerCase() === target) return id
  }
  return null
}
