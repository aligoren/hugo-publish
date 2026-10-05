// Front matter splitting and format-preserving YAML editing.
//
// A content file is split into byte-exact pieces so that
// `joinFrontMatter(splitFrontMatter(x)) === x` for every input. YAML front
// matter is edited through the `yaml` Document API, and the result is merged
// back line by line: lines the edit does not touch keep their original bytes
// (spacing, comments, quote style, line endings), even where `yaml` itself
// would print them differently. TOML and JSON front matter are read-only here;
// TOML is edited on the Rust side with `toml_edit`.

import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  Scalar,
  YAMLMap,
  YAMLSeq,
  type Document,
  type DocumentOptions,
  type ParseOptions,
  type Schema,
  type SchemaOptions,
  type ToStringOptions,
} from 'yaml'
import {
  BOM,
  detectEol,
  dominantEol,
  eolToSeparator,
  lineSeparatorOf,
  splitLinesKeepEol,
  toLf,
  type Eol,
  type LineSeparator,
  type LineWithEol,
} from './eol'

export type FrontMatterFormat = 'yaml' | 'toml' | 'json'

/**
 * A content file cut into consecutive, unmodified slices:
 * `(bom ? BOM : '') + open + frontMatterText + close + body` is the file.
 */
export interface FrontMatterParts {
  /** The file started with a UTF-8 byte order mark (not part of `open`). */
  bom: boolean
  /** Line ending style of the whole file. */
  eol: Eol
  /** `null` when the file has no front matter; then `open`, `frontMatterText` and `close` are empty. */
  format: FrontMatterFormat | null
  /**
   * Everything before the front matter text: leading blank space (Hugo allows
   * it) and the opening `---` / `+++` line with its line break. Empty for JSON.
   */
  open: string
  /** The front matter exactly as written. For JSON this is the whole `{ … }` object. */
  frontMatterText: string
  /**
   * The closing `---` / `+++` line with its line break (no line break when
   * the file ends there). For JSON, the line break right after the closing `}`.
   */
  close: string
  /** The rest of the file, verbatim. */
  body: string
}

export class FrontMatterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrontMatterError'
  }
}

/** Thrown when an edit is attempted on TOML or JSON front matter. */
export class FrontMatterReadOnlyError extends FrontMatterError {
  readonly format: FrontMatterFormat | null
  constructor(format: FrontMatterFormat | null) {
    super(
      format === null
        ? 'The file has no front matter; call ensureYamlFrontMatter() first'
        : `${format.toUpperCase()} front matter is read-only in the editor`,
    )
    this.name = 'FrontMatterReadOnlyError'
    this.format = format
  }
}

// ---------------------------------------------------------------------------
// Splitting

