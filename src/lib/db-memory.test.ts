import { beforeEach, describe, expect, it } from 'vitest'
import { memoryBackend, resetMemoryBackend } from './db-memory'

/**
 * The in-memory backend parses the app's SQL rather than executing it, so every
 * statement shape the app issues needs at least one test. A mis-parse would look
 * like "messages vanish" rather than like an error, which is the failure this
 * backend exists to prevent.
 */

const db = memoryBackend()

beforeEach(() => {
  resetMemoryBackend()
})

describe('insert and select', () => {
  it('round-trips a row', async () => {
    await db.execute(
      'INSERT INTO conversations (id, title, pinned, created_at, updated_at, prefs, active_leaf_turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['c1', 'hello', 0, 10, 10, '{}', null],
    )

    const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM conversations')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'c1', title: 'hello' })
  })

  it('filters by an equality predicate', async () => {
    await db.execute(
      'INSERT INTO turns (id, conversation_id, parent_turn_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
      ['t1', 'c1', null, 'first', 1],
    )
    await db.execute(
      'INSERT INTO turns (id, conversation_id, parent_turn_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
      ['t2', 'c2', null, 'second', 2],
    )

    const rows = await db.select<Array<Record<string, unknown>>>(
      'SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at',
      ['c1'],
    )
    expect(rows.map((row) => row.id)).toEqual(['t1'])
  })

  it('orders ascending by created_at', async () => {
    await db.execute('INSERT INTO turns (id, conversation_id, text, created_at) VALUES (?, ?, ?, ?)', [
      'late',
      'c1',
      'b',
      20,
    ])
    await db.execute('INSERT INTO turns (id, conversation_id, text, created_at) VALUES (?, ?, ?, ?)', [
      'early',
      'c1',
      'a',
      10,
    ])

    const rows = await db.select<Array<Record<string, unknown>>>(
      'SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at',
      ['c1'],
    )
    expect(rows.map((row) => row.id)).toEqual(['early', 'late'])
  })
})

describe('update', () => {
  it('patches only matching rows', async () => {
    await db.execute(
      'INSERT INTO replies (id, turn_id, lane_id, text, active, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['r1', 't1', 'l1', '', 0, 'pending', 1],
    )
    await db.execute(
      'INSERT INTO replies (id, turn_id, lane_id, text, active, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['r2', 't1', 'l2', '', 0, 'pending', 1],
    )

    const result = await db.execute('UPDATE replies SET active = ? WHERE turn_id = ? AND lane_id = ?', [
      1,
      't1',
      'l1',
    ])
    expect(result.rowsAffected).toBe(1)

    const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM replies')
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
    expect(byId.r1.active).toBe(1)
    expect(byId.r2.active).toBe(0)
  })

  it('appends to text via a single-column patch', async () => {
    await db.execute(
      'INSERT INTO replies (id, turn_id, lane_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
      ['r1', 't1', 'l1', 'a', 1],
    )
    await db.execute('UPDATE replies SET text = ? WHERE id = ?', ['ab', 'r1'])

    const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM replies')
    expect(rows[0].text).toBe('ab')
  })
})

describe('delete', () => {
  it('deletes by id', async () => {
    await db.execute(
      'INSERT INTO conversations (id, title, pinned, created_at, updated_at, prefs, active_leaf_turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['c1', 'x', 0, 1, 1, '{}', null],
    )
    await db.execute('DELETE FROM conversations WHERE id = ?', ['c1'])
    expect(await db.select('SELECT * FROM conversations')).toHaveLength(0)
  })
})

describe('upsert', () => {
  it('inserts then updates the named columns on conflict', async () => {
    const statement =
      'INSERT INTO providers (id, kind, name, base_url, enabled, models, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, base_url = excluded.base_url, enabled = excluded.enabled, models = excluded.models'

    await db.execute(statement, ['p1', 'anthropic', 'Anthropic', 'https://a.test', 1, '[]', 1])
    await db.execute(statement, ['p1', 'anthropic', 'Renamed', 'https://a.test', 0, '["m"]', 1])

    const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM providers')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Renamed', enabled: 0, models: '["m"]' })
  })

  it('preserves columns the statement does not update', async () => {
    // A partial upsert (omitting `created_at`) must not blank that column.
    await db.execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['theme', '"light"'],
    )
    await db.execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['theme', '"dark"'],
    )

    const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM settings')
    expect(rows).toHaveLength(1)
    expect(rows[0].value).toBe('"dark"')
  })
})

