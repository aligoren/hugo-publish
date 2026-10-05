// Menu entries that pages declare in their own front matter:
//   menus: main                      (one menu)
//   menus: [main, footer]            (several)
//   menus: { main: { weight: 20, parent: docs, name: Guide, identifier: guide } }
// `menu` is an alias of `menus`. Edits keep the form the page uses when they can and switch to the
// map form only when a field has to be written.
import type { FrontMatterOp } from '../../document/frontMatterOps'
import type { FrontMatterValue } from '../../../lib/frontmatter'
import { isPlainObject, type Tree } from './values'

export type PageMenuForm = 'string' | 'list' | 'map'

/** Fields of a page menu entry this app edits. */
export const PAGE_MENU_FIELDS = ['name', 'weight', 'parent', 'identifier', 'pre', 'post', 'title'] as const

export interface PageMenuEntry {
  /** Content file, site-relative. */
  file: string
  menu: string
  /** The front matter key as written (`menus`, `menu`, `Menus`). */
  key: string
  form: PageMenuForm
  /** Fields set in front matter (map form only). */
  values: Tree
  /** Every menu the page is in, for rewriting the string and list forms. */
  allMenus: string[]
}

/** The front matter key that holds the page's menus, as written. */
export function menusKey(frontMatter: Tree | null): string | undefined {
  if (!frontMatter) return undefined
  const keys = Object.keys(frontMatter)
  return keys.find((k) => k.toLowerCase() === 'menus') ?? keys.find((k) => k.toLowerCase() === 'menu')
}

/** Menu entries of one page. */
export function pageMenuEntries(file: string, frontMatter: Tree | null): PageMenuEntry[] {
  const key = menusKey(frontMatter)
  if (!frontMatter || key === undefined) return []
  const raw = frontMatter[key]
  if (typeof raw === 'string' && raw.trim() !== '') {
    return [{ file, menu: raw.trim(), key, form: 'string', values: {}, allMenus: [raw.trim()] }]
  }
  if (Array.isArray(raw)) {
    const names = raw.filter((m): m is string => typeof m === 'string' && m.trim() !== '').map((m) => m.trim())
    return names.map((menu) => ({ file, menu, key, form: 'list', values: {}, allMenus: names }))
  }
  if (isPlainObject(raw)) {
    const names = Object.keys(raw)
    return names.map((menu) => ({ file, menu, key, form: 'map', values: isPlainObject(raw[menu]) ? { ...raw[menu] } : {}, allMenus: names }))
  }
  return []
}

function clean(values: Tree): Tree {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ''))
}

/**
 * Ops that give the page's entry in `entry.menu` exactly these field values (for the fields in
 * PAGE_MENU_FIELDS; other fields such as `params` are kept).
 */
export function setPageMenuOps(entry: PageMenuEntry, desired: Tree): FrontMatterOp[] {
  const wanted = clean(desired)
  const editable = (k: string) => (PAGE_MENU_FIELDS as readonly string[]).includes(k)
  if (entry.form === 'map') {
    const ops: FrontMatterOp[] = []
    const current = entry.values
    for (const k of Object.keys(current)) {
      if (editable(k) && !(k in wanted)) ops.push({ op: 'remove', path: [entry.key, entry.menu, k] })
    }
    for (const [k, v] of Object.entries(wanted)) {
      if (current[k] !== v) ops.push({ op: 'set', path: [entry.key, entry.menu, k], value: v as FrontMatterValue })
    }
    // Removing the last field would leave `main:` (null); write an empty map instead.
    const kept = Object.keys(current).filter((k) => !editable(k) || k in wanted).length + Object.keys(wanted).length
    if (kept === 0 && ops.length > 0) return [{ op: 'set', path: [entry.key, entry.menu], value: {} }]
    return ops
  }
  if (Object.keys(wanted).length === 0) return []
  // String and list forms hold no fields: rewrite as a map, keeping every menu of the page.
  const map: Record<string, FrontMatterValue> = {}
  for (const menu of entry.allMenus) map[menu] = menu === entry.menu ? (wanted as Record<string, FrontMatterValue>) : {}
  return [{ op: 'set', path: [entry.key], value: map }]
}

/** Ops that add the page to `menu` (with optional fields). */
export function addPageMenuOps(frontMatter: Tree | null, menu: string, fields: Tree = {}): FrontMatterOp[] {
  const wanted = clean(fields) as Record<string, FrontMatterValue>
  const entries = pageMenuEntries('', frontMatter)
  if (entries.some((e) => e.menu === menu)) return []
  const key = menusKey(frontMatter)
  if (key === undefined || entries.length === 0) {
    const name = key ?? 'menus'
    return Object.keys(wanted).length === 0 ? [{ op: 'set', path: [name], value: menu }] : [{ op: 'set', path: [name, menu], value: wanted }]
  }
  const form = entries[0].form
  if (form === 'map') return [{ op: 'set', path: [key, menu], value: wanted }]
  if (Object.keys(wanted).length === 0) return [{ op: 'set', path: [key], value: [...entries[0].allMenus, menu] }]
  const map: Record<string, FrontMatterValue> = {}
  for (const m of entries[0].allMenus) map[m] = {}
  map[menu] = wanted
  return [{ op: 'set', path: [key], value: map }]
}

/** Ops that take the page out of `entry.menu`. */
export function removePageMenuOps(entry: PageMenuEntry): FrontMatterOp[] {
  const rest = entry.allMenus.filter((m) => m !== entry.menu)
  if (rest.length === 0) return [{ op: 'remove', path: [entry.key] }]
  if (entry.form === 'map') return [{ op: 'remove', path: [entry.key, entry.menu] }]
  return [{ op: 'set', path: [entry.key], value: rest.length === 1 ? rest[0] : rest }]
}

/**
 * Language of a content file from its name (`about.tr.md` or Hugo 0.161's `about._language_tr_.md`
 * → `tr`), if it is one of `languages`. For per-language content folders see `contentLanguage`.
 */
export function fileLanguage(path: string, languages: readonly string[]): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const marked = /\._language_([^._]+)_(?=\.|$)/i.exec(name)
  if (marked) return languages.find((l) => l.toLowerCase() === marked[1].toLowerCase()) ?? null
  const parts = name.split('.')
  if (parts.length < 3) return null
  const code = parts[parts.length - 2].toLowerCase()
  return languages.find((l) => l.toLowerCase() === code) ?? null
}