const FENCE_OPEN = /^([ \t\r\n]*)(---|\+\+\+)[ \t]*(\r\n|\n)/
const JSON_OPEN = /^[ \t\r\n]*\{(?!\{)/

/** Splits a content file into front matter and body. Never throws. */
export function splitFrontMatter(content: string): FrontMatterParts {
  const bom = content.charCodeAt(0) === 0xfeff
  const rest = bom ? content.slice(1) : content
  const eol = detectEol(content)
  const none: FrontMatterParts = { bom, eol, format: null, open: '', frontMatterText: '', close: '', body: rest }

  const fence = FENCE_OPEN.exec(rest)
  if (fence) {
    const delimiter = fence[2]
    const format: FrontMatterFormat = delimiter === '---' ? 'yaml' : 'toml'
    const open = fence[0]
    const closeRe = delimiter === '---' ? /---[ \t]*(\r\n|\n|$)/y : /\+\+\+[ \t]*(\r\n|\n|$)/y
    let lineStart = open.length
    while (lineStart <= rest.length) {
      closeRe.lastIndex = lineStart
      const close = closeRe.exec(rest)
      if (close) {
        return {
          bom,
          eol,
          format,
          open,
          frontMatterText: rest.slice(open.length, lineStart),
          close: close[0],
          body: rest.slice(lineStart + close[0].length),
        }
      }
      const nl = rest.indexOf('\n', lineStart)
      if (nl === -1) break
      lineStart = nl + 1
    }
    return none
  }

  if (JSON_OPEN.test(rest)) {
    const start = rest.indexOf('{')
    const end = findJsonObjectEnd(rest, start)
    if (end === -1) return none
    const after = /^(\r\n|\n)?/.exec(rest.slice(end))
    const close = after ? after[0] : ''
    return {
      bom,
      eol,
      format: 'json',
      open: rest.slice(0, start),
      frontMatterText: rest.slice(start, end),
      close,
      body: rest.slice(end + close.length),
    }
  }

  return none
}

/** Index just past the `}` that closes the object starting at `start`, or -1. */
function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** Reassembles a file from its parts. `joinFrontMatter(splitFrontMatter(x)) === x`. */
export function joinFrontMatter(parts: FrontMatterParts): string {
  return (parts.bom ? BOM : '') + parts.open + parts.frontMatterText + parts.close + parts.body
}

/** Short aliases. */
export const split = splitFrontMatter
export const join = joinFrontMatter

/** Only YAML front matter can be edited in the app's JS side. */
export function isFrontMatterEditable(parts: FrontMatterParts): boolean {
  return parts.format === 'yaml'
}

/** TOML and JSON front matter are shown as raw text and edited elsewhere. */
export function isFrontMatterReadOnly(parts: FrontMatterParts): boolean {
  return parts.format === 'toml' || parts.format === 'json'
}

/** The separator new lines in this file should use. */
export function fileLineSeparator(parts: FrontMatterParts): LineSeparator {
  if (parts.eol === 'crlf') return '\r\n'
  if (parts.eol === 'mixed') return lineSeparatorOf(joinFrontMatter(parts))
  return '\n'
}

/**
 * Gives a file without front matter an empty YAML block (`---` / `---`) so
 * fields can be set. Files that already have front matter are returned as is.
 */
export function ensureYamlFrontMatter(parts: FrontMatterParts): FrontMatterParts {
  if (parts.format !== null) return parts
  const sep = fileLineSeparator(parts)
  return { ...parts, format: 'yaml', open: '---' + sep, frontMatterText: '', close: '---' + sep }
}

// ---------------------------------------------------------------------------
// Reading

const PARSE_OPTIONS: ParseOptions & DocumentOptions & SchemaOptions = {
  // YAML 1.2 core schema: no timestamp type, so dates stay strings verbatim.
  version: '1.2',
  schema: 'core',
}

function parseYaml(text: string): Document.Parsed {
  const doc = parseDocument(toLf(text), PARSE_OPTIONS)
  if (doc.errors.length > 0) {
    throw new FrontMatterError(`Invalid YAML front matter: ${doc.errors[0].message}`)
  }
  return doc
}

/**
 * Parses the front matter into plain JS values. Dates are returned as the
 * strings written in the file. Returns `null` when the file has no front
 * matter or it is TOML (read TOML through the Rust side). Throws
 * {@link FrontMatterError} on a syntax error.
 */
export function readFrontMatter(parts: FrontMatterParts): Record<string, unknown> | null {
  if (parts.format === 'yaml') {
    const value: unknown = parseYaml(parts.frontMatterText).toJS()
    if (value === null || value === undefined) return {}
    if (!isPlainObject(value)) throw new FrontMatterError('YAML front matter must be a mapping')
    return value
  }
  if (parts.format === 'json') {
    let value: unknown
    try {
      value = JSON.parse(parts.frontMatterText)
    } catch (error) {
      throw new FrontMatterError(`Invalid JSON front matter: ${(error as Error).message}`)
    }
    if (!isPlainObject(value)) throw new FrontMatterError('JSON front matter must be an object')
    return value
  }
  return null
}

export type FieldPath = string | readonly (string | number)[]

function toPath(path: FieldPath): (string | number)[] {
  const result = typeof path === 'string' ? path.split('.') : [...path]
  if (result.length === 0 || result.some((key) => key === '')) {
    throw new FrontMatterError(`Invalid field path: ${JSON.stringify(path)}`)
  }
  return result
}

/** Reads one field (dot path or key array). `undefined` when absent. */
export function getField(parts: FrontMatterParts, path: FieldPath): unknown {
  let value: unknown = readFrontMatter(parts)
  for (const key of toPath(path)) {
    if (Array.isArray(value) && typeof key === 'number') value = value[key]
    else if (isPlainObject(value)) value = value[String(key)]
    else return undefined
  }
  return value
}

// ---------------------------------------------------------------------------
// Editing

export type FrontMatterValue =
  | string
  | number
  | boolean
  | null
  | readonly FrontMatterValue[]
  | { readonly [key: string]: FrontMatterValue }

function assertEditable(parts: FrontMatterParts): void {
  if (parts.format !== 'yaml') throw new FrontMatterReadOnlyError(parts.format)
}

/**
 * Sets a field and returns new parts. Only the lines that hold the field
 * change. An existing scalar keeps its quote style; an existing sequence keeps
 * its flow or block style; a new sequence copies the style of sibling
 * sequences (flow `["a", "b"]` by default). Pass dates as strings.
 */
export function setField(parts: FrontMatterParts, path: FieldPath, value: FrontMatterValue): FrontMatterParts {
  assertEditable(parts)
  const keys = toPath(path)
  return withYamlEdit(parts, (doc) => setIn(doc, keys, value))
}

/** Deletes a field. Comment lines above it are kept (moved to the next key). */
export function deleteField(parts: FrontMatterParts, path: FieldPath): FrontMatterParts {
  assertEditable(parts)
  const keys = toPath(path)
  return withYamlEdit(parts, (doc) => deleteIn(doc, keys))
}

/** Applies any `yaml` Document mutation to the front matter with the same minimal-diff merge. */
export function editFrontMatter(parts: FrontMatterParts, mutate: (doc: Document) => void): FrontMatterParts {
  assertEditable(parts)
  return withYamlEdit(parts, mutate)
}

function withYamlEdit(parts: FrontMatterParts, mutate: (doc: Document) => void): FrontMatterParts {
  const text = editYamlText(parts.frontMatterText, mutate, { eol: fileLineSeparator(parts) })
  return text === parts.frontMatterText ? parts : { ...parts, frontMatterText: text }
}

export interface YamlEditOptions {
  /** Line break for new lines when `text` has none to copy from. Default `\n`. */
  eol?: LineSeparator
}

/**
 * Edits a YAML text through the `yaml` Document API and returns the new text.
 * The result differs from `text` only in the lines the mutation changed; every
 * other line keeps its exact bytes and line ending. Throws
 * {@link FrontMatterError} when the text is not valid YAML.
 */
export function editYamlText(text: string, mutate: (doc: Document) => void, options: YamlEditOptions = {}): string {
  const doc = parseYaml(text)
  const sep = eolToSeparator(dominantEol(text, options.eol === '\r\n' ? 'crlf' : 'lf'))
  // `yaml` cannot reproduce every indentation scheme (e.g. maps indented by 4
  // with sequences not indented). The detected style is tried first; other
  // common styles are tried when the merged text does not parse to the
  // edited data, and as a last resort the whole block is printed by `yaml`.
  const styles = candidateStyles(detectYamlStyle(toLf(text)))
  const befores = styles.map((style) => renderLines(doc, style))
  mutate(doc)
  const expected: unknown = doc.toJS()
  for (let i = 0; i < styles.length; i++) {
    const after = renderLines(doc, styles[i])
    if (i === 0 && sameLines(befores[0], after)) return text
    const merged = mergeLineEdit(text, befores[i], after, sep)
    if (parsesTo(merged, expected)) return merged
  }
  const lines = renderLines(doc, styles[0])
  return lines.map((line) => line + sep).join('')
}

const BASE_STRINGIFY: ToStringOptions = { flowCollectionPadding: false, lineWidth: 0 }

interface YamlStyle {
  indent: number
  indentSeq: boolean
  flowCollectionPadding: boolean
}

function candidateStyles(detected: YamlStyle): YamlStyle[] {
  const styles = [detected]
  for (const indent of [2, 4]) {
    for (const indentSeq of [true, false]) {
      if (!styles.some((s) => s.indent === indent && s.indentSeq === indentSeq)) {
        styles.push({ indent, indentSeq, flowCollectionPadding: detected.flowCollectionPadding })
      }
    }
  }
  return styles
}

function parsesTo(text: string, expected: unknown): boolean {
  const doc = parseDocument(toLf(text), PARSE_OPTIONS)
  return doc.errors.length === 0 && deepEqual(doc.toJS(), expected)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && deepEqual(a[k], b[k]))
  }
  return Number.isNaN(a) && Number.isNaN(b)
}

