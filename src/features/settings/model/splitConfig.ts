// Splitting a single hugo.toml / hugo.yaml / hugo.json into config/_default/: one file per
// top-level table (params.toml, menus.toml, markup.toml…) and the rest in config/_default/hugo.toml.
// Text blocks are moved, not re-serialized, so comments, quoting and order survive; only the table
// headers lose their first key (`[params.author]` → `[author]` in params.toml). JSON members are
// moved as written too, one indentation level to the left.
import type { ConfigFormat } from '../../config-edit'
import { categoryKey } from './sources'
import { deepEqual, isPlainObject, type Tree } from './values'

export interface SplitFile {
  path: string
  /** Documented category key (`params`, `menus`, `outputFormats`). */
  category: string
  text: string
}

export interface SplitPlan {
  format: ConfigFormat
  /** The project root file being split. */
  rootPath: string
  files: SplitFile[]
  /** What stays: root keys and tables Hugo does not read from category files. */
  remainder: string
  /** Where the remainder goes. */
  movedTo: string
}

interface Segment {
  /** Documented category, or null for root content. */
  category: string | null
  lines: string[]
  /** Starts with the bare category header (`[params]`), so its keys become the file's root keys. */
  bare: boolean
  /** Starts with a commented-out header; folds back into the previous segment if real keys follow. */
  commented: boolean
}

const BOM = '﻿'

function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function body(line: string): string {
  return line.replace(/\r?\n$/, '')
}

function isBlank(line: string): boolean {
  return body(line).trim() === ''
}

function isComment(line: string): boolean {
  return /^\s*#/.test(line)
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** Splits `a."b.c".d` into its raw pieces, quotes kept. */
function rawKeys(raw: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of raw) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === '.') {
      out.push(current.trim())
      current = ''
    } else current += ch
  }
  out.push(current.trim())
  return out
}

