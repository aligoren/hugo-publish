// Edits to arrays of tables (menus, `related.indices`, `server.redirects`…) as a desired list of rows,
// turned into ops only when reviewing. Index paths refer to the file as it is on disk, so every
// edit of an existing row comes first, then removals from the end, then appended rows.
import type { ConfigOp, KeyPath } from '../../../lib/api'
import type { LoadedSource } from './sources'
import { isArrayOfTables } from './toml'
import { compact, deepEqual, subtreeOps, type Tree } from './values'

/**
 * `aot`: TOML `[[a.b]]` entries, edited in place by index.
 * `value`: an inline array or YAML sequence, written as a whole.
 * `append`: TOML key that does not exist yet; each row becomes a `[[a.b]]` entry.
 */
export type ListMode = 'aot' | 'value' | 'append'

export interface ListRow {
  /** Index of the entry on disk; null for a new row. */
  orig: number | null
  values: Tree
}

export interface ListDraft {
  file: string
  /** Path of the array inside the file. */
  path: KeyPath
  mode: ListMode
  /** Entries on disk; null when the key does not exist yet. */
  disk: Tree[] | null
  rows: ListRow[]
}

export function listMode(source: LoadedSource, filePath: KeyPath, exists: boolean): ListMode {
  const plainPath = filePath.length > 0 && filePath.every((k) => typeof k === 'string')
  if (source.format !== 'toml' || !plainPath) return 'value'
  if (!exists) return 'append'
  return source.text !== null && isArrayOfTables(source.text, filePath) ? 'aot' : 'value'
}

export function rowsOf(entries: readonly Tree[]): ListRow[] {
  return entries.map((values, orig) => ({ orig, values }))
}

export function listDraftKey(file: string, path: KeyPath): string {
  return `${file}\u0000${path.map(String).join('\u0001')}`
}

/** The ops that turn the list on disk into the draft's rows. */
export function listOps(draft: ListDraft): ConfigOp[] {
  const { path, disk, rows, mode } = draft
  if (mode === 'value') {
    const desired = rows.map((r) => r.values)
    if (disk !== null && deepEqual(disk, desired)) return []
    if (desired.length === 0) return disk === null ? [] : [{ op: 'remove', path }]
    return [{ op: 'set', path, value: desired.map(compact) }]
  }
  const ops: ConfigOp[] = []
  if (mode === 'aot' && disk !== null) {
    for (const row of rows) {
      if (row.orig === null) continue
      ops.push(...subtreeOps([...path, row.orig], disk[row.orig] ?? {}, row.values))
    }
    const kept = new Set(rows.map((r) => r.orig))
    for (let i = disk.length - 1; i >= 0; i--) {
      if (!kept.has(i)) ops.push({ op: 'remove', path: [...path, i] })
    }
  }
  const stringPath = path.map(String)
  for (const row of rows) {
    if (row.orig === null || mode === 'append') ops.push({ op: 'appendTable', path: stringPath, entries: compact(row.values) })
  }
  return ops
}

/** Ops of every draft, grouped by file. */
export function listOpsByFile(drafts: Iterable<ListDraft>): Record<string, ConfigOp[]> {
  const out: Record<string, ConfigOp[]> = {}
  for (const draft of drafts) {
    const ops = listOps(draft)
    if (ops.length > 0) out[draft.file] = [...(out[draft.file] ?? []), ...ops]
  }
  return out
}

/** Field ops first, list ops after them: list ops use indexes that field ops never touch. */
export function mergeOps(...groups: Record<string, ConfigOp[]>[]): Record<string, ConfigOp[]> {
  const out: Record<string, ConfigOp[]> = {}
  for (const group of groups) {
    for (const [file, ops] of Object.entries(group)) {
      if (ops.length > 0) out[file] = [...(out[file] ?? []), ...ops]
    }
  }
  return out
}
