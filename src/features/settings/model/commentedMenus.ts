// Menu entries kept as comments in a config file, the way themes ship examples. TOML:
//   # [[menus.main]]
//   #   name = "Tags"
//   #   url = "/tags/"
// YAML (an entry of an existing menu, or a whole menu under `menus:` / in menus.yaml):
//   #   - name: Tags
//   #     url: /tags/
//   # footer:
//   #   - name: About
// Enabling one removes the comment markers from exactly those lines and nothing else.
import { parseDocument } from 'yaml'

import type { KeyPath } from '../../../lib/api'
import { menuOfPath } from './menus'
import { toGlobalPath, type LoadedSource } from './sources'
import { splitDottedKey } from './toml'
import { deepEqual, isPlainObject, type Tree } from './values'

/** `hashSpace`: `#` and one space or tab after it; `hash`: only the `#` (YAML, where indentation matters). */
export type CommentStrip = 'hashSpace' | 'hash'

export interface CommentedMenuEntry {
  file: string
  lang: string | null
  menu: string
  /** First line of the block (0-based) and the line after its end. */
  start: number
  end: number
  /** The commented lines as written. */
  lines: string[]
  /** Values of the (first) entry in the block. */
  values: Tree
  /** Entries in the block: a whole commented-out YAML menu can hold several. */
  count: number
  /** How the comment markers come off (YAML picks the one that gives valid YAML). */
  strip: CommentStrip
  /**
   * False when the block cannot be enabled where it is: in TOML, plain keys follow it and would
   * join the entry; in YAML, the uncommented lines would not read as menu entries there.
   */
  safe: boolean
}

