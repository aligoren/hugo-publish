// Turning a field edit into config ops. The value rules come from the schema: booleans are never
// quoted, `x-writeFalse: omit` deletes instead of writing false, string-or-list keys stay a
// string when there is one item, and Reset removes the key so the theme default applies.
import type { ConfigOp, KeyPath } from '../../lib/api'
import { isRecord } from './discovery'
import type { ThemeField } from './merge'

export type FieldChange = { kind: 'set'; value: unknown } | { kind: 'remove' }

/** The change to record when the user sets `value` in a field. */
export function changeFor(field: Pick<ThemeField, 'type' | 'writeFalse' | 'stringOrList'>, value: unknown): FieldChange {
  if (value === undefined || value === null) return { kind: 'remove' }
  if (field.type === 'boolean' && value === false && field.writeFalse === 'omit') return { kind: 'remove' }
  if (typeof value === 'string' && value === '' && field.type !== 'boolean') return { kind: 'remove' }
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== '' && v !== null && v !== undefined)
    if (items.length === 0) return { kind: 'remove' }
    if (field.stringOrList && items.length === 1 && typeof items[0] === 'string') return { kind: 'set', value: items[0] }
    return { kind: 'set', value: items }
  }
  if (isRecord(value) && Object.keys(value).length === 0) return { kind: 'remove' }
  if ((field.type === 'integer' || field.type === 'number') && typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) && value.trim() !== '' ? { kind: 'set', value: n } : { kind: 'remove' }
  }
  return { kind: 'set', value }
}

/** Splits a TOML table header (`[[params."a b".c]]`) into keys. */
export function splitTomlKey(text: string): string[] {
  const out: string[] = []
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(?:\.|$)/y
  let m: RegExpExecArray | null
  re.lastIndex = 0
  while (re.lastIndex < text.length && (m = re.exec(text))) {
    out.push(m[1] ?? m[2] ?? m[3])
    if (m[0] === '') break
  }
  return out
}

/** Whether `path` is written as `[[…]]` array-of-tables in this TOML text. */
export function isArrayOfTables(text: string, path: string[]): boolean {
  const wanted = path.map((p) => p.toLowerCase()).join('\u0000')
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\[\[\s*([^\]]+?)\s*\]\]/.exec(line)
    if (m && splitTomlKey(m[1]).map((p) => p.toLowerCase()).join('\u0000') === wanted) return true
  }
  return false
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Ops that turn the array of tables at `path` from `before` into `after` entry by entry, so the
 * `[[…]]` style and comments around unchanged entries stay as they are.
 */
export function arrayOfTablesOps(path: string[], before: unknown[], after: Record<string, unknown>[]): ConfigOp[] {
  const ops: ConfigOp[] = []
  const common = Math.min(before.length, after.length)
  for (let i = 0; i < common; i++) {
    const b = isRecord(before[i]) ? (before[i] as Record<string, unknown>) : {}
    const a = after[i]
    const keys = [...Object.keys(b), ...Object.keys(a).filter((k) => !(k in b))]
    for (const key of keys) {
      if (key in a) {
        if (!same(b[key], a[key])) ops.push({ op: 'set', path: [...path, i, key], value: a[key] })
      } else {
        ops.push({ op: 'remove', path: [...path, i, key] })
      }
    }
  }
  for (let i = common; i < after.length; i++) ops.push({ op: 'appendTable', path, entries: after[i] })
  for (let i = before.length - 1; i >= after.length; i--) ops.push({ op: 'remove', path: [...path, i] })
  return ops
}

export interface FileState {
  path: string
  format: 'toml' | 'yaml' | 'json'
  text: string
  values: Record<string, unknown>
}

function valueAtPath(values: unknown, path: KeyPath): unknown {
  let current: unknown = values
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

/**
 * Prepares draft ops for the review: in TOML, replacing a whole `[[array.of.tables]]` value is
 * not possible in place, so it becomes per-entry edits.
 */
export function expandOps(file: FileState, ops: ConfigOp[]): ConfigOp[] {
  if (file.format !== 'toml') return ops
  const out: ConfigOp[] = []
  for (const op of ops) {
    if (op.op === 'set' && Array.isArray(op.value) && op.value.every(isRecord) && op.path.every((p) => typeof p === 'string')) {
      const path = op.path as string[]
      if (isArrayOfTables(file.text, path)) {
        const before = valueAtPath(file.values, path)
        out.push(...arrayOfTablesOps(path, Array.isArray(before) ? before : [], op.value as Record<string, unknown>[]))
        continue
      }
    }
    out.push(op)
  }
  return out
}
