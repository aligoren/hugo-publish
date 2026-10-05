import { describe, expect, it } from 'vitest'

import {
  defaultDateFormat,
  formatDate,
  fromInputValue,
  inputType,
  nowInFormat,
  parseDate,
  templateFormat,
  toInputValue,
  zoneLabel,
} from './dates'

describe('parseDate / formatDate', () => {
  it.each([
    '2026-10-03T00:11:40+03:00',
    '2026-10-03',
    '2026-10-03T00:11:40Z',
    '2026-10-03T00:11:40',
    '2026-10-03 00:11:40',
    '2026-10-03T00:11',
    '2026-10-03T00:11:40.123+03:00',
    '2026-10-03T00:11:40-0500',
    '2026-10-03 00:11:40 +0300',
    '2026-10-03T00:11:40+05',
  ])('round-trips %s', (value) => {
    const parsed = parseDate(value)
    expect(parsed).not.toBeNull()
    expect(formatDate(parsed!.wall, parsed!.format)).toBe(value)
  })

  it.each(['{{ .Date }}', '3 Oct 2026', '2026-13-01', '2026-02-30', '2026-10-03T25:00:00', ''])('rejects %s', (value) => {
    expect(parseDate(value)).toBeNull()
  })

  it('reads the offset in minutes', () => {
    expect(parseDate('2026-10-03T00:11:40+03:00')!.format.zone).toEqual({ kind: 'offset', minutes: 180, style: 'colon' })
    expect(parseDate('2026-10-03T00:11:40-05:30')!.format.zone).toEqual({ kind: 'offset', minutes: -330, style: 'colon' })
  })
})

describe('picker values keep the file format', () => {
  it('keeps the offset when the time changes', () => {
    const parsed = parseDate('2026-10-03T00:11:40+03:00')!
    expect(inputType(parsed.format)).toBe('datetime-local')
    expect(toInputValue(parsed)).toBe('2026-10-03T00:11:40')
    expect(fromInputValue('2026-10-05T10:30:00', parsed)).toBe('2026-10-05T10:30:00+03:00')
    // Browsers drop the seconds when they are zero; the file keeps writing them.
    expect(fromInputValue('2026-10-05T10:30', parsed)).toBe('2026-10-05T10:30:00+03:00')
  })

  it('keeps a date-only value date-only', () => {
    const parsed = parseDate('2026-10-03')!
    expect(inputType(parsed.format)).toBe('date')
    expect(toInputValue(parsed)).toBe('2026-10-03')
    expect(fromInputValue('2026-11-20', parsed)).toBe('2026-11-20')
  })

  it('keeps no-zone, space separator and missing seconds', () => {
    expect(fromInputValue('2026-10-04T08:05', parseDate('2026-10-03 00:11')!)).toBe('2026-10-04 08:05')
    expect(fromInputValue('2026-10-04T08:05:09', parseDate('2026-10-03T00:11:40')!)).toBe('2026-10-04T08:05:09')
    expect(fromInputValue('2026-10-04T08:05:09', parseDate('2026-10-03 00:11:40 +0300')!)).toBe('2026-10-04 08:05:09 +0300')
  })

  it('keeps fractional seconds only while the time is unchanged', () => {
    const parsed = parseDate('2026-10-03T00:11:40.250Z')!
    expect(fromInputValue('2026-10-04T00:11:40', parsed)).toBe('2026-10-04T00:11:40.250Z')
    expect(fromInputValue('2026-10-04T00:12:40', parsed)).toBe('2026-10-04T00:12:40.000Z')
  })

  it('ignores incomplete input', () => {
    expect(fromInputValue('', parseDate('2026-10-03')!)).toBeNull()
    expect(fromInputValue('2026-02-31', parseDate('2026-10-03')!)).toBeNull()
  })
})

describe('now and defaults', () => {
  const instant = new Date('2026-10-03T21:11:40Z')

  it('writes now in the value’s own zone', () => {
    expect(nowInFormat(parseDate('2026-01-01T00:00:00+03:00')!.format, instant)).toBe('2026-10-04T00:11:40+03:00')
    expect(nowInFormat(parseDate('2026-01-01T00:00:00Z')!.format, instant)).toBe('2026-10-03T21:11:40Z')
    expect(nowInFormat(parseDate('2026-01-01T00:00-05:00')!.format, instant)).toBe('2026-10-03T16:11-05:00')
  })

  it('uses Hugo’s archetype format when there is nothing to copy', () => {
    const format = defaultDateFormat(instant)
    expect(format.hasTime).toBe(true)
    expect(format.seconds).toBe(true)
    const offset = -instant.getTimezoneOffset()
    expect(format.zone).toEqual(offset === 0 ? { kind: 'utc', text: 'Z' } : { kind: 'offset', minutes: offset, style: 'colon' })
  })

  it('copies the format of the first parseable date', () => {
    const format = templateFormat([undefined, '{{ .Date }}', '2026-10-03'])
    expect(format.hasTime).toBe(false)
    expect(templateFormat(['2026-10-03T00:11:40.5+03:00']).fractionDigits).toBe(0)
  })

  it('labels zones', () => {
    expect(zoneLabel(parseDate('2026-10-03T00:11:40+03:00')!.format.zone)).toBe('UTC+03:00')
    expect(zoneLabel(parseDate('2026-10-03T00:11:40Z')!.format.zone)).toBe('UTC')
    expect(zoneLabel(parseDate('2026-10-03T00:11:40')!.format.zone)).toBeNull()
  })
})
