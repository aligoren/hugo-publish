// Comparing two builds of the site, and preparing HTML for a readable line diff.

import type { BuildFile } from '../../../lib/api'

export type ChangeKind = 'added' | 'changed' | 'removed'

export interface BuildChange {
  path: string
  kind: ChangeKind
  /** An HTML page (as opposed to CSS, images, feeds…). */
  isPage: boolean
}

export interface BuildDiff {
  added: BuildChange[]
  changed: BuildChange[]
  removed: BuildChange[]
  unchanged: number
}

export function isPagePath(path: string): boolean {
  return /\.html?$/i.test(path)
}

/** Files that can be shown as a text diff. */
export function isTextPath(path: string): boolean {
  return /\.(html?|css|js|mjs|json|xml|txt|svg|md|webmanifest|csv|ics)$/i.test(path)
}

/** The URL path a page file is served at: `posts/a/index.html` → `/posts/a/`. */
export function pageUrlPath(path: string): string {
  if (path === 'index.html') return '/'
  if (path.endsWith('/index.html')) return `/${path.slice(0, -'index.html'.length)}`
  return `/${path}`
}

/** Pages first, then everything else, each by path. */
function byPagesFirst(a: BuildChange, b: BuildChange): number {
  return Number(b.isPage) - Number(a.isPage) || a.path.localeCompare(b.path)
}

/** What differs between the `before` and `after` builds, by path and content hash. */
export function diffBuilds(before: BuildFile[], after: BuildFile[]): BuildDiff {
  const old = new Map(before.map((f) => [f.path, f.hash]))
  const now = new Map(after.map((f) => [f.path, f.hash]))
  const diff: BuildDiff = { added: [], changed: [], removed: [], unchanged: 0 }
  for (const [path, hash] of now) {
    const previous = old.get(path)
    if (previous === undefined) diff.added.push({ path, kind: 'added', isPage: isPagePath(path) })
    else if (previous !== hash) diff.changed.push({ path, kind: 'changed', isPage: isPagePath(path) })
    else diff.unchanged++
  }
  for (const path of old.keys()) {
    if (!now.has(path)) diff.removed.push({ path, kind: 'removed', isPage: isPagePath(path) })
  }
  diff.added.sort(byPagesFirst)
  diff.changed.sort(byPagesFirst)
  diff.removed.sort(byPagesFirst)
  return diff
}

/** Puts each tag of minified HTML on its own line, so a line diff shows what changed. */
export function htmlForDiff(html: string): string {
  return html.replace(/\r\n/g, '\n').replace(/>(?=<)/g, '>\n')
}

export interface DiffWindow {
  before: string
  after: string
  /** Lines left out at the top (the same in both). */
  skipped: number
  /** The middle part was too long and was cut. */
  truncated: boolean
}

/**
 * The part of two texts worth diffing: common lines at the start and end are dropped (keeping
 * `context` lines), and very long middles are cut so the O(n·m) diff stays quick.
 */
export function diffWindow(before: string, after: string, context = 3, maxLines = 1500): DiffWindow {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const from = Math.max(0, start - context)
  let toA = Math.min(a.length, endA + context)
  let toB = Math.min(b.length, endB + context)
  let truncated = false
  if (toA - from > maxLines || toB - from > maxLines) {
    toA = Math.min(toA, from + maxLines)
    toB = Math.min(toB, from + maxLines)
    truncated = true
  }
  return { before: a.slice(from, toA).join('\n'), after: b.slice(from, toB).join('\n'), skipped: from, truncated }
}
