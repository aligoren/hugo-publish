// Layer (c): reading a theme's commented defaults. Comments follow a few recognisable shapes
// (research §16.3): `# valid options: light or dark`, `# (Optional, default light) …`,
// `# You can also specify this parameter per page in front matter`, and commented-out keys
// such as `# mainSections = ["section1"]` that name optional settings.
import { parse as parseYaml } from 'yaml'

import type { Literal } from './scan/infer'

export interface CommentInfo {
  description?: string
  options?: Literal[]
  default?: Literal
  optional?: boolean
  pageOverridable?: boolean
  docLink?: string
  experimental?: boolean
}

const ENUM_MARKER =
  /\b(?:valid options|valid values|accepted values|allowed values|possible values|available options|options|one of|values)\b(?:\s+are)?\s*[:=]?\s*(.+)/i
const URL = /https?:\/\/[^\s)>"']+/
const TOKEN = /^[\w.\-#%+@!:/]+$/

/** Reads the conventions out of a comment (lines joined with `\n`, `#` already removed). */
export function parseComment(comment: string): CommentInfo {
  const info: CommentInfo = {}
  const text = comment
    .split('\n')
    .map((l) => l.replace(/^#+\s?/, '').trim())
    .filter((l) => l !== '' && !/^[-=*#~_\s]+$/.test(l))
    .join('\n')
  if (!text) return info

  const link = URL.exec(text)
  if (link) info.docLink = link[0].replace(/[.,;]$/, '')

  // Hugo Book: "(Optional, default light)", "(Optional, experimental, default false)".
  const structured = /\(\s*optional\b([^)]*)\)/i.exec(text)
  if (structured) {
    info.optional = true
    if (/experimental/i.test(structured[1])) info.experimental = true
    const def = /default\s+(.+)$/i.exec(structured[1].replace(/^[\s,]+/, ''))
    if (def) {
      const value = parseLiteral(def[1].trim())
      if (value !== undefined && !/^none$/i.test(def[1].trim())) info.default = value
    }
  }
  if (info.default === undefined) {
    const def =
      /\(\s*defaults?\s*(?:to|:|is|=)?\s*([^)]+)\)/i.exec(text) ?? /\bdefaults?\s+(?:to|is)\s+([^\s,;)]+)/i.exec(text) ?? /\bdefault:\s*([^\s,;)]+)/i.exec(text)
    if (def) {
      const value = parseLiteral(def[1].trim().replace(/[.]$/, ''))
      if (value !== undefined) info.default = value
    }
  }
  if (/\bexperimental\b/i.test(text)) info.experimental = true

  if (/(front ?matter|per[- ]page|page level|page params?)/i.test(text) && /(also|can|overwrit|overrid|specify|set|per)/i.test(text)) {
    info.pageOverridable = true
  }

  const options = extractOptions(text)
  if (options) {
    info.options = options.values
    if (options.default !== undefined && info.default === undefined) info.default = options.default
  }

  const description = text
    .replace(/\(\s*optional\b[^)]*\)\s*/i, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
  if (description) info.description = description
  return info
}

/** Enum values from "valid options: a or b", "Accepted values: "x", "y"", "Sets theme: a, b or c". */
export function extractOptions(text: string): { values: Literal[]; default?: Literal } | null {
  for (const line of text.split('\n')) {
    const marker = ENUM_MARKER.exec(line)
    if (marker) {
      const list = splitList(marker[1])
      if (list) return list
    }
  }
  for (const line of text.split('\n')) {
    // "Sets color theme: light, dark or auto." / "Visual style: classic or handDrawn (sketch style)"
    const colon = line.lastIndexOf(':')
    if (colon > 0 && !/https?$/i.test(line.slice(0, colon))) {
      const list = splitList(line.slice(colon + 1))
      if (list) return list
    }
  }
  // A bare list as the whole comment: "debug, info, warning, error".
  if (!text.includes('\n')) {
    const list = splitList(text, 3)
    if (list && /,/.test(text)) return list
  }
  return null
}

function splitList(raw: string, min = 2): { values: Literal[]; default?: Literal } | null {
  // Up to the end of the sentence; drop explanations in parentheses except a "(default)" marker.
  let body = raw.trim()
  const stop = /\.(\s|$)|;/.exec(body)
  if (stop) body = body.slice(0, stop.index)
  let defaultValue: Literal | undefined
  const parts = body.split(/\s*(?:,|\||\bor\b|\/(?!\/))\s*/i).map((p) => p.trim())
  const values: Literal[] = []
  for (const part of parts) {
    if (!part) continue
    let token = part.replace(/^and\s+/i, '')
    if (/\(\s*default\s*\)/i.test(token)) {
      token = token.replace(/\(\s*default\s*\)/i, '').trim()
      const v = parseLiteral(token)
      if (v !== undefined) defaultValue = v
    }
    token = token.replace(/\s*\([^)]*\)\s*/g, '').trim()
    if (!token) continue
    const value = parseLiteral(token)
    if (value === undefined) return null
    const asText = String(value)
    if (typeof value === 'string' && (!TOKEN.test(asText) || asText.length > 30 || /^https?:/.test(asText))) return null
    if (!values.includes(value)) values.push(value)
  }
  if (values.length < min) return null
  return defaultValue === undefined ? { values } : { values, default: defaultValue }
}

