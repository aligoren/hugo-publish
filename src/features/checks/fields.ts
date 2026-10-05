// Reading front matter values for checks, including TOML front matter (read-only, top-level keys).

import { readFrontMatter, splitFrontMatter, type FrontMatterParts } from '../../lib/frontmatter'

export interface ParsedDocument {
  parts: FrontMatterParts
  /** Front matter values; `null` when the file has none or it could not be parsed. */
  fields: Record<string, unknown> | null
  /** The parse error, when the front matter is not valid. */
  error: string | null
  /** 1-based line of the whole file where the body starts. */
  bodyLine: number
}

export function parseDocument(text: string): ParsedDocument {
  const parts = splitFrontMatter(text)
  const head = parts.open + parts.frontMatterText + parts.close
  const bodyLine = countNewlines(head) + 1
  if (parts.format === null) return { parts, fields: null, error: null, bodyLine }
  try {
    const fields = parts.format === 'toml' ? readTomlTopLevel(parts.frontMatterText) : readFrontMatter(parts)
    return { parts, fields, error: null, bodyLine }
  } catch (error) {
    return { parts, fields: null, error: error instanceof Error ? error.message : String(error), bodyLine }
  }
}

function countNewlines(text: string): number {
  let count = 0
  for (const ch of text) if (ch === '\n') count++
  return count
}

/**
 * Top-level `key = value` pairs of a TOML text (stops at the first `[table]`). Strings, booleans,
 * numbers, dates (as written) and single-line arrays of those. Enough for title, description and
 * draft; values it does not understand are left out.
 */
export function readTomlTopLevel(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('[')) break
    const match = /^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const key = unquoteKey(match[1])
    let raw = match[2]
    // Multi-line strings and arrays: gather the following lines.
    for (const fence of ['"""', "'''"]) {
      if (raw.startsWith(fence) && raw.indexOf(fence, 3) === -1) {
        while (i + 1 < lines.length) {
          raw += '\n' + lines[++i]
          if (lines[i].includes(fence)) break
        }
      }
    }
    if (raw.startsWith('[') && !balanced(raw)) {
      while (i + 1 < lines.length && !balanced(raw)) raw += '\n' + lines[++i]
    }
    const value = parseTomlValue(raw.trim())
    if (value !== undefined) result[key] = value
  }
  return result
}

function unquoteKey(key: string): string {
  if (key.startsWith('"')) return parseBasicString(key) ?? key.slice(1, -1)
  if (key.startsWith("'")) return key.slice(1, -1)
  return key
}

function balanced(text: string): boolean {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\' && quote === '"') i++
      else if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '#') {
      const end = text.indexOf('\n', i)
      if (end === -1) break
      i = end
    } else if (ch === '[') depth++
    else if (ch === ']') depth--
  }
  return depth <= 0
}

function parseTomlValue(raw: string): unknown {
  if (raw.startsWith('"""')) {
    const end = raw.indexOf('"""', 3)
    if (end === -1) return undefined
    return parseBasicString(`"${raw.slice(3, end).replace(/^\n/, '').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`)
  }
  if (raw.startsWith("'''")) {
    const end = raw.indexOf("'''", 3)
    return end === -1 ? undefined : raw.slice(3, end).replace(/^\n/, '')
  }
  if (raw.startsWith('"')) {
    const match = /^"(?:[^"\\]|\\.)*"/.exec(raw)
    return match ? parseBasicString(match[0]) : undefined
  }
  if (raw.startsWith("'")) {
    const end = raw.indexOf("'", 1)
    return end === -1 ? undefined : raw.slice(1, end)
  }
  if (raw.startsWith('[')) return parseArray(raw)
  const bare = raw.replace(/\s+#.*$/, '').trim()
  if (bare === 'true') return true
  if (bare === 'false') return false
  if (/^[+-]?\d[\d_]*(\.\d+)?([eE][+-]?\d+)?$/.test(bare)) return Number(bare.replace(/_/g, ''))
  if (/^\d{4}-\d{2}-\d{2}/.test(bare)) return bare
  return undefined
}

function parseArray(raw: string): unknown[] | undefined {
  const inner = raw.slice(1, raw.lastIndexOf(']'))
  const items: unknown[] = []
  const re = /"(?:[^"\\]|\\.)*"|'[^']*'|[^,\s#\]]+|#[^\n]*/g
  for (const match of inner.matchAll(re)) {
    const token = match[0]
    if (token.startsWith('#')) continue
    const value = parseTomlValue(token)
    if (value !== undefined) items.push(value)
  }
  return items
}

function parseBasicString(quoted: string): string | undefined {
  // TOML basic strings use JSON's escapes plus \UXXXXXXXX.
  const json = quoted.replace(/\\U([0-9A-Fa-f]{8})/g, (_, hex: string) => {
    const code = parseInt(hex, 16)
    return code > 0x10ffff ? '' : JSON.stringify(String.fromCodePoint(code)).slice(1, -1)
  })
  try {
    return JSON.parse(json) as string
  } catch {
    return quoted.slice(1, -1)
  }
}