/** Guesses the indentation and flow padding the author used, so new lines match. */
function detectYamlStyle(text: string): YamlStyle {
  const lines = text.split('\n')
  const indentOf = (line: string) => line.length - line.trimStart().length
  const isContent = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#')
  let indent: number | null = null
  let indentSeq: boolean | null = null
  for (let i = 0; i < lines.length && (indent === null || indentSeq === null); i++) {
    // A key that opens a nested block: `key:` with nothing (or only a comment) after it.
    if (!/^\s*[^\s#-][^:#]*:\s*(#.*)?$/.test(lines[i])) continue
    let j = i + 1
    while (j < lines.length && !isContent(lines[j])) j++
    if (j >= lines.length) break
    const parentIndent = indentOf(lines[i])
    const childIndent = indentOf(lines[j])
    if (/^\s*- /.test(lines[j]) || /^\s*-$/.test(lines[j])) {
      if (indentSeq === null) indentSeq = childIndent > parentIndent
    } else if (indent === null && childIndent > parentIndent) {
      indent = childIndent - parentIndent
    }
  }
  let padded = 0
  let compact = 0
  for (const line of lines) {
    if (/[[{] +[^\s\]}]/.test(line)) padded++
    else if (/[[{][^\s\]}]/.test(line)) compact++
  }
  return { indent: indent ?? 2, indentSeq: indentSeq ?? true, flowCollectionPadding: padded > compact }
}

function renderLines(doc: Document, style: YamlStyle): string[] {
  const text = doc.toString({ ...BASE_STRINGIFY, ...style })
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  // `yaml` prints an empty document as `null` and an empty mapping as `{}`;
  // empty front matter has no lines at all.
  const contents = doc.contents
  const placeholder = contents == null ? 'null' : isMap(contents) && contents.items.length === 0 ? '{}' : null
  if (placeholder !== null) {
    const index = lines.lastIndexOf(placeholder)
    if (index !== -1) lines.splice(index, 1)
  }
  return lines
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i])
}

