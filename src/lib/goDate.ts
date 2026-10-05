// Go's time.Format for the layout elements a permalink token can hold (`:2006`, `:Jan`, `:02`…).
// Dates are taken as written in the page (wall clock and offset), not converted to local time.
// A date without an offset is read in the site's `timeZone` (an IANA name), as Hugo does: the
// wall clock stays as written; only the offset and the zone name come from the zone.

export interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** Offset from UTC in minutes; null when the date had none (Hugo then uses the site time zone). */
  offset: number | null
  /** Zone name for the `MST` layout (`UTC`, `EST`, `+03`), when known. */
  zone?: string
}

const DATE = /^(-?\d{4,})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?/

/** Parses a front matter / `hugo list` date; null when it is not a date. */
export function parseWallTime(text: string): WallTime | null {
  const m = DATE.exec(text.trim())
  if (!m) return null
  let offset: number | null = null
  if (m[7] === 'Z') offset = 0
  else if (m[7]) {
    const digits = m[7].replace(':', '')
    const sign = digits.startsWith('-') ? -1 : 1
    offset = sign * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)))
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
    offset,
  }
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** 0 = Sunday, like Go's time.Weekday. */
export function weekday(t: WallTime): number {
  return new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay()
}

/** 1-based day of the year. */
export function yearDay(t: WallTime): number {
  return Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(t.year, 0, 1)) / 86_400_000) + 1
}

/** Go's reference time (Mon Jan 2 15:04:05 MST 2006) as Hugo uses it to spot date layouts. */
export const HUGO_REFERENCE: WallTime = { year: 2019, month: 11, day: 9, hour: 23, minute: 1, second: 42, offset: 0 }

function pad(n: number, width: number, fill = '0'): string {
  const s = String(Math.abs(n))
  return (n < 0 ? '-' : '') + (s.length >= width ? s : fill.repeat(width - s.length) + s)
}

function isLower(ch: string | undefined): boolean {
  return ch !== undefined && ch >= 'a' && ch <= 'z'
}

function zone(t: WallTime, colon: boolean, seconds: boolean, z: boolean): string {
  const offset = t.offset ?? 0
  if (z && offset === 0) return 'Z'
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  const hh = pad(Math.floor(abs / 60), 2)
  const mm = pad(abs % 60, 2)
  const sep = colon ? ':' : ''
  return `${sign}${hh}${sep}${mm}${seconds ? `${sep}00` : ''}`
}

/** `time.Time.Format(layout)` for the layout elements Go knows; everything else is copied. */
export function goFormat(t: WallTime, layout: string): string {
  let out = ''
  let i = 0
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12
  const at = (s: string) => layout.startsWith(s, i)
  while (i < layout.length) {
    const ch = layout[i]
    if (ch === 'J' && at('Jan')) {
      if (at('January')) {
        out += MONTH_NAMES[t.month - 1]
        i += 7
        continue
      }
      if (!isLower(layout[i + 3])) {
        out += MONTH_NAMES[t.month - 1].slice(0, 3)
        i += 3
        continue
      }
    } else if (ch === 'M') {
      if (at('Monday')) {
        out += WEEKDAY_NAMES[weekday(t)]
        i += 6
        continue
      }
      if (at('Mon') && !isLower(layout[i + 3])) {
        out += WEEKDAY_NAMES[weekday(t)].slice(0, 3)
        i += 3
        continue
      }
      if (at('MST')) {
        out += t.zone ?? (t.offset === null || t.offset === 0 ? 'UTC' : zone(t, false, false, false))
        i += 3
        continue
      }
    } else if (ch === '0') {
      const next = layout[i + 1]
      if (next !== undefined && next >= '1' && next <= '6') {
        out += [pad(t.month, 2), pad(t.day, 2), pad(hour12, 2), pad(t.minute, 2), pad(t.second, 2), pad(t.year % 100, 2)][Number(next) - 1]
        i += 2
        continue
      }
      if (at('002')) {
        out += pad(yearDay(t), 3)
        i += 3
        continue
      }
    } else if (ch === '1') {
      if (at('15')) {
        out += pad(t.hour, 2)
        i += 2
      } else {
        out += String(t.month)
        i += 1
      }
      continue
    } else if (ch === '2') {
      if (at('2006')) {
        out += pad(t.year, 4)
        i += 4
      } else {
        out += String(t.day)
        i += 1
      }
      continue
    } else if (ch === '_') {
      if (layout[i + 1] === '2') {
        if (layout.startsWith('2006', i + 1)) {
          out += '_' + pad(t.year, 4)
          i += 5
        } else {
          out += pad(t.day, 2, ' ')
          i += 2
        }
        continue
      }
      if (at('__2')) {
        out += pad(yearDay(t), 3, ' ')
        i += 3
        continue
      }
    } else if (ch === '3' || ch === '4' || ch === '5') {
      out += String(ch === '3' ? hour12 : ch === '4' ? t.minute : t.second)
      i += 1
      continue
    } else if (ch === 'P' && layout[i + 1] === 'M') {
      out += t.hour >= 12 ? 'PM' : 'AM'
      i += 2
      continue
    } else if (ch === 'p' && layout[i + 1] === 'm') {
      out += t.hour >= 12 ? 'pm' : 'am'
      i += 2
      continue
    } else if (ch === 'Z') {
      if (at('Z070000')) {
        out += zone(t, false, true, true)
        i += 7
        continue
      }
      if (at('Z0700')) {
        out += zone(t, false, false, true)
        i += 5
        continue
      }
      if (at('Z07')) {
        out += t.offset === 0 || t.offset === null ? 'Z' : zone(t, false, false, false).slice(0, 3)
        i += 3
        continue
      }
    }
    out += ch
    i += 1
  }
  return out
}