const HEADER = /^\s*#\s*\[\[\s*([^\]]+?)\s*\]\]\s*(?:#.*)?$/
const KEY_VALUE = /^\s*#\s*([A-Za-z0-9_-]+|"[^"]*"|'[^']*')\s*=\s*(.+?)\s*$/
const REAL_HEADER = /^\s*\[/

/** Lines with their line breaks, so a joined result has the same bytes. */
export function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function content(line: string): string {
  return line.replace(/\r?\n$/, '')
}

function parseValue(raw: string): unknown {
  const text = raw.replace(/\s+#.*$/, '').trim()
  if (/^"(?:\\.|[^"\\])*"$/.test(text)) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  if (/^'[^']*'$/.test(text)) return text.slice(1, -1)
  if (text === 'true' || text === 'false') return text === 'true'
  if (/^[+-]?\d+(\.\d+)?$/.test(text)) return Number(text)
  return text
}

function unquote(key: string): string {
  return /^["'].*["']$/.test(key) ? key.slice(1, -1) : key
}

/** Commented-out menu entries of a TOML or YAML config file. */
export function findCommentedMenus(source: LoadedSource): CommentedMenuEntry[] {
  if (!source.text) return []
  if (source.format === 'toml') return findToml(source, source.text)
  if (source.format === 'yaml') return findYaml(source, source.text)
  return []
}

/** Commented-out `[[menus.<name>]]` blocks of a TOML file. */
function findToml(source: LoadedSource, text: string): CommentedMenuEntry[] {
  const lines = linesOf(text)
  const out: CommentedMenuEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    const header = HEADER.exec(content(lines[i]))
    if (!header) continue
    const keys: KeyPath = splitDottedKey(header[1])
    const menu = menuOfPath(toGlobalPath(source, keys))
    if (!menu) continue
    const values: Tree = {}
    let end = i + 1
    for (; end < lines.length; end++) {
      const kv = KEY_VALUE.exec(content(lines[end]))
      if (!kv || HEADER.test(content(lines[end]))) break
      values[unquote(kv[1])] = parseValue(kv[2])
    }
    if (end === i + 1) continue
    // What follows (blank lines and other comments skipped) must start a new table, or end the file.
    let next = end
    while (next < lines.length && /^\s*(#.*)?$/.test(content(lines[next]))) next++
    const safe = next >= lines.length || REAL_HEADER.test(content(lines[next]))
    out.push({ file: source.path, lang: menu.lang, menu: menu.name, start: i, end, lines: lines.slice(i, end).map(content), values, count: 1, strip: 'hashSpace', safe })
    i = end - 1
  }
  return out
}

// ---- YAML -------------------------------------------------------------------------------------

function uncomment(line: string, strip: CommentStrip): string {
  return strip === 'hash' ? line.replace(/^(\s*)#/, '$1') : line.replace(/^(\s*)#[ \t]?/, '$1')
}

const isCommentLine = (line: string) => /^\s*#/.test(line)
const isBlank = (line: string) => content(line).trim() === ''
const indentOf = (line: string) => /^ */.exec(line)![0].length
const ITEM = /^ *-(\s|$)/
/** `key:` with no value on the line (a map or a list follows). */
const OPEN_KEY = /^ *("[^"]*"|'[^']*'|[^\s#'"\-?:][^:#]*?)\s*:\s*(#.*)?$/

interface Candidate {
  start: number
  end: number
  kind: 'item' | 'header'
}

/** The commented block starting at `i` once its markers come off: one list item, or `key:` and its children. */
function yamlCandidate(lines: readonly string[], i: number, strip: CommentStrip): Candidate | null {
  const first = content(uncomment(lines[i], strip))
  const n = indentOf(first)
  const kind = ITEM.test(first) ? 'item' : OPEN_KEY.test(first) ? 'header' : null
  if (!kind) return null
  // Lines commented out together have their `#` in the same column.
  const column = lines[i].indexOf('#')
  let end = i + 1
  for (; end < lines.length; end++) {
    if (!isCommentLine(lines[end]) || lines[end].indexOf('#') !== column) break
    const line = content(uncomment(lines[end], strip))
    if (line.trim() === '') break
    const m = indentOf(line)
    if (m > n || (kind === 'header' && m === n && ITEM.test(line))) continue
    break
  }
  if (kind === 'header' && end === i + 1) return null
  return { start: i, end, kind }
}

function parseYaml(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const doc = parseDocument(text.replace(/^\uFEFF/, ''))
    if (doc.errors.length > 0) return { ok: false }
    return { ok: true, value: doc.toJS() }
  } catch {
    return { ok: false }
  }
}

interface Addition {
  path: KeyPath
  added: unknown[]
}

/**
 * The single place where `after` adds list items to `before` (or a whole new list), with
 * everything else equal; null when nothing changed, `other` for any other difference.
 */
export function additionOf(before: unknown, after: unknown, path: KeyPath = []): Addition | null | 'other' {
  if (deepEqual(before, after)) return null
  if (before === undefined || before === null) {
    if (Array.isArray(after)) return { path, added: after }
    if (!isPlainObject(after)) return 'other'
    before = {}
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    let found: Addition | null = null
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in after)) return 'other'
      const inner = additionOf(before[key], after[key], [...path, key])
      if (inner === 'other') return 'other'
      if (inner) {
        if (found) return 'other'
        found = inner
      }
    }
    return found
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const extra = after.length - before.length
    if (extra <= 0) return 'other'
    for (let at = 0; at <= before.length; at++) {
      if (deepEqual(before.slice(0, at), after.slice(0, at)) && deepEqual(before.slice(at), after.slice(at + extra))) {
        return { path, added: after.slice(at, at + extra) }
      }
    }
  }
  return 'other'
}

/** The key of a real `key:` line, unquoted. */
function keyOfLine(line: string): string | null {
  const m = /^ *("[^"]*"|'[^']*'|[^\s#'"\-?:][^:#]*?)\s*:(\s|$)/.exec(content(line))
  return m ? unquote(m[1].trim()) : null
}

/** Keys of the real (not commented) lines that hold a line at `indent` before line `i`; null inside a list. */
function parentKeys(lines: readonly string[], i: number, indent: number): string[] | null {
  const path: string[] = []
  let limit = indent
  for (let j = i - 1; j >= 0 && limit > 0; j--) {
    const line = lines[j]
    if (isBlank(line) || isCommentLine(line)) continue
    const m = indentOf(content(line))
    if (m >= limit) continue
    if (ITEM.test(content(line))) return null
    const key = keyOfLine(line)
    if (key === null) return null
    path.unshift(key)
    limit = m
  }
  return path
}

