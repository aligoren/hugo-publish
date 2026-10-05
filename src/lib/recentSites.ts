// Recently opened sites, kept in the app's own store (not in any site).
import { LazyStore } from '@tauri-apps/plugin-store'

export interface RecentSite {
  path: string
  name: string
  openedMs: number
}

const KEY = 'recentSites'
const MAX_RECENT = 12

const store = new LazyStore('app.json', { defaults: {}, autoSave: 200 })

/** Puts `site` first, removes an older entry for the same folder, keeps at most `max`. */
export function withRecent(list: RecentSite[], site: RecentSite, max = MAX_RECENT): RecentSite[] {
  const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
  return [site, ...list.filter((s) => !samePath(s.path, site.path))].slice(0, max)
}

export async function loadRecentSites(): Promise<RecentSite[]> {
  try {
    const list = await store.get<RecentSite[]>(KEY)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export async function rememberSite(path: string, name: string): Promise<RecentSite[]> {
  const list = withRecent(await loadRecentSites(), { path, name, openedMs: Date.now() })
  try {
    await store.set(KEY, list)
  } catch {
    // Not persisted; the list still works for this session.
  }
  return list
}

export async function forgetSite(path: string): Promise<RecentSite[]> {
  const list = (await loadRecentSites()).filter((s) => s.path !== path)
  try {
    await store.set(KEY, list)
  } catch {
    // Not persisted.
  }
  return list
}