/** `"x"`, `'x'`, `true`, `12`, `light` → typed literal; undefined when it is not a single value. */
export function parseLiteral(text: string): Literal | undefined {
  const t = text.trim()
  if (/^"(?:[^"\\]|\\.)*"$/.test(t) || /^'[^']*'$/.test(t) || /^`[^`]*`$/.test(t)) return t.slice(1, -1)
  if (t === 'true' || t === 'false') return t === 'true'
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (/^[\w.\-#%+@!:/]+$/.test(t)) return t
  return undefined
}

// --- Commented-out keys ----------------------------------------------------------------------

export interface CommentedKey {
  /** Key path (table path + key) as written. */
  path: string[]
  /** Parsed example value, when it could be read. */
  value?: unknown
  /** Comment lines directly above plus the trailing comment. */
  comment: string
  line: number
}

/** `# key = value` lines in a TOML file, with the table they belong to. */
export function commentedTomlKeys(text: string): CommentedKey[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: CommentedKey[] = []
  let table: string[] = []
  let commentedTable: string[] | null = null
  let pending: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '') {
      pending = []
      continue
    }
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(trimmed)
    if (header) {
      table = splitDotted(header[1])
      commentedTable = null
      pending = []
      continue
    }
    if (!trimmed.startsWith('#')) {
      pending = []
      continue
    }
    const body = trimmed.replace(/^#+/, '').trim()
    const commentedHeader = /^\[\[?\s*([A-Za-z0-9_.\-"' ]+?)\s*\]\]?\s*$/.exec(body)
    if (commentedHeader) {
      commentedTable = splitDotted(commentedHeader[1])
      pending = []
      continue
    }
    const keyLine = /^([A-Za-z0-9_-]+|"[^"]+"|'[^']+')\s*=\s*(.*)$/.exec(body)
    if (keyLine) {
      let valueText = keyLine[2]
      // A multi-line commented array: keep reading `#` lines until the brackets balance.
      while (bracketDepth(stripTrailingComment(valueText).value) > 0 && i + 1 < lines.length && lines[i + 1].trim().startsWith('#')) {
        i++
        valueText += ' ' + lines[i].trim().replace(/^#+\s?/, '')
      }
      const { value, comment } = stripTrailingComment(valueText)
      const key = keyLine[1].replace(/^["']|["']$/g, '')
      const parsed = parseTomlValue(value)
      out.push({
        path: [...(commentedTable ?? table), key],
        ...(parsed === undefined ? {} : { value: parsed }),
        comment: [...pending, ...(comment ? [comment] : [])].join('\n'),
        line: i + 1,
      })
      pending = []
      continue
    }
    pending.push(body)
  }
  return out
}

/** `# key: value` lines in a YAML file; the indentation of `#` gives the parent. */
export function commentedYamlKeys(text: string): CommentedKey[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: CommentedKey[] = []
  const stack: { indent: number; key: string }[] = []
  let pending: string[] = []
  const parentsFor = (indent: number) => {
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    return stack.map((s) => s.key)
  }
  lines.forEach((line, index) => {
    if (line.trim() === '') {
      pending = []
      return
    }
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      const body = trimmed.replace(/^#+/, '').trim()
      const keyLine = /^([A-Za-z0-9_-]+|"[^"]+"):\s*(.*)$/.exec(body)
      if (keyLine && !/^https?$/i.test(keyLine[1])) {
        const parents = parentsFor(indent)
        const { value, comment } = stripTrailingComment(keyLine[2])
        let parsed: unknown
        try {
          parsed = value.trim() === '' ? undefined : parseYaml(value)
        } catch {
          parsed = undefined
        }
        out.push({
          path: [...parents, keyLine[1].replace(/^"|"$/g, '')],
          ...(parsed === undefined ? {} : { value: parsed }),
          comment: [...pending, ...(comment ? [comment] : [])].join('\n'),
          line: index + 1,
        })
        pending = []
      } else {
        pending.push(body)
      }
      return
    }
    pending = []
    const keyLine = /^(?:-\s+)?([A-Za-z0-9_-]+|"[^"]+"):(\s|$)/.exec(trimmed)
    if (keyLine) {
      parentsFor(indent)
      stack.push({ indent, key: keyLine[1].replace(/^"|"$/g, '') })
    }
  })
  return out
}

/** Section comments (`# -- Theme Options --`) are kept out of key descriptions by the caller. */
function splitDotted(text: string): string[] {
  const parts: string[] = []
  const re = /\s*("([^"]*)"|'([^']*)'|[^.\s]+)\s*(\.|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && m[0] !== '') parts.push(m[2] ?? m[3] ?? m[1])
  return parts
}

function bracketDepth(text: string): number {
  let depth = 0
  let quote: string | null = null
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') depth--
  }
  return depth
}

/** Splits `value # comment`, respecting quotes. */
export function stripTrailingComment(text: string): { value: string; comment: string } {
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\' && quote === '"') i++
      else if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '#') return { value: text.slice(0, i).trim(), comment: text.slice(i + 1).trim() }
  }
  return { value: text.trim(), comment: '' }
}

/** A small, tolerant reader for TOML literal values in comments. */
export function parseTomlValue(text: string): unknown {
  const t = text.trim()
  if (t === '') return undefined
  let pos = 0
  const skip = () => {
    while (pos < t.length && /[\s,]/.test(t[pos])) pos++
  }
  const value = (): unknown => {
    skip()
    const ch = t[pos]
    if (ch === '"') {
      let out = ''
      pos++
      while (pos < t.length && t[pos] !== '"') {
        if (t[pos] === '\\') {
          pos++
          out += t[pos] === 'n' ? '\n' : t[pos]
        } else out += t[pos]
        pos++
      }
      pos++
      return out
    }
    if (ch === "'") {
      const end = t.indexOf("'", pos + 1)
      if (end === -1) throw new Error('unterminated')
      const out = t.slice(pos + 1, end)
      pos = end + 1
      return out
    }
    if (ch === '[') {
      pos++
      const list: unknown[] = []
      for (;;) {
        skip()
        if (pos >= t.length) throw new Error('unterminated')
        if (t[pos] === ']') {
          pos++
          return list
        }
        list.push(value())
      }
    }
    if (ch === '{') {
      pos++
      const obj: Record<string, unknown> = {}
      for (;;) {
        skip()
        if (pos >= t.length) throw new Error('unterminated')
        if (t[pos] === '}') {
          pos++
          return obj
        }
        const key = /^("[^"]*"|'[^']*'|[A-Za-z0-9_-]+)\s*=\s*/.exec(t.slice(pos))
        if (!key) throw new Error('bad key')
        pos += key[0].length
        obj[key[1].replace(/^["']|["']$/g, '')] = value()
      }
    }
    const word = /^[^\s,\]}]+/.exec(t.slice(pos))
    if (!word) throw new Error('bad value')
    pos += word[0].length
    const w = word[0]
    if (w === 'true' || w === 'false') return w === 'true'
    if (/^[-+]?\d[\d_]*(\.\d+)?([eE][-+]?\d+)?$/.test(w)) return Number(w.replace(/_/g, ''))
    return w
  }
  try {
    const result = value()
    skip()
    return pos >= t.length ? result : undefined
  } catch {
    return undefined
  }
}
