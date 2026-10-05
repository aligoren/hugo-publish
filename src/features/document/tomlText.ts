// A small line scanner for TOML front matter. It does not validate (the Rust side parses TOML);
// it finds where keys and values are written so the form can keep the author's formatting:
// a bare datetime stays bare, a 'literal string' keeps its quotes, and nested values can be
// edited as the exact text they are written as.

export interface TomlLine {
  /** Offset of the line in the text. */
  start: number
  /** The line without its line break. */
  text: string
  kind: 'blank' | 'comment' | 'header' | 'arrayHeader' | 'keyValue' | 'continuation' | 'other'
  /** Table the line belongs to (for headers: the table they open). Null inside an array of tables. */
  table: string[] | null
  /** For key-value lines: the (dotted) key as written. */
  key?: string[]
  /** For key-value lines: offset of the value inside `text`. */
  valueOffset?: number
  /** For key-value lines: index of the last line of the value (multi-line arrays and strings). */
  endLine?: number
}

const BARE_KEY = /^[A-Za-z0-9_-]+/

/** Parses a (dotted) key starting at `pos`. */
function parseKey(text: string, pos: number): { path: string[]; end: number } | null {
  const path: string[] = []
  let i = pos
  for (;;) {
    while (text[i] === ' ' || text[i] === '\t') i++
    const ch = text[i]
    if (ch === '"') {
      let value = ''
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          value += unescapeBasic(text[i + 1])
          i += 2
        } else {
          value += text[i++]
        }
      }
      if (text[i] !== '"') return null
      i++
      path.push(value)
    } else if (ch === "'") {
      const close = text.indexOf("'", i + 1)
      if (close === -1) return null
      path.push(text.slice(i + 1, close))
      i = close + 1
    } else {
      const m = BARE_KEY.exec(text.slice(i))
      if (!m) return null
      path.push(m[0])
      i += m[0].length
    }
    while (text[i] === ' ' || text[i] === '\t') i++
    if (text[i] !== '.') return { path, end: i }
    i++
  }
}

function unescapeBasic(ch: string): string {
  switch (ch) {
    case 'n':
      return '\n'
    case 't':
      return '\t'
    case 'r':
      return '\r'
    default:
      return ch
  }
}

type StringMode = 'none' | 'basic' | 'literal' | 'mlBasic' | 'mlLiteral'

/**
 * Finds the line on which a value starting at (`line`, `offset`) ends, following brackets and
 * multi-line strings.
 */
function valueEndLine(lines: readonly string[], line: number, offset: number): number {
  let depth = 0
  let mode: StringMode = 'none'
  for (let l = line; l < lines.length; l++) {
    const text = lines[l]
    let i = l === line ? offset : 0
    while (i < text.length) {
      const ch = text[i]
      if (mode === 'basic') {
        if (ch === '\\') i++
        else if (ch === '"') mode = 'none'
      } else if (mode === 'literal') {
        if (ch === "'") mode = 'none'
      } else if (mode === 'mlBasic') {
        if (ch === '\\') i++
        else if (text.startsWith('"""', i)) {
          mode = 'none'
          i += 2
        }
      } else if (mode === 'mlLiteral') {
        if (text.startsWith("'''", i)) {
          mode = 'none'
          i += 2
        }
      } else if (ch === '#') {
        break
      } else if (text.startsWith('"""', i)) {
        mode = 'mlBasic'
        i += 2
      } else if (text.startsWith("'''", i)) {
        mode = 'mlLiteral'
        i += 2
      } else if (ch === '"') {
        mode = 'basic'
      } else if (ch === "'") {
        mode = 'literal'
      } else if (ch === '[' || ch === '{') {
        depth++
      } else if (ch === ']' || ch === '}') {
        depth--
      }
      i++
    }
    // A single-line string cannot continue on the next line.
    if (mode === 'basic' || mode === 'literal') mode = 'none'
    if (depth <= 0 && mode === 'none') return l
  }
  return lines.length - 1
}

/** Splits `text` into lines (without line breaks) and their start offsets. */
function splitLines(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = []
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    const end = nl === -1 ? text.length : nl
    const lineText = text.slice(start, end).replace(/\r$/, '')
    out.push({ text: lineText, start })
    if (nl === -1) break
    start = nl + 1
  }
  return out
}

/** Classifies every line of a TOML text. */
export function scanToml(text: string): TomlLine[] {
  const raw = splitLines(text)
  const texts = raw.map((l) => l.text)
  const out: TomlLine[] = []
  let table: string[] | null = []
  for (let i = 0; i < raw.length; i++) {
    const { text: line, start } = raw[i]
    const trimmed = line.trim()
    if (trimmed === '') {
      out.push({ start, text: line, kind: 'blank', table })
      continue
    }
    if (trimmed.startsWith('#')) {
      out.push({ start, text: line, kind: 'comment', table })
      continue
    }
    if (trimmed.startsWith('[')) {
      const array = trimmed.startsWith('[[')
      const open = line.indexOf('[') + (array ? 2 : 1)
      const parsed = parseKey(line, open)
      const path = parsed?.path ?? []
      table = array ? null : path
      out.push({ start, text: line, kind: array ? 'arrayHeader' : 'header', table: path })
      continue
    }
    const key = parseKey(line, 0)
    if (!key || line[key.end] !== '=') {
      out.push({ start, text: line, kind: 'other', table })
      continue
    }
    let valueOffset = key.end + 1
    while (line[valueOffset] === ' ' || line[valueOffset] === '\t') valueOffset++
    const endLine = valueEndLine(texts, i, valueOffset)
    out.push({ start, text: line, kind: 'keyValue', table, key: key.path, valueOffset, endLine })
    for (let c = i + 1; c <= endLine; c++) {
      out.push({ start: raw[c].start, text: raw[c].text, kind: 'continuation', table })
    }
    i = endLine
  }
  return out
}