function plainKey(raw: string): string {
  return /^["'].*["']$/.test(raw) ? raw.slice(1, -1) : raw
}

const TOML_HEADER = /^(\s*)(\[\[?)\s*([^\]]+?)\s*(\]\]?)(\s*(?:#.*)?)$/
const TOML_COMMENTED_HEADER = /^(\s*#\s*)(\[\[?)\s*([^\]]+?)\s*(\]\]?)(\s*)$/

/** Bracket balance of a TOML value line outside strings and comments (multi-line arrays). */
function bracketBalance(line: string): number {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\' && quote === '"') i++
      else if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '#') break
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') depth--
  }
  return depth
}

/** Comment lines right above the end of `lines` (not at the very start of the file). */
function trailingComments(lines: string[], isFileStart: boolean, topLevelOnly = false): number {
  let n = 0
  const pullable = (line: string) => isComment(line) && !TOML_COMMENTED_HEADER.test(body(line)) && (!topLevelOnly || line.startsWith('#'))
  while (n < lines.length && pullable(lines[lines.length - 1 - n])) n++
  // A comment block that opens the file describes the whole file.
  if (isFileStart && n === lines.length) return 0
  return n
}

function segmentsOfToml(lines: string[]): Segment[] {
  const segments: Segment[] = [{ category: null, lines: [], bare: false, commented: false }]
  let depth = 0
  let multiline: string | null = null
  const start = (category: string | null, bare: boolean, commented: boolean) => {
    const prev = segments[segments.length - 1]
    // The body of a commented-out block is all comments; it stays with its header.
    const n = prev.commented ? 0 : trailingComments(prev.lines, segments.length === 1)
    const pulled = n > 0 ? prev.lines.splice(prev.lines.length - n, n) : []
    segments.push({ category, lines: pulled, bare, commented })
  }
  for (const line of lines) {
    const text = body(line)
    if (multiline) {
      if ((text.split(multiline).length - 1) % 2 === 1) multiline = null
      segments[segments.length - 1].lines.push(line)
      continue
    }
    const header = depth === 0 ? TOML_HEADER.exec(text) : null
    const commented = depth === 0 && !header ? TOML_COMMENTED_HEADER.exec(text) : null
    if (header && header[2].length === header[4].length) {
      const keys = rawKeys(header[3])
      const category = categoryKey(plainKey(keys[0]))
      start(category, keys.length === 1 && header[2] === '[', false)
    } else if (commented && commented[2].length === commented[4].length) {
      start(categoryKey(plainKey(rawKeys(commented[3])[0])), false, true)
    } else if (!isBlank(line) && !isComment(line)) {
      const current = segments[segments.length - 1]
      if (current.commented && segments.length > 1) {
        // Real keys after a commented header still belong to the table above it.
        segments.pop()
        segments[segments.length - 1].lines.push(...current.lines)
      }
      for (const quote of ['"""', "'''"]) if ((text.split(quote).length - 1) % 2 === 1) multiline = quote
      if (!multiline) depth = Math.max(0, depth + bracketBalance(text))
    }
    segments[segments.length - 1].lines.push(line)
  }
  return segments
}

/** A header of `category` without its first key; null for the bare header, which is dropped. */
function stripTomlHeader(line: string, category: string): string | null {
  const eol = line.slice(body(line).length)
  const text = body(line)
  const real = TOML_HEADER.exec(text)
  const commented = real ? null : TOML_COMMENTED_HEADER.exec(text)
  const m = real ?? commented
  if (!m || m[2].length !== m[4].length) return line
  const keys = rawKeys(m[3])
  if (categoryKey(plainKey(keys[0])) !== category) return line
  if (keys.length === 1) return real ? null : line
  return `${m[1]}${m[2]}${keys.slice(1).join('.')}${m[4]}${m[5]}${eol}`
}

function trimBlankEdges(lines: string[]): string[] {
  let a = 0
  let b = lines.length
  while (a < b && isBlank(lines[a])) a++
  while (b > a && isBlank(lines[b - 1])) b--
  return lines.slice(a, b)
}

function joinBlocks(blocks: string[][], eol: string): string {
  const parts = blocks.map(trimBlankEdges).filter((b) => b.length > 0)
  if (parts.length === 0) return ''
  return parts.map((b) => b.map((l) => (/\n$/.test(l) ? l : l + eol)).join('')).join(eol)
}

// ---- YAML -----------------------------------------------------------------------------------

const YAML_KEY = /^("[^"]*"|'[^']*'|[^\s#'"\-?:][^:#]*?)\s*:(?:\s+(.*))?$/

function indentOf(line: string): number {
  return /^ */.exec(line)![0].length
}

function segmentsOfYaml(lines: string[]): (Segment & { inline: boolean })[] {
  const segments: (Segment & { inline: boolean })[] = [{ category: null, lines: [], bare: false, commented: false, inline: false }]
  for (const line of lines) {
    const text = body(line)
    const key = /^\S/.test(text) && !isComment(line) && !text.startsWith('-') ? YAML_KEY.exec(text) : null
    if (key) {
      const prev = segments[segments.length - 1]
      const n = trailingComments(prev.lines, segments.length === 1, true)
      const pulled = n > 0 ? prev.lines.splice(prev.lines.length - n, n) : []
      const rest = (key[2] ?? '').replace(/\s+#.*$/, '').trim()
      segments.push({ category: categoryKey(plainKey(key[1])), lines: pulled, bare: true, commented: false, inline: rest !== '' })
    }
    segments[segments.length - 1].lines.push(line)
  }
  return segments
}

/** The children of a top-level YAML key, moved left by their indentation; null when that is not possible. */
function dedentYaml(segment: Segment): string[] | null {
  const keyAt = segment.lines.findIndex((l) => !isBlank(l) && !isComment(l))
  const lead = segment.lines.slice(0, keyAt)
  const children = segment.lines.slice(keyAt + 1)
  const first = children.find((l) => !isBlank(l) && !isComment(l))
  if (!first) return null
  const width = indentOf(first)
  if (width === 0) return null
  const out: string[] = [...lead]
  for (const line of children) {
    if (isBlank(line)) out.push(line)
    else if (indentOf(line) >= width) out.push(line.slice(width))
    else if (isComment(line)) out.push(line.trimStart())
    else return null
  }
  return out
}

// ---- Plan -----------------------------------------------------------------------------------

function fileName(category: string, ext: string): string {
  return `config/_default/${category.toLowerCase()}.${ext}`
}

/** How a single root config file would be split; null when there is nothing to move. */
export function planSplit(rootPath: string, text: string, format: ConfigFormat): SplitPlan | null {
  if (format === 'json') return planJsonSplit(rootPath, text)
  const bom = text.startsWith(BOM)
  const source = bom ? text.slice(1) : text
  const eol = eolOf(source)
  const ext = rootPath.slice(rootPath.lastIndexOf('.') + 1)
  const lines = linesOf(source)
  const byCategory = new Map<string, string[][]>()
  const kept: string[][] = []

  if (format === 'toml') {
    const segments = segmentsOfToml(lines)
    // AoT directly under a category (`[[params]]`) cannot become a category file.
    const blocked = new Set(segments.filter((s) => s.category && s.lines.some((l) => new RegExp(`^\\s*\\[\\[\\s*${s.category}\\s*\\]\\]`, 'i').test(body(l)))).map((s) => s.category!))
    const movable = (s: Segment): s is Segment & { category: string } => s.category !== null && !blocked.has(s.category)
    // Neighbouring segments of one category stay one block, so their spacing is kept.
    const runs: { category: string | null; segments: Segment[] }[] = []
    for (const s of segments) {
      const category = movable(s) ? s.category : null
      const last = runs[runs.length - 1]
      if (last && last.category === category) last.segments.push(s)
      else runs.push({ category, segments: [s] })
    }
    for (const run of runs) {
      if (run.category === null) {
        kept.push(run.segments.flatMap((s) => s.lines))
        continue
      }
      const category = run.category
      const blocks = byCategory.get(category) ?? []
      // The bare header's keys must come first: in the new file they are root keys.
      const bareAt = run.segments.findIndex((s) => s.bare && !s.commented)
      const strip = (list: Segment[]) => list.flatMap((s) => s.lines.map((l) => stripTomlHeader(l, category)).filter((l): l is string => l !== null))
      if (bareAt > 0 || (bareAt === 0 && blocks.length > 0)) {
        blocks.unshift(strip([run.segments[bareAt]]))
        blocks.push(strip(run.segments.filter((_, i) => i !== bareAt)))
      } else {
        blocks.push(strip(run.segments))
      }
      byCategory.set(category, blocks)
    }
  } else {
    let keeping = false
    for (const s of segmentsOfYaml(lines)) {
      const moved = s.category !== null && !s.inline ? dedentYaml(s) : null
      if (moved === null || s.category === null) {
        // Neighbouring kept keys stay one block, so their spacing is kept.
        if (keeping) kept[kept.length - 1].push(...s.lines)
        else kept.push([...s.lines])
        keeping = true
      } else {
        byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), moved])
        keeping = false
      }
    }
  }

  if (byCategory.size === 0) return null
  const files = [...byCategory].map(([category, blocks]) => ({ category, path: fileName(category, ext), text: joinBlocks(blocks, eol) }))
  const remainder = (bom ? BOM : '') + joinBlocks(kept, eol)
  return { format, rootPath, files, remainder, movedTo: `config/_default/hugo.${ext}` }
}

