import { describe, expect, it } from 'vitest'

import type { PageEntry } from '../../../lib/api'
import {
  makeSiteIndex,
  normalizePath,
  outputCandidates,
  parseBaseUrl,
  resolveContentFile,
  resolveInternalLink,
  type SiteIndex,
} from './internalLinks'

function page(path: string, permalink: string, draft = false): PageEntry {
  return {
    path,
    slug: '',
    title: path,
    date: '',
    expiryDate: '',
    publishDate: '',
    draft,
    permalink,
    kind: 'page',
    section: '',
  }
}

function index(baseUrl = 'https://example.org/'): SiteIndex {
  const base = baseUrl.replace(/\/$/, '')
  return makeSiteIndex({
    baseUrl,
    contentDir: 'content',
    contentFiles: [
      'content/_index.md',
      'content/yazilar/a.md',
      'content/yazilar/b/index.md',
      'content/yazilar/taslak.md',
      'content/hakkinda.md',
      'content/yazilar/_index.md',
    ],
    pages: [
      page('content/_index.md', `${base}/`),
      page('content/yazilar/a.md', `${base}/yazilar/a/`),
      page('content/yazilar/b/index.md', `${base}/yazilar/b/`),
      page('content/yazilar/taslak.md', `${base}/yazilar/taslak/`, true),
      page('content/hakkinda.md', `${base}/hakk%C4%B1nda/`),
      page('content/yazilar/_index.md', `${base}/yazilar/`),
    ],
    outputFiles: [
      'index.html',
      'yazilar/index.html',
      'yazilar/a/index.html',
      'yazilar/b/index.html',
      'yazilar/b/kapak.jpg',
      'hakkında/index.html',
      'images/logo.png',
      'index.xml',
    ],
  })
}

const resolve = (source: string, url: string, source_kind: 'markdown' | 'ref' = 'markdown', idx = index()) =>
  resolveInternalLink(source, { url, line: 1, source: source_kind }, idx)

describe('helpers', () => {
  it('parses baseURL', () => {
    expect(parseBaseUrl('https://example.org')).toEqual({ host: 'example.org', basePath: '/' })
    expect(parseBaseUrl('https://user.github.io/blog/')).toEqual({ host: 'user.github.io', basePath: '/blog/' })
    expect(parseBaseUrl('/')).toEqual({ host: null, basePath: '/' })
    expect(parseBaseUrl(undefined)).toEqual({ host: null, basePath: '/' })
  })

  it('maps URL paths to output files', () => {
    expect(outputCandidates('/', '/')).toEqual(['index.html'])
    expect(outputCandidates('/a/', '/')).toEqual(['a/index.html'])
    expect(outputCandidates('/a', '/')).toEqual(['a', 'a/index.html', 'a.html'])
    expect(outputCandidates('/blog/a/', '/blog/')).toEqual(['a/index.html'])
  })

  it('normalizes paths', () => {
    expect(normalizePath('content/yazilar/../hakkinda')).toBe('content/hakkinda')
    expect(normalizePath('/a/./b//c/')).toBe('/a/b/c')
  })

  it('finds content files like Hugo refs do', () => {
    const idx = index()
    expect(resolveContentFile('content/yazilar/a.md', 'b', idx)).toBe('content/yazilar/b/index.md')
    expect(resolveContentFile('content/yazilar/a.md', '../hakkinda.md', idx)).toBe('content/hakkinda.md')
    expect(resolveContentFile('content/hakkinda.md', '/yazilar/a', idx)).toBe('content/yazilar/a.md')
    expect(resolveContentFile('content/hakkinda.md', 'yazilar', idx)).toBe('content/yazilar/_index.md')
    expect(resolveContentFile('content/hakkinda.md', 'a.md', idx)).toBe('content/yazilar/a.md')
    expect(resolveContentFile('content/hakkinda.md', 'yok.md', idx)).toBeNull()
  })
})

describe('resolveInternalLink', () => {
  it('accepts links that exist in the build', () => {
    for (const url of ['/yazilar/a/', '/yazilar/a', 'https://www.example.org/yazilar/b/', '/images/logo.png', '/index.xml', '/hakkında/']) {
      expect(resolve('content/hakkinda.md', url)?.problem, url).toBeNull()
    }
  })

  it('resolves relative links from the page URL', () => {
    expect(resolve('content/yazilar/b/index.md', 'kapak.jpg')).toMatchObject({ problem: null, outputFile: 'yazilar/b/kapak.jpg' })
    expect(resolve('content/yazilar/a.md', 'kapak.jpg')?.problem).toBe('missing')
    expect(resolve('content/yazilar/a.md', '../b/')).toMatchObject({ problem: null, outputFile: 'yazilar/b/index.html' })
  })

  it('reports missing and unpublished targets', () => {
    expect(resolve('content/hakkinda.md', '/yok/')?.problem).toBe('missing')
    expect(resolve('content/hakkinda.md', '/yazilar/taslak/')?.problem).toBe('unpublished')
    expect(resolve('content/hakkinda.md', 'yazilar/taslak.md', 'ref')?.problem).toBe('unpublished')
    expect(resolve('content/hakkinda.md', 'yazilar/yok.md', 'ref')?.problem).toBe('contentMissing')
  })

  it('passes fragments on for checking against the target page', () => {
    expect(resolve('content/hakkinda.md', '/yazilar/a/#giriş')).toMatchObject({
      outputFile: 'yazilar/a/index.html',
      fragment: 'giriş',
    })
    expect(resolve('content/yazilar/a.md', '#sonuç')).toMatchObject({ outputFile: 'yazilar/a/index.html', fragment: 'sonuç' })
    expect(resolve('content/hakkinda.md', 'yazilar/b.md#bolum', 'ref')).toMatchObject({
      outputFile: 'yazilar/b/index.html',
      fragment: 'bolum',
    })
    expect(resolve('content/yazilar/a.md', '../hakkinda.md')).toMatchObject({ outputFile: 'hakkında/index.html', problem: null })
  })

  it('cannot judge relative links on pages outside the build', () => {
    expect(resolve('content/yazilar/taslak.md', '#x')).toMatchObject({ unknown: true, problem: null })
    expect(resolve('content/nowhere.md', 'img.png')).toMatchObject({ unknown: true, problem: null })
  })

  it('ignores external and non-web links', () => {
    expect(resolve('content/hakkinda.md', 'https://other.org/')).toBeNull()
    expect(resolve('content/hakkinda.md', 'mailto:a@b.c')).toBeNull()
  })

  it('strips a baseURL path prefix', () => {
    const idx = index('https://user.github.io/blog/')
    expect(resolve('content/hakkinda.md', '/blog/yazilar/a/', 'markdown', idx)?.problem).toBeNull()
    expect(resolve('content/yazilar/b/index.md', 'kapak.jpg', 'markdown', idx)?.problem).toBeNull()
  })
})
