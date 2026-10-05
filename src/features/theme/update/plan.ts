// What a theme update means for this site: changed theme files, overrides that drifted from
// the theme, parameters added or removed, hooks the site relies on that disappear.
import { compareTexts, type OverrideEntry } from '../overrides'
import type { ScanResult } from '../scan/scanner'
import { canonicalThemePath } from '../schema'
import type { I18nData, I18nValue } from '../textOverrides'
import { merge3 } from './merge3'

export type DriftKind =
  /** The theme file did not change: nothing to do. */
  | 'unchanged'
  /** The site copy is now the same as the new theme file: it can be deleted. */
  | 'nowIdentical'
  /** Theme changes merged cleanly into the site copy. */
  | 'merged'
  /** Theme and site changed the same lines. */
  | 'conflict'
  /** The theme no longer has this file: the site copy is now a site-only file. */
  | 'themeRemoved'
  /** The theme folder was edited locally, so the original is unknown: compare by hand. */
  | 'noBase'

export interface Drift {
  kind: DriftKind
  /** Proposed new text of the site copy (merged, possibly with conflict markers). */
  merged?: string
  conflicts?: number
}

/**
 * How one override is affected. `base` is the theme file the copy was made from (the current
 * theme file when the theme folder has no local edits), `theirs` the file in the new version.
 */
export function classifyDrift(input: { base: string | null; theirs: string | null; ours: string; baseReliable: boolean }): Drift {
  const { base, theirs, ours } = input
  if (theirs === null) return { kind: 'themeRemoved' }
  const identical = (x: string, y: string) => {
    const c = compareTexts(x, y)
    return c === 'identical' || c === 'lineEndings'
  }
  if (base !== null && identical(base, theirs)) return { kind: 'unchanged' }
  if (identical(ours, theirs)) return { kind: 'nowIdentical' }
  if (base === null || !input.baseReliable) return { kind: 'noBase' }
  const result = merge3(base, ours, theirs)
  return result.conflicts === 0 ? { kind: 'merged', merged: result.text, conflicts: 0 } : { kind: 'conflict', merged: result.text, conflicts: result.conflicts }
}

export interface ParamDiff {
  added: string[]
  removed: string[]
}

function siteParamKeys(scan: ScanResult): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of scan.params.values()) {
    if (p.key.includes('[]')) continue
    out.set(p.key.toLowerCase(), p.key)
  }
  return out
}

/** Params (any scope) the new theme reads that the old one did not, and the reverse. */
export function paramDiff(before: ScanResult, after: ScanResult): ParamDiff {
  const a = siteParamKeys(before)
  const b = siteParamKeys(after)
  return {
    added: [...b].filter(([k]) => !a.has(k)).map(([, key]) => key).sort((x, y) => x.localeCompare(y)),
    removed: [...a].filter(([k]) => !b.has(k)).map(([, key]) => key).sort((x, y) => x.localeCompare(y)),
  }
}

/** i18n keys and partials of the theme that site files depend on and the new version lacks. */
export interface LostHook {
  sitePath: string
  /** The theme folder or file the site file relied on. */
  hook: string
}

/**
 * Site files that rely on the theme: additions in a theme folder the theme bundles (CSS hooks),
 * and overrides of theme files (often empty hooks) that the new version no longer has.
 */
export function lostHooks(entries: OverrideEntry[], newThemeFiles: string[]): LostHook[] {
  const canonical = new Set(newThemeFiles.map(canonicalThemePath))
  const dirs = new Set([...canonical].map((f) => f.slice(0, f.lastIndexOf('/') + 1)))
  const out: LostHook[] = []
  for (const entry of entries) {
    if (entry.kind === 'addition' && entry.hookFolder && !dirs.has(entry.hookFolder)) out.push({ sitePath: entry.sitePath, hook: entry.hookFolder })
    if (entry.kind === 'override' && entry.themePath) {
      const rel = canonicalThemePath(entry.sitePath)
      if (!canonical.has(rel)) out.push({ sitePath: entry.sitePath, hook: rel })
    }
  }
  return out
}

/** Site param keys that the old theme used and the new one will not (lower-case compare). */
export function paramsBecomingUnused(unknownBefore: string[], unknownAfter: string[]): string[] {
  const before = new Set(unknownBefore.map((k) => k.toLowerCase()))
  return unknownAfter.filter((k) => !before.has(k.toLowerCase()))
}

/** What to do with one override when applying the update. */
export type OverrideAction = 'keep' | 'merge' | 'theirs' | 'edit' | 'delete'

/** The safe default: delete copies that became identical, take clean merges, keep the rest. */
export function defaultAction(kind: DriftKind): OverrideAction {
  if (kind === 'nowIdentical') return 'delete'
  if (kind === 'merged') return 'merge'
  return 'keep'
}

/** A key the site's i18n file sets whose theme text changed or went away in the new version. */
export interface I18nKeyDrift {
  key: string
  /** The site's text. */
  site: I18nValue
  /** Theme text before and after the update (null when the key is missing). */
  before: I18nValue | null
  after: I18nValue | null
}

export interface I18nDrift {
  /** Site i18n file (merged by Hugo over the theme's file of the same language). */
  sitePath: string
  language: string
  /** Keys the site overrides whose theme text changed: check that your text still fits. */
  changed: I18nKeyDrift[]
  /** Keys the site overrides that the theme no longer has: possibly unused now. */
  removed: I18nKeyDrift[]
}

function sameValue(a: I18nValue, b: I18nValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Compares the theme's texts for the keys a site i18n file overrides. */
export function i18nDrift(sitePath: string, language: string, site: I18nData, before: I18nData | null, after: I18nData | null): I18nDrift {
  const changed: I18nKeyDrift[] = []
  const removed: I18nKeyDrift[] = []
  const lookup = (data: I18nData | null, key: string): I18nValue | null => {
    if (!data) return null
    if (key in data.entries) return data.entries[key]
    const found = Object.keys(data.entries).find((k) => k.toLowerCase() === key.toLowerCase())
    return found === undefined ? null : data.entries[found]
  }
  for (const [key, value] of Object.entries(site.entries)) {
    const old = lookup(before, key)
    const next = lookup(after, key)
    if (old === null) continue
    if (next === null) removed.push({ key, site: value, before: old, after: null })
    else if (!sameValue(old, next)) changed.push({ key, site: value, before: old, after: next })
  }
  const byKey = (a: I18nKeyDrift, b: I18nKeyDrift) => a.key.localeCompare(b.key)
  return { sitePath, language, changed: changed.sort(byKey), removed: removed.sort(byKey) }
}