const TOML_DATETIME = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$/
const BARE_DATETIME = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/

/** Whether `value` can be written as a bare TOML date-time (offset, local date-time or date). */
export function isTomlDatetime(value: string): boolean {
  return TOML_DATETIME.test(value)
}

export interface TomlScalar {
  /** Offsets of the value token in the text. */
  start: number
  end: number
  raw: string
  style: 'basic' | 'literal' | 'datetime' | 'bare' | 'multiline'
}

function sameKey(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i])
}

/** Finds the written value of a key (`["date"]`, `["params", "toc"]`), or null. */
export function locateTomlScalar(text: string, path: readonly string[]): TomlScalar | null {
  for (const line of scanToml(text)) {
    if (line.kind !== 'keyValue' || !line.table || !line.key || line.valueOffset === undefined) continue
    if (!sameKey([...line.table, ...line.key], path)) continue
    const rest = line.text.slice(line.valueOffset)
    const start = line.start + line.valueOffset
    let length: number
    let style: TomlScalar['style']
    if (rest.startsWith('"""') || rest.startsWith("'''")) {
      return { start, end: start + rest.length, raw: rest, style: 'multiline' }
    }
    if (rest.startsWith('"')) {
      let i = 1
      while (i < rest.length && rest[i] !== '"') i += rest[i] === '\\' ? 2 : 1
      length = Math.min(i + 1, rest.length)
      style = 'basic'
    } else if (rest.startsWith("'")) {
      const close = rest.indexOf("'", 1)
      length = close === -1 ? rest.length : close + 1
      style = 'literal'
    } else {
      const dt = BARE_DATETIME.exec(rest)
      if (dt) {
        length = dt[0].length
        style = 'datetime'
      } else {
        length = /^[^\s#,]*/.exec(rest)![0].length
        style = 'bare'
      }
    }
    return { start, end: start + length, raw: rest.slice(0, length), style }
  }
  return null
}

export interface TomlStyleHint {
  path: readonly (string | number)[]
  value: unknown
  /** Write the string as a bare TOML date-time when the key is new. */
  datetime?: boolean
}

/**
 * The Rust TOML editor keeps the style of a value it replaces (bare date-times stay bare,
 * 'literal' strings stay literal), but writes a new key's string as a "basic string". This makes
 * a new date key bare when asked (`date = 2026-10-03T00:11:40+03:00`, like Hugo's TOML
 * archetypes). `before` is the front matter before the edit, `after` the editor's result.
 */
export function bareNewTomlDates(before: string, after: string, hints: readonly TomlStyleHint[]): string {
  let text = after
  for (const hint of hints) {
    if (!hint.datetime || typeof hint.value !== 'string' || !isTomlDatetime(hint.value)) continue
    if (hint.path.some((k) => typeof k !== 'string')) continue
    const path = hint.path as readonly string[]
    if (locateTomlScalar(before, path)) continue
    const now = locateTomlScalar(text, path)
    if (now?.style === 'basic') text = text.slice(0, now.start) + hint.value + text.slice(now.end)
  }
  return text
}

/**
 * Lines `[start, end)` that hold a top-level key: `key = …` (also multi-line and dotted
 * `key.x = …` lines) or its `[key]` / `[key.x]` / `[[key]]` tables, with comment lines right
 * above. Null when the key is not found or is written in separate places.
 */
export function tomlKeyLines(text: string, key: string): { start: number; end: number } | null {
  const lines = scanToml(text)
  const owned = new Array<boolean>(lines.length).fill(false)
  let inSection = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.kind === 'header' || line.kind === 'arrayHeader') {
      inSection = line.table?.[0] === key
      owned[i] = inSection
    } else if (inSection) {
      owned[i] = true
    } else if (line.kind === 'keyValue' && line.table?.length === 0 && line.key?.[0] === key) {
      for (let c = i; c <= (line.endLine ?? i) && c < lines.length; c++) owned[c] = true
    }
  }
  let start = owned.indexOf(true)
  if (start === -1) return null
  let end = owned.lastIndexOf(true) + 1
  // Trailing blank lines and comments belong to whatever follows.
  while (end > start && (lines[end - 1].kind === 'blank' || lines[end - 1].kind === 'comment')) end--
  for (let i = start; i < end; i++) {
    if (!owned[i] && lines[i].kind !== 'blank' && lines[i].kind !== 'comment') return null
  }
  while (start > 0 && lines[start - 1].kind === 'comment') start--
  return { start, end }
}
