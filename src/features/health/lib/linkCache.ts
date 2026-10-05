// External link results kept for a day in localStorage, so re-opening the view does not
// contact every site again. Storage can be missing or full; then nothing is cached.

import type { LinkCheck } from '../../../lib/api'

export const LINK_CACHE_KEY = 'hugo-publisher.health.links'
export const LINK_CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** Oldest entries are dropped beyond this many URLs. */
const MAX_ENTRIES = 5000

export interface CachedCheck extends LinkCheck {
  checkedAt: number
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readAll(): Record<string, CachedCheck> {
  try {
    const raw = storage()?.getItem(LINK_CACHE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, CachedCheck>) : {}
  } catch {
    return {}
  }
}

/** Results younger than a day, by URL. */
export function loadCachedChecks(now = Date.now()): Map<string, CachedCheck> {
  const fresh = new Map<string, CachedCheck>()
  for (const [url, entry] of Object.entries(readAll())) {
    if (entry && typeof entry.checkedAt === 'number' && now - entry.checkedAt < LINK_CACHE_TTL_MS) fresh.set(url, entry)
  }
  return fresh
}

/** Adds results to the cache (and drops expired ones). */
export function saveCachedChecks(checks: CachedCheck[], now = Date.now()): void {
  try {
    const all = { ...readAll() }
    for (const check of checks) all[check.url] = check
    const kept = Object.values(all)
      .filter((e) => e && typeof e.checkedAt === 'number' && now - e.checkedAt < LINK_CACHE_TTL_MS)
      .sort((a, b) => b.checkedAt - a.checkedAt)
      .slice(0, MAX_ENTRIES)
    storage()?.setItem(LINK_CACHE_KEY, JSON.stringify(Object.fromEntries(kept.map((e) => [e.url, e]))))
  } catch {
    // Full or unavailable storage: results simply are not cached.
  }
}

export function clearCachedChecks(): void {
  try {
    storage()?.removeItem(LINK_CACHE_KEY)
  } catch {
    // Nothing to clear.
  }
}
