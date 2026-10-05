// Front matter edits for the form. YAML is edited here with the format-preserving `setField` /
// `deleteField`; TOML goes through `toml_edit` on the Rust side (`api.tomlEditText`)
// (which keeps the style of replaced values); new date keys are written bare. JSON is read-only.

import { api, type ConfigOp } from '../../lib/api'
import {
  deleteField,
  ensureYamlFrontMatter,
  FrontMatterReadOnlyError,
  setField,
  type FrontMatterParts,
  type FrontMatterValue,
} from '../../lib/frontmatter'
import { bareNewTomlDates } from './tomlText'

export type FieldPath = readonly (string | number)[]

export type FrontMatterOp =
  | {
      op: 'set'
      path: FieldPath
      value: FrontMatterValue
      /** TOML: write a new key as a bare date-time (`date = 2026-10-03T00:11:40+03:00`). */
      datetime?: boolean
    }
  | { op: 'remove'; path: FieldPath }

/** Whether the form can change this front matter. */
export function canEditFrontMatter(parts: FrontMatterParts): boolean {
  return parts.format === 'yaml' || parts.format === 'toml' || parts.format === null
}

/** Applies ops to YAML front matter (a file without front matter gets a YAML block). */
export function applyYamlOps(parts: FrontMatterParts, ops: readonly FrontMatterOp[]): FrontMatterParts {
  let next = ensureYamlFrontMatter(parts)
  for (const op of ops) {
    next = op.op === 'set' ? setField(next, op.path, op.value) : deleteField(next, op.path)
  }
  return next
}

export interface TomlTextApi {
  tomlEditText(text: string, ops: ConfigOp[]): Promise<string>
}

/** Applies ops to TOML front matter text through `toml_edit`. */
export async function applyTomlOps(
  text: string,
  ops: readonly FrontMatterOp[],
  toml: TomlTextApi = api,
): Promise<string> {
  const configOps: ConfigOp[] = ops.map((op) => {
    if (op.op === 'remove') return { op: 'remove', path: [...op.path] }
    if (op.value === null) throw new Error('TOML has no null value')
    return { op: 'set', path: [...op.path], value: op.value }
  })
  if (configOps.length === 0) return text
  const edited = await toml.tomlEditText(text, configOps)
  const hints = ops.flatMap((op) => (op.op === 'set' ? [{ path: op.path, value: op.value, datetime: op.datetime }] : []))
  return bareNewTomlDates(text, edited, hints)
}

/** Applies ops to any editable front matter. */
export async function applyFrontMatterOps(
  parts: FrontMatterParts,
  ops: readonly FrontMatterOp[],
  toml: TomlTextApi = api,
): Promise<FrontMatterParts> {
  if (parts.format === 'toml') {
    const text = await applyTomlOps(parts.frontMatterText, ops, toml)
    return text === parts.frontMatterText ? parts : { ...parts, frontMatterText: text }
  }
  if (parts.format === 'json') throw new FrontMatterReadOnlyError('json')
  return applyYamlOps(parts, ops)
}

/**
 * Merges ops that follow each other: only the last `set` / `remove` of a path matters
 * (typing in a field produces one op per keystroke).
 */
export function coalesceOps(ops: readonly FrontMatterOp[]): FrontMatterOp[] {
  const out: FrontMatterOp[] = []
  for (const op of ops) {
    const key = JSON.stringify(op.path)
    const last = out.length - 1
    if (last >= 0 && JSON.stringify(out[last].path) === key) out[last] = op
    else out.push(op)
  }
  return out
}

// --- Plain values -------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Value at `path` in parsed front matter. */
export function getIn(values: unknown, path: FieldPath): unknown {
  let current = values
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key]
    else if (isRecord(current)) current = current[String(key)]
    else return undefined
  }
  return current
}

function setInValue(target: unknown, path: FieldPath, value: unknown): unknown {
  if (path.length === 0) return value
  const [key, ...rest] = path
  if (Array.isArray(target) && typeof key === 'number') {
    const copy = [...target]
    copy[key] = setInValue(copy[key], rest, value)
    return copy
  }
  const record = isRecord(target) ? { ...target } : {}
  record[String(key)] = setInValue(record[String(key)], rest, value)
  return record
}

function removeInValue(target: unknown, path: FieldPath): unknown {
  if (path.length === 0) return target
  const [key, ...rest] = path
  if (Array.isArray(target) && typeof key === 'number') {
    const copy = [...target]
    if (rest.length === 0) copy.splice(key, 1)
    else copy[key] = removeInValue(copy[key], rest)
    return copy
  }
  if (!isRecord(target)) return target
  const record = { ...target }
  if (rest.length === 0) delete record[String(key)]
  else if (String(key) in record) record[String(key)] = removeInValue(record[String(key)], rest)
  return record
}

/** What the parsed values look like after `ops` (shown right away while TOML is edited). */
export function applyOpsToValues(values: Record<string, unknown>, ops: readonly FrontMatterOp[]): Record<string, unknown> {
  let next: unknown = values
  for (const op of ops) next = op.op === 'set' ? setInValue(next, op.path, op.value) : removeInValue(next, op.path)
  return isRecord(next) ? next : {}
}

/** The key as written in the front matter, matched without regard to case (Hugo ignores it). */
export function findKey(values: Record<string, unknown> | null, name: string): string | undefined {
  if (!values) return undefined
  if (name in values) return name
  const lower = name.toLowerCase()
  return Object.keys(values).find((key) => key.toLowerCase() === lower)
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && deepEqual(a[k], b[k]))
  }
  return false
}

export { isRecord }
