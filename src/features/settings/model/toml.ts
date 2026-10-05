// Small TOML helpers that do not need the Rust editor: spotting `[[array.of.tables]]` headers in a
// file, and writing the text of a brand-new file (existing files are only changed through ops).
import type { KeyPath } from '../../../lib/api'
import { isPlainObject, sameKey, type Tree } from './values'

/** Key paths of every `[[...]]` header in a TOML text. */
export function arrayOfTablesHeaders(text: string): string[][] {
  const headers: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*\[\[(.+)\]\]\s*(#.*)?$/.exec(line)
    if (match) headers.push(splitDottedKey(match[1]))
  }
  return headers
}

/** Splits `a."b.c".'d'` into its keys. */
export function splitDottedKey(raw: string): string[] {
  const keys: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < raw.length) {
        current += raw[++i]
      } else if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '.') {
      keys.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  keys.push(current.trim())
  return keys
}

/** Whether `path` is written as an array of tables (`[[menu.main]]`) in this TOML text. */
export function isArrayOfTables(text: string, path: KeyPath): boolean {
  if (path.some((k) => typeof k === 'number')) return false
  return arrayOfTablesHeaders(text).some((h) => h.length === path.length && h.every((k, i) => sameKey(k, path[i])))
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/

function tomlKey(key: string): string {
  return BARE_KEY.test(key) ? key : JSON.stringify(key)
}

function tomlString(value: string): string {
  // Literal strings need no escaping as long as they hold no quote or control character.
  // oxlint-disable-next-line no-control-regex
  if (!value.includes("'") && !/[\u0000-\u001f\u007f]/.test(value)) return `'${value}'`
  return JSON.stringify(value)
}

export function tomlValue(value: unknown): string {
  if (typeof value === 'string') return tomlString(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0'
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null)
    return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`).join(', ')} }`
  }
  return "''"
}

function isTableArray(value: unknown): value is Tree[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPlainObject)
}

/**
 * TOML text for a new file: plain values first, then `[tables]` and `[[arrays of tables]]`.
 * `header` lines become `#` comments at the top.
 */
export function tomlDocument(values: Tree, header: readonly string[] = [], eol = '\n'): string {
  const out: string[] = header.map((line) => (line ? `# ${line}` : '#'))
  writeTable(out, [], values, false)
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.length === 0 ? '' : out.join(eol) + eol
}

function writeTable(out: string[], path: string[], table: Tree, isArrayEntry: boolean) {
  const entries = Object.entries(table).filter(([, v]) => v !== undefined && v !== null)
  const plain = entries.filter(([, v]) => !isPlainObject(v) && !isTableArray(v))
  const nested = entries.filter(([, v]) => isPlainObject(v) || isTableArray(v))
  if (path.length > 0 && (plain.length > 0 || nested.length === 0 || isArrayEntry)) {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('')
    const name = path.map(tomlKey).join('.')
    out.push(isArrayEntry ? `[[${name}]]` : `[${name}]`)
  }
  for (const [k, v] of plain) out.push(`${tomlKey(k)} = ${tomlValue(v)}`)
  for (const [k, v] of nested) {
    if (isTableArray(v)) {
      for (const entry of v) writeTable(out, [...path, k], entry, true)
    } else {
      writeTable(out, [...path, k], v as Tree, false)
    }
  }
}
