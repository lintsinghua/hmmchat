import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A migration file that is not listed in `src-tauri/src/lib.rs` never runs, and
 * nothing says so: the app starts, and the first write to the new column fails
 * with "no such column". Twice now. This keeps the two lists in step.
 */

const root = resolve(__dirname, '../../src-tauri')

describe('migrations', () => {
  it('registers every migration file in lib.rs', () => {
    const files = readdirSync(resolve(root, 'migrations')).filter((name) => name.endsWith('.sql'))
    const source = readFileSync(resolve(root, 'src/lib.rs'), 'utf8')
    const registered = [...source.matchAll(/migrations\/([^"]+\.sql)/g)].map((match) => match[1])

    // 002_turn_attachments.sql duplicates 002_attachments.sql (same ALTER) and is
    // deliberately not run; registering both would fail on the second ALTER.
    const expected = files.filter((name) => name !== '002_turn_attachments.sql')
    expect(registered.sort()).toEqual(expected.sort())
  })
})
