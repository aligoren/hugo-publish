// Taxonomy terms used across the site, for chip autocomplete. Every content file's front matter
// is read once and cached by modification time, so reopening the form costs nothing.

import { api, type ContentFile } from '../../lib/api'
import { readFrontMatter, splitFrontMatter } from '../../lib/frontmatter'
import { mapLimited } from './asyncPool'
import { findKey } from './frontMatterOps'

export interface IndexDeps {
  readText(path: string): Promise<{ text: string }>
  tomlParseText(text: string): Promise<{ values: Record<string, unknown> }>
}

interface Entry {
  modifiedMs: number
  values: Record<string, unknown> | null
}

const sites = new Map<string, Map<string, Entry>>()

async function parseFile(path: string, deps: IndexDeps): Promise<Record<string, unknown> | null> {
  try {
    const { text } = await deps.readText(path)
    const parts = splitFrontMatter(text)
    if (parts.format === 'toml') return (await deps.tomlParseText(parts.frontMatterText)).values
    return readFrontMatter(parts)
  } catch {
    return null
  }
}

/** Parsed front matter of every content file (cached per site by modification time). */
export async function indexFrontMatter(
  siteRoot: string,
  files: readonly ContentFile[],
  deps: IndexDeps = api,
): Promise<Map<string, Record<string, unknown> | null>> {
  let cache = sites.get(siteRoot)
  if (!cache) {
    cache = new Map()
    sites.set(siteRoot, cache)
  }
  const store = cache
  const stale = files.filter((file) => store.get(file.path)?.modifiedMs !== file.modifiedMs)
  await mapLimited(stale, 8, async (file) => {
    store.set(file.path, { modifiedMs: file.modifiedMs, values: await parseFile(file.path, deps) })
  })
  const result = new Map<string, Record<string, unknown> | null>()
  for (const file of files) result.set(file.path, store.get(file.path)?.values ?? null)
  return result
}

/** Updates one file's entry after it was saved, without reading it again. */
export function updateIndexedFile(siteRoot: string, path: string, values: Record<string, unknown> | null): void {
  const cache = sites.get(siteRoot)
  const entry = cache?.get(path)
  if (cache && entry) cache.set(path, { ...entry, values })
}

export interface TermCount {
  term: string
  count: number
}

/** Terms per taxonomy, most used first. */
export function collectTerms(
  frontMatters: Iterable<Record<string, unknown> | null>,
  taxonomies: readonly string[],
): Record<string, TermCount[]> {
  const counts: Record<string, Map<string, number>> = {}
  for (const taxonomy of taxonomies) counts[taxonomy] = new Map()
  for (const values of frontMatters) {
    if (!values) continue
    for (const taxonomy of taxonomies) {
      const key = findKey(values, taxonomy)
      if (key === undefined) continue
      const raw = values[key]
      const terms = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
      for (const term of terms) {
        if (typeof term !== 'string' || term.trim() === '') continue
        counts[taxonomy].set(term, (counts[taxonomy].get(term) ?? 0) + 1)
      }
    }
  }
  const result: Record<string, TermCount[]> = {}
  for (const [taxonomy, map] of Object.entries(counts)) {
    result[taxonomy] = [...map]
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
  }
  return result
}

/** Suggestions for a chip input: matching terms not chosen yet, most used first. */
export function suggestTerms(terms: readonly TermCount[], query: string, chosen: readonly string[], limit = 8): TermCount[] {
  const q = query.trim().toLocaleLowerCase()
  const taken = new Set(chosen.map((c) => c.toLocaleLowerCase()))
  const matches = terms.filter((t) => !taken.has(t.term.toLocaleLowerCase()) && (q === '' || t.term.toLocaleLowerCase().includes(q)))
  if (q) matches.sort((a, b) => Number(!a.term.toLocaleLowerCase().startsWith(q)) - Number(!b.term.toLocaleLowerCase().startsWith(q)))
  return matches.slice(0, limit)
}

/** For tests. */
export function clearTermIndex(): void {
  sites.clear()
}
