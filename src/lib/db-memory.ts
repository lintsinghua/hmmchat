/**
 * In-memory persistence for the browser dev loop.
 *
 * Implements the same query surface the app uses against SQLite, so `db.ts` can
 * switch backends without any caller knowing. Only the handful of statements
 * the app actually issues are understood; anything else throws loudly, because
 * a silent no-op here would recreate the bug this replaced (a message that
 * appears to send and then vanishes).
 *
 * Scope is per page load: reloading starts fresh. That is the intended tradeoff
 * for a backend that exists to make UI iteration fast without a Tauri build.
 */

interface Row {
  [column: string]: unknown
}

const tables: Record<string, Map<string, Row>> = {
  conversations: new Map(),
  turns: new Map(),
  lanes: new Map(),
  replies: new Map(),
  providers: new Map(),
  settings: new Map(),
}

/** Tables whose first column is the primary key. */
const PRIMARY_KEYS: Record<string, string> = {
  conversations: 'id',
  turns: 'id',
  lanes: 'id',
  replies: 'id',
  providers: 'id',
  settings: 'key',
}

function table(name: string): Map<string, Row> {
  const found = tables[name]
  if (!found) throw new Error(`memory backend: unknown table \`${name}\``)
  return found
}

/** The table a statement names, or a clear failure. */
function tableOf(sql: string): string {
  const match = sql.match(/\b(?:FROM|INTO|UPDATE)\s+([a-z_]+)/i)
  const name = match?.[1]
  if (!name || !(name in tables)) {
    throw new Error(`memory backend: unsupported statement: ${sql.slice(0, 80)}`)
  }
  return name
}

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/**
 * Handles `INSERT … ON CONFLICT(key) DO UPDATE SET a = excluded.a, …`.
 *
 * The conflict target and the updated columns are read out of the statement
 * rather than hard-coded, so a change to the SQL does not silently stop the
 * update from happening.
 */
function applyUpsert(tableName: string, sql: string, values: unknown[]): void {
  const keyColumn = sql.match(/ON CONFLICT\(([a-z_]+)\)/i)?.[1]
  if (!keyColumn) throw new Error(`memory backend: upsert without a conflict target: ${sql}`)

  const setClause = sql.match(/DO UPDATE SET([\s\S]*)$/i)?.[1] ?? ''
  const updatedColumns = [...setClause.matchAll(/([a-z_]+)\s*=\s*excluded\.([a-z_]+)/gi)].map(
    (match) => match[2],
  )

  const columns = columnsOfInsert(sql)
  const row: Row = {}
  columns.forEach((column, index) => {
    row[column] = values[index]
  })

  const key = String(row[keyColumn])
  const existing = table(tableName).get(key)

  if (existing) {
    // Only the columns the statement says to update; everything else on the
    // existing row is preserved, which is what makes a partial upsert safe.
    for (const column of updatedColumns) existing[column] = row[column]
  } else {
    table(tableName).set(key, row)
  }
}

/** Column names from the INSERT's column list. */
function columnsOfInsert(sql: string): string[] {
  const match = sql.match(/INSERT INTO\s+[a-z_]+\s*\(([^)]+)\)/i)
  if (!match) throw new Error(`memory backend: INSERT without a column list: ${sql.slice(0, 80)}`)
  return match[1].split(',').map((column) => column.trim())
}

/**
 * The VALUES tuple, with `?` placeholders filled in order and literals parsed.
 * A statement like `VALUES (?, ?, 0, ?, NULL, ?)` would otherwise shift every
 * value after the first literal into the wrong column.
 */
function valuesOfInsert(sql: string, values: unknown[]): unknown[] {
  const match = sql.match(/VALUES\s*\(([^)]*)\)/i)
  if (!match) return values
  let next = 0
  return match[1].split(',').map((slot) => {
    const literal = slot.trim()
    if (literal === '?') return values[next++]
    if (/^NULL$/i.test(literal)) return null
    if (/^-?\d+(\.\d+)?$/.test(literal)) return Number(literal)
    return literal.replace(/^'(.*)'$/, '$1')
  })
}

export function resetMemoryBackend(): void {
  for (const entries of Object.values(tables)) entries.clear()
}

