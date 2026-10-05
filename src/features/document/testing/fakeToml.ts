// A small stand-in for the Rust TOML commands in tests.
//
// `fakeTomlParse` is a compact TOML parser (tables, arrays of tables, inline tables, arrays,
// basic/literal/multi-line strings, numbers, booleans, date-times kept as written).
// `fakeTomlEdit` behaves like the Rust editor: a replaced value keeps its style (a bare date-time
// stays bare, a 'literal' string stays literal, each array item keeps its quote style and extra
// items copy the last one's), new keys get basic strings and go to the end of their table,
// `appendTable` adds an `[[array.of.tables]]` entry, and untouched lines keep their bytes.

import type { ConfigOp } from '../../../lib/api'
import { scanToml, type TomlLine } from '../tomlText'

// --- Parsing --------------------------------------------------------------------------------

class Parser {
  i = 0
  readonly s: string
  constructor(s: string) {
    this.s = s
  }

  ws() {
    while (this.i < this.s.length && (this.s[this.i] === ' ' || this.s[this.i] === '\t')) this.i++
  }

  /** Whitespace, newlines and comments. */
  gap() {
    for (;;) {
      this.ws()
      const ch = this.s[this.i]
      if (ch === '\n' || ch === '\r') this.i++
      else if (ch === '#') while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++
      else return
    }
  }

  fail(what: string): never {
    throw new Error(`fakeToml: ${what} at ${this.i}: ${JSON.stringify(this.s.slice(this.i, this.i + 20))}`)
  }

  key(): string[] {
    const path: string[] = []
    for (;;) {
      this.ws()
      const ch = this.s[this.i]
      if (ch === '"' || ch === "'") path.push(this.string() as string)
      else {
        const m = /^[A-Za-z0-9_-]+/.exec(this.s.slice(this.i))
        if (!m) this.fail('key expected')
        path.push(m[0])
        this.i += m[0].length
      }
      this.ws()
      if (this.s[this.i] !== '.') return path
      this.i++
    }
  }

  string(): string {
    const s = this.s
    if (s.startsWith('"""', this.i) || s.startsWith("'''", this.i)) {
      const quote = s.slice(this.i, this.i + 3)
      this.i += 3
      if (s[this.i] === '\r') this.i++
      if (s[this.i] === '\n') this.i++
      const end = s.indexOf(quote, this.i)
      if (end === -1) this.fail('unclosed string')
      const raw = s.slice(this.i, end).replace(/\r\n/g, '\n')
      this.i = end + 3
      return quote === '"""' ? unescape(raw.replace(/\\\n\s*/g, '')) : raw
    }
    if (s[this.i] === "'") {
      const end = s.indexOf("'", this.i + 1)
      const raw = s.slice(this.i + 1, end)
      this.i = end + 1
      return raw
    }
    let j = this.i + 1
    while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1
    const raw = s.slice(this.i + 1, j)
    this.i = j + 1
    return unescape(raw)
  }

  value(): unknown {
    this.ws()
    const s = this.s
    const ch = s[this.i]
    if (ch === '"' || ch === "'") return this.string()
    if (ch === '[') {
      this.i++
      const items: unknown[] = []
      for (;;) {
        this.gap()
        if (s[this.i] === ']') {
          this.i++
          return items
        }
        items.push(this.value())
        this.gap()
        if (s[this.i] === ',') this.i++
        else if (s[this.i] !== ']') this.fail('`,` or `]` expected')
      }
    }
    if (ch === '{') {
      this.i++
      const table: Record<string, unknown> = {}
      for (;;) {
        this.ws()
        if (s[this.i] === '}') {
          this.i++
          return table
        }
        const path = this.key()
        if (s[this.i] !== '=') this.fail('`=` expected')
        this.i++
        setPath(table, path, this.value())
        this.ws()
        if (s[this.i] === ',') this.i++
      }
    }
    const m = /^(true|false|\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|[+-]?\d+(?:\.\d+)?)/.exec(s.slice(this.i))
    if (!m) this.fail('value expected')
    this.i += m[0].length
    if (m[0] === 'true' || m[0] === 'false') return m[0] === 'true'
    return /^\d{4}-/.test(m[0]) ? m[0] : Number(m[0])
  }
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', b: '\b', f: '\f' }

function unescape(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, e: string) => (e.length > 1 ? String.fromCharCode(parseInt(e.slice(1), 16)) : (ESCAPES[e] ?? e)))
}

function setPath(table: Record<string, unknown>, path: string[], value: unknown) {
  let current = table
  for (const key of path.slice(0, -1)) {
    current[key] ??= {}
    current = current[key] as Record<string, unknown>
  }
  const last = path[path.length - 1]
  if (last in current) throw new Error(`fakeToml: duplicate key ${path.join('.')}`)
  current[last] = value
}

/** Parses TOML like the Rust side does (date-times become strings as written). Throws on errors. */
export function fakeTomlParse(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  const defined = new Set<string>()
  let table = root
  const p = new Parser(text)
  for (;;) {
    p.gap()
    if (p.i >= text.length) return root
    if (text[p.i] === '[') {
      const array = text.startsWith('[[', p.i)
      p.i += array ? 2 : 1
      const path = p.key()
      p.i += array ? 2 : 1
      table = root
      path.forEach((key, index) => {
        const last = index === path.length - 1
        if (last && array) {
          const list = (table[key] ??= []) as Record<string, unknown>[]
          list.push({})
          table = list[list.length - 1]
          return
        }
        const next: unknown = (table[key] ??= {})
        table = (Array.isArray(next) ? next[next.length - 1] : next) as Record<string, unknown>
      })
      if (!array) {
        const id = path.join('.')
        if (defined.has(id)) throw new Error(`fakeToml: table ${id} defined twice`)
        defined.add(id)
      }
      continue
    }
    const path = p.key()
    if (text[p.i] !== '=') p.fail('`=` expected')
    p.i++
    setPath(table, path, p.value())
    p.ws()
    if (text[p.i] === '#') while (p.i < text.length && text[p.i] !== '\n') p.i++
    if (p.i < text.length && text[p.i] !== '\n' && text[p.i] !== '\r') p.fail('end of line expected')
  }
}

