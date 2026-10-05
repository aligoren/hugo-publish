// Hugo's page list prints dates with the file's own offset (`2026-10-04T23:14:42+03:00`) and a
// zero date when unset; compare them as instants, never as text.

const ZERO_YEAR = '0001-01-01'

function instant(date: string): number | null {
  if (date === '' || date.startsWith(ZERO_YEAR)) return null
  const time = Date.parse(date)
  return Number.isNaN(time) ? null : time
}

/** The page is set to appear only after `now` (ISO time). */
export function isFuture(publishDate: string, now: string): boolean {
  const time = instant(publishDate)
  return time !== null && time > Date.parse(now)
}

/** The page's expiry date is before `now`. */
export function isExpired(expiryDate: string, now: string): boolean {
  const time = instant(expiryDate)
  return time !== null && time < Date.parse(now)
}
