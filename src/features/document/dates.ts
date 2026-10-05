// Front matter dates that keep the way they are written: a date-only value stays date-only,
// `2026-10-03T00:11:40+03:00` keeps its `+03:00` offset, a value without a zone stays without
// one. The picker edits the wall-clock time in the value's own zone.

export type DateZone =
  /** No zone: Hugo uses the site's `timeZone` (or UTC). */
  | { kind: 'none' }
  | { kind: 'utc'; text: 'Z' | 'z' }
  /** `+03:00`, `+0300` or `+03`. */
  | { kind: 'offset'; minutes: number; style: 'colon' | 'compact' | 'hours' }

export interface DateFormat {
  hasTime: boolean
  /** Between date and time: `T`, `t` or a space. */
  separator: string
  seconds: boolean
  /** Digits after the seconds' decimal point (0 = none). */
  fractionDigits: number
  zone: DateZone
  /** Text between the time and the zone, e.g. a space in `2026-10-03 00:11:40 +0300`. */
  zoneGap: string
}

export interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** Fraction digits as written (without the dot). */
  fraction: string
}

export interface ParsedDate {
  format: DateFormat
  wall: WallTime
}

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:([Tt ])(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?( ?)([Zz]|[+-]\d{2}(?::?\d{2})?)?)?$/

/** Parses an ISO-like date as Hugo writes and reads it; null for anything else. */
export function parseDate(value: string): ParsedDate | null {
  const m = DATE_RE.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, sep, h, mi, s, frac, gap, zoneText] = m
  const wall: WallTime = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: h ? Number(h) : 0,
    minute: mi ? Number(mi) : 0,
    second: s ? Number(s) : 0,
    fraction: frac ?? '',
  }
  if (!validWall(wall)) return null
  const hasTime = sep !== undefined
  if (hasTime && gap && !zoneText) return null
  return {
    wall,
    format: {
      hasTime,
      separator: sep ?? 'T',
      seconds: s !== undefined,
      fractionDigits: frac?.length ?? 0,
      zone: parseZone(zoneText),
      zoneGap: gap ?? '',
    },
  }
}

function parseZone(text: string | undefined): DateZone {
  if (!text) return { kind: 'none' }
  if (text === 'Z' || text === 'z') return { kind: 'utc', text }
  const sign = text.startsWith('-') ? -1 : 1
  const digits = text.slice(1).replace(':', '')
  const hours = Number(digits.slice(0, 2))
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0
  const style = text.includes(':') ? 'colon' : digits.length > 2 ? 'compact' : 'hours'
  return { kind: 'offset', minutes: sign * (hours * 60 + minutes), style }
}

function validWall(w: WallTime): boolean {
  if (w.month < 1 || w.month > 12 || w.day < 1 || w.hour > 23 || w.minute > 59 || w.second > 60) return false
  return w.day <= daysInMonth(w.year, w.month)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

export function formatZone(zone: DateZone): string {
  if (zone.kind === 'none') return ''
  if (zone.kind === 'utc') return zone.text
  const sign = zone.minutes < 0 ? '-' : '+'
  const abs = Math.abs(zone.minutes)
  const hh = pad(Math.floor(abs / 60))
  const mm = pad(abs % 60)
  if (zone.style === 'hours' && abs % 60 === 0) return `${sign}${hh}`
  return zone.style === 'compact' ? `${sign}${hh}${mm}` : `${sign}${hh}:${mm}`
}

/** Writes a wall time in `format`. */
export function formatDate(wall: WallTime, format: DateFormat): string {
  const date = `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`
  if (!format.hasTime) return date
  let time = `${pad(wall.hour)}:${pad(wall.minute)}`
  if (format.seconds) {
    time += `:${pad(wall.second)}`
    if (format.fractionDigits > 0) {
      time += '.' + wall.fraction.padEnd(format.fractionDigits, '0').slice(0, format.fractionDigits)
    }
  }
  const zone = formatZone(format.zone)
  return `${date}${format.separator}${time}${zone ? format.zoneGap + zone : ''}`
}

/** `<input type="date">` or `<input type="datetime-local">`. */
export function inputType(format: DateFormat): 'date' | 'datetime-local' {
  return format.hasTime ? 'datetime-local' : 'date'
}

/** The value for the picker input. */
export function toInputValue(parsed: ParsedDate): string {
  const { wall, format } = parsed
  const date = `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`
  if (!format.hasTime) return date
  return `${date}T${pad(wall.hour)}:${pad(wall.minute)}${format.seconds ? `:${pad(wall.second)}` : ''}`
}

const INPUT_RE = /^(\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/

/**
 * Turns the picker's value back into front matter text in the previous value's format.
 * Returns null when the input is empty or incomplete.
 */
export function fromInputValue(input: string, previous: ParsedDate): string | null {
  const m = INPUT_RE.exec(input)
  if (!m) return null
  const wall: WallTime = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
    second: m[6] ? Number(m[6]) : 0,
    fraction: '',
  }
  if (!validWall(wall)) return null
  const sameTime =
    wall.hour === previous.wall.hour && wall.minute === previous.wall.minute && wall.second === previous.wall.second
  wall.fraction = sameTime ? previous.wall.fraction : ''
  if (!previous.format.seconds) wall.second = 0
  return formatDate(wall, previous.format)
}

/** The wall-clock time of `instant` in `zone` (local time when the value has no zone). */
export function wallTimeIn(zone: DateZone, instant: Date): WallTime {
  if (zone.kind === 'none') {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
      hour: instant.getHours(),
      minute: instant.getMinutes(),
      second: instant.getSeconds(),
      fraction: '',
    }
  }
  const shifted = new Date(instant.getTime() + (zone.kind === 'offset' ? zone.minutes : 0) * 60_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    fraction: '',
  }
}

/** The current time written in `format` (and its zone). */
export function nowInFormat(format: DateFormat, now = new Date()): string {
  return formatDate(wallTimeIn(format.zone, now), format)
}

/**
 * Format for a new date when the file has no date to copy: like Hugo's `.Date` in archetypes,
 * `2026-10-03T00:11:40+03:00` with this computer's offset (`Z` in UTC).
 */
export function defaultDateFormat(now = new Date()): DateFormat {
  const minutes = -now.getTimezoneOffset()
  return {
    hasTime: true,
    separator: 'T',
    seconds: true,
    fractionDigits: 0,
    zone: minutes === 0 ? { kind: 'utc', text: 'Z' } : { kind: 'offset', minutes, style: 'colon' },
    zoneGap: '',
  }
}

/** The format of the first parseable value, else {@link defaultDateFormat}. */
export function templateFormat(values: readonly unknown[], now = new Date()): DateFormat {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const parsed = parseDate(value)
    if (parsed) return { ...parsed.format, fractionDigits: 0 }
  }
  return defaultDateFormat(now)
}

/** `UTC+03:00`, `UTC` or null (no zone). */
export function zoneLabel(zone: DateZone): string | null {
  if (zone.kind === 'none') return null
  if (zone.kind === 'utc' || zone.minutes === 0) return 'UTC'
  return `UTC${formatZone({ ...zone, style: 'colon' })}`
}

/** Looks like a date Hugo would read (used to infer field types). */
export function isDateLike(value: string): boolean {
  return parseDate(value) !== null
}