/** Deep merge as Hugo does for the files of one config folder (later files add keys). */
function merge(into: Tree, from: Tree): Tree {
  const out: Tree = { ...into }
  for (const [k, v] of Object.entries(from)) {
    const existing = Object.keys(out).find((key) => key.toLowerCase() === k.toLowerCase())
    if (existing !== undefined && isPlainObject(out[existing]) && isPlainObject(v)) out[existing] = merge(out[existing] as Tree, v)
    else out[existing ?? k] = v
  }
  return out
}

export interface ParsedSplit {
  remainder: Tree
  files: { category: string; values: Tree }[]
}

/**
 * Problems with a split, checked on the parsed files: the merged result must equal the original
 * values, and no file may look wrapped (`[params]` as its only key) when it is not.
 */
export function checkSplit(original: Tree, parsed: ParsedSplit): string[] {
  const problems: string[] = []
  let merged = parsed.remainder
  for (const file of parsed.files) {
    const keys = Object.keys(file.values)
    if (keys.length === 1 && keys[0].toLowerCase() === file.category.toLowerCase()) problems.push(`${file.category}: wrapped`)
    merged = merge(merged, { [file.category]: file.values })
  }
  // Top-level keys are compared without case (file names are lower case); `menu` is read as `menus`.
  const normalize = (tree: Tree): Tree => {
    const out: Tree = {}
    for (const [k, v] of Object.entries(tree)) out[k.toLowerCase() === 'menu' ? 'menus' : k.toLowerCase()] = v
    return out
  }
  if (!deepEqual(sortKeys(normalize(original)), sortKeys(normalize(merged)))) problems.push('different values')
  return problems
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys(value[k])]),
  )
}

