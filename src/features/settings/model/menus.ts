// Menus defined in config files: `[[menus.main]]`, the `menu` alias, `config/_default/menus.toml`,
// `menus.tr.toml` and `languages.<lang>.menus`. Pages can add themselves through front matter too;
// those entries are not in config and are only mentioned in the editor.
import type { KeyPath } from '../../../lib/api'
import { listMode, type ListMode, type ListRow } from './lists'
import { resolveKey, type WriteTarget } from './owner'
import { globalTree, stackFor, toFilePath, type LoadedSource } from './sources'
import { findKey, isPlainObject, type Tree } from './values'

export interface MenuList {
  source: LoadedSource
  /** Null for site-wide menus. */
  lang: string | null
  name: string
  /** Path of the entry array inside the file (`['menu', 'main']`, `['main']`…). */
  filePath: KeyPath
  entries: Tree[]
  mode: ListMode
  /** A higher-precedence file defines the same menu, so Hugo does not use this one. */
  overridden: boolean
}

export const MENU_FIELDS = ['name', 'url', 'pageRef', 'weight', 'identifier', 'parent', 'pre', 'post', 'title'] as const

function isMenuKey(key: string): boolean {
  const lower = key.toLowerCase()
  return lower === 'menus' || lower === 'menu'
}

/** Menus Hugo loads for `env` (null: root + `_default`), in precedence order. */
export function findMenus(sources: readonly LoadedSource[], env: string | null): MenuList[] {
  const lists: MenuList[] = []
  for (const source of stackFor(sources, env)) {
    const tree = globalTree(source)
    collect(lists, source, tree, [], null)
    const languagesKey = findKey(tree, 'languages')
    const languages = languagesKey === undefined ? undefined : tree[languagesKey]
    if (isPlainObject(languages)) {
      for (const [lang, settings] of Object.entries(languages)) {
        if (isPlainObject(settings)) collect(lists, source, settings, [languagesKey!, lang], lang)
      }
    }
  }
  // Hugo merges menus by name; the highest-precedence definition of a menu wins.
  const seen = new Set<string>()
  for (let i = lists.length - 1; i >= 0; i--) {
    const id = menuId(lists[i].lang, lists[i].name)
    lists[i].overridden = seen.has(id)
    seen.add(id)
  }
  return lists
}

function collect(out: MenuList[], source: LoadedSource, tree: Tree, base: KeyPath, lang: string | null) {
  for (const key of Object.keys(tree)) {
    const menus = tree[key]
    if (!isMenuKey(key) || !isPlainObject(menus)) continue
    for (const [name, entries] of Object.entries(menus)) {
      if (!Array.isArray(entries)) continue
      const filePath = toFilePath(source, [...base, key, name])
      if (!filePath || filePath.length === 0) continue
      out.push({
        source,
        lang,
        name,
        filePath,
        entries: entries.filter(isPlainObject),
        mode: listMode(source, filePath, true),
        overridden: false,
      })
    }
  }
}

/** The menu a list draft edits, from its path in the merged config; null for other lists. */
export function menuOfPath(globalPath: KeyPath): { lang: string | null; name: string } | null {
  const isMenus = (k: unknown) => typeof k === 'string' && isMenuKey(k)
  if (globalPath.length === 2 && isMenus(globalPath[0])) return { lang: null, name: String(globalPath[1]) }
  if (globalPath.length === 4 && String(globalPath[0]).toLowerCase() === 'languages' && isMenus(globalPath[2])) {
    return { lang: String(globalPath[1]), name: String(globalPath[3]) }
  }
  return null
}

export function menuId(lang: string | null, name: string): string {
  return `${(lang ?? '').toLowerCase()}/${name.toLowerCase()}`
}

/** Where a new menu goes: next to the other menus of that language, else the usual target. */
export function newMenuTarget(sources: readonly LoadedSource[], env: string | null, lang: string | null, name: string): WriteTarget | null {
  const parent = lang ? ['languages', lang, 'menus'] : ['menus']
  const target = resolveKey(sources, env, parent).target
  return target ? { source: target.source, filePath: [...target.filePath, name] } : null
}

/** Weight as Hugo reads it; 0 or missing sorts last. */
function weightOf(row: ListRow): number {
  const w = Number(row.values.weight)
  return Number.isFinite(w) ? w : 0
}

/** Hugo's menu order: by weight (0 last), then name, then identifier. */
export function compareEntries(a: ListRow, b: ListRow): number {
  const wa = weightOf(a)
  const wb = weightOf(b)
  if (wa !== wb) {
    if (wa === 0) return 1
    if (wb === 0) return -1
    return wa - wb
  }
  const name = String(a.values.name ?? '').localeCompare(String(b.values.name ?? ''))
  return name !== 0 ? name : String(a.values.identifier ?? '').localeCompare(String(b.values.identifier ?? ''))
}

/** The key other entries use as `parent`: the identifier, else the name. */
export function entryKey(row: ListRow): string {
  return String(row.values.identifier ?? row.values.name ?? '')
}

function parentOf(row: ListRow): string {
  return String(row.values.parent ?? '')
}

export interface MenuNode {
  row: ListRow
  /** Position in the draft's row array. */
  index: number
  depth: number
}

/** Rows in display order: Hugo's order, children under their parent. */
export function menuTree(rows: readonly ListRow[]): MenuNode[] {
  const keys = new Set(rows.map(entryKey).filter((k) => k !== ''))
  const indexed = rows.map((row, index) => ({ row, index }))
  const children = (parent: string) =>
    indexed
      .filter(({ row }) => (parent === '' ? !keys.has(parentOf(row)) || parentOf(row) === '' : parentOf(row) === parent))
      .sort((a, b) => compareEntries(a.row, b.row))
  const out: MenuNode[] = []
  const visit = (parent: string, depth: number, trail: Set<string>) => {
    for (const item of children(parent)) {
      out.push({ ...item, depth })
      const key = entryKey(item.row)
      if (key !== '' && !trail.has(key)) visit(key, depth + 1, new Set([...trail, key]))
    }
  }
  visit('', 0, new Set())
  // Entries in a parent loop never hang under the root; list them at the end.
  for (const item of indexed) if (!out.some((n) => n.index === item.index)) out.push({ ...item, depth: 0 })
  return out
}

/**
 * Moves the row at `index` one place up or down among its siblings and rewrites the siblings'
 * weights to 10, 20, 30… so the order is explicit.
 */
export function moveEntry(rows: readonly ListRow[], index: number, delta: -1 | 1): ListRow[] {
  const parent = parentOf(rows[index])
  const keys = new Set(rows.map(entryKey).filter((k) => k !== ''))
  const isSibling = (row: ListRow) => (parent === '' || !keys.has(parent) ? parentOf(row) === '' || !keys.has(parentOf(row)) : parentOf(row) === parent)
  const siblings = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => isSibling(row))
    .sort((a, b) => compareEntries(a.row, b.row))
    .map(({ i }) => i)
  const at = siblings.indexOf(index)
  const to = at + delta
  if (at < 0 || to < 0 || to >= siblings.length) return [...rows]
  ;[siblings[at], siblings[to]] = [siblings[to], siblings[at]]
  const next = [...rows]
  siblings.forEach((i, position) => {
    next[i] = { ...next[i], values: { ...next[i].values, weight: (position + 1) * 10 } }
  })
  return next
}

/** The next weight for a new entry: 10 past the heaviest top-level entry. */
export function nextWeight(rows: readonly ListRow[]): number {
  const max = rows.reduce((m, r) => Math.max(m, weightOf(r)), 0)
  return Math.ceil((max + 1) / 10) * 10
}
