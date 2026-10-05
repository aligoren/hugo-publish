// Reordering and re-parenting menu entries from config and front matter together. Every operation
// rewrites the weights of the affected siblings to 10, 20, 30… and sets `parent`; a parent without
// an identifier gets one, so children do not depend on its label.
import { slugify } from '../../../lib/slug'
import { deepEqual, type Tree } from './values'

export interface MenuItem {
  /** Stable id for the UI (`c:3` for config row 3, `p:content/about.md` for a page). */
  id: string
  /** Fields as written. */
  values: Tree
  /** Name Hugo uses when `name` is not set (a page's title). */
  fallbackName?: string
  /** Weight Hugo uses when `weight` is not set (a page's own weight). */
  fallbackWeight?: number
}

export type DropPosition = 'before' | 'after' | 'inside'

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/** What children write as `parent`: the identifier, else the name. */
export function itemKey(item: MenuItem): string {
  return str(item.values.identifier) || str(item.values.name) || str(item.fallbackName)
}

export function itemName(item: MenuItem): string {
  return str(item.values.name) || str(item.fallbackName)
}

function weightOf(item: MenuItem): number {
  const w = Number(item.values.weight ?? item.fallbackWeight)
  return Number.isFinite(w) ? w : 0
}

/** Hugo's menu order: by weight (0 last), then name, then identifier. */
export function compareItems(a: MenuItem, b: MenuItem): number {
  const wa = weightOf(a)
  const wb = weightOf(b)
  if (wa !== wb) {
    if (wa === 0) return 1
    if (wb === 0) return -1
    return wa - wb
  }
  return itemName(a).localeCompare(itemName(b)) || str(a.values.identifier).localeCompare(str(b.values.identifier))
}

/** The parent key an item hangs under ('' for the top level or an unknown parent). */
export function parentKey(items: readonly MenuItem[], item: MenuItem): string {
  const parent = str(item.values.parent)
  if (parent === '') return ''
  return items.some((i) => i !== item && itemKey(i) === parent) ? parent : ''
}

export interface TreeNode {
  item: MenuItem
  depth: number
}

/** Items in display order: Hugo's order, children under their parent; loops end up at the top level. */
export function itemTree(items: readonly MenuItem[]): TreeNode[] {
  const out: TreeNode[] = []
  const placed = new Set<string>()
  const visit = (parent: string, depth: number, trail: Set<string>) => {
    const children = items.filter((i) => !placed.has(i.id) && parentKey(items, i) === parent).sort(compareItems)
    for (const item of children) {
      if (placed.has(item.id)) continue
      placed.add(item.id)
      out.push({ item, depth })
      const key = itemKey(item)
      if (key !== '' && !trail.has(key)) visit(key, depth + 1, new Set([...trail, key]))
    }
  }
  visit('', 0, new Set())
  for (const item of items) if (!placed.has(item.id)) out.push({ item, depth: 0 })
  return out
}

function isDescendant(items: readonly MenuItem[], ancestor: MenuItem, candidate: MenuItem): boolean {
  const key = itemKey(ancestor)
  let current: MenuItem | undefined = candidate
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = parentKey(items, current)
    if (parent === '') return false
    if (parent === key) return true
    current = items.find((i) => itemKey(i) === parent)
  }
  return false
}

function withValues(item: MenuItem, changes: Tree): MenuItem {
  const values = { ...item.values }
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || v === '') delete values[k]
    else values[k] = v
  }
  return { ...item, values }
}

/** A new identifier from the item's name, unique among the keys in use. */
export function newIdentifier(items: readonly MenuItem[], item: MenuItem): string {
  const base = slugify(itemName(item)) || 'entry'
  const taken = new Set(items.filter((i) => i !== item).map(itemKey))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/** Gives `target` an identifier if it has none and points its children at it. */
function ensureIdentifier(items: MenuItem[], targetId: string): { items: MenuItem[]; key: string } {
  const target = items.find((i) => i.id === targetId)!
  if (str(target.values.identifier) !== '') return { items, key: itemKey(target) }
  const oldKey = itemKey(target)
  const id = newIdentifier(items, target)
  const next = items.map((i) => {
    if (i.id === targetId) return withValues(i, { identifier: id })
    if (oldKey !== '' && str(i.values.parent) === oldKey) return withValues(i, { parent: id })
    return i
  })
  return { items: next, key: id }
}

function reweigh(items: MenuItem[], ordered: readonly string[]): MenuItem[] {
  return items.map((i) => {
    const at = ordered.indexOf(i.id)
    return at < 0 ? i : withValues(i, { weight: (at + 1) * 10 })
  })
}

function siblingsOf(items: readonly MenuItem[], parent: string, except: string): MenuItem[] {
  return items.filter((i) => i.id !== except && parentKey(items, i) === parent).sort(compareItems)
}

/** Moves `dragId` before or after `targetId`, or into it as its last child. Null when not allowed. */
export function dropItem(items: readonly MenuItem[], dragId: string, targetId: string, position: DropPosition): MenuItem[] | null {
  const drag = items.find((i) => i.id === dragId)
  const target = items.find((i) => i.id === targetId)
  if (!drag || !target || drag === target || isDescendant(items, drag, target)) return null
  let next = [...items]
  let parent: string
  if (position === 'inside') {
    const ensured = ensureIdentifier(next, targetId)
    next = ensured.items
    parent = ensured.key
  } else {
    parent = parentKey(items, target)
  }
  next = next.map((i) => (i.id === dragId ? withValues(i, { parent: parent === '' ? undefined : parent }) : i))
  const siblings = siblingsOf(next, parent, dragId).map((i) => i.id)
  const at = position === 'inside' ? siblings.length : siblings.indexOf(targetId) + (position === 'after' ? 1 : 0)
  siblings.splice(at, 0, dragId)
  return reweigh(next, siblings)
}

/** One place up (-1) or down (+1) among its siblings. */
export function moveItem(items: readonly MenuItem[], id: string, delta: -1 | 1): MenuItem[] | null {
  const item = items.find((i) => i.id === id)
  if (!item) return null
  const siblings = siblingsOf(items, parentKey(items, item), '').map((i) => i.id)
  const at = siblings.indexOf(id)
  const to = at + delta
  if (at < 0 || to < 0 || to >= siblings.length) return null
  ;[siblings[at], siblings[to]] = [siblings[to], siblings[at]]
  return reweigh([...items], siblings)
}

/** Makes the item the last child of the sibling above it. */
export function indentItem(items: readonly MenuItem[], id: string): MenuItem[] | null {
  const item = items.find((i) => i.id === id)
  if (!item) return null
  const siblings = siblingsOf(items, parentKey(items, item), '')
  const at = siblings.findIndex((i) => i.id === id)
  if (at <= 0) return null
  return dropItem(items, id, siblings[at - 1].id, 'inside')
}

/** Moves the item out of its parent, right after it. */
export function outdentItem(items: readonly MenuItem[], id: string): MenuItem[] | null {
  const item = items.find((i) => i.id === id)
  if (!item) return null
  const parent = parentKey(items, item)
  if (parent === '') return null
  const parentItem = items.find((i) => i !== item && itemKey(i) === parent)
  return parentItem ? dropItem(items, id, parentItem.id, 'after') : null
}

/** Items whose values differ between two versions of the list. */
export function changedItems(before: readonly MenuItem[], after: readonly MenuItem[]): MenuItem[] {
  return after.filter((item) => {
    const old = before.find((b) => b.id === item.id)
    return !old || !deepEqual(old.values, item.values)
  })
}
