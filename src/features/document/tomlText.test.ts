import { describe, expect, it } from 'vitest'

import { bareNewTomlDates, isTomlDatetime, locateTomlScalar, scanToml, tomlKeyLines } from './tomlText'

const FM = [
  '# TOML yorumu',
  'title = "TOML örneği"',
  "summary = 'tek tırnak'",
  'date = 2026-10-03T00:11:40+03:00',
  'draft = false',
  'tags = ["toml", "örnek"]',
  'menu = [',
  '  "main",',
  '  "footer",',
  ']',
  '',
  '# parametreler',
  '[params]',
  '  toc = true',
  '  note = """',
  '[not a table]',
  '"""',
  '',
  '[[params.links]]',
  '  name = "a"',
  '',
  '[other]',
  '  x = 1',
  '',
].join('\n')

describe('scanToml', () => {
  it('classifies lines, following multi-line values', () => {
    const kinds = scanToml(FM).map((l) => l.kind)
    expect(kinds.slice(0, 11)).toEqual([
      'comment',
      'keyValue',
      'keyValue',
      'keyValue',
      'keyValue',
      'keyValue',
      'keyValue',
      'continuation',
      'continuation',
      'continuation',
      'blank',
    ])
    // The `[not a table]` line is inside a multi-line string.
    expect(kinds[15]).toBe('continuation')
    expect(kinds[12]).toBe('header')
    expect(kinds[18]).toBe('arrayHeader')
  })
})

describe('locateTomlScalar', () => {
  it('finds values and their style', () => {
    expect(locateTomlScalar(FM, ['date'])).toMatchObject({ raw: '2026-10-03T00:11:40+03:00', style: 'datetime' })
    expect(locateTomlScalar(FM, ['title'])).toMatchObject({ raw: '"TOML örneği"', style: 'basic' })
    expect(locateTomlScalar(FM, ['summary'])).toMatchObject({ raw: "'tek tırnak'", style: 'literal' })
    expect(locateTomlScalar(FM, ['params', 'toc'])).toMatchObject({ raw: 'true', style: 'bare' })
    expect(locateTomlScalar(FM, ['other', 'x'])).toMatchObject({ raw: '1' })
    expect(locateTomlScalar(FM, ['missing'])).toBeNull()
    expect(locateTomlScalar(FM, ['toc'])).toBeNull()
  })

  it('handles quoted and dotted keys and CRLF', () => {
    const text = '"quoted key" = 1\r\ncover.image = "a.png"\r\n'
    expect(locateTomlScalar(text, ['quoted key'])?.raw).toBe('1')
    const found = locateTomlScalar(text, ['cover', 'image'])!
    expect(found.raw).toBe('"a.png"')
    expect(text.slice(found.start, found.end)).toBe('"a.png"')
  })
})

describe('bareNewTomlDates', () => {
  const hint = { path: ['lastmod'], value: '2026-10-05T10:30:00+03:00' }

  it('writes a new date bare only when asked', () => {
    const before = 'title = "x"\n'
    const after = 'title = "x"\nlastmod = "2026-10-05T10:30:00+03:00"\n'
    expect(bareNewTomlDates(before, after, [{ ...hint, datetime: true }])).toBe('title = "x"\nlastmod = 2026-10-05T10:30:00+03:00\n')
    expect(bareNewTomlDates(before, after, [hint])).toBe(after)
  })

  it('leaves existing keys to the Rust editor and invalid date-times alone', () => {
    // An existing quoted date was quoted on purpose.
    const before = 'lastmod = "2026-10-03T00:11:40+03:00"\n'
    const after = 'lastmod = "2026-10-05T10:30:00+03:00"\n'
    expect(bareNewTomlDates(before, after, [{ ...hint, datetime: true }])).toBe(after)
    // No seconds: not a TOML 1.0 date-time, so it stays a string.
    const noSeconds = 'lastmod = "2026-10-05T10:30+03:00"\n'
    expect(bareNewTomlDates('', noSeconds, [{ path: ['lastmod'], value: '2026-10-05T10:30+03:00', datetime: true }])).toBe(noSeconds)
  })

  it('knows TOML date-times', () => {
    expect(isTomlDatetime('2026-10-03T00:11:40+03:00')).toBe(true)
    expect(isTomlDatetime('2026-10-03')).toBe(true)
    expect(isTomlDatetime('2026-10-03 00:11:40Z')).toBe(true)
    expect(isTomlDatetime('2026-10-03T00:11+03:00')).toBe(false)
    expect(isTomlDatetime('2026-10-03T00:11:40+0300')).toBe(false)
  })
})

describe('tomlKeyLines', () => {
  const lines = FM.split('\n')
  const slice = (range: { start: number; end: number } | null) => (range ? lines.slice(range.start, range.end) : null)

  it('finds a multi-line value', () => {
    expect(slice(tomlKeyLines(FM, 'menu'))).toEqual(['menu = [', '  "main",', '  "footer",', ']'])
  })

  it('finds a table with its sub-tables and the comment above', () => {
    expect(slice(tomlKeyLines(FM, 'params'))).toEqual([
      '# parametreler',
      '[params]',
      '  toc = true',
      '  note = """',
      '[not a table]',
      '"""',
      '',
      '[[params.links]]',
      '  name = "a"',
    ])
  })

  it('includes comments right above a key', () => {
    expect(slice(tomlKeyLines(FM, 'title'))).toEqual(['# TOML yorumu', 'title = "TOML örneği"'])
  })

  it('returns null for keys written in separate places', () => {
    expect(tomlKeyLines('a.x = 1\nb = 2\na.y = 3\n', 'a')).toBeNull()
    expect(tomlKeyLines('a = 1\n', 'zzz')).toBeNull()
  })
})
