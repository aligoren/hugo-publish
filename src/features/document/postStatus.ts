// What the header's status pill and the meta line under the title show: whether a post is a
// draft, scheduled (its publish date is still ahead) or published, and its date for people.

import { parseDate, type ParsedDate } from './dates'
import { isDraftValue } from './frontMatterFields'

export type PostStatus = 'draft' | 'scheduled' | 'published'

/** The moment a front matter date stands for (wall time in its own zone; local time when it has none). */
export function dateInstant(parsed: ParsedDate): number {
  const { year, month, day, hour, minute, second } = parsed.wall
  const zone = parsed.format.zone
  if (zone.kind === 'none') return new Date(year, month - 1, day, hour, minute, second).getTime()
  const utc = Date.UTC(year, month - 1, day, hour, minute, second)
  return zone.kind === 'offset' ? utc - zone.minutes * 60_000 : utc
}

/**
 * Hugo publishes a page once its `publishDate` (or else its `date`) has passed, unless it is a
 * draft. `get` reads a top-level field without regard to case.
 */
export function postStatus(get: (name: string) => unknown, now = Date.now()): PostStatus {
  if (isDraftValue(get('draft'))) return 'draft'
  for (const name of ['publishDate', 'pubdate', 'published', 'date']) {
    const value = get(name)
    if (typeof value !== 'string' || value === '') continue
    const parsed = parseDate(value)
    if (!parsed) return 'published'
    return dateInstant(parsed) > now ? 'scheduled' : 'published'
  }
  return 'published'
}

/** The calendar date of a front matter value as people read it ("3 Oct 2026"), or the text itself. */
export function displayDate(value: unknown, language: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = parseDate(value)
  if (!parsed) return value
  const { year, month, day } = parsed.wall
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(year, month - 1, day))
  } catch {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
}
