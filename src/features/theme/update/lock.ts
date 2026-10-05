// `.hugo-publisher/theme.lock.json`: where the theme came from and a hash of every theme file,
// so the app can tell local edits inside themes/ apart from upstream changes.
import type { SiteFile, ThemeSource } from '../../../lib/api'
import { siteComponent, type ThemeComponent } from '../../../lib/themeSources'

export const LOCK_PATH = '.hugo-publisher/theme.lock.json'

export interface ThemeLock {
  theme: string
  source: { owner: string; repo: string; reference?: string }
  commit?: string
  installedAt: string
  files: Record<string, string>
}

/** Theme files that are not part of the lock (removed by the installer, or editor clutter). */
export function isLockedPath(path: string): boolean {
  return !/^(exampleSite|\.github|node_modules)\//.test(path) && !/(^|\/)\.[^/]+$/.test(path)
}

const TEXT_FILE = /\.(html?|xml|json|txt|rss|toml|ya?ml|md|markdown|css|scss|sass|less|js|mjs|ts|svg|csv|ics|go|mod|sum|license|lock|tmpl|gotmpl|webmanifest)$|(^|\/)(LICENSE|README|CHANGELOG|AUTHORS)[^/]*$/i

export function isTextFile(path: string): boolean {
  return TEXT_FILE.test(path)
}

/**
 * SHA-256 of the text with line endings normalised, so a CRLF checkout is not "edited". The Rust
 * side (`site_hash_files`) computes the same value for text files.
 */
export async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text.replace(/^﻿/, '').replace(/\r\n?/g, '\n'))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return 'sha256:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Hash of a binary file in locks written before content hashing (size only). */
export function sizeHash(size: number): string {
  return `size:${size}`
}

export interface HashedFiles {
  /** `sha256:<hex>` by component-relative path (line endings normalised in text files). */
  hashes: Record<string, string>
  /** Sizes in bytes, for comparing with old `size:` lock entries. */
  sizes: Record<string, number>
}

/** Content hashes of every locked file of a theme component (hashed by the Rust side). */
export async function hashComponent(component: ThemeComponent, listed?: SiteFile[]): Promise<HashedFiles> {
  const files = (listed ?? (await component.list('.'))).filter((f) => f.path && isLockedPath(f.path))
  const hashes: Record<string, string> = {}
  const sizes: Record<string, number> = {}
  // Batches keep each call small enough to stay responsive.
  for (let i = 0; i < files.length; i += 500) {
    for (const h of await component.hash(files.slice(i, i + 500).map((f) => f.path))) {
      hashes[h.path] = `sha256:${h.sha256}`
      sizes[h.path] = h.size
    }
  }
  const sorted = Object.keys(hashes).sort((a, b) => a.localeCompare(b))
  return { hashes: Object.fromEntries(sorted.map((k) => [k, hashes[k]])), sizes }
}

/** Hashes of every locked file under a site-relative theme folder, by theme-relative path. */
export async function hashThemeFolder(root: string): Promise<Record<string, string>> {
  return (await hashComponent(siteComponent(root.split('/').pop() ?? root, root))).hashes
}

export interface TreeDiff {
  added: string[]
  changed: string[]
  removed: string[]
}

/**
 * Files added, changed and removed going from `before` to `after` (path → hash maps). An old
 * `size:N` entry in `before` matches when `afterSizes` gives the same size.
 */
export function compareHashes(before: Record<string, string>, after: Record<string, string>, afterSizes: Record<string, number> = {}): TreeDiff {
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []
  for (const [path, hash] of Object.entries(after)) {
    if (!(path in before)) added.push(path)
    else if (before[path] !== hash && !(before[path].startsWith('size:') && before[path] === sizeHash(afterSizes[path] ?? -1))) changed.push(path)
  }
  for (const path of Object.keys(before)) if (!(path in after)) removed.push(path)
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() }
}

export function parseLock(text: string): ThemeLock | null {
  try {
    const value = JSON.parse(text) as Partial<ThemeLock>
    if (typeof value.theme !== 'string' || !value.source || typeof value.source.owner !== 'string' || typeof value.source.repo !== 'string') return null
    return { ...value, files: value.files ?? {} } as ThemeLock
  } catch {
    return null
  }
}

export function lockText(lock: ThemeLock): string {
  return JSON.stringify(lock, null, 2) + '\n'
}

export function makeLock(theme: string, source: ThemeSource, files: Record<string, string>, now = new Date(), commit?: string | null): ThemeLock {
  return {
    theme,
    source: { owner: source.owner, repo: source.repo, ...(source.reference ? { reference: source.reference } : {}) },
    ...(commit ? { commit } : {}),
    installedAt: now.toISOString(),
    files,
  }
}

/** `owner/repo` from a GitHub URL or `github.com/owner/repo` module path. */
export function parseGithubRepo(text: string): { owner: string; repo: string } | null {
  const m = /(?:^|[/@])(?:www\.)?github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(text.trim())
  if (m) return { owner: m[1], repo: m[2] }
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(text.trim())
  return short ? { owner: short[1], repo: short[2] } : null
}

/** A likely GitHub source for the installed theme, from theme.toml and go.mod. */
export function inferSource(themeToml: Record<string, unknown> | null, modulePath: string | null): { owner: string; repo: string } | null {
  const candidates: unknown[] = [modulePath, themeToml?.homepage, themeToml?.repo, themeToml?.licenselink]
  for (const c of candidates) {
    if (typeof c !== 'string') continue
    const hit = parseGithubRepo(c.replace(/\/v\d+$/, ''))
    if (hit && c.toLowerCase().includes('github.com')) return hit
  }
  return null
}
