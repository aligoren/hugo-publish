// Nested front matter values (maps, lists of maps) are edited as the exact text they are
// written as: the snippet is cut out of the front matter, edited, and put back in place. The
// result is checked before it is used: it must parse and leave every other key as it was.

import { splitLinesKeepEol } from '../../lib/eol'
import { fileLineSeparator, readFrontMatter, type FrontMatterParts } from '../../lib/frontmatter'
import { deepEqual } from './frontMatterOps'
import { tomlKeyLines } from './tomlText'

/** Unquotes a YAML key as written at the start of a line. */
function yamlLineKey(line: string): string | null {
  if (line === '' || /^[\s#-]/.test(line) || line.startsWith('---') || line.startsWith('...')) return null
  const quoted = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)')\s*:(?:\s|$)/.exec(line)
  if (quoted) return quoted[1] !== undefined ? quoted[1].replace(/\\(.)/g, '$1') : quoted[2].replace(/''/g, "'")
  const plain = /^([^:#]+?)\s*:(?:\s|$)/.exec(line)
  return plain ? plain[1] : null
}

/**
 * Lines `[start, end)` holding a top-level YAML key and its nested lines, with comment lines
 * right above it. Null when the key is not found.
 */
export function yamlKeyLines(text: string, key: string): { start: number; end: number } | null {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
  if (lines[lines.length - 1] === '') lines.pop()
  const startKey = lines.findIndex((line) => yamlLineKey(line) === key)
  if (startKey === -1) return null
  const continues = (line: string) => /^\s/.test(line) || line === '-' || line.startsWith('- ')
  let end = startKey + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() === '' || continues(line)) {
      end++
      continue
    }
    if (line.startsWith('#')) {
      // A comment at column 0 belongs to this key only when nested lines follow it.
      let next = end
      while (next < lines.length && (lines[next].trim() === '' || lines[next].startsWith('#'))) next++
      if (next < lines.length && continues(lines[next])) {
        end = next
        continue
      }
    }
    break
  }
  while (end > startKey + 1 && (lines[end - 1].trim() === '' || lines[end - 1].trimStart().startsWith('#'))) end--
  let start = startKey
  while (start > 0 && lines[start - 1].startsWith('#')) start--
  return { start, end }
}

function keyLines(parts: FrontMatterParts, key: string): { start: number; end: number } | null {
  if (parts.format === 'yaml') return yamlKeyLines(parts.frontMatterText, key)
  if (parts.format === 'toml') return tomlKeyLines(parts.frontMatterText, key)
  return null
}

/** The text of a top-level key (LF line breaks, no final line break), or null. */
export function extractSnippet(parts: FrontMatterParts, key: string): string | null {
  const range = keyLines(parts, key)
  if (!range) return null
  return splitLinesKeepEol(parts.frontMatterText)
    .slice(range.start, range.end)
    .map((line) => line.text)
    .join('\n')
}

/**
 * Front matter text with the lines of `key` replaced by `snippet`. New lines use the file's
 * line ending; every other line keeps its bytes. Null when the key cannot be located.
 */
export function replaceSnippet(parts: FrontMatterParts, key: string, snippet: string): string | null {
  const range = keyLines(parts, key)
  if (!range) return null
  const lines = splitLinesKeepEol(parts.frontMatterText)
  const sep = fileLineSeparator(parts)
  const replaced = lines.slice(range.start, range.end)
  const lastEol = replaced.length > 0 ? replaced[replaced.length - 1].eol : sep
  const body = snippet.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  const inserted = body === '' ? [] : body.split('\n')
  const before = lines.slice(0, range.start).map((l) => l.text + l.eol).join('')
  const after = lines.slice(range.end).map((l) => l.text + l.eol).join('')
  const middle = inserted.map((line, i) => line + (i === inserted.length - 1 ? lastEol || (after ? sep : '') : sep)).join('')
  return before + middle + after
}

export type SnippetCheck =
  | { ok: true; frontMatterText: string; value: unknown }
  | { ok: false; reason: 'notFound' | 'syntax' | 'otherKeys'; detail?: string }

export interface SnippetParsers {
  /** Parses TOML front matter text into values (the Rust side). */
  parseToml(text: string): Promise<Record<string, unknown>>
}

async function parseFrontMatterText(
  parts: FrontMatterParts,
  text: string,
  parsers: SnippetParsers,
): Promise<Record<string, unknown>> {
  if (parts.format === 'toml') return parsers.parseToml(text)
  return readFrontMatter({ ...parts, frontMatterText: text }) ?? {}
}

/**
 * Replaces the lines of `key` with `snippet` and checks the result: it must parse, and every
 * other top-level key must keep its value (the snippet can only change `key`, or remove it).
 */
export async function applySnippet(
  parts: FrontMatterParts,
  key: string,
  snippet: string,
  parsers: SnippetParsers,
): Promise<SnippetCheck> {
  const text = replaceSnippet(parts, key, snippet)
  if (text === null) return { ok: false, reason: 'notFound' }
  let before: Record<string, unknown>
  let after: Record<string, unknown>
  try {
    before = await parseFrontMatterText(parts, parts.frontMatterText, parsers)
  } catch (error) {
    return { ok: false, reason: 'syntax', detail: errorText(error) }
  }
  try {
    after = await parseFrontMatterText(parts, text, parsers)
  } catch (error) {
    return { ok: false, reason: 'syntax', detail: errorText(error) }
  }
  const others = (values: Record<string, unknown>) => Object.keys(values).filter((k) => k !== key)
  const changed =
    others(before).length !== others(after).length || others(before).some((k) => !(k in after) || !deepEqual(before[k], after[k]))
  if (changed) return { ok: false, reason: 'otherKeys' }
  return { ok: true, frontMatterText: text, value: after[key] }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}
