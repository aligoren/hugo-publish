// Bulk front matter changes for several content files at once.
// YAML is edited in place (only the touched lines change); TOML goes through toml_edit on the
// Rust side (injected, so this stays testable); JSON front matter is left alone and reported.
import type { ConfigOp } from '../../lib/api'
import { getField, joinFrontMatter, setField, splitFrontMatter } from '../../lib/frontmatter'

export type BulkAction = { kind: 'draft'; draft: boolean } | { kind: 'addTerm'; taxonomy: string; term: string }

export interface TomlTools {
  edit(text: string, ops: ConfigOp[]): Promise<string>
  parse(text: string): Promise<Record<string, unknown>>
}

export interface BulkResult {
  text: string
  /** Why the file was not changed, when it was not. */
  skipped?: 'json' | 'unchanged'
}

/** The term list with `term` added (Turkish-aware, case-insensitive duplicate check). */
export function withTerm(current: unknown, term: string): string[] {
  const list = Array.isArray(current) ? current.map(String) : typeof current === 'string' && current ? [current] : []
  const exists = list.some((t) => t.toLocaleLowerCase('tr') === term.toLocaleLowerCase('tr'))
  return exists ? list : [...list, term]
}

export async function applyBulk(text: string, action: BulkAction, toml: TomlTools): Promise<BulkResult> {
  const parts = splitFrontMatter(text)
  if (parts.format === 'json') return { text, skipped: 'json' }

  let next: string
  if (parts.format === 'toml') {
    let op: ConfigOp
    if (action.kind === 'draft') {
      op = { op: 'set', path: ['draft'], value: action.draft }
    } else {
      const values = await toml.parse(parts.frontMatterText)
      op = { op: 'set', path: [action.taxonomy], value: withTerm(values[action.taxonomy], action.term) }
    }
    next = joinFrontMatter({ ...parts, frontMatterText: await toml.edit(parts.frontMatterText, [op]) })
  } else {
    // YAML, or no front matter yet (a YAML block is created).
    next = joinFrontMatter(
      action.kind === 'draft'
        ? setField(parts, 'draft', action.draft)
        : setField(parts, action.taxonomy, withTerm(getField(parts, action.taxonomy), action.term)),
    )
  }
  return next === text ? { text, skipped: 'unchanged' } : { text: next }
}
