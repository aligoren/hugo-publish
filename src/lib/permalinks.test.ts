import { describe, expect, it } from 'vitest'

import type { PageEntry } from './api'
import { goFormat, inTimeZone, parseWallTime, resolveTimeZone, zoneOffset } from './goDate'
import {
  aliasFor,
  basePath,
  contentLanguage,
  contentLocation,
  defaultPath,
  forHugo,
  globToRegExp,
  languageBaseURL,
  languagePrefix,
  matchRule,
  pageAddress,
  permalinkRules,
  siteUrlConfig,
  urlOptionsFor,
  expandPermalink,
  expandTokens,
  patternForSection,
  permalinkPage,
  PermalinkError,
  previewUrls,
  sliceSections,
  unknownTokens,
  urlize,
  type PermalinkPage,
} from './permalinks'

function entry(path: string, extra: Partial<PageEntry> = {}): PageEntry {
  return {
    path,
    slug: '',
    title: 'A Page',
    date: '2024-03-05T09:07:03+02:00',
    expiryDate: '',
    publishDate: '',
    draft: false,
    permalink: '',
    kind: 'page',
    section: path.split('/')[1] ?? '',
    ...extra,
  }
}

const PAGE: PermalinkPage = {
  title: 'Hello World: Part 2',
  slug: '',
  date: '2024-03-05T09:07:03+02:00',
  section: 'docs',
  sections: ['docs', 'guide', 'advanced'],
  sectionSlugs: ['documentation', 'guide', 'advanced'],
  contentBaseName: 'my-file',
  dirs: ['docs', 'guide', 'advanced'],
}

describe('Go date layouts', () => {
  const time = parseWallTime('2024-03-05T09:07:03+02:00')!

  it('parses dates as written, keeping the offset', () => {
    expect(time).toEqual({ year: 2024, month: 3, day: 5, hour: 9, minute: 7, second: 3, offset: 120 })
    expect(parseWallTime('2024-12-31')).toMatchObject({ year: 2024, month: 12, day: 31, offset: null })
    expect(parseWallTime('soon')).toBeNull()
  })

  it.each([
    ['2006', '2024'],
    ['06', '24'],
    ['01', '03'],
    ['1', '3'],
    ['Jan', 'Mar'],
    ['January', 'March'],
    ['02', '05'],
    ['2', '5'],
    ['_2', ' 5'],
    ['002', '065'],
    ['Mon', 'Tue'],
    ['Monday', 'Tuesday'],
    ['15', '09'],
    ['03', '09'],
    ['3', '9'],
    ['04', '07'],
    ['05', '03'],
    ['PM', 'AM'],
    ['Z0700', '+0200'],
    ['2006_01', '2024_03'],
    ['Month', 'Month'],
  ])('formats %s as %s', (layout, expected) => {
    expect(goFormat(time, layout)).toBe(expected)
  })
})

describe('urlize', () => {
  it('works like Hugo: spaces become hyphens, punctuation goes, lower case', () => {
    expect(urlize('Hello World: Part 2')).toBe('hello-world-part-2')
    expect(urlize('  A  --  B ')).toBe('a--b')
    expect(urlize('C# & C++')).toBe('c#-c++')
  })

  it('keeps accents unless removePathAccents is set; the dotless ı stays', () => {
    expect(urlize('Gündem Işık')).toBe('gündem-işık')
    expect(urlize('Gündem Işık', { removePathAccents: true })).toBe('gundem-isık')
    expect(urlize('Big Title', { disablePathToLower: true })).toBe('Big-Title')
  })
})

