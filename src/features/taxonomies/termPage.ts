// Term pages: `content/<plural>/<term>/_index.md` gives a term its own title, description and
// text. Hugo finds the page by the folder name, compared the same way as term paths.

import type { ConfigOp } from '../../lib/api'
import {
  deleteField,
  FrontMatterReadOnlyError,
  joinFrontMatter,
  readFrontMatter,
  setField,
  splitFrontMatter,
} from '../../lib/frontmatter'
import { findKey } from './indexer'
import type { TomlDeps } from './termEdit'
import { termSegment, type PathOptions } from './urlize'

const TERM_PAGE = /^_index(\.[A-Za-z0-9-]+)?\.(md|markdown|mdown)$/i

/** Path of a new term page for a term with this segment. */
export function termPagePath(contentDir: string, plural: string, segment: string): string {
  return `${contentDir}/${plural}/${segment}/_index.md`
}

/** Folder of a term page (`content/tags/kitap/_index.md` → `content/tags/kitap`). */
export function termPageFolder(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/**
 * Existing term pages of a taxonomy by term segment. `_index.md` wins over language variants
 * such as `_index.tr.md`.
 */
export function findTermPages(
  paths: readonly string[],
  contentDir: string,
  plural: string,
  options: PathOptions,
): Map<string, string> {
  const prefix = `${contentDir}/${plural}/`.toLowerCase()
  const pages = new Map<string, string>()
  for (const path of paths) {
    if (!path.toLowerCase().startsWith(prefix)) continue
    const rest = path.slice(prefix.length).split('/')
    if (rest.length !== 2 || !TERM_PAGE.test(rest[1])) continue
    const segment = termSegment(rest[0], options)
    const existing = pages.get(segment)
    if (existing === undefined || (rest[1].toLowerCase() === '_index.md' && !existing.toLowerCase().endsWith('/_index.md'))) {
      pages.set(segment, path)
    }
  }
  return pages
}

export interface TermPageFields {
  title: string
  description: string
}

export interface TermPageData {
  fields: TermPageFields
  /** False for JSON front matter, which the app does not edit. */
  editable: boolean
}

function stringField(data: Record<string, unknown>, key: string): string {
  const found = findKey(data, key)
  const value = found === undefined ? undefined : data[found]
  return typeof value === 'string' ? value : ''
}

export async function readTermPage(text: string, deps: Pick<TomlDeps, 'tomlParseText'>): Promise<TermPageData> {
  const parts = splitFrontMatter(text)
  const data = parts.format === 'toml' ? await deps.tomlParseText(parts.frontMatterText) : (readFrontMatter(parts) ?? {})
  return {
    fields: { title: stringField(data, 'title'), description: stringField(data, 'description') },
    editable: parts.format !== 'json',
  }
}

/** Text of a new term page with YAML front matter; empty fields are left out. */
export function newTermPage(fields: TermPageFields, eol: '\n' | '\r\n' = '\n'): string {
  const lines = ['---']
  if (fields.title.trim() !== '') lines.push(`title: ${JSON.stringify(fields.title)}`)
  if (fields.description.trim() !== '') lines.push(`description: ${JSON.stringify(fields.description)}`)
  lines.push('---', '')
  return lines.join(eol)
}

/**
 * The term page with new title and description. Unchanged fields are not touched; a field that
 * is emptied is removed so Hugo falls back to its default (the term itself for the title).
 */
export async function updateTermPage(text: string, fields: TermPageFields, deps: TomlDeps): Promise<string> {
  let parts = splitFrontMatter(text)
  if (parts.format === 'json') throw new FrontMatterReadOnlyError('json')
  if (parts.format === null) {
    // No front matter yet: put a YAML block in front of the existing text.
    const eol = parts.eol === 'crlf' ? '\r\n' : '\n'
    const head = newTermPage(fields, eol)
    return (parts.bom ? '\uFEFF' : '') + head + parts.body
  }
  const current = await readTermPage(text, deps)
  const changed = (['title', 'description'] as const).filter((key) => current.fields[key] !== fields[key])
  if (changed.length === 0) return text

  if (parts.format === 'yaml') {
    const data = readFrontMatter(parts) ?? {}
    for (const name of changed) {
      const key = findKey(data, name) ?? name
      const value = fields[name]
      if (value === '') {
        if (findKey(data, name) !== undefined) parts = deleteField(parts, [key])
      } else {
        parts = setField(parts, [key], value)
      }
    }
    return joinFrontMatter(parts)
  }

  const values = await deps.tomlParseText(parts.frontMatterText)
  const ops: ConfigOp[] = []
  for (const name of changed) {
    const existing = findKey(values, name)
    const value = fields[name]
    if (value !== '') ops.push({ op: 'set', path: [existing ?? name], value })
    else if (existing !== undefined) ops.push({ op: 'remove', path: [existing] })
  }
  if (ops.length === 0) return text
  const frontMatterText = await deps.tomlEditText(parts.frontMatterText, ops)
  return joinFrontMatter({ ...parts, frontMatterText })
}

export interface TermPageMovePlan {
  /** Folder move that keeps a renamed term's page, when it can be done safely. */
  move: { from: string; to: string } | null
  /** Pages of edited terms that stay where they are (no longer matching a term, or ambiguous). */
  kept: string[]
}

/**
 * What happens to the term pages of the terms an edit touches. A rename moves the page folder
 * when exactly one source term has a page, no other term still uses that page and the new name
 * has no page yet. Deleted terms keep their pages (the user decides what to do with them).
 */
export function planTermPageMove(
  edit: { kind: 'rename'; from: readonly string[]; to: string } | { kind: 'delete'; terms: readonly string[] },
  terms: readonly { name: string; segment: string }[],
  pages: ReadonlyMap<string, string>,
  contentDir: string,
  plural: string,
  options: PathOptions,
): TermPageMovePlan {
  const sources = new Set(edit.kind === 'rename' ? edit.from : edit.terms)
  const target = edit.kind === 'rename' ? termSegment(edit.to, options) : null
  const remaining = new Set(terms.filter((t) => !sources.has(t.name)).map((t) => t.segment))
  const affected: string[] = []
  for (const term of terms) {
    if (!sources.has(term.name) || term.segment === target || remaining.has(term.segment)) continue
    const page = pages.get(term.segment)
    if (page !== undefined && !affected.includes(page)) affected.push(page)
  }
  if (target && affected.length === 1 && !pages.has(target)) {
    return { move: { from: termPageFolder(affected[0]), to: `${contentDir}/${plural}/${target}` }, kept: [] }
  }
  return { move: null, kept: affected }
}
