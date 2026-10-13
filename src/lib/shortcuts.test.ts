import { describe, expect, it } from 'vitest'
import {
  bindingFromEvent,
  defaultShortcuts,
  findConflict,
  formatBinding,
  formatBindingText,
  matchesBinding,
} from './shortcuts'
import { resolveShortcuts } from '@/components/palette/CommandPalette'

const event = (patch: Partial<Parameters<typeof bindingFromEvent>[0]>) => ({
  key: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...patch,
})

describe('bindingFromEvent', () => {
  it('normalises a command binding', () => {
    expect(bindingFromEvent(event({ key: 'K', metaKey: true }))).toBe('mod+k')
    expect(bindingFromEvent(event({ key: '\\', metaKey: true }))).toBe('mod+\\')
    expect(bindingFromEvent(event({ key: ',', ctrlKey: true }))).toBe('mod+,')
  })

  it('orders modifiers consistently', () => {
    expect(bindingFromEvent(event({ key: 'K', metaKey: true, shiftKey: true, altKey: true }))).toBe(
      'mod+alt+shift+k',
    )
  })

  it('ignores a modifier pressed on its own', () => {
    expect(bindingFromEvent(event({ key: 'Meta' }))).toBeNull()
    expect(bindingFromEvent(event({ key: 'Shift', metaKey: true }))).toBeNull()
  })

  it('refuses a bare key, which would swallow typing', () => {
    expect(bindingFromEvent(event({ key: 'k' }))).toBeNull()
    // Escape is the one bare key the app claims, and it is not configurable.
    expect(bindingFromEvent(event({ key: 'Escape' }))).toBe('Escape')
  })

  it('names the space key so a binding can be stored', () => {
    expect(bindingFromEvent(event({ key: ' ', metaKey: true }))).toBe('mod+Space')
  })
})

describe('matchesBinding', () => {
  it('matches regardless of the keyboard’s letter case', () => {
    expect(matchesBinding(event({ key: 'K', metaKey: true, shiftKey: true }), 'mod+K')).toBe(false)
    expect(matchesBinding(event({ key: 'k', metaKey: true }), 'mod+k')).toBe(true)
    expect(matchesBinding(event({ key: 'n', metaKey: true }), 'mod+k')).toBe(false)
  })
})

describe('formatBinding', () => {
  it('renders platform glyphs', () => {
    expect(formatBinding('mod+shift+k')).toEqual(['⌘', '⇧', 'K'])
    expect(formatBindingText('mod+\\')).toBe('⌘\\')
    expect(formatBindingText('Escape')).toBe('Esc')
  })
})

describe('resolveShortcuts', () => {
  it('fills in defaults for an install that has none', () => {
    const resolved = resolveShortcuts(undefined)
    expect(resolved.newChat).toBe('mod+n')
    expect(resolved.stop).toBe('Escape')
  })

  it('keeps a user binding and restores only what is missing', () => {
    const resolved = resolveShortcuts({ newChat: 'mod+alt+n' })
    expect(resolved.newChat).toBe('mod+alt+n')
    expect(resolved.palette).toBe('mod+k')
  })
})

describe('findConflict', () => {
  it('finds the action already using a binding', () => {
    expect(findConflict(defaultShortcuts(), 'mod+k', 'newChat')).toBe('palette')
    // Not a conflict with itself.
    expect(findConflict(defaultShortcuts(), 'mod+k', 'palette')).toBeNull()
  })
})