describe('permalink tokens', () => {
  it.each([
    ['/:year/:month/:day/:slug/', '/2024/03/05/hello-world-part-2/'],
    ['/:monthname/:weekday/:weekdayname/:yearday/', '/march/2/tuesday/65/'],
    ['/:section/:title/', '/docs/hello-world-part-2/'],
    ['/:sections/:contentbasename/', '/docs/guide/advanced/my-file/'],
    ['/:sections[1:]/:filename/', '/guide/advanced/my-file/'],
    ['/:sections[:last]/:slugorcontentbasename/', '/docs/guide/my-file/'],
    ['/:sections[last]/:slugorfilename/', '/advanced/my-file/'],
    ['/:sections[0]/x/', '/docs/x/'],
    ['/:sectionslug/:sectionslugs[1:]/', '/documentation/guide/advanced/'],
    ['/:2006/:01/:02/:slug', '/2024/03/05/hello-world-part-2/'],
    ['/:06:Jan/', '/24mar/'],
    ['/archive/:slug.html', '/archive/hello-world-part-2.html'],
  ])('%s → %s', (pattern, expected) => {
    expect(expandPermalink(pattern, PAGE)).toBe(expected)
  })

  it('uses the slug when the page has one', () => {
    const page = { ...PAGE, slug: 'Custom Slug' }
    expect(expandPermalink('/:slug/', page)).toBe('/custom-slug/')
    expect(expandPermalink('/:slugorcontentbasename/', page)).toBe('/custom-slug/')
    expect(expandPermalink('/:title/', page)).toBe('/hello-world-part-2/')
  })

  it('replaces repeated tokens one by one and keeps literal text', () => {
    expect(expandTokens('x-:year-:year', PAGE)).toBe('x-2024-2024')
  })

  it('rejects tokens Hugo does not know', () => {
    expect(() => expandPermalink('/:nope/', PAGE)).toThrow(PermalinkError)
    expect(unknownTokens('/:year/:nope/:sections[1:]/:2006/')).toEqual([':nope'])
  })

  it('slices like Hugo, never out of range', () => {
    const s = ['a', 'b', 'c']
    expect(sliceSections(s, '1:')).toEqual(['b', 'c'])
    expect(sliceSections(s, ':last')).toEqual(['a', 'b'])
    expect(sliceSections(s, 'last')).toEqual(['c'])
    expect(sliceSections(s, '5')).toEqual([])
    expect(sliceSections(s, '1:9')).toEqual(['b', 'c'])
    expect(sliceSections(s, '2:1')).toEqual([])
  })

  it('handles ugly URLs and disablePathToLower', () => {
    expect(expandPermalink('/:section/:slug/', PAGE, { uglyURLs: true })).toBe('/docs/hello-world-part-2.html')
    expect(expandPermalink('/Blog/:slug/', PAGE, { disablePathToLower: true })).toBe('/Blog/Hello-World-Part-2/')
  })

  it('builds the default path from folders and slug or file name', () => {
    expect(defaultPath(PAGE)).toBe('/docs/guide/advanced/my-file/')
    expect(defaultPath({ ...PAGE, slug: 'short' })).toBe('/docs/guide/advanced/short/')
  })
})

describe('pages', () => {
  const pages = [
    entry('content/docs/_index.md', { kind: 'section', slug: 'documentation' }),
    entry('content/docs/guide/_index.md', { kind: 'section' }),
    entry('content/docs/guide/intro.md', { slug: '' }),
    entry('content/docs/loose/thing.md'),
    entry('content/posts/trip/index.md'),
    entry('content/about.tr.md', { section: '' }),
  ]

  it('finds sections, bundles and languages', () => {
    const intro = permalinkPage(pages[2], { pages })
    expect(intro).toMatchObject({ sections: ['docs', 'guide'], sectionSlugs: ['documentation', 'guide'], contentBaseName: 'intro', dirs: ['docs', 'guide'] })
    // A folder without an _index is not a section.
    expect(permalinkPage(pages[3], { pages }).sections).toEqual(['docs'])
    expect(permalinkPage(pages[4], { pages })).toMatchObject({ contentBaseName: 'trip', dirs: ['posts'], sections: ['posts'] })
    expect(permalinkPage(pages[5], { pages, languages: ['tr'] })).toMatchObject({ contentBaseName: 'about', section: '', sections: [] })
  })

  it('reads new and old style patterns', () => {
    expect(patternForSection({ page: { posts: '/:year/:slug/' } }, 'posts')).toEqual({ pattern: '/:year/:slug/', origin: 'page', key: 'posts' })
    expect(patternForSection({ Posts: '/p/:slug/' }, 'posts')).toEqual({ pattern: '/p/:slug/', origin: 'legacy', key: 'Posts' })
    expect(patternForSection({ page: { posts: '/a/' }, posts: '/b/' }, 'posts')?.origin).toBe('page')
    expect(patternForSection({}, 'posts')).toBeNull()
    expect(patternForSection(undefined, 'posts')).toBeNull()
  })
})