// ---- JSON -----------------------------------------------------------------------------------

interface JsonMember {
  key: string
  /** Start of the member (its key), and start and end of its value in the text. */
  start: number
  valueStart: number
  end: number
}

/** The members of the top-level object, with their positions; null when the text is not one JSON object. */
export function jsonMembers(text: string): JsonMember[] | null {
  let i = 0
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  const string = (): boolean => {
    if (text[i] !== '"') return false
    for (i++; i < text.length; i++) {
      if (text[i] === '\\') i++
      else if (text[i] === '"') {
        i++
        return true
      }
    }
    return false
  }
  /** Skips one value up to the `,` or `}` after it; strings and brackets are balanced. */
  const value = (): boolean => {
    let depth = 0
    while (i < text.length) {
      const ch = text[i]
      if (ch === '"') {
        if (!string()) return false
        continue
      }
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        if (depth === 0) return true
        depth--
      } else if (ch === ',' && depth === 0) return true
      i++
    }
    return false
  }
  ws()
  if (text[i] !== '{') return null
  i++
  const members: JsonMember[] = []
  for (;;) {
    ws()
    if (text[i] === '}' && members.length === 0) break
    const start = i
    if (!string()) return null
    let key: string
    try {
      key = JSON.parse(text.slice(start, i)) as string
    } catch {
      return null
    }
    ws()
    if (text[i] !== ':') return null
    i++
    ws()
    const valueStart = i
    if (!value()) return null
    let end = i
    while (end > valueStart && /\s/.test(text[end - 1])) end--
    members.push({ key, start, valueStart, end })
    if (text[i] === ',') {
      i++
      continue
    }
    break
  }
  if (text[i] !== '}') return null
  i++
  ws()
  return i === text.length ? members : null
}

/** One indentation step of a JSON text (`'  '`, `'\t'`), or null for compact JSON. */
function jsonIndent(text: string, members: readonly JsonMember[]): string | null {
  const first = members[0]
  if (!first) return null
  const before = text.slice(0, first.start)
  const nl = before.lastIndexOf('\n')
  return nl === -1 ? null : before.slice(nl + 1)
}

function planJsonSplit(rootPath: string, text: string): SplitPlan | null {
  const bom = text.startsWith(BOM)
  const source = bom ? text.slice(1) : text
  const members = jsonMembers(source)
  if (!members) return null
  const eol = eolOf(source)
  const indent = jsonIndent(source, members)
  const trailing = /\r?\n$/.test(source) ? eol : ''
  const seen = new Map<string, number>()
  for (const m of members) {
    const category = categoryKey(m.key)
    if (category) seen.set(category, (seen.get(category) ?? 0) + 1)
  }
  const files: SplitFile[] = []
  const kept: JsonMember[] = []
  for (const m of members) {
    const category = categoryKey(m.key)
    const raw = source.slice(m.valueStart, m.end)
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
    // Only maps move, when one key holds the category and Hugo would not unwrap the new file.
    const keys = isPlainObject(value) ? Object.keys(value) : []
    const wrapped = keys.length === 1 && category !== null && keys[0].toLowerCase() === category.toLowerCase()
    if (category === null || seen.get(category) !== 1 || !isPlainObject(value) || wrapped) {
      kept.push(m)
      continue
    }
    // The value moves one level to the left: its inner lines lose one indentation step.
    const body = indent === null ? raw : raw.split('\n').map((line, i) => (i > 0 && line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n')
    files.push({ category, path: fileName(category, 'json'), text: body + trailing })
  }
  if (files.length === 0) return null
  let remainder: string
  if (kept.length === 0) remainder = '{}'
  else if (indent === null) remainder = `{${kept.map((m) => source.slice(m.start, m.end)).join(',')}}`
  else remainder = `{${eol}${kept.map((m) => indent + source.slice(m.start, m.end)).join(`,${eol}`)}${eol}}`
  return { format: 'json', rootPath, files, remainder: (bom ? BOM : '') + remainder + trailing, movedTo: 'config/_default/hugo.json' }
}
