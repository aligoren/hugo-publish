import { describe, expect, it, vi } from 'vitest'

import { convertToUtc, countOffsets, dateKeys, offsetDates, offsetLabel, regionalTimeZone, toUtc } from './dateZones'

describe('dateKeys', () => {
  it("covers Hugo's date aliases by default", () => {
    expect(dateKeys(null)).toEqual(['date', 'lastmod', 'publishdate', 'expirydate', 'pubdate', 'published', 'modified', 'unpublishdate'])
  })

  it("follows the site's [frontmatter] lists, leaving out special sources", () => {
    // `hugo config` lower-cases keys.
    const values = {
      frontmatter: {
        date: ['created', ':filename', ':default'],
        lastmod: [':git', ':fileModTime', 'updated'],
        publishdate: 'released',
        expirydate: [],
      },
    }
    expect(dateKeys(values)).toEqual([
      'date',
      'lastmod',
      'publishdate',
      'expirydate',
      'created',
      'pubdate',
      'published',
      'modified',
      'updated',
      'released',
    ])
    expect(dateKeys({ FrontMatter: 'odd' })).toEqual(dateKeys(null))
  })
})

describe('toUtc', () => {
  it('keeps the instant and the precision', () => {
    expect(toUtc('2026-10-03T00:11:40+03:00')).toBe('2026-10-02T21:11:40Z')
    expect(toUtc('2026-01-01T10:00:00.250-05:30')).toBe('2026-01-01T15:30:00.250Z')
    expect(toUtc('2026-03-01T01:30+0300')).toBe('2026-02-28T22:30Z')
    expect(toUtc('2026-10-03 08:00:00 +03')).toBe('2026-10-03 05:00:00Z')
    expect(toUtc('2026-10-03')).toBeNull()
    expect(toUtc('2026-10-03T00:00:00Z')).toBeNull()
    expect(toUtc('soon')).toBeNull()
  })
})

describe('offsetDates', () => {
  it('finds offset dates in YAML, TOML and JSON, any key case', () => {
    expect(offsetDates('---\ntitle: x\ndate: 2026-10-03T00:11:40+03:00\nLastMod: "2026-10-04T09:00:00+03:00"\npublishDate: 2026-10-03\n---\n')).toEqual([
      { key: 'date', value: '2026-10-03T00:11:40+03:00', minutes: 180 },
      { key: 'LastMod', value: '2026-10-04T09:00:00+03:00', minutes: 180 },
    ])
    expect(offsetDates('+++\ndate = 2026-10-03T00:11:40-04:00\n+++\n')).toEqual([{ key: 'date', value: '2026-10-03T00:11:40-04:00', minutes: -240 }])
    expect(offsetDates('{\n "date": "2026-10-03T00:11:40+01:00"\n}\n')).toHaveLength(1)
    expect(offsetDates('---\ndate: 2026-10-03T00:11:40Z\nexpiryDate: 2026-10-03T00:11:40+00:00\n---\n')).toEqual([])
    expect(offsetDates('no front matter')).toEqual([])
  })

  it('finds aliases and configured keys, never other fields', () => {
    const text =
      '---\ntitle: "2026-10-03T00:11:40+03:00"\npubdate: 2026-10-03T00:11:40+03:00\nModified: 2026-10-04T08:00:00+03:00\nupdated: 2026-10-05T08:00:00+03:00\npublished: true\n---\n'
    expect(offsetDates(text).map((d) => d.key)).toEqual(['pubdate', 'Modified'])
    const keys = dateKeys({ frontmatter: { lastmod: ['updated', ':git'] } })
    expect(offsetDates(text, keys).map((d) => d.key)).toEqual(['pubdate', 'Modified', 'updated'])
  })

  it('counts pages per offset', () => {
    const files = [
      { path: 'a', dates: [{ key: 'date', value: '', minutes: 180 }, { key: 'lastmod', value: '', minutes: 180 }] },
      { path: 'b', dates: [{ key: 'date', value: '', minutes: 180 }] },
      { path: 'c', dates: [{ key: 'date', value: '', minutes: -330 }] },
    ]
    expect(countOffsets(files)).toEqual([
      { label: '+03:00', pages: 2 },
      { label: '-05:30', pages: 1 },
    ])
    expect(offsetLabel(-330)).toBe('-05:30')
  })
})