// --- Document mutation helpers ---------------------------------------------

type ScalarType = Scalar.Type

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPrimitive(value: FrontMatterValue): value is string | number | boolean | null {
  return value === null || typeof value !== 'object'
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

interface NewNodeStyle {
  /** Style for new text strings. */
  text?: ScalarType
  /** Style for new date-like strings. */
  date?: ScalarType
  /** Flow (`[a, b]`) or block (`- a`) for new sequences. */
  seqFlow?: boolean
  /** Style for strings inside new sequences. */
  seqItem?: ScalarType
}

function mostCommon<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>()
  let best: T | undefined
  let bestCount = 0
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1
    counts.set(value, count)
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/** Collects the styles used by a mapping's existing values. */
function siblingStyle(parent: unknown): NewNodeStyle {
  const text: ScalarType[] = []
  const date: ScalarType[] = []
  const seqFlow: boolean[] = []
  const seqItem: ScalarType[] = []
  const collect = (node: unknown, into: { text: ScalarType[]; date: ScalarType[] }) => {
    if (isScalar(node) && typeof node.value === 'string' && node.type) {
      ;(DATE_LIKE.test(node.value) ? into.date : into.text).push(node.type)
    }
  }
  if (isMap(parent)) {
    for (const pair of parent.items) {
      collect(pair.value, { text, date })
      if (isSeq(pair.value)) {
        seqFlow.push(Boolean(pair.value.flow))
        for (const item of pair.value.items) collect(item, { text: seqItem, date: seqItem })
      }
    }
  }
  return {
    text: mostCommon(text) ?? Scalar.PLAIN,
    date: mostCommon(date) ?? Scalar.PLAIN,
    seqFlow: mostCommon(seqFlow) ?? true,
    seqItem: mostCommon(seqItem),
  }
}

function stringType(value: string, preferred: ScalarType | undefined): ScalarType {
  if (value.includes('\n')) return Scalar.BLOCK_LITERAL
  return preferred ?? Scalar.PLAIN
}

function createNode(value: FrontMatterValue, style: NewNodeStyle, schema: Schema): Scalar | YAMLSeq | YAMLMap {
  if (Array.isArray(value)) {
    const seq = new YAMLSeq(schema)
    seq.flow = style.seqFlow ?? true
    const itemStyle = style.seqItem ?? (seq.flow ? Scalar.QUOTE_DOUBLE : Scalar.PLAIN)
    for (const item of value as readonly FrontMatterValue[]) {
      seq.items.push(createNode(item, { text: itemStyle, date: itemStyle, seqFlow: true }, schema))
    }
    return seq
  }
  if (value !== null && typeof value === 'object') {
    const map = new YAMLMap(schema)
    for (const [key, item] of Object.entries(value as { readonly [key: string]: FrontMatterValue })) {
      map.set(key, createNode(item, { text: style.text, date: style.date, seqFlow: style.seqFlow }, schema))
    }
    return map
  }
  const scalar = new Scalar(value)
  if (typeof value === 'string') {
    scalar.type = stringType(value, DATE_LIKE.test(value) ? style.date : style.text)
  }
  return scalar
}

/** Updates `node` to hold `value` while keeping its style. Returns false when it cannot. */
function updateInPlace(node: unknown, value: FrontMatterValue, schema: Schema): boolean {
  if (isScalar(node) && isPrimitive(value)) {
    if (node.value === value) return true
    node.value = value
    const isBlock = node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED
    if (typeof value === 'string' && value.includes('\n') && !isBlock) node.type = Scalar.BLOCK_LITERAL
    return true
  }
  if (isSeq(node) && Array.isArray(value)) {
    reconcileSeq(node, value as readonly FrontMatterValue[], schema)
    return true
  }
  if (isMap(node) && isPlainObject(value)) {
    reconcileMap(node, value as { readonly [key: string]: FrontMatterValue }, schema)
    return true
  }
  return false
}

function reconcileSeq(seq: YAMLSeq, values: readonly FrontMatterValue[], schema: Schema): void {
  const itemTypes: ScalarType[] = []
  for (const item of seq.items) {
    if (isScalar(item) && typeof item.value === 'string' && item.type) itemTypes.push(item.type)
  }
  const itemStyle = mostCommon(itemTypes) ?? (seq.flow ? Scalar.QUOTE_DOUBLE : Scalar.PLAIN)
  const style: NewNodeStyle = { text: itemStyle, date: itemStyle, seqFlow: true }
  values.forEach((value, i) => {
    if (i < seq.items.length) {
      if (!updateInPlace(seq.items[i], value, schema)) seq.items[i] = createNode(value, style, schema)
    } else {
      seq.items.push(createNode(value, style, schema))
    }
  })
  seq.items.splice(values.length)
}

function reconcileMap(map: YAMLMap, value: { readonly [key: string]: FrontMatterValue }, schema: Schema): void {
  const style = siblingStyle(map)
  for (const [key, item] of Object.entries(value)) {
    if (!updateInPlace(map.get(key, true), item, schema)) map.set(key, createNode(item, style, schema))
  }
  for (const pair of [...map.items]) {
    const key = isScalar(pair.key) ? pair.key.value : pair.key
    if (typeof key === 'string' && !(key in value)) removePair(map, map.items.indexOf(pair), null)
  }
}

function setIn(doc: Document, path: (string | number)[], value: FrontMatterValue): void {
  if (doc.contents == null) doc.contents = new YAMLMap(doc.schema) as Document['contents']
  if (isMap(doc.contents) && doc.contents.items.length === 0) doc.contents.flow = false
  if (!isMap(doc.contents)) throw new FrontMatterError('YAML front matter must be a mapping')
  const existing = doc.getIn(path, true)
  if (existing !== undefined && updateInPlace(existing, value, doc.schema)) return
  const parent = path.length > 1 ? doc.getIn(path.slice(0, -1), true) : doc.contents
  const node = createNode(value, siblingStyle(parent), doc.schema)
  // Keep a trailing comment (`key: value # note`) when the value node is replaced.
  if (existing && typeof existing === 'object' && 'comment' in existing) {
    const comment = (existing as { comment?: string | null }).comment
    if (comment) node.comment = comment
  }
  doc.setIn(path, node)
}

function deleteIn(doc: Document, path: (string | number)[]): void {
  const parent = path.length > 1 ? doc.getIn(path.slice(0, -1), true) : doc.contents
  const key = path[path.length - 1]
  if (isMap(parent)) {
    const index = parent.items.findIndex((pair) => (isScalar(pair.key) ? pair.key.value : pair.key) === key)
    if (index !== -1) removePair(parent, index, parent === doc.contents ? doc : null)
  } else if (isSeq(parent) && typeof key === 'number' && key >= 0 && key < parent.items.length) {
    parent.items.splice(key, 1)
  }
}

/** Removes a pair but moves the comment lines and blank line above it to the next key. */
function removePair(map: YAMLMap, index: number, doc: Document | null): void {
  const pair = map.items[index]
  const keyNode = isScalar(pair.key) ? pair.key : null
  const commentBefore = keyNode?.commentBefore
  const spaceBefore = keyNode?.spaceBefore
  const next = map.items[index + 1]
  const nextKey = next && isScalar(next.key) ? next.key : null
  if (nextKey) {
    if (commentBefore) nextKey.commentBefore = nextKey.commentBefore ? `${commentBefore}\n${nextKey.commentBefore}` : commentBefore
    if (spaceBefore) nextKey.spaceBefore = true
  } else if (commentBefore) {
    if (doc) doc.comment = doc.comment ? `${commentBefore}\n${doc.comment}` : commentBefore
    else map.comment = map.comment ? `${commentBefore}\n${map.comment}` : commentBefore
  }
  map.items.splice(index, 1)
}

// --- Line merge ---------------------------------------------------------------

/**
 * Longest common subsequence of two line lists as index pairs. Common prefix
 * and suffix are matched directly; the rest uses the O(n·m) table, which is
 * fine for front matter sized input.
 */
function lcsPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const pairs: [number, number][] = []
  for (let i = 0; i < start; i++) pairs.push([i, i])
  const n = endA - start
  const m = endB - start
  if (n > 0 && m > 0 && n * m <= 4_000_000) {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] =
          a[start + i] === b[start + j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j])
        i++
        j++
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        i++
      } else {
        j++
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k])
  return pairs
}