describe('previewUrls', () => {
  const base = 'https://example.org/blog'
  const posts = [
    entry('content/posts/first.md', { title: 'Same Title', permalink: `${base}/posts/first/` }),
    entry('content/posts/second.md', { title: 'Same Title', permalink: `${base}/posts/second/` }),
  ]
  const about = entry('content/about.md', { section: '', permalink: `${base}/same-title/` })

  it('keeps the base path, shows changes and finds collisions', () => {
    const changes = previewUrls({ pages: posts, allPages: [...posts, about], currentPattern: null, nextPattern: '/:title/' })
    expect(changes.map((c) => [c.current, c.next, c.changed])).toEqual([
      ['/blog/posts/first/', '/blog/same-title/', true],
      ['/blog/posts/second/', '/blog/same-title/', true],
    ])
    expect(changes[0].collidesWith).toEqual(['content/posts/second.md', 'content/about.md'])
  })

  it('leaves pages with a front matter url alone', () => {
    const changes = previewUrls({
      pages: posts.slice(0, 1),
      allPages: posts,
      currentPattern: null,
      nextPattern: '/:year/:slug/',
      context: { urls: new Map([['content/posts/first.md', '/custom/']]) },
    })
    expect(changes[0].changed).toBe(false)
  })

  it('reports a pattern that cannot be expanded', () => {
    const [change] = previewUrls({ pages: posts.slice(0, 1), allPages: posts, currentPattern: null, nextPattern: '/:bad/' })
    expect(change.next).toBeNull()
  })
})

describe('time zones', () => {
  it('reads dates without an offset in the site time zone', () => {
    const t = parseWallTime('2024-01-05T10:00:00')!
    expect(inTimeZone(t, 'Europe/Istanbul')).toMatchObject({ hour: 10, offset: 180, zone: '+03' })
    expect(inTimeZone(t, 'America/New_York')).toMatchObject({ offset: -300, zone: 'EST' })
    expect(inTimeZone(parseWallTime('2024-07-05T10:00:00')!, 'America/New_York')).toMatchObject({ offset: -240, zone: 'EDT' })
    expect(inTimeZone(t, 'UTC')).toMatchObject({ offset: 0, zone: 'UTC' })
    // Dates with an offset keep it; unknown zones change nothing.
    expect(inTimeZone(parseWallTime('2024-01-05T10:00:00+01:00')!, 'Asia/Tokyo').offset).toBe(60)
    expect(inTimeZone(t, 'Nowhere/City').offset).toBeNull()
    expect(resolveTimeZone('')).toBeNull()
    expect(zoneOffset(t, 'Asia/Kolkata')).toBe(330)
  })

  it('formats zone layouts with the site time zone', () => {
    const page = { ...PAGE, date: '2024-01-05' }
    expect(expandTokens(':Z0700-:MST', page, { timeZone: 'Europe/Istanbul' })).toBe('+0300-+03')
    expect(expandTokens(':Z0700-:MST', page)).toBe('Z-UTC')
    expect(expandTokens(':2006/:02', page, { timeZone: 'Pacific/Kiritimati' })).toBe('2024/05')
  })
})

