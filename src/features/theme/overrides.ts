// Site files that shadow theme files ("overrides"), and site-only files that rely on the theme.
// Hugo ≥0.146 moved layouts/partials → _partials, shortcodes → _shortcodes and _default/x → x;
// both spellings still resolve, so they are compared in their canonical form.
import { canonicalThemePath } from './schema'

export const OVERRIDE_ROOTS = ['layouts', 'assets', 'i18n', 'archetypes'] as const

export type OverrideKind =
  /** The site file replaces the theme file. */
  | 'override'
  /** Theme i18n: Hugo merges the site's keys over the theme's file. */
  | 'merge'
  /** No theme counterpart. */
  | 'addition'

export interface OverrideEntry {
  sitePath: string
  /** The theme file for display (`<theme folder or module>/<file>`), when there is one. */
  themePath: string | null
  /** The theme file relative to the theme component (read it with `ThemeComponent.read`). */
  themeFile: string | null
  kind: OverrideKind
  /** The site file uses the old path form (layouts/partials/…) of a new-form theme file, or the reverse. */
  legacyPath: boolean
  /** For additions: a theme assets folder (hook) the file is added to, e.g. assets/css/extended/. */
  hookFolder?: string
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i + 1)
}

/**
 * Pairs site files with theme files. `siteFiles` are site-relative; `themeFiles` are relative to
 * the theme component; `themeRoot` is its folder (or label) used for `themePath`.
 */
export function findOverrides(siteFiles: string[], themeFiles: string[], themeRoot: string, ignore: string[] = []): OverrideEntry[] {
  const canonicalTheme = new Map<string, string>()
  for (const file of themeFiles) {
    if (!OVERRIDE_ROOTS.some((r) => file.startsWith(r + '/'))) continue
    const canonical = canonicalThemePath(file)
    if (!canonicalTheme.has(canonical) || canonical === file) canonicalTheme.set(canonical, file)
  }
  const themeDirs = new Set(themeFiles.map(dirOf))
  const out: OverrideEntry[] = []
  for (const sitePath of siteFiles) {
    if (!OVERRIDE_ROOTS.some((r) => sitePath.startsWith(r + '/'))) continue
    if (ignore.includes(sitePath)) continue
    const canonical = canonicalThemePath(sitePath)
    const themeFile = canonicalTheme.get(canonical)
    if (themeFile) {
      out.push({
        sitePath,
        themePath: `${themeRoot}/${themeFile}`,
        themeFile,
        kind: sitePath.startsWith('i18n/') ? 'merge' : 'override',
        legacyPath: themeFile !== sitePath,
      })
    } else {
      // An assets folder the theme bundles by pattern (PaperMod's css/extended/*.css) is a hook.
      const dir = dirOf(canonical)
      const hook = dir.startsWith('assets/') && (themeDirs.has(dir) || [...canonicalTheme.keys()].some((k) => dirOf(k) === dir)) ? dir : undefined
      out.push({ sitePath, themePath: null, themeFile: null, kind: 'addition', legacyPath: false, ...(hook ? { hookFolder: hook } : {}) })
    }
  }
  return out.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.sitePath.localeCompare(b.sitePath))
}

function kindOrder(kind: OverrideKind): number {
  return kind === 'override' ? 0 : kind === 'merge' ? 1 : 2
}

export type Comparison = 'identical' | 'lineEndings' | 'whitespace' | 'different'

/** How a site copy differs from the theme file. */
export function compareTexts(site: string, theme: string): Comparison {
  if (site === theme) return 'identical'
  const lf = (t: string) => t.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (lf(site) === lf(theme)) return 'lineEndings'
  const squash = (t: string) => lf(t).replace(/[ \t]+$/gm, '').replace(/\n+$/, '')
  if (squash(site) === squash(theme)) return 'whitespace'
  return 'different'
}

/** An empty theme file, or one with only comments: a hook meant to be filled by the site. */
export function isEmptyHook(text: string): boolean {
  const stripped = text
    .replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
  return stripped === ''
}
