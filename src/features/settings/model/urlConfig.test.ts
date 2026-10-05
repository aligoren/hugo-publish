import { describe, expect, it } from 'vitest'

import type { PageEntry } from '../../../lib/api'
import { permalinkPage } from '../../../lib/permalinks'
import { sourcesOf } from './testing'
import { editedRule, mergedFiles, mergeTrees, patternWith, permalinkGroups, urlConfigOf } from './urlConfig'

function entry(path: string, extra: Partial<PageEntry> = {}): PageEntry {
  return { path, slug: '', title: 'A Page', date: '2024-03-05', expiryDate: '', publishDate: '', draft: false, permalink: '', kind: 'page', section: 'posts', ...extra }
}

describe('URL settings in the settings view', () => {
  it('merges config files like Hugo: keys in any casing, later files win, lists replaced', () => {
    expect(mergeTrees({ Params: { a: 1, list: [1] }, title: 'x' }, { params: { b: 2, list: [2] } })).toEqual({ Params: { a: 1, b: 2, list: [2] }, title: 'x' })
    const sources = sourcesOf({
      'hugo.toml': { baseURL: 'https://example.org/', permalinks: { page: { posts: '/:year/:slug/' } } },
      'config/_default/languages.toml': { tr: { contentDir: 'content/tr' } },
      'config/production/hugo.toml': { baseURL: 'https://www.example.org/' },
    })
    expect(mergedFiles(sources, null)).toMatchObject({ baseURL: 'https://example.org/', languages: { tr: { contentDir: 'content/tr' } } })
    expect(mergedFiles(sources, 'production').baseURL).toBe('https://www.example.org/')
  })

  it('reads the files first, then hugo config, with content folders made site-relative', () => {
    const config = urlConfigOf({ baseURL: 'https://example.org/' }, { baseurl: 'https://other/', languages: { en: { contentdir: 'C:/site/content/en' }, tr: {} } }, null, 'C:/site')
    expect(config.baseURL).toBe('https://example.org/')
    expect(config.roots.map((r) => [r.dir, r.lang])).toEqual([
      ['content/en', 'en'],
      ['content', null],
    ])
  })

  it('groups pages by kind and section', () => {
    const groups = permalinkGroups([entry('content/posts/a.md'), entry('content/posts/_index.md', { kind: 'section' }), entry('content/about.md', { section: '' }), entry('content/tags/go/_index.md', { kind: 'term', section: 'tags' })])
    expect([...groups]).toEqual([
      ['page', ['posts']],
      ['section', ['posts']],
      ['term', ['tags']],
    ])
  })

  it('edits the rule in the files, or writes a new per-kind pattern', () => {
    const files = { permalinks: { posts: '/old/:slug/' } }
    const config = urlConfigOf(files, null)
    const page = permalinkPage(entry('content/posts/a.md'), { config })
    expect(editedRule(page, config, files, 'page', 'posts', null)).toMatchObject({ rule: { form: 'legacy' }, writePath: ['permalinks', 'posts'], arrayForm: false })
    const empty = urlConfigOf({}, null)
    expect(editedRule(page, empty, {}, 'page', 'posts', null)).toMatchObject({ rule: null, writePath: ['permalinks', 'page', 'posts'] })
  })

  it('edits array entries in place and cannot add one', () => {
    const files = { permalinks: [{ pattern: '/a/:slug/', target: { kind: 'page', path: '/posts/**' } }] }
    const config = urlConfigOf(files, null)
    const posts = permalinkPage(entry('content/posts/a.md'), { config })
    expect(editedRule(posts, config, files, 'page', 'posts', null)).toMatchObject({ writePath: ['permalinks', 0, 'pattern'], arrayForm: true })
    const docs = permalinkPage(entry('content/docs/a.md', { section: 'docs' }), { config })
    expect(editedRule(docs, config, files, 'page', 'docs', null)).toMatchObject({ rule: null, writePath: null, arrayForm: true })
  })

  it('does not write rules that only hugo config knows into their array position', () => {
    const effective = { permalinks: [{ pattern: '/:year/:slug/', target: { kind: 'page', path: '/{posts,posts/**}' } }] }
    const config = urlConfigOf({}, effective)
    const page = permalinkPage(entry('content/posts/a.md'), { config })
    expect(editedRule(page, config, {}, 'page', 'posts', null)).toMatchObject({ rule: { pattern: '/:year/:slug/' }, writePath: ['permalinks', 'page', 'posts'] })
  })

  it('gives the draft to the pages of the edited rule only', () => {
    const files = {
      permalinks: [
        { pattern: '/a/:slug/', target: { kind: 'page', path: '/posts/a*' } },
        { pattern: '/b/:slug/', target: { kind: 'page' } },
      ],
    }
    const config = urlConfigOf(files, null)
    const a = permalinkPage(entry('content/posts/a1.md'), { config })
    const b = permalinkPage(entry('content/posts/b1.md'), { config })
    const edited = editedRule(a, config, files, 'page', 'posts', null).rule
    const choose = patternWith(config, edited, '/new/:slug/', { kind: 'page', section: 'posts' }, null)
    expect([choose(a), choose(b)]).toEqual(['/new/:slug/', '/b/:slug/'])
    const fresh = patternWith(urlConfigOf({}, null), null, '/x/', { kind: 'page', section: 'posts' }, null)
    expect([fresh(a), fresh({ ...a, section: 'docs' })]).toEqual(['/x/', null])
  })
})
