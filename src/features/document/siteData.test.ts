import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({
  api: {},
  isAppError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}))

import { addDictionaryWord, addWordToText, parseDictionary, readDictionary, DICTIONARY_PATH } from './dictionary'
import { loadSiteSettings, siteSettingsFromConfig, spellLanguage } from './siteSettings'
import { clearTermIndex, collectTerms, indexFrontMatter, suggestTerms } from './termIndex'
import { fakeTomlParse } from './testing/fakeToml'

describe('site settings', () => {
  it('reads taxonomies, language and base URL from hugo config output', () => {
    const settings = siteSettingsFromConfig({
      taxonomies: { category: 'categories', tag: 'tags', series: 'series' },
      defaultcontentlanguage: 'tr',
      languages: { tr: { locale: 'tr-TR' } },
      baseurl: 'https://example.org/',
      theme: ['PaperMod'],
    })
    expect(settings).toEqual({
      taxonomies: ['categories', 'tags', 'series'],
      defaultContentLanguage: 'tr',
      locale: 'tr-TR',
      baseURL: 'https://example.org/',
      themes: ['PaperMod'],
    })
    expect(spellLanguage(settings)).toBe('tr')
  })

  it('falls back to Hugo’s defaults', () => {
    const settings = siteSettingsFromConfig({ defaultcontentlanguage: 'en', theme: 'ananke' })
    expect(settings.taxonomies).toEqual(['categories', 'tags'])
    expect(settings.themes).toEqual(['ananke'])
    expect(spellLanguage(settings)).toBe('en')
    expect(spellLanguage(siteSettingsFromConfig({ defaultcontentlanguage: 'ar' }))).toBe('ar')
    expect(spellLanguage(siteSettingsFromConfig({ locale: 'en-GB' }))).toBe('en')
    expect(spellLanguage(siteSettingsFromConfig({}))).toBeNull()
    expect(siteSettingsFromConfig({ taxonomies: {} }).taxonomies).toEqual([])
  })

  it('caches per site and config version, and survives a missing Hugo', async () => {
    const read = vi.fn(async () => ({ values: { taxonomies: { tag: 'etiketler' } }, messages: [] }))
    expect((await loadSiteSettings('/cache-site', 1, read)).taxonomies).toEqual(['etiketler'])
    await loadSiteSettings('/cache-site', 1, read)
    expect(read).toHaveBeenCalledTimes(1)
    const failing = vi.fn(async () => Promise.reject(new Error('no hugo')))
    expect((await loadSiteSettings('/cache-site', 2, failing)).taxonomies).toEqual(['categories', 'tags'])
  })
})

describe('term index', () => {
  const texts: Record<string, string> = {
    'content/a.md': '---\ntags: ["kitap", "Roman"]\ncategories: notlar\n---\n',
    'content/b.md': '+++\ntags = ["kitap"]\n+++\n',
    'content/c.md': 'no front matter',
    'content/d.md': '---\ntags: [\n---\n',
  }
  const deps = {
    readText: vi.fn(async (path: string) => ({ text: texts[path] })),
    tomlParseText: vi.fn(async (text: string) => ({ values: fakeTomlParse(text) })),
  }
  const files = Object.keys(texts).map((path) => ({ path, title: null, modifiedMs: 1 }))

  it('counts terms across YAML and TOML files, reading each file once', async () => {
    clearTermIndex()
    const index = await indexFrontMatter('/terms', files, deps)
    const terms = collectTerms(index.values(), ['tags', 'categories'])
    expect(terms.tags).toEqual([
      { term: 'kitap', count: 2 },
      { term: 'Roman', count: 1 },
    ])
    expect(terms.categories).toEqual([{ term: 'notlar', count: 1 }])
    await indexFrontMatter('/terms', files, deps)
    expect(deps.readText).toHaveBeenCalledTimes(4)
    await indexFrontMatter('/terms', [{ ...files[0], modifiedMs: 2 }, ...files.slice(1)], deps)
    expect(deps.readText).toHaveBeenCalledTimes(5)
  })

  it('suggests matching terms, prefix matches first, without chosen ones', () => {
    const terms = [
      { term: 'deneme', count: 5 },
      { term: 'kitap', count: 3 },
      { term: 'Roman', count: 2 },
      { term: 'romantik', count: 1 },
    ]
    expect(suggestTerms(terms, 'rom', ['romantik']).map((t) => t.term)).toEqual(['Roman'])
    expect(suggestTerms(terms, 'e', []).map((t) => t.term)).toEqual(['deneme'])
    expect(suggestTerms(terms, '', ['KİTAP'.toLocaleLowerCase('tr')]).length).toBe(3)
  })
})

describe('personal dictionary', () => {
  it('parses and appends words with the file’s line endings', () => {
    expect(parseDictionary('﻿bir\r\n# yorum\r\niki\r\nbir\r\n\r\n')).toEqual(['bir', 'iki'])
    expect(addWordToText('', 'Hugo')).toBe('Hugo\n')
    expect(addWordToText('bir\r\niki', 'üç')).toBe('bir\r\niki\r\nüç\r\n')
    expect(addWordToText('bir\n', 'bir')).toBe('bir\n')
  })

  it('creates the file on the first word and retries after a conflict', async () => {
    const files = new Map<string, { text: string; version: string }>()
    const deps = {
      readText: vi.fn(async (path: string) => {
        const file = files.get(path)
        if (!file) throw { code: 'io', message: 'missing' }
        return file
      }),
      writeText: vi.fn(async (path: string, text: string, expected?: string) => {
        const current = files.get(path)
        if (expected !== undefined && current?.version !== expected) throw { code: 'conflict', message: '' }
        const version = `v${text.length}`
        files.set(path, { text, version })
        return version
      }),
    }
    const empty = await readDictionary(deps)
    expect(empty).toEqual({ words: [], text: '', version: null })
    const first = await addDictionaryWord(empty, 'Hugo', deps)
    expect(deps.writeText).toHaveBeenLastCalledWith(DICTIONARY_PATH, 'Hugo\n', undefined)
    // Another program adds a word meanwhile.
    files.set(DICTIONARY_PATH, { text: 'Hugo\nTauri\n', version: 'other' })
    const second = await addDictionaryWord(first, 'markdown', deps)
    expect(second.words).toEqual(['Hugo', 'Tauri', 'markdown'])
  })
})