describe('permalink rules', () => {
  it('reads the per-kind tables, the older form and the array form', () => {
    const map = permalinkRules({ page: { posts: '/p/:slug/' }, section: { posts: '/blog/' }, term: { tags: '/t/:slug/' }, docs: '/d/:slug/' })
    expect(map.map((r) => [r.form, r.kinds, r.section, r.keyPath])).toEqual([
      ['kind', ['page'], 'posts', ['page', 'posts']],
      ['kind', ['section'], 'posts', ['section', 'posts']],
      ['kind', ['term'], 'tags', ['term', 'tags']],
      ['legacy', ['page', 'term'], 'docs', ['docs']],
    ])
    expect(matchRule(map, { kind: 'section', section: 'posts', path: '/posts' })?.pattern).toBe('/blog/')
    expect(matchRule(map, { kind: 'page', section: 'Posts', path: '/posts/a' })?.pattern).toBe('/p/:slug/')
    expect(matchRule(map, { kind: 'term', section: 'docs', path: '/docs/x' })?.pattern).toBe('/d/:slug/')
    expect(matchRule(map, { kind: 'section', section: 'docs', path: '/docs' })).toBeNull()
  })

  it('matches array entries by kind, path glob, environment and language, first match wins', () => {
    const rules = permalinkRules([
      { pattern: '/news/:slug/', target: { kind: 'page', path: '/{posts,posts/**}', sites: { matrix: { languages: ['tr'] } } } },
      { pattern: '/:year/:slug/', target: { kind: 'page', path: '/posts/**' } },
      { pattern: '/staging/:slug/', target: { environment: 'staging' } },
      { pattern: '/:slug/' },
    ])
    expect(rules[0].keyPath).toEqual([0, 'pattern'])
    expect(matchRule(rules, { kind: 'page', section: 'posts', path: '/posts/a', lang: 'tr' })?.pattern).toBe('/news/:slug/')
    expect(matchRule(rules, { kind: 'page', section: 'posts', path: '/posts/a', lang: 'en' })?.pattern).toBe('/:year/:slug/')
    expect(matchRule(rules, { kind: 'section', section: 'posts', path: '/posts', env: 'staging' })?.pattern).toBe('/staging/:slug/')
    expect(matchRule(rules, { kind: 'section', section: 'posts', path: '/posts' })?.pattern).toBe('/:slug/')
  })

  it('compiles Hugo globs', () => {
    expect(globToRegExp('/posts/*')!.test('/posts/a')).toBe(true)
    expect(globToRegExp('/posts/*')!.test('/posts/a/b')).toBe(false)
    expect(globToRegExp('/posts/**')!.test('/posts/a/b')).toBe(true)
    expect(globToRegExp('/{a,b}/[!x]?')!.test('/b/yz')).toBe(true)
    expect(globToRegExp('/{a')).toBeNull()
  })
})