// ---- Time zones -------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function formatter(timeZone: string, locale = 'en-US', withName = false): Intl.DateTimeFormat | null {
  const key = `${locale}|${timeZone}|${withName}`
  if (!formatters.has(key)) {
    let made: Intl.DateTimeFormat | null = null
    try {
      made = new Intl.DateTimeFormat(locale, {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        ...(withName ? { timeZoneName: 'short' as const } : {}),
      })
    } catch {
      made = null
    }
    formatters.set(key, made)
  }
  return formatters.get(key) ?? null
}

/** The IANA name Hugo would use for a `timeZone` value; null when unset or unknown. `Local` is this computer's zone. */
export function resolveTimeZone(timeZone: string | null | undefined): string | null {
  const name = timeZone?.trim() ?? ''
  if (name === '') return null
  if (name.toLowerCase() === 'local') return Intl.DateTimeFormat().resolvedOptions().timeZone
  return formatter(name) ? name : null
}

/** Offset (minutes) of a zone at a UTC instant. */
function offsetAt(timeZone: string, utcMs: number): number {
  const parts = formatter(timeZone)!.formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000)
}

/** Offset (minutes) of a zone for a wall-clock time in that zone; null for an unknown zone. */
export function zoneOffset(t: WallTime, timeZone: string): number | null {
  const name = resolveTimeZone(timeZone)
  if (!name) return null
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  // A second pass settles the offset around daylight saving changes.
  const first = offsetAt(name, wall)
  return offsetAt(name, wall - first * 60_000)
}

/** The zone's short name at an instant, as close to Go's (tzdata) names as Intl allows. */
function zoneName(timeZone: string, utcMs: number, offset: number): string {
  if (offset === 0 && /^(etc\/)?(utc|uct|zulu|universal)$/i.test(timeZone)) return 'UTC'
  for (const locale of ['en-US', 'en-GB']) {
    const name =
      formatter(timeZone, locale, true)
        ?.formatToParts(new Date(utcMs))
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    if (name !== '' && !/^GMT[+-]/.test(name)) return name
  }
  // Zones without a letter abbreviation print their offset in tzdata: `+03`, `+0530`.
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return `${sign}${pad(Math.floor(abs / 60), 2)}${abs % 60 === 0 ? '' : pad(abs % 60, 2)}`
}

/**
 * The date read in the site's time zone when it has no offset of its own (Hugo's `timeZone`),
 * else unchanged: dates with an offset keep it, as in Hugo.
 */
export function inTimeZone(t: WallTime, timeZone: string | null | undefined): WallTime {
  if (t.offset !== null) return t
  const name = resolveTimeZone(timeZone)
  if (!name) return t
  const offset = zoneOffset(t, name)
  if (offset === null) return t
  const utc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - offset * 60_000
  return { ...t, offset, zone: zoneName(name, utc, offset) }
}
