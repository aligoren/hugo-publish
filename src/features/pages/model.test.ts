import { describe, expect, it } from 'vitest'

import type { ContentFile, PageEntry } from '../../lib/api'
import { siteUrlConfig } from '../../lib/permalinks'
import { configMenusOf, nextMenuWeight, standalonePages, standaloneReason } from './model'

function file(path: string, title: string | null = null): ContentFile {
  return { path, title, modifiedMs: 1 }
}

function entry(path: string, extra: Partial<PageEntry> = {}): PageEntry {
  return { path, slug: '', title: '', date: '', expiryDate: '', publishDate: '', draft: false, permalink: '', kind: 'page', section: '', ...extra }
}

describe('standalone pages', () => {
  const paths = new Set([
    'content/_index.md',
    'content/about.md',
    'content/contact/index.md',
    'content/posts/_index.md',
    'content/posts/hello.md',
    'content/posts/archive.md',
    'content/posts/trip/index.md',
    'content/about.tr.md',
  ])

  it('tells standalone pages from posts', () => {
    const reason = (path: string, fm: Record<string, unknown> | null = null) => standaloneReason(path, paths, fm, 'content', ['tr'])
    expect(reason('content/_index.md')).toBe('home')
    expect(reason('content/posts/_index.md')).toBe('section')
    expect(reason('content/about.md')).toBe('root')
    expect(reason('content/about.tr.md')).toBe('root')
    expect(reason('content/contact/index.md')).toBe('root')
    expect(reason('content/posts/hello.md')).toBeNull()
    expect(reason('content/posts/trip/index.md')).toBeNull()
    expect(reason('content/posts/archive.md', { layout: 'archives' })).toBe('type')
    expect(reason('content/posts/archive.md', { Type: 'special' })).toBe('type')
    expect(reason('content/posts/archive.md', { type: '' })).toBeNull()
  })

  it('collects title, draft state and menus from front matter and config', () => {
    const files = [file('content/about.md', 'About'), file('content/posts/hello.md'), file('content/_index.md'), file('content/search.md')]
    const pages = [
      entry('content/about.md', { title: 'About', permalink: 'https://example.org/about/' }),
      entry('content/search.md', { title: 'Search', draft: true, permalink: 'https://example.org/search/' }),
    ]
    const frontMatter = new Map<string, Record<string, unknown> | null>([
      ['content/about.md', { title: 'About us', menus: { footer: { weight: 5 } } }],
      ['content/search.md', { title: 'Search', draft: true }],
      ['content/_index.md', { title: 'Home' }],
    ])
    const configMenus = [
      { name: 'main', lang: null, entries: [{ name: 'About', pageRef: '/about' }, { name: 'Search', url: '/search/' }] },
      { name: 'social', lang: null, entries: [{ name: 'X', url: 'https://x.com/' }] },
    ]
    const result = standalonePages({ files, pages, frontMatter, configMenus })
    expect(result.map((p) => [p.path, p.reason, p.title, p.draft])).toEqual([
      ['content/_index.md', 'home', 'Home', false],
      ['content/about.md', 'root', 'About us', false],
      ['content/search.md', 'root', 'Search', true],
    ])
    expect(result[1].menus).toEqual([
      { menu: 'footer', lang: null, from: 'page' },
      { menu: 'main', lang: null, from: 'config' },
    ])
    expect(result[2].menus).toEqual([{ menu: 'main', lang: null, from: 'config' }])
  })

  it('matches pageRef forms Hugo accepts', () => {
    const menus = [{ name: 'main', lang: null, entries: [{ pageRef: 'docs/_index.md' }, { pageRef: '/About' }] }]
    expect(configMenusOf('content/docs/_index.md', null, menus)).toHaveLength(1)
    expect(configMenusOf('content/about.md', null, menus)).toHaveLength(1)
    expect(configMenusOf('content/contact.md', null, menus)).toHaveLength(0)
  })

  it('puts a new entry after the heaviest one', () => {
    expect(nextMenuWeight('main', [{ name: 'Main', lang: null, entries: [{ weight: 20 }, { weight: 35 }] }], [10])).toBe(40)
    expect(nextMenuWeight('footer', [], [])).toBe(10)
  })
})

describe('standalone pages in per-language content folders', () => {
  const config = siteUrlConfig({
    defaultContentLanguage: 'en',
    languages: { en: { contentDir: 'content/en' }, tr: { contentDir: 'content/tr' } },
  })
  const files = [file('content/en/_index.md'), file('content/en/about.md'), file('content/tr/hakkinda.md'), file('content/tr/posts/merhaba.md'), file('content/tr/iletisim/index.md')]
  const paths = new Set(files.map((f) => f.path))

  it('reads each language folder as a content root', () => {
    const reason = (path: string) => standaloneReason(path, paths, null, 'content', [], config)
    expect(reason('content/en/_index.md')).toBe('home')
    expect(reason('content/tr/hakkinda.md')).toBe('root')
    expect(reason('content/tr/iletisim/index.md')).toBe('root')
    expect(reason('content/tr/posts/merhaba.md')).toBeNull()
    // Without the settings, the language folder looks like a section.
    expect(standaloneReason('content/tr/hakkinda.md', paths, null)).toBeNull()
  })

  it('gives pages and their menu entries the language of their folder', () => {
    const frontMatter = new Map<string, Record<string, unknown> | null>([
      ['content/tr/hakkinda.md', { title: 'Hakkında', menus: 'main' }],
      ['content/en/about.md', { title: 'About' }],
    ])
    const configMenus = [
      { name: 'main', lang: 'en', entries: [{ name: 'About', pageRef: '/about' }] },
      { name: 'main', lang: 'tr', entries: [{ name: 'About?', pageRef: '/about' }] },
      { name: 'footer', lang: null, entries: [{ name: 'Hakkında', pageRef: '/hakkinda' }] },
    ]
    const result = standalonePages({ files, pages: [], frontMatter, configMenus, config })
    const about = result.find((p) => p.path === 'content/en/about.md')!
    const hakkinda = result.find((p) => p.path === 'content/tr/hakkinda.md')!
    expect([about.lang, hakkinda.lang]).toEqual([null, 'tr'])
    // `/about` in the Turkish menu does not link the English page.
    expect(about.menus).toEqual([{ menu: 'main', lang: 'en', from: 'config' }])
    expect(hakkinda.menus).toEqual([
      { menu: 'main', lang: 'tr', from: 'page' },
      { menu: 'footer', lang: null, from: 'config' },
    ])
  })
})
