import { describe, expect, it } from 'vitest'

import { parseDate } from './dates'
import { dateInstant, displayDate, postStatus } from './postStatus'

const fields = (values: Record<string, unknown>) => (name: string) => {
  const key = Object.keys(values).find((k) => k.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : values[key]
}

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0)

describe('postStatus', () => {
  it('is a draft whenever draft is on', () => {
    expect(postStatus(fields({ draft: true, date: '2099-01-01' }), NOW)).toBe('draft')
    expect(postStatus(fields({ draft: 'true' }), NOW)).toBe('draft')
  })

  it('is scheduled while the publish date (or else the date) is ahead', () => {
    expect(postStatus(fields({ date: '2026-10-04T15:30:00+03:00' }), NOW)).toBe('scheduled')
    expect(postStatus(fields({ date: '2026-10-04T14:30:00+03:00' }), NOW)).toBe('published')
    expect(postStatus(fields({ date: '2020-01-01', publishdate: '2026-10-05T00:00:00Z' }), NOW)).toBe('scheduled')
    expect(postStatus(fields({ date: '2099-01-01', publishDate: '2020-01-01T00:00:00Z' }), NOW)).toBe('published')
  })

  it('is published without dates or with dates it cannot read', () => {
    expect(postStatus(fields({}), NOW)).toBe('published')
    expect(postStatus(fields({ draft: false, date: '{{ .Date }}' }), NOW)).toBe('published')
  })
})

describe('dateInstant', () => {
  it('reads the zone of the value', () => {
    expect(dateInstant(parseDate('2026-10-04T15:00:00+03:00')!)).toBe(Date.UTC(2026, 9, 4, 12))
    expect(dateInstant(parseDate('2026-10-04T12:00:00Z')!)).toBe(Date.UTC(2026, 9, 4, 12))
    expect(dateInstant(parseDate('2026-10-04')!)).toBe(new Date(2026, 9, 4).getTime())
  })
})

describe('displayDate', () => {
  it('shows the calendar date as written, in the reader’s language', () => {
    expect(displayDate('2026-10-03T00:11:40+03:00', 'en')).toBe('Oct 3, 2026')
    expect(displayDate('2026-10-03', 'tr')).toBe('3 Eki 2026')
    expect(displayDate('dün', 'tr')).toBe('dün')
    expect(displayDate('', 'en')).toBeNull()
    expect(displayDate(undefined, 'en')).toBeNull()
  })
})
