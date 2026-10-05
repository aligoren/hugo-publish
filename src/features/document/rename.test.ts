import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: {} }))

import type { PageEntry } from '../../lib/api'
import { siteUrlConfig } from '../../lib/permalinks'
import { aliasPath, contentFolders, docLocation, pageAlias, predictPagePermalink, predictPermalink, renamePlan } from './rename'
import { renameOps } from './useRename'

describe('docLocation / renamePlan', () => {
  it('renames a single file', () => {
    expect(docLocation('content/posts/eski.md')).toEqual({ kind: 'file', parent: 'content/posts', name: 'eski', fileName: '.md' })
    expect(renamePlan('content/posts/eski.md', 'Yeni Yazı')).toEqual({
      from: 'content/posts/eski.md',
      to: 'content/posts/yeni-yazi.md',
      newPath: 'content/posts/yeni-yazi.md',
    })
  })

  it('moves the whole page bundle folder', () => {
    expect(renamePlan('content/posts/eski/index.md', 'yeni', 'content/blog')).toEqual({
      from: 'content/posts/eski',
      to: 'content/blog/yeni',
      newPath: 'content/blog/yeni/index.md',
    })
  })

  it('does nothing for unchanged names, empty names and section pages', () => {
    expect(renamePlan('content/posts/eski.md', 'eski')).toBeNull()
    expect(renamePlan('content/posts/eski.md', '!!!')).toBeNull()
    expect(renamePlan('content/posts/_index.md', 'x')).toBeNull()
    expect(docLocation('content/posts/_index.md').kind).toBe('section')
  })
})

describe('aliases', () => {
  it('uses the path below the base URL', () => {
    expect(aliasPath('https://example.org/posts/eski/')).toBe('/posts/eski/')
    expect(aliasPath('https://user.github.io/blog/posts/eski/', 'https://user.github.io/blog/')).toBe('/posts/eski/')
    expect(aliasPath('https://example.org/yaz%C4%B1/', 'https://example.org/')).toBe('/yazı/')
    expect(aliasPath('/posts/x/')).toBe('/posts/x/')
  })

  it('predicts the permalink when it ends with the name', () => {
    expect(predictPermalink('https://example.org/posts/eski/', ['', 'eski'], 'yeni')).toBe('https://example.org/posts/yeni/')
    expect(predictPermalink('https://example.org/posts/eski-yazi', ['Eski Yazı'], 'yeni')).toBe('https://example.org/posts/yeni')
    expect(predictPermalink('https://example.org/2026/10/03/', ['eski'], 'yeni')).toBeNull()
  })

  it('adds the old address to aliases once and sets the slug', () => {
    expect(
      renameOps({ aliases: ['/a/'], Slug: 'eski' }, { plan: { from: '', to: '', newPath: '' }, slug: 'yeni', alias: '/posts/eski/' }),
    ).toEqual([
      { op: 'set', path: ['Slug'], value: 'yeni' },
      { op: 'set', path: ['aliases'], value: ['/a/', '/posts/eski/'] },
    ])
    expect(renameOps({ aliases: ['/posts/eski/'] }, { plan: { from: '', to: '', newPath: '' }, slug: null, alias: '/posts/eski/' })).toEqual([])
    expect(renameOps({}, { plan: { from: '', to: '', newPath: '' }, slug: null, alias: '/x/' })).toEqual([
      { op: 'set', path: ['aliases'], value: ['/x/'] },
    ])
  })
})

describe('contentFolders', () => {
  it('lists sections, not bundle folders', () => {
    const files = [
      { path: 'content/posts/a.md', title: null, modifiedMs: 0 },
      { path: 'content/posts/b/index.md', title: null, modifiedMs: 0 },
      { path: 'content/blog/2026/c.md', title: null, modifiedMs: 0 },
      { path: 'content/about.md', title: null, modifiedMs: 0 },
    ]
    expect(contentFolders(files, 'content', 'content/posts')).toEqual(['content', 'content/blog', 'content/blog/2026', 'content/posts'])
  })
})

describe('addresses from the site settings', () => {
  function entry(path: string, permalink: string, extra: Partial<PageEntry> = {}): PageEntry {
    return { path, slug: '', title: 'Eski Yazi', date: '2024-03-05T10:00:00+03:00', expiryDate: '', publishDate: '', draft: false, permalink, kind: 'page', section: 'posts', ...extra }
  }
  const config = siteUrlConfig({
    baseurl: 'https://example.org/blog/',
    defaultcontentlanguage: 'en',
    languages: { en: { weight: 1 }, tr: { weight: 2, contentdir: 'content/tr' } },
    permalinks: [
      { pattern: '/:year/:slug/', target: { kind: 'page', path: '/{posts,posts/**}' } },
      { pattern: '/notes/:contentbasename/', target: { kind: 'page', path: '/notes/**' } },
    ],
  })
  const model = { config, pages: [], hugo: { major: 0, minor: 160 } }

  it('uses the real pattern: a new file name keeps a slug-or-title address', () => {
    const page = entry('content/posts/eski.md', 'https://example.org/blog/2024/eski-yazi/')
    expect(predictPagePermalink(page, { path: 'content/posts/yeni.md', slug: '', title: 'Eski Yazi' }, model)).toBe(page.permalink)
    expect(predictPagePermalink(page, { slug: 'Yeni Adres', title: 'Eski Yazi' }, model)).toBe('https://example.org/blog/2024/yeni-adres/')
  })

  it('follows a move into a section with another pattern', () => {
    const page = entry('content/posts/eski.md', 'https://example.org/blog/2024/eski-yazi/')
    expect(predictPagePermalink(page, { path: 'content/notes/eski.md', slug: '', title: 'Eski Yazi' }, model)).toBe('https://example.org/blog/notes/eski/')
  })

  it('keeps the language prefix and makes the alias relative to the language site', () => {
    const page = entry('content/tr/posts/eski.md', 'https://example.org/blog/tr/2024/eski-yazi/')
    expect(predictPagePermalink(page, { slug: 'yeni', title: 'Eski Yazi' }, model)).toBe('https://example.org/blog/tr/2024/yeni/')
    expect(pageAlias(page, model, null)).toBe('/2024/eski-yazi/')
    expect(pageAlias(page, { ...model, hugo: { major: 0, minor: 150 } }, null)).toBe('/tr/2024/eski-yazi/')
    expect(pageAlias(page, null, 'https://example.org/blog/')).toBe('/tr/2024/eski-yazi/')
  })

  it('gives up when the settings do not reproduce the current address', () => {
    const page = entry('content/posts/eski.md', 'https://example.org/blog/custom/place/')
    expect(predictPagePermalink(page, { slug: 'yeni', title: 'x' }, model)).toBeNull()
  })
})