describe('convertToUtc', () => {
  it('rewrites YAML dates and leaves every other byte alone', async () => {
    const text = '---\r\ntitle: "Başlık" # yorum\r\ndate: 2026-10-03T00:11:40+03:00\r\nlastmod: \'2026-10-04T09:00:00+03:00\'\r\ntags: [a, b]\r\n---\r\nGövde\r\n'
    const result = await convertToUtc(text)
    expect(result).toEqual({
      kind: 'converted',
      text: '---\r\ntitle: "Başlık" # yorum\r\ndate: 2026-10-02T21:11:40Z\r\nlastmod: \'2026-10-04T06:00:00Z\'\r\ntags: [a, b]\r\n---\r\nGövde\r\n',
      changes: [
        { key: 'date', before: '2026-10-03T00:11:40+03:00', after: '2026-10-02T21:11:40Z' },
        { key: 'lastmod', before: '2026-10-04T09:00:00+03:00', after: '2026-10-04T06:00:00Z' },
      ],
    })
  })

  it('rewrites aliases and configured keys only', async () => {
    const text = '---\ntitle: x\npublished: 2026-10-03T00:11:40+03:00\ncreated: 2026-10-01T10:00:00+03:00\nnote: 2026-10-01T10:00:00+03:00\n---\n'
    const keys = dateKeys({ frontmatter: { date: ['created', ':default'] } })
    const result = await convertToUtc(text, undefined, keys)
    expect(result).toEqual({
      kind: 'converted',
      text: '---\ntitle: x\npublished: 2026-10-02T21:11:40Z\ncreated: 2026-10-01T07:00:00Z\nnote: 2026-10-01T10:00:00+03:00\n---\n',
      changes: [
        { key: 'created', before: '2026-10-01T10:00:00+03:00', after: '2026-10-01T07:00:00Z' },
        { key: 'published', before: '2026-10-03T00:11:40+03:00', after: '2026-10-02T21:11:40Z' },
      ],
    })
  })

  it('sends TOML through toml_edit and skips JSON and clean files', async () => {
    const toml = { tomlEditText: vi.fn(async (text: string) => text.replace('2026-10-03T00:11:40+03:00', '2026-10-02T21:11:40Z')) }
    const result = await convertToUtc('+++\ntitle = "x"\ndate = 2026-10-03T00:11:40+03:00\n+++\nbody\n', toml)
    expect(toml.tomlEditText).toHaveBeenCalledWith('title = "x"\ndate = 2026-10-03T00:11:40+03:00\n', [
      { op: 'set', path: ['date'], value: '2026-10-02T21:11:40Z' },
    ])
    expect(result).toMatchObject({ kind: 'converted', text: '+++\ntitle = "x"\ndate = 2026-10-02T21:11:40Z\n+++\nbody\n' })
    expect(await convertToUtc('{\n "date": "2026-10-03T00:11:40+01:00"\n}\n')).toEqual({ kind: 'readOnly' })
    expect(await convertToUtc('---\ndate: 2026-10-03\n---\n')).toEqual({ kind: 'unchanged' })
  })
})

describe('regionalTimeZone', () => {
  it('reports region names, not UTC', () => {
    expect(regionalTimeZone({ timezone: 'Europe/Istanbul' })).toBe('Europe/Istanbul')
    expect(regionalTimeZone({ timezone: 'UTC' })).toBeNull()
    expect(regionalTimeZone({ timezone: 'Etc/UTC' })).toBeNull()
    expect(regionalTimeZone({ timezone: '' })).toBeNull()
    expect(regionalTimeZone({})).toBeNull()
  })
})
