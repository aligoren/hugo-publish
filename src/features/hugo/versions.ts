// Hugo version strings: parsing, comparing and sorting. Hugo uses plain `major.minor.patch`
// (tags carry a leading `v`); themes sometimes write `min_version = "0.41"` or even a number.

import type { HugoInfo } from '../../lib/api'

export type Version = readonly [number, number, number]

/** `0.167.0`, `v0.167.0`, `0.146` (patch 0) or the number `0.41`; null for anything else. */
export function parseVersion(value: unknown): Version | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(value).trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

/** The canonical `x.y.z` form, or null when `value` is not a version. */
export function normalizeVersion(value: unknown): string | null {
  const parsed = parseVersion(value)
  return parsed ? formatVersion(parsed) : null
}

export function formatVersion(version: Version): string {
  return version.join('.')
}

/**
 * Negative when `a` is older than `b`, positive when newer, 0 when equal.
 * Unparseable versions sort before every real one (and equal to each other).
 */
export function compareVersions(a: unknown, b: unknown): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

export function isOlder(a: unknown, b: unknown): boolean {
  return parseVersion(a) !== null && parseVersion(b) !== null && compareVersions(a, b) < 0
}

export function sameVersion(a: unknown, b: unknown): boolean {
  return parseVersion(a) !== null && compareVersions(a, b) === 0
}

/** Newest first; a stable sort, so equal versions keep their order. */
export function sortNewestFirst<T extends { version: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => compareVersions(b.version, a.version))
}

/** `0.167.0` from a detected Hugo. */
export function hugoVersionString(info: HugoInfo): string {
  return `${info.version.major}.${info.version.minor}.${info.version.patch}`
}

/** Compares file paths the way the OS would: separators unified, Windows paths case-insensitive. */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const norm = (p: string) => {
    const unified = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[a-zA-Z]:\//.test(unified) || unified.startsWith('//') ? unified.toLowerCase() : unified
  }
  return norm(a) === norm(b)
}
