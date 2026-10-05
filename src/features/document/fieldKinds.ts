// Which control the form uses for a front matter value.

import { isDateLike } from './dates'
import { isRecord } from './frontMatterOps'

export type FieldKind =
  | 'string'
  /** Multi-line or long text. */
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'stringList'
  /** A string holding an image path (`cover`, `image`, `thumbnail`, …). */
  | 'image'
  /** A list of image paths (`images`). */
  | 'imageList'
  /** A map of simple values (`cover: {image, alt}`), shown as a group of fields. */
  | 'group'
  /** Anything deeper: edited as YAML/TOML text. */
  | 'snippet'
  /** `key:` with no value. */
  | 'empty'

/** Keys whose values are images. */
export const IMAGE_KEY = /image|cover|thumbnail/i

export function isImageKey(key: string): boolean {
  return IMAGE_KEY.test(key)
}

function isSimple(value: unknown): boolean {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Infers the control for a value. `key` is the last key of the value's path. */
export function inferFieldKind(key: string, value: unknown): FieldKind {
  if (value === null || value === undefined) return 'empty'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') {
    if (isImageKey(key)) return 'image'
    if (isDateLike(value)) return 'date'
    return value.includes('\n') || value.length > 100 ? 'text' : 'string'
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) return isImageKey(key) ? 'imageList' : 'stringList'
    return 'snippet'
  }
  if (isRecord(value)) {
    const entries = Object.values(value)
    return entries.length > 0 && entries.length <= 12 && entries.every(isSimple) ? 'group' : 'snippet'
  }
  return 'snippet'
}

/** The empty value a new field of a kind starts with. */
export function emptyValue(kind: 'string' | 'number' | 'boolean' | 'stringList'): string | number | boolean | string[] {
  switch (kind) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'stringList':
      return []
    default:
      return ''
  }
}

/** Keys the form has its own fields for (lower case). Taxonomies are added per site. */
export const KNOWN_KEYS = new Set([
  'title',
  'description',
  'date',
  'lastmod',
  'publishdate',
  'expirydate',
  'draft',
  'slug',
  'weight',
  'aliases',
  'summary',
])

/** Sub-keys of `build` and `sitemap` handled by the form's checkboxes. */
export const MANAGED_SUBKEYS: Record<string, string[]> = { build: ['list'], sitemap: ['disable'] }

/**
 * Keys shown in "Other fields": everything without its own field. `build` and `sitemap` are
 * listed only when they hold more than the sub-keys the checkboxes manage.
 */
export function otherKeys(values: Record<string, unknown>, taxonomies: readonly string[], imageKeys: readonly string[] = []): string[] {
  const taken = new Set([...KNOWN_KEYS, ...taxonomies.map((t) => t.toLowerCase()), ...imageKeys.map((k) => k.toLowerCase())])
  return Object.keys(values).filter((key) => {
    const lower = key.toLowerCase()
    if (taken.has(lower)) return false
    const managed = MANAGED_SUBKEYS[lower]
    if (managed) {
      const value = values[key]
      return !(isRecord(value) && Object.keys(value).every((k) => managed.includes(k.toLowerCase())))
    }
    return true
  })
}

/** Top-level keys that are images or hold one (`cover: {image: …}`), shown with the main fields. */
export function imageFieldKeys(values: Record<string, unknown>): string[] {
  return Object.keys(values).filter((key) => {
    if (!isImageKey(key)) return false
    const kind = inferFieldKind(key, values[key])
    return kind === 'image' || kind === 'imageList' || kind === 'group'
  })
}