/**
 * Three-way line merge. `before` is how `yaml` prints the original text and
 * `after` how it prints the edited document. The changes from `before` to
 * `after` are applied to the original lines; everything else keeps its bytes.
 */
function mergeLineEdit(original: string, before: readonly string[], after: readonly string[], sep: LineSeparator): string {
  const lines = splitLinesKeepEol(original)
  const anchors = lcsPairs(
    lines.map((line) => line.text),
    before,
  )

  const kept = new Array<boolean>(before.length).fill(false)
  const inserted: string[][] = Array.from({ length: before.length + 1 }, () => [])
  let nextAfter = 0
  for (const [b, a] of lcsPairs(before, after)) {
    while (nextAfter < a) inserted[b].push(after[nextAfter++])
    kept[b] = true
    nextAfter = a + 1
  }
  while (nextAfter < after.length) inserted[before.length].push(after[nextAfter++])

  const out: LineWithEol[] = []
  const emitted = new Array<boolean>(before.length + 1).fill(false)
  const emitInserted = (b: number) => {
    if (emitted[b]) return
    emitted[b] = true
    for (const text of inserted[b]) out.push({ text, eol: sep })
  }

  // Lines between two anchors: original lines o0..o1 that `yaml` printed as b0..b1.
  const gap = (o0: number, o1: number, b0: number, b1: number) => {
    let touched = false
    for (let b = b0; b < b1; b++) if (!kept[b]) touched = true
    for (let b = b0 + 1; b < b1; b++) if (inserted[b].length > 0) touched = true
    if (!touched) {
      emitInserted(b0)
      for (let o = o0; o < o1; o++) out.push(lines[o])
    } else if (b1 - b0 === o1 - o0) {
      // Same number of lines: pair them up and keep the original bytes.
      for (let b = b0; b < b1; b++) {
        emitInserted(b)
        if (kept[b]) out.push(lines[o0 + b - b0])
      }
    } else if (o0 === o1) {
      // Lines only `yaml` prints (e.g. its `null` placeholder) are dropped.
      for (let b = b0; b < b1; b++) emitInserted(b)
    } else {
      // Cannot pair the lines: use the printed version of this small region.
      for (let b = b0; b < b1; b++) {
        emitInserted(b)
        if (kept[b]) out.push({ text: before[b], eol: sep })
      }
    }
  }

  let o = 0
  let b = 0
  for (const [oa, ba] of anchors) {
    gap(o, oa, b, ba)
    emitInserted(ba)
    if (kept[ba]) out.push(lines[oa])
    o = oa + 1
    b = ba + 1
  }
  gap(o, lines.length, b, before.length)
  emitInserted(before.length)

  const endsWithEol = lines.length === 0 || lines[lines.length - 1].eol !== ''
  let result = ''
  out.forEach((line, i) => {
    const last = i === out.length - 1
    let eol: string = line.eol
    if (!last && eol === '') eol = sep
    if (last) eol = endsWithEol ? eol || sep : ''
    result += line.text + eol
  })
  return result
}
