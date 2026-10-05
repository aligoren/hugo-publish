// Plain-data helpers for config values: equality, case-insensitive lookup, applying ops.
import type { ConfigOp, KeyPath } from '../../../lib/api'

export type Tree = Record<string, unknown>

export function isPlainObject(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

/**
 * Equality for comparing what Hugo prints with a documented default: Hugo lower-cases keys,
 * some enum values (`AP`), strips `#` from colors and prints unset strings as `""`/null.
 */
export function looseEqual(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true
  if (typeof a === 'string' && typeof b === 'string') return norm(a) === norm(b)
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => looseEqual(v, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const la = lowerKeys(a)
    const lb = lowerKeys(b)
    const keys = new Set([...Object.keys(la), ...Object.keys(lb)])
    return [...keys].every((k) => looseEqual(la[k], lb[k]))
  }
  return a === b
}

/** Unset, or set to nothing: what `hugo config --printZero` prints for keys nobody configured. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return isPlainObject(value) && Object.keys(value).length === 0
}

function norm(s: string): string {
  return s.toLowerCase().replace(/^#/, '')
}

function lowerKeys(tree: Tree): Tree {
  return Object.fromEntries(Object.entries(tree).map(([k, v]) => [k.toLowerCase(), v]))
}

/** Hugo reads `menu` as `menus`. */
const KEY_ALIASES: Record<string, string> = { menus: 'menu' }

/** The key of `tree` that Hugo would read for `key`: exact, then any casing, then an alias. */
export function findKey(tree: unknown, key: string): string | undefined {
  if (!isPlainObject(tree)) return undefined
  if (Object.prototype.hasOwnProperty.call(tree, key)) return key
  const lower = key.toLowerCase()
  const match = Object.keys(tree).find((k) => k.toLowerCase() === lower)
  if (match !== undefined) return match
  const alias = KEY_ALIASES[lower]
  return alias ? Object.keys(tree).find((k) => k.toLowerCase() === alias) : undefined
}

export interface Found {
  value: unknown
  /** The path with the key casing used in the tree. */
  actual: KeyPath
}

/** Looks a path up the way Hugo does: keys in any casing, array indexes as numbers. */
export function lookup(tree: unknown, path: KeyPath): Found | null {
  let current: unknown = tree
  const actual: KeyPath = []
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) return null
      current = current[segment]
      actual.push(segment)
    } else {
      const found = findKey(current, segment)
      if (found === undefined) return null
      current = (current as Tree)[found]
      actual.push(found)
    }
  }
  return { value: current, actual }
}

/** The path to write `path` at: existing keys keep the tree's casing, new keys the given one. */
export function writePath(tree: unknown, path: KeyPath): KeyPath {
  const out: KeyPath = []
  let current: unknown = tree
  for (const segment of path) {
    if (typeof segment === 'number') {
      out.push(segment)
      current = Array.isArray(current) ? current[segment] : undefined
      continue
    }
    const found = findKey(current, segment)
    out.push(found ?? segment)
    current = found === undefined ? undefined : (current as Tree)[found]
  }
  return out
}

export function startsWith(path: KeyPath, prefix: KeyPath): boolean {
  return prefix.length <= path.length && prefix.every((k, i) => sameKey(k, path[i]))
}

export function sameKey(a: string | number, b: string | number): boolean {
  return typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

/** What the file values become after `ops`, mirroring the Rust and YAML editors. */
export function applyOps(values: Tree, ops: readonly ConfigOp[]): Tree {
  const root = clone(values)
  for (const op of ops) {
    if (op.op === 'appendTable') {
      const parent = ensureContainer(root, op.path.slice(0, -1))
      const last = op.path[op.path.length - 1]
      if (!parent) continue
      const list = Array.isArray(parent[last]) ? (parent[last] as unknown[]) : []
      parent[last] = [...list, clone(op.entries)]
      continue
    }
    if (op.path.length === 0) continue
    const last = op.path[op.path.length - 1]
    if (op.op === 'set') {
      const parent = ensureContainer(root, op.path.slice(0, -1))
      if (parent && typeof last === 'string') parent[last] = clone(op.value)
      continue
    }
    const parentFound = lookupExact(root, op.path.slice(0, -1))
    if (typeof last === 'number') {
      if (Array.isArray(parentFound)) parentFound.splice(last, 1)
    } else if (isPlainObject(parentFound)) {
      delete parentFound[last]
    }
  }
  return root
}

function lookupExact(tree: unknown, path: KeyPath): unknown {
  let current: unknown = tree
  for (const k of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[k]
  }
  return current
}

function ensureContainer(root: Tree, path: KeyPath): Tree | null {
  let current: unknown = root
  for (const k of path) {
    if (typeof k === 'number') {
      if (!Array.isArray(current)) return null
      current = current[k]
      continue
    }
    if (!isPlainObject(current)) return null
    if (!isPlainObject(current[k]) && !Array.isArray(current[k])) current[k] = {}
    current = current[k]
  }
  return isPlainObject(current) ? current : null
}

/**
 * The smallest ops that turn `before` into `after` at `base`: maps are compared key by key
 * (so `[outputFormats.llms]` gets one line per changed field), everything else is set whole.
 * `undefined` means "absent".
 */
export function subtreeOps(base: KeyPath, before: unknown, after: unknown): ConfigOp[] {
  if (deepEqual(before, after)) return []
  if (after === undefined) return before === undefined ? [] : [{ op: 'remove', path: base }]
  if (isPlainObject(after) && (before === undefined || isPlainObject(before))) {
    const old = before ?? {}
    const keys = Object.keys(after)
    if (keys.length === 0 && before === undefined) return [{ op: 'set', path: base, value: {} }]
    const ops: ConfigOp[] = []
    for (const k of Object.keys(old)) {
      if (!keys.some((n) => n === k)) ops.push({ op: 'remove', path: [...base, k] })
    }
    for (const k of keys) ops.push(...subtreeOps([...base, k], old[k], after[k]))
    return ops
  }
  return [{ op: 'set', path: base, value: after }]
}

/** Drops empty strings, empty lists and nulls, which mean "not set" in a form row. */
export function compact(row: Tree): Tree {
  return Object.fromEntries(
    Object.entries(row).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)),
  )
}

/** A short, readable rendering of a value for badges and summaries. */
export function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') return value === '' ? '""' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) {
    return value.length === 0 ? '[]' : value.map((v) => String(v)).join(', ')
  }
  return JSON.stringify(value)
}