/** Where a commented block would sit, from the indentation of the real lines above it. */
function structuralPath(lines: readonly string[], c: Candidate, strip: CommentStrip): KeyPath | null {
  const first = content(uncomment(lines[c.start], strip))
  const n = indentOf(first)
  if (c.kind === 'header') {
    const parents = parentKeys(lines, c.start, n)
    const key = keyOfLine(first)
    return parents && key !== null ? [...parents, key] : null
  }
  // A list item belongs to the nearest `key:` above it, at a smaller or (for `key:\n- a`) the same indentation.
  for (let j = c.start - 1; j >= 0; j--) {
    const line = lines[j]
    if (isBlank(line) || isCommentLine(line)) continue
    const m = indentOf(content(line))
    if (m === n && ITEM.test(content(line))) continue
    if (m > n) continue
    if (!OPEN_KEY.test(content(line))) return null
    const parents = parentKeys(lines, j, m)
    const key = keyOfLine(line)
    return parents && key !== null ? [...parents, key] : null
  }
  return null
}

/** Values of the first entry, read from the block alone (for blocks that cannot be enabled). */
function blockValues(lines: readonly string[], c: Candidate, strip: CommentStrip): Tree {
  const uncommented = lines.slice(c.start, c.end).map((l) => uncomment(l, strip))
  const width = Math.min(...uncommented.filter((l) => !isBlank(l)).map((l) => indentOf(content(l))))
  const parsed = parseYaml(uncommented.map((l) => l.slice(Math.min(width, indentOf(l)))).join(''))
  if (!parsed.ok) return {}
  const value = c.kind === 'header' && isPlainObject(parsed.value) ? Object.values(parsed.value)[0] : parsed.value
  const first: unknown = Array.isArray(value) ? value[0] : undefined
  return isPlainObject(first) ? first : {}
}

function findYaml(source: LoadedSource, text: string): CommentedMenuEntry[] {
  const original = parseYaml(text)
  if (!original.ok) return []
  const lines = linesOf(text)
  const out: CommentedMenuEntry[] = []
  const entry = (c: Candidate, strip: CommentStrip, menu: { lang: string | null; name: string }, values: Tree, count: number, safe: boolean): CommentedMenuEntry => ({
    file: source.path,
    lang: menu.lang,
    menu: menu.name,
    start: c.start,
    end: c.end,
    lines: lines.slice(c.start, c.end).map(content),
    values,
    count,
    strip,
    safe,
  })
  for (let i = 0; i < lines.length; i++) {
    if (!isCommentLine(lines[i])) continue
    let chosen: CommentedMenuEntry | null = null
    let unsafe: CommentedMenuEntry | null = null
    for (const strip of ['hashSpace', 'hash'] as const) {
      const c = yamlCandidate(lines, i, strip)
      if (!c) continue
      // Enabled in place, the file must read the same with only menu entries added.
      const next = lines.map((line, k) => (k >= c.start && k < c.end ? uncomment(line, strip) : line)).join('')
      const parsed = parseYaml(next)
      const added = parsed.ok ? additionOf(original.value, parsed.value) : 'other'
      if (added && added !== 'other' && added.added.length > 0 && added.added.every(isPlainObject)) {
        const menu = menuOfPath(toGlobalPath(source, added.path))
        if (menu) {
          chosen = entry(c, strip, menu, added.added[0] as Tree, added.added.length, true)
          break
        }
      }
      if (!unsafe) {
        const path = structuralPath(lines, c, strip)
        const menu = path ? menuOfPath(toGlobalPath(source, path)) : null
        if (menu) unsafe = entry(c, strip, menu, blockValues(lines, c, strip), 1, false)
      }
    }
    const found = chosen ?? unsafe
    if (found) {
      out.push(found)
      i = found.end - 1
    }
  }
  return out
}

/** Removes the comment marker from the block's lines (`#` and one space, or only `#`, per `strip`). */
export function enableCommentedMenu(text: string, entry: Pick<CommentedMenuEntry, 'start' | 'end' | 'lines'> & { strip?: CommentStrip }): string {
  const lines = linesOf(text)
  const current = lines.slice(entry.start, entry.end).map(content)
  if (current.length !== entry.lines.length || current.some((l, i) => l !== entry.lines[i])) {
    throw new Error('The file changed since it was read.')
  }
  for (let i = entry.start; i < entry.end; i++) lines[i] = uncomment(lines[i], entry.strip ?? 'hashSpace')
  return lines.join('')
}
