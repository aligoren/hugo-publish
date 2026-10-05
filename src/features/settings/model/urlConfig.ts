// The site's URL settings as the settings view sees them (files with pending changes first, then
// `hugo config`), and what the permalink tester edits: which rule applies to a group of pages and
// where a changed pattern is written.
import type { KeyPath, PageEntry } from '../../../lib/api'
import {
  forHugo,
  matchRule,
  relativeToSite,
  rulesFor,
  sameRule,
  siteUrlConfig,
  targetOf,
  type PermalinkPage,
  type PermalinkRule,
  type SiteUrlConfig,
} from '../../../lib/permalinks'
import type { ValuesOf } from './owner'
import { globalTree, stackFor, type LoadedSource } from './sources'
import { findKey, isPlainObject, lookup, type Tree } from './values'

/** Deep merge of config trees as Hugo does for its config files (keys in any casing, later wins, lists replaced). */
export function mergeTrees(into: Tree, from: Tree): Tree {
  const out: Tree = { ...into }
  for (const [key, value] of Object.entries(from)) {
    const existing = findKey(out, key)
    const same = existing !== undefined && existing.toLowerCase() === key.toLowerCase() ? existing : undefined
    if (same !== undefined && isPlainObject(out[same]) && isPlainObject(value)) out[same] = mergeTrees(out[same] as Tree, value)
    else {
      if (same !== undefined) delete out[same]
      out[same ?? key] = value
    }
  }
  return out
}

/** The config files Hugo merges for `env`, as one tree (pending changes included with `valuesOf`). */
export function mergedFiles(sources: readonly LoadedSource[], env: string | null, valuesOf: ValuesOf = (s) => s.values): Tree {
  return stackFor(sources, env).reduce<Tree>((tree, source) => mergeTrees(tree, globalTree(source, valuesOf(source))), {})
}

/** URL settings from the files, then `hugo config` for keys the files do not set. */
export function urlConfigOf(files: Tree, effective: Tree | null, hugo?: { major: number; minor: number } | null, siteRoot?: string): SiteUrlConfig {
  const config = effective ? siteUrlConfig(files, effective) : siteUrlConfig(files)
  return forHugo(siteRoot ? relativeToSite(config, siteRoot) : config, hugo)
}

export type PermalinkKind = 'page' | 'section' | 'taxonomy' | 'term'
export const PERMALINK_KINDS: PermalinkKind[] = ['page', 'section', 'taxonomy', 'term']

/** Sections (taxonomies for `taxonomy` and `term`) that have pages of each kind. */
export function permalinkGroups(pages: readonly PageEntry[]): Map<PermalinkKind, string[]> {
  const out = new Map<PermalinkKind, string[]>()
  for (const kind of PERMALINK_KINDS) {
    const sections = [...new Set(pages.filter((p) => p.kind === kind && p.section !== '').map((p) => p.section))].sort()
    if (sections.length > 0) out.set(kind, sections)
  }
  return out
}

export interface EditedRule {
  /** The rule that applies to the chosen page now (pending changes included); null = Hugo's default. */
  rule: PermalinkRule | null
  /** Where a new pattern is written; null when it cannot be (array form without a matching entry). */
  writePath: KeyPath | null
  /** The files list patterns as `[[permalinks]]` entries. */
  arrayForm: boolean
}

/** The rule the tester edits for a page, and where its pattern lives in the files. */
export function editedRule(page: PermalinkPage, config: SiteUrlConfig, files: Tree, kind: PermalinkKind, section: string, env: string | null): EditedRule {
  const rule = matchRule(rulesFor(config, page.lang), targetOf(page, env ?? 'production'))
  const inFiles = (r: PermalinkRule) => lookup(files, [...r.base, ...r.keyPath]) !== null
  const permalinks = lookup(files, ['permalinks'])?.value
  const arrayForm = Array.isArray(permalinks)
  if (rule && inFiles(rule)) return { rule, writePath: [...rule.base, ...rule.keyPath], arrayForm }
  return { rule, writePath: arrayForm ? null : ['permalinks', kind, section], arrayForm }
}

/**
 * The pattern for a page with `draft` in place of the edited rule's pattern: pages under the
 * edited rule (or, for a new rule, pages of the group no rule applies to) get the draft.
 */
export function patternWith(
  config: SiteUrlConfig,
  edited: PermalinkRule | null,
  draft: string | null,
  group: { kind: string; section: string },
  env: string | null,
): (page: PermalinkPage) => string | null {
  return (page) => {
    const rule = matchRule(rulesFor(config, page.lang), targetOf(page, env ?? 'production'))
    const inGroup = (page.kind ?? 'page') === group.kind && page.section.toLowerCase() === group.section.toLowerCase()
    if (edited ? sameRule(rule, edited) : rule === null && inGroup) return draft
    return rule?.pattern ?? null
  }
}