describe('aggregate', () => {
  it('returns the maximum version, or null when none exists', async () => {
    expect(await db.select('SELECT MAX(version) AS max_version FROM replies WHERE turn_id = ? AND lane_id = ?', ['t1', 'l1'])).toEqual([
      { max_version: null },
    ])

    await db.execute(
      'INSERT INTO replies (id, turn_id, lane_id, version, created_at) VALUES (?, ?, ?, ?, ?)',
      ['r1', 't1', 'l1', 1, 1],
    )
    await db.execute(
      'INSERT INTO replies (id, turn_id, lane_id, version, created_at) VALUES (?, ?, ?, ?, ?)',
      ['r2', 't1', 'l1', 2, 2],
    )

    expect(
      await db.select('SELECT MAX(version) AS max_version FROM replies WHERE turn_id = ? AND lane_id = ?', ['t1', 'l1']),
    ).toEqual([{ max_version: 2 }])
  })
})

describe('search', () => {
  it('matches a title substring', async () => {
    await db.execute(
      'INSERT INTO conversations (id, title, pinned, created_at, updated_at, prefs, active_leaf_turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['c1', '数据模型设计', 0, 1, 1, '{}', null],
    )

    const rows = await db.select<Array<Record<string, unknown>>>(
      'SELECT DISTINCT c.* FROM conversations c LEFT JOIN turns t ON t.conversation_id = c.id WHERE c.title LIKE ? OR t.text LIKE ? ORDER BY c.pinned DESC, c.updated_at DESC',
      ['%模型%', '%模型%'],
    )
    expect(rows.map((row) => row.id)).toEqual(['c1'])
  })

  it('matches CJK text in a message body, which is why LIKE is used', async () => {
    await db.execute(
      'INSERT INTO conversations (id, title, pinned, created_at, updated_at, prefs, active_leaf_turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['c1', 'untitled', 0, 1, 1, '{}', null],
    )
    await db.execute(
      'INSERT INTO turns (id, conversation_id, parent_turn_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
      ['t1', 'c1', null, '这个应用的数据模型要怎么设计？', 1],
    )

    const rows = await db.select<Array<Record<string, unknown>>>(
      'SELECT DISTINCT c.* FROM conversations c LEFT JOIN turns t ON t.conversation_id = c.id WHERE c.title LIKE ? OR t.text LIKE ? ORDER BY c.pinned DESC, c.updated_at DESC',
      ['%数据模型%', '%数据模型%'],
    )
    expect(rows.map((row) => row.id)).toEqual(['c1'])
  })

  it('returns nothing when nothing matches', async () => {
    await db.execute(
      'INSERT INTO conversations (id, title, pinned, created_at, updated_at, prefs, active_leaf_turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['c1', 'cooking', 0, 1, 1, '{}', null],
    )

    const rows = await db.select(
      'SELECT DISTINCT c.* FROM conversations c LEFT JOIN turns t ON t.conversation_id = c.id WHERE c.title LIKE ? OR t.text LIKE ?',
      ['%zzz%', '%zzz%'],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('ordering of the conversation list', () => {
  it('floats pinned rows above more recent ones', async () => {
    await db.execute(
      'INSERT INTO conversations (id, title, pinned, created_at, updated_at, prefs, active_leaf_turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['recent', 'new', 0, 100, 100, '{}', null],
    )
    await db.execute(
      'INSERT INTO conversations (id, title, pinned, created_at, updated_at, prefs, active_leaf_turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['old-pinned', 'pinned', 1, 1, 1, '{}', null],
    )

    const rows = await db.select<Array<Record<string, unknown>>>(
      'SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC',
    )
    expect(rows.map((row) => row.id)).toEqual(['old-pinned', 'recent'])
  })
})

describe('unsupported statements', () => {
  it('throws rather than silently doing nothing', async () => {
    // A silent no-op is the exact bug this backend replaced, so an unknown
    // statement must be loud.
    await expect(db.execute('VACUUM irrelevant_table')).rejects.toThrow(/unsupported statement/)
  })
})
