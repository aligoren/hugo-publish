import { describe, expect, it } from 'vitest'

import { fileLanguage, groupTranslations, languagesFromConfig, translationPath } from './model'

const suffixSite = languagesFromConfig({
  defaultcontentlanguage: 'tr',
  languages: { tr: { label: 'Türkçe', weight: 1 }, en: { label: 'English', weight: 2 } },
})

const folderSite = languagesFromConfig({
  defaultcontentlanguage: 'en',
  languages: {
    en: { weight: 1, contentdir: 'content/en' },
    de: { weight: 2, contentdir: 'content/de' },
  },
})

describe('languagesFromConfig', () => {
  it('reads codes, labels, order and content folders', () => {
    expect(suffixSite.languages.map((l) => [l.code, l.label, l.contentDir])).toEqual([
      ['tr', 'Türkçe', 'content'],
      ['en', 'English', 'content'],
    ])
    expect(folderSite.languages.map((l) => l.contentDir)).toEqual(['content/en', 'content/de'])
  })

  it('falls back to the default language for single-language sites', () => {
    expect(languagesFromConfig({ defaultcontentlanguage: 'tr' }).languages).toEqual([
      { code: 'tr', label: 'tr', weight: 0, contentDir: 'content' },
    ])
  })

  it('skips disabled languages', () => {
    const { languages } = languagesFromConfig({ languages: { en: {}, fr: { disabled: true } } })
    expect(languages.map((l) => l.code)).toEqual(['en'])
  })
})

describe('fileLanguage', () => {
  it('uses the file name suffix, else the default language', () => {
    const { languages, defaultLanguage } = suffixSite
    expect(fileLanguage('content/posts/a.en.md', languages, defaultLanguage)).toEqual({
      path: 'content/posts/a.en.md',
      language: 'en',
      key: 'posts/a.md',
    })
    expect(fileLanguage('content/posts/a.md', languages, defaultLanguage)?.language).toBe('tr')
    // A suffix that is not a site language is part of the name.
    expect(fileLanguage('content/posts/v1.fr.md', languages, defaultLanguage)).toMatchObject({ language: 'tr', key: 'posts/v1.fr.md' })
  })

  it('uses per-language content folders', () => {
    const { languages, defaultLanguage } = folderSite
    expect(fileLanguage('content/de/posts/a.md', languages, defaultLanguage)).toEqual({
      path: 'content/de/posts/a.md',
      language: 'de',
      key: 'posts/a.md',
    })
    expect(fileLanguage('static/x.md', languages, defaultLanguage)).toBeNull()
  })
})

describe('groupTranslations', () => {
  it('pairs files by path or by translationKey', () => {
    const { languages, defaultLanguage } = suffixSite
    const files = ['content/posts/a.md', 'content/posts/a.en.md', 'content/posts/b.md', 'content/posts/hello.en.md'].map(
      (p) => fileLanguage(p, languages, defaultLanguage)!,
    )
    const groups = groupTranslations(files, { 'content/posts/b.md': 'greeting', 'content/posts/hello.en.md': 'greeting' })
    expect(groups.map((g) => g.files)).toEqual([
      { tr: 'content/posts/b.md', en: 'content/posts/hello.en.md' },
      { tr: 'content/posts/a.md', en: 'content/posts/a.en.md' },
    ])
  })
})

describe('translationPath', () => {
  it('adds a language suffix when languages share a folder', () => {
    const { languages, defaultLanguage } = suffixSite
    const source = fileLanguage('content/posts/a.md', languages, defaultLanguage)!
    expect(translationPath(source, languages[1], languages)).toBe('content/posts/a.en.md')
  })

  it('mirrors the path into the language folder otherwise', () => {
    const { languages, defaultLanguage } = folderSite
    const source = fileLanguage('content/en/posts/a/index.md', languages, defaultLanguage)!
    expect(translationPath(source, languages[1], languages)).toBe('content/de/posts/a/index.md')
  })
})
