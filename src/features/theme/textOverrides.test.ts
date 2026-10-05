import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { i18nLanguage, newI18nFile, normalizeI18n, parseI18nText, planI18nWrite, type I18nTarget } from './textOverrides'

const PAPERMOD_TR = `- id: prev_page
  translation: "Önceki"

- id: read_time
  translation:
    one : "1 dk"
    other: "{{ .Count }} dk"
`

function target(path: string, text: string | null, format: 'yaml' | 'toml' | 'json', raw?: unknown): I18nTarget {
  const parsed = raw ?? (text === null ? {} : format === 'json' ? JSON.parse(text) : parse(text))
  return { path, format, text, version: text === null ? null : 'v1', data: normalizeI18n(parsed), raw: parsed }
}

describe('reading i18n files', () => {
  it('normalises list and map forms, plural forms and translation wrappers', () => {
    expect(parseI18nText(PAPERMOD_TR, 'yaml')).toEqual({
      shape: 'list',
      entries: { prev_page: 'Önceki', read_time: { one: '1 dk', other: '{{ .Count }} dk' } },
    })
    expect(normalizeI18n({ home: 'Ana Sayfa', toc: { other: 'İçindekiler' }, x: { translation: 'y' }, n: 3 })).toEqual({
      shape: 'map',
      entries: { home: 'Ana Sayfa', toc: { other: 'İçindekiler' }, x: 'y', n: '3' },
    })
    expect(parseI18nText('', 'yaml')).toEqual({ shape: 'map', entries: {} })
    expect(i18nLanguage('themes/x/i18n/zh-TW.yaml')).toBe('zh-tw')
  })
})

describe('planI18nWrite', () => {
  it('creates a new file with only the changed keys', () => {
    const plan = planI18nWrite(target('i18n/tr.yaml', null, 'yaml'), {
      prev_page: 'Geri',
      read_time: { one: '1 dakika', other: '{{ .Count }} dakika' },
      untouched: null,
    })
    expect(plan).toEqual({
      kind: 'text',
      path: 'i18n/tr.yaml',
      before: null,
      version: null,
      after: 'prev_page: Geri\nread_time:\n  one: 1 dakika\n  other: "{{ .Count }} dakika"\n',
    })
    expect(newI18nFile('toml', { home: 'Ev', read_time: { one: '1 dk', other: '{{ .Count }} dk' } })).toBe(
      'home = "Ev"\n\n[read_time]\none = "1 dk"\nother = "{{ .Count }} dk"\n',
    )
    expect(newI18nFile('json', { home: 'Ev' })).toBe('{\n  "home": "Ev"\n}\n')
  })

  it('produces config ops for an existing map-form YAML or TOML file', () => {
    const yaml = target('i18n/tr.yaml', 'home: Ev\ntoc:\n  other: İçerik\n', 'yaml')
    expect(planI18nWrite(yaml, { home: 'Ana', toc: 'Konular', words: { one: 'kelime', other: '{{ .Count }} kelime' }, gone: null })).toEqual({
      kind: 'ops',
      path: 'i18n/tr.yaml',
      ops: [
        { op: 'set', path: ['home'], value: 'Ana' },
        { op: 'set', path: ['toc', 'other'], value: 'Konular' },
        { op: 'set', path: ['words'], value: { one: 'kelime', other: '{{ .Count }} kelime' } },
      ],
    })
    const toml = target('i18n/tr.toml', '[read_time]\nother = "x"\n', 'toml', { read_time: { other: 'x' }, home: 'Ev' })
    expect(planI18nWrite(toml, { read_time: { one: '1', other: 'n' }, home: null })).toEqual({
      kind: 'ops',
      path: 'i18n/tr.toml',
      ops: [
        { op: 'set', path: ['read_time', 'one'], value: '1' },
        { op: 'set', path: ['read_time', 'other'], value: 'n' },
        { op: 'remove', path: ['home'] },
      ],
    })
  })

  it('edits list-form YAML in place and keeps the other lines', () => {
    const plan = planI18nWrite(target('i18n/tr.yaml', PAPERMOD_TR, 'yaml'), { prev_page: 'Geri', toc: 'Konular', read_time: null })
    expect(plan.kind).toBe('text')
    if (plan.kind !== 'text') return
    expect(plan.after).toBe('- id: prev_page\n  translation: "Geri"\n\n- id: toc\n  translation: Konular\n')
    expect(parseI18nText(plan.after, 'yaml').entries).toEqual({ prev_page: 'Geri', toc: 'Konular' })
  })

  it('rewrites JSON with its indentation and line endings', () => {
    const plan = planI18nWrite(target('i18n/tr.json', '{\r\n    "home": "Ev"\r\n}\r\n', 'json'), { home: null, toc: 'İçindekiler' })
    expect(plan).toMatchObject({ kind: 'text', after: '{\r\n    "toc": "İçindekiler"\r\n}\r\n' })
  })
})
