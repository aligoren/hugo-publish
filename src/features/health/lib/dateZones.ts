// Front matter dates written with a fixed UTC offset (`+03:00`) hint at where the author lives.
// This finds them and rewrites them as the same instant in UTC (`Z`), keeping each value's
// precision and everything else in the front matter byte for byte.

import { joinFrontMatter, splitFrontMatter } from '../../../lib/frontmatter'
import { parseDocument } from '../../checks'
import { formatDate, parseDate, wallTimeIn, type ParsedDate } from '../../document/dates'
import { applyFrontMatterOps, findKey, type FrontMatterOp, type TomlTextApi } from '../../document/frontMatterOps'

/** The front matter dates Hugo reads. */
export const DATE_KEYS = ['date', 'lastmod', 'publishDate', 'expiryDate'] as const

type DateField = (typeof DATE_KEYS)[number]

/**
 * Hugo's default `[frontmatter]` settings: for each page date, the front matter keys (and
 * special `:` sources) it is read from, in order. `:default` in a site's list stands for these.
 */
export const DEFAULT_DATE_SOURCES: Record<DateField, readonly string[]> = {
  date: ['date', 'publishdate', 'pubdate', 'published', 'lastmod', 'modified'],
  lastmod: [':git', 'lastmod', 'modified', 'date', 'publishdate', 'pubdate', 'published'],
  publishDate: ['publishdate', 'pubdate', 'published', 'date'],
  expiryDate: ['expirydate', 'unpublishdate'],
}

function sourceList(value: unknown): string[] | null {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return null
}

/**
 * The front matter keys the site reads dates from, lower case: the `frontmatter` lists of the
 * effective config (`hugo config` lower-cases keys), with `:default` expanded and Hugo's defaults
 * for dates it does not set. Special sources such as `:git`, `:fileModTime` and `:filename` are
 * not keys and are left out; the four standard names are always included.
 */
export function dateKeys(values: Record<string, unknown> | null | undefined): string[] {
  const raw = values ? values[Object.keys(values).find((k) => k.toLowerCase() === 'frontmatter') ?? ''] : undefined
  const config = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const keys = new Set<string>(DATE_KEYS.map((k) => k.toLowerCase()))
  for (const field of DATE_KEYS) {
    const configured = Object.keys(config).find((k) => k.toLowerCase() === field.toLowerCase())
    const sources = (configured === undefined ? null : sourceList(config[configured])) ?? [...DEFAULT_DATE_SOURCES[field]]
    for (const source of sources) {
      const name = source.trim().toLowerCase()
      if (name === ':default') for (const d of DEFAULT_DATE_SOURCES[field]) keys.add(d)
      else keys.add(name)
    }
  }
  return [...keys].filter((k) => k !== '' && !k.startsWith(':'))
}

export interface OffsetDate {
  /** The key as written. */
  key: string
  value: string
  /** Offset from UTC in minutes (never 0). */
  minutes: number
}

/** `+03:00`, `-05:30`. */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/**
 * Top-level date fields of a content file written with a non-zero UTC offset. `keys` are the
 * front matter keys dates are read from (see {@link dateKeys}); any case matches.
 */
export function offsetDates(text: string, keys: readonly string[] = dateKeys(null)): OffsetDate[] {
  const fields = parseDocument(text).fields
  if (!fields) return []
  const found: OffsetDate[] = []
  const seen = new Set<string>()
  for (const name of keys) {
    const key = findKey(fields, name)
    const value = key === undefined ? undefined : fields[key]
    if (key === undefined || seen.has(key) || typeof value !== 'string') continue
    seen.add(key)
    const parsed = parseDate(value)
    if (parsed && parsed.format.zone.kind === 'offset' && parsed.format.zone.minutes !== 0) {
      found.push({ key, value, minutes: parsed.format.zone.minutes })
    }
  }
  return found
}

/** The same instant in UTC, written with the value's own precision: `…T00:11:40+03:00` → `…T21:11:40Z`. */
export function toUtc(value: string): string | null {
  const parsed: ParsedDate | null = parseDate(value)
  if (!parsed || parsed.format.zone.kind !== 'offset') return null
  const { wall } = parsed
  const instant = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - parsed.format.zone.minutes * 60_000
  const utc = { ...wallTimeIn({ kind: 'utc', text: 'Z' }, new Date(instant)), fraction: wall.fraction }
  return formatDate(utc, { ...parsed.format, zone: { kind: 'utc', text: 'Z' }, zoneGap: '' })
}

export type Conversion =
  | { kind: 'converted'; text: string; changes: { key: string; before: string; after: string }[] }
  | { kind: 'unchanged' }
  /** JSON front matter is read-only in the app. */
  | { kind: 'readOnly' }

/** Rewrites a file's offset dates (under `keys`, see {@link dateKeys}) in UTC; TOML goes through `toml_edit`. */
export async function convertToUtc(text: string, toml?: TomlTextApi, keys?: readonly string[]): Promise<Conversion> {
  const dates = offsetDates(text, keys)
  if (dates.length === 0) return { kind: 'unchanged' }
  const parts = splitFrontMatter(text)
  if (parts.format === 'json') return { kind: 'readOnly' }
  const changes = dates.flatMap((d) => {
    const after = toUtc(d.value)
    return after ? [{ key: d.key, before: d.value, after }] : []
  })
  const ops: FrontMatterOp[] = changes.map((c) => ({ op: 'set', path: [c.key], value: c.after, datetime: true }))
  const next = await applyFrontMatterOps(parts, ops, toml)
  const result = joinFrontMatter(next)
  return result === text ? { kind: 'unchanged' } : { kind: 'converted', text: result, changes }
}

/** Pages per offset, most used first. */
export function countOffsets(files: { path: string; dates: OffsetDate[] }[]): { label: string; pages: number }[] {
  const counts = new Map<string, number>()
  for (const file of files) {
    for (const label of new Set(file.dates.map((d) => offsetLabel(d.minutes)))) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].map(([label, pages]) => ({ label, pages })).sort((a, b) => b.pages - a.pages || a.label.localeCompare(b.label))
}

/** A `timeZone` setting that names a region (anything but UTC). */
export function regionalTimeZone(values: Record<string, unknown> | null | undefined): string | null {
  const zone = values?.timezone
  if (typeof zone !== 'string' || zone.trim() === '') return null
  return /^(utc|etc\/utc|etc\/gmt|gmt|z|universal|etc\/universal|zulu)$/i.test(zone.trim()) ? null : zone.trim()
}