export function memoryBackend() {
  return {
    async execute(sql: string, values: unknown[] = []) {
      const statement = normalize(sql)

      // Transactions are a no-op here: the backend is a set of Maps in one
      // process, so a statement cannot half-apply, and `tableOf` has no view of
      // BEGIN. Accepted rather than rejected so the SQLite path's
      // `BEGIN`/`COMMIT` wrapping works unchanged in the browser dev loop.
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(statement)) {
        return { rowsAffected: 0, lastInsertId: 0 }
      }

      const tableName = tableOf(statement)

      if (/^PRAGMA/i.test(statement)) return { rowsAffected: 0, lastInsertId: 0 }

      if (/^INSERT/i.test(statement)) {
        if (/ON CONFLICT/i.test(statement)) {
          applyUpsert(tableName, statement, values)
        } else {
          const columns = columnsOfInsert(statement)
          const row: Row = {}
          const slots = valuesOfInsert(statement, values)
          columns.forEach((column, index) => {
            row[column] = slots[index]
          })
          const key = String(row[PRIMARY_KEYS[tableName]])
          table(tableName).set(key, row)
        }
        return { rowsAffected: 1, lastInsertId: 0 }
      }

      if (/^UPDATE/i.test(statement)) {
        // `UPDATE t SET a = ?, b = ? WHERE x = ? AND y = ?`
        const setPart = statement.match(/SET (.*?) WHERE/i)?.[1] ?? ''
        const columns = [...setPart.matchAll(/([a-z_]+)\s*=\s*\?/gi)].map((match) => match[1])
        const wherePart = statement.match(/WHERE (.*)$/i)?.[1] ?? ''
        const whereColumns = [...wherePart.matchAll(/([a-z_]+)\s*=\s*\?/gi)].map(
          (match) => match[1],
        )

        const setValues = values.slice(0, columns.length)
        const whereValues = values.slice(columns.length)

        const predicate = (row: Row) =>
          whereColumns.every((column, index) => String(row[column]) === String(whereValues[index]))

        let affected = 0
        for (const row of table(tableName).values()) {
          if (!predicate(row)) continue
          columns.forEach((column, index) => {
            row[column] = setValues[index]
          })
          affected += 1
        }
        return { rowsAffected: affected, lastInsertId: 0 }
      }

      if (/^DELETE/i.test(statement)) {
        const wherePart = statement.match(/WHERE (.*)$/i)?.[1]
        if (!wherePart) {
          const size = table(tableName).size
          table(tableName).clear()
          return { rowsAffected: size, lastInsertId: 0 }
        }

        const whereColumns = [...wherePart.matchAll(/([a-z_]+)\s*=\s*\?/gi)].map(
          (match) => match[1],
        )
        let affected = 0
        for (const [key, row] of table(tableName)) {
          if (whereColumns.every((column, index) => String(row[column]) === String(values[index]))) {
            table(tableName).delete(key)
            affected += 1
          }
        }
        return { rowsAffected: affected, lastInsertId: 0 }
      }

      throw new Error(`memory backend: unsupported statement: ${statement.slice(0, 80)}`)
    },

    async select<T>(sql: string, values: unknown[] = []): Promise<T> {
      const statement = normalize(sql)

      // Aggregate used for version numbering.
      if (/SELECT MAX\(version\)/i.test(statement)) {
        const [turnId, laneId] = values
        let max: number | null = null
        for (const row of table('replies').values()) {
          if (String(row.turn_id) !== String(turnId) || String(row.lane_id) !== String(laneId)) {
            continue
          }
          const version = Number(row.version)
          if (max === null || version > max) max = version
        }
        return [{ max_version: max }] as T
      }

      // The snippet queries join replies to turns to reach the conversation id.
      // Handled explicitly: the generic path below reads one table and would
      // return the wrong rows for a join.
      if (/SELECT conversation_id, text FROM turns/i.test(statement)) {
        const pattern = String(values[0] ?? '').replace(/%/g, '').toLowerCase()
        const rows = [...table('turns').values()]
          .filter((row) => String(row.text ?? '').toLowerCase().includes(pattern))
          .sort((a, b) => Number(b.created_at) - Number(a.created_at))
          .map((row) => ({ conversation_id: row.conversation_id, text: row.text }))
        return rows as T
      }

      if (/SELECT t\.conversation_id AS id/i.test(statement)) {
        const pattern = String(values[0] ?? '').replace(/%/g, '').toLowerCase()
        const turnById = table('turns')
        const rows = [...table('replies').values()]
          .filter((row) => String(row.text ?? '').toLowerCase().includes(pattern))
          .sort((a, b) => Number(b.created_at) - Number(a.created_at))
          .map((row) => ({
            id: turnById.get(String(row.turn_id))?.conversation_id,
            text: row.text,
          }))
          .filter((row) => row.id !== undefined)
        return rows as T
      }

      // A conversation's replies, reached through their turns.
      if (/SELECT r\.\* FROM replies r JOIN turns t/i.test(statement)) {
        const turnIds = new Set(
          [...table('turns').values()]
            .filter((turn) => String(turn.conversation_id) === String(values[0]))
            .map((turn) => String(turn.id)),
        )
        const rows = [...table('replies').values()]
          .filter((row) => turnIds.has(String(row.turn_id)))
          .sort((a, b) => Number(a.created_at) - Number(b.created_at))
        return rows.map((row) => ({ ...row })) as T
      }

      const tableName = tableOf(statement)
      const wherePart = statement.match(/WHERE (.*?)(?:ORDER BY|$)/i)?.[1] ?? ''
      const whereColumns = [...wherePart.matchAll(/([a-z_.]+)\s*=\s*\?/gi)].map((match) =>
        match[1].includes('.') ? match[1].split('.')[1] : match[1],
      )
      const likeColumns = [...wherePart.matchAll(/([a-z_.]+)\s+LIKE\s+\?/gi)].map((match) =>
        match[1].includes('.') ? match[1].split('.')[1] : match[1],
      )

      // The conversation-search statement joins turns and matches either the
      // title or a message body with LIKE; both are handled by scanning.
      const searchesByMessage = /LEFT JOIN turns/i.test(statement)
      const searchesByReply = /LEFT JOIN replies/i.test(statement)

      const eqValues = values.slice(0, whereColumns.length)
      const likeValues = values.slice(whereColumns.length)

      const matches = (row: Row): boolean => {
        if (!whereColumns.every((column, index) => String(row[column]) === String(eqValues[index]))) {
          return false
        }
        return likeColumns.every((column, index) => {
          const pattern = String(likeValues[index] ?? '').replace(/%/g, '')
          return String(row[column] ?? '').toLowerCase().includes(pattern.toLowerCase())
        })
      }

      let rows = [...table(tableName).values()]

      if (searchesByMessage && likeValues.length) {
        // Title, question or answer — the same three the SQL statement matches.
        const pattern = String(likeValues[0]).replace(/%/g, '').toLowerCase()
        const turnIds = new Map(
          [...table('turns').values()].map((turn) => [String(turn.id), String(turn.conversation_id)]),
        )

        rows = rows.filter((row) => {
          if (String(row.title ?? '').toLowerCase().includes(pattern)) return true
          const id = String(row.id)
          const asked = [...table('turns').values()].some(
            (turn) =>
              String(turn.conversation_id) === id &&
              String(turn.text ?? '').toLowerCase().includes(pattern),
          )
          if (asked) return true
          if (!searchesByReply) return false
          return [...table('replies').values()].some(
            (reply) =>
              turnIds.get(String(reply.turn_id)) === id &&
              String(reply.text ?? '').toLowerCase().includes(pattern),
          )
        })
      } else {
        rows = rows.filter(matches)
      }

      // ORDER BY: only the shapes the app issues are interpreted.
      if (/ORDER BY[^;]*updated_at DESC/i.test(statement)) {
        const pinnedFirst = /pinned DESC/i.test(statement)
        rows.sort((a, b) => {
          if (pinnedFirst && Number(a.pinned) !== Number(b.pinned)) {
            return Number(b.pinned) - Number(a.pinned)
          }
          return Number(b.updated_at) - Number(a.updated_at)
        })
      } else if (/ORDER BY created_at/i.test(statement)) {
        rows.sort((a, b) => Number(a.created_at) - Number(b.created_at))
      } else if (/ORDER BY position/i.test(statement)) {
        rows.sort((a, b) => Number(a.position) - Number(b.position))
      } else if (/ORDER BY r\.created_at/i.test(statement)) {
        rows.sort((a, b) => Number(a.created_at) - Number(b.created_at))
      }

      return rows.map((row) => ({ ...row })) as T
    },

    async close() {
      return true
    },
  }
}