// --- Editing --------------------------------------------------------------------------------

const DATETIME = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$/

function render(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(render).join(', ')}]`
  if (typeof value === 'string') return JSON.stringify(value)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${k} = ${render(v)}`).join(', ')} }`
  }
  return String(value)
}

/** The raw items of a single-line array (`['a', "b"]` → `'a'`, `"b"`). */
function arrayItems(raw: string): string[] {
  const inner = raw.trim().slice(1, -1)
  const items: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of inner) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === ',') {
      items.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) items.push(current.trim())
  return items
}

/** A replacement value written in the style of the value it replaces. */
function renderLike(old: string, value: unknown): string {
  if (typeof value === 'string') {
    if (DATETIME.test(old) && DATETIME.test(value)) return value
    if (old.startsWith("'") && !old.startsWith("'''") && !/['\n]/.test(value)) return `'${value}'`
  }
  if (Array.isArray(value) && old.trim().startsWith('[')) {
    const items = arrayItems(old)
    if (items.length > 0) return `[${value.map((v, i) => renderLike(items[Math.min(i, items.length - 1)], v)).join(', ')}]`
  }
  return render(value)
}

interface Section {
  /** Header line index, or -1 for the root table. */
  header: number
  /** First line after the header, and the line where the next header starts. */
  start: number
  end: number
}

function sections(lines: TomlLine[]): { path: string[]; array: boolean; section: Section }[] {
  const out: { path: string[]; array: boolean; section: Section }[] = []
  let current = { path: [] as string[], array: false, section: { header: -1, start: 0, end: lines.length } }
  lines.forEach((line, i) => {
    if (line.kind !== 'header' && line.kind !== 'arrayHeader') return
    current.section.end = i
    out.push(current)
    current = { path: line.table ?? [], array: line.kind === 'arrayHeader', section: { header: i, start: i + 1, end: lines.length } }
  })
  out.push(current)
  return out
}

/** The section of a table path (`[]`, `['params']`, `['snippet', 2]`). */
function findSection(lines: TomlLine[], path: (string | number)[]): Section | null {
  const all = sections(lines)
  if (path.length === 0) return all[0].section
  const last = path[path.length - 1]
  if (typeof last === 'number') {
    const name = path.slice(0, -1).join('.')
    return all.filter((s) => s.array && s.path.join('.') === name)[last]?.section ?? null
  }
  return all.find((s) => !s.array && s.path.join('.') === path.join('.'))?.section ?? null
}

/** Applies config ops like the Rust editor would. */
export function fakeTomlEdit(text: string, ops: ConfigOp[]): string {
  const sep = text.includes('\r\n') ? '\r\n' : '\n'
  let out = text
  for (const op of ops) {
    const scanned = scanToml(out)
    const raw = out.split(/\r?\n/)
    if (raw[raw.length - 1] === '') raw.pop()
    const lines = raw
    if (op.op === 'appendTable') {
      const body = [`[[${op.path.join('.')}]]`, ...Object.entries(op.entries).map(([k, v]) => `${k} = ${render(v)}`)]
      const prefix = out === '' ? '' : out.endsWith('\n') ? sep : sep + sep
      out = out + prefix + body.join(sep) + sep
      continue
    }
    const last = op.path[op.path.length - 1]
    if (op.op === 'remove' && typeof last === 'number') {
      const section = findSection(scanned, op.path)
      if (!section) continue
      lines.splice(section.header, section.end - section.header)
      out = lines.join(sep) + (lines.length ? sep : '')
      continue
    }
    const key = String(last)
    const section = findSection(scanned, op.path.slice(0, -1))
    let found = -1
    if (section) {
      for (let i = section.start; i < section.end; i++) {
        const line = scanned[i]
        if (line.kind === 'keyValue' && line.key?.length === 1 && line.key[0] === key) found = i
      }
    }
    if (op.op === 'remove') {
      if (found !== -1) lines.splice(found, (scanned[found].endLine ?? found) - found + 1)
    } else if (found !== -1) {
      const line = scanned[found]
      const end = line.endLine ?? found
      const head = line.text.slice(0, line.valueOffset)
      const valueText = [line.text.slice(line.valueOffset), ...lines.slice(found + 1, end + 1)].join('\n')
      const comment = end === found ? (/(\s+#.*)$/.exec(valueText.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (m) => 'x'.repeat(m.length)))?.[1] ?? '') : ''
      const oldValue = comment ? valueText.slice(0, valueText.length - comment.length) : valueText
      lines.splice(found, end - found + 1, head + renderLike(oldValue.trim(), op.value) + (comment ? valueText.slice(valueText.length - comment.length) : ''))
    } else if (section) {
      let at = section.end
      while (at > section.start && (scanned[at - 1].kind === 'blank' || scanned[at - 1].kind === 'comment')) at--
      lines.splice(at, 0, `${key} = ${render(op.value)}`)
    } else {
      lines.push(`[${op.path.slice(0, -1).join('.')}]`, `${key} = ${render(op.value)}`)
    }
    out = lines.join(sep) + (lines.length ? sep : '')
  }
  return out
}