describe('site addresses', () => {
  const tree = {
    baseURL: 'https://example.org/blog/',
    defaultContentLanguage: 'en',
    timeZone: 'Europe/Istanbul',
    languages: { en: { weight: 1 }, TR: { weight: 2, contentDir: 'content/tr', permalinks: { page: { posts: '/yazi/:slug/' } } } },
    permalinks: { page: { posts: '/:year/:slug/' } },
    uglyURLs: { docs: true },
  }
  const config = siteUrlConfig(tree)

  it('reads languages, folders and flags in any casing', () => {
    expect(config.languages.map((l) => l.code)).toEqual(['en', 'tr'])
    expect(config.roots).toEqual([
      { dir: 'content/tr', target: '', lang: 'tr' },
      { dir: 'content', target: '', lang: null },
    ])
    expect(urlOptionsFor(config, 'docs')).toMatchObject({ uglyURLs: true, timeZone: 'Europe/Istanbul' })
    expect(urlOptionsFor(config, 'posts').uglyURLs).toBe(false)
    expect(siteUrlConfig({ baseurl: 'https://x.org/', defaultcontentlanguage: 'tr' }, { baseURL: 'https://other/' })).toMatchObject({
      baseURL: 'https://x.org/',
      defaultLanguage: 'tr',
    })
  })

  it('tells the language of a content file', () => {
    expect(contentLocation('content/tr/posts/a.md', config)).toMatchObject({ lang: 'tr', rel: 'posts/a.md' })
    expect(contentLocation('content/posts/a.tr.md', config)).toMatchObject({ lang: 'tr', rel: 'posts/a.tr.md' })
    expect(contentLocation('content/posts/a._language_tr_.md', config)?.lang).toBe('tr')
    expect(contentLanguage('content/posts/a.md', config)).toBeNull()
    expect(contentLocation('static/a.md', config)).toBeNull()
  })

  it('reads content mounts with a language', () => {
    const mounted = siteUrlConfig({
      languages: { en: {}, de: {} },
      module: {
        mounts: [
          { source: 'content/english', target: 'content' },
          { source: 'content/german', target: 'content', sites: { matrix: { languages: ['de'] } } },
          { source: 'docs', target: 'content/docs', lang: 'en' },
        ],
      },
    })
    expect(contentLocation('content/german/about.md', mounted)).toMatchObject({ lang: 'de', rel: 'about.md' })
    expect(contentLocation('docs/a/b.md', mounted)).toMatchObject({ lang: 'en', rel: 'docs/a/b.md' })
    // The default content folder is not read once content is mounted.
    expect(contentLocation('content/x.md', mounted)).toBeNull()
  })

  it('builds the base path and language prefix from the config', () => {
    expect(languagePrefix(config, 'en')).toBe('')
    expect(languagePrefix(config, 'tr')).toBe('/tr')
    expect(languagePrefix({ ...config, defaultInSubdir: true }, 'en')).toBe('/en')
    expect(languagePrefix(siteUrlConfig({ defaultContentLanguageInSubdir: true }), null)).toBe('/en')
    expect(languagePrefix(siteUrlConfig({}), 'en')).toBe('')
    const multihost = siteUrlConfig({ languages: { en: { baseURL: 'https://example.com/' }, tr: { baseURL: 'https://example.com.tr/site/' } } })
    expect(multihost.multihost).toBe(true)
    expect(languagePrefix(multihost, 'tr')).toBe('')
    expect(basePath(languageBaseURL(multihost, 'tr'))).toBe('/site')
  })

  it('computes full addresses with the language rules', () => {
    const pages = [entry('content/posts/hello.md', { title: 'Hello', date: '2024-05-01' }), entry('content/tr/posts/merhaba.md', { title: 'Merhaba', section: 'posts' })]
    const en = permalinkPage(pages[0], { config })
    expect(en).toMatchObject({ lang: 'en', section: 'posts', logicalPath: '/posts/hello' })
    expect(pageAddress(en, config)).toMatchObject({ path: '/blog/2024/hello/', url: 'https://example.org/blog/2024/hello/' })
    const tr = permalinkPage(pages[1], { config })
    expect(pageAddress(tr, config).path).toBe('/blog/tr/yazi/merhaba/')
    expect(pageAddress(tr, config, { pattern: null }).path).toBe('/blog/tr/posts/merhaba/')
    expect(pageAddress({ ...tr, title: 'Işık Gündem' }, config).url).toBe('https://example.org/blog/tr/yazi/' + encodeURI('işık-gündem') + '/')
  })

  it('lets section slugs carry over to default paths on Hugo 0.167+', () => {
    const pages = [entry('content/guide/_index.md', { kind: 'section', slug: 'Documentation' }), entry('content/guide/intro.md')]
    const page = permalinkPage(pages[1], { config, pages })
    expect(pageAddress(page, forHugo(config, { major: 0, minor: 167 })).path).toBe('/blog/documentation/intro/')
    expect(pageAddress(page, forHugo(config, { major: 0, minor: 160 })).path).toBe('/blog/guide/intro/')
  })

  it('previews with the config instead of copying the current prefix', () => {
    const pages = [entry('content/tr/posts/a.md', { title: 'A', section: 'posts', permalink: 'https://example.org/blog/tr/yazi/a/' })]
    const [change] = previewUrls({ pages, allPages: pages, currentPattern: '/yazi/:slug/', nextPattern: '/makale/:slug/', config })
    expect(change).toMatchObject({ current: '/blog/tr/yazi/a/', next: '/blog/tr/makale/a/', changed: true, mismatch: false })
    const [off] = previewUrls({ pages, allPages: pages, currentPattern: null, nextPattern: null, config })
    expect(off.mismatch).toBe(true)
  })

  it('makes aliases relative to the language site on Hugo 0.155+', () => {
    const url = 'https://example.org/blog/tr/yazi/eski/'
    expect(aliasFor(url, config, 'tr', { major: 0, minor: 160 })).toBe('/yazi/eski/')
    expect(aliasFor(url, config, 'tr', { major: 0, minor: 150 })).toBe('/tr/yazi/eski/')
    expect(aliasFor('https://example.org/blog/2024/eski/', config, 'en', null)).toBe('/2024/eski/')
    expect(aliasFor('https://example.org/blog/tr/', config, 'tr', null)).toBe('/')
  })
})
