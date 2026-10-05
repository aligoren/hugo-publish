import { describe, expect, it } from 'vitest'

import { diffBuilds, diffWindow, htmlForDiff, isPagePath, isTextPath, pageUrlPath } from './buildDiff'

const file = (path: string, hash: string) => ({ path, size: 1, hash })

describe('diffBuilds', () => {
  it('lists added, changed and removed files, pages first', () => {
    const before = [file('index.html', '1'), file('a/index.html', '2'), file('old/index.html', '3'), file('css/x.css', '4'), file('index.xml', '5')]
    const after = [file('index.html', '1'), file('a/index.html', '2b'), file('css/x.css', '4b'), file('new/index.html', '6'), file('img/n.png', '7'), file('index.xml', '5b')]
    const diff = diffBuilds(before, after)
    expect(diff.added.map((c) => c.path)).toEqual(['new/index.html', 'img/n.png'])
    expect(diff.changed.map((c) => c.path)).toEqual(['a/index.html', 'css/x.css', 'index.xml'])
    expect(diff.removed.map((c) => c.path)).toEqual(['old/index.html'])
    expect(diff.unchanged).toBe(1)
    expect(diff.changed[0]).toEqual({ path: 'a/index.html', kind: 'changed', isPage: true })
  })
})

describe('paths', () => {
  it('knows pages, text files and page URLs', () => {
    expect(isPagePath('a/index.html')).toBe(true)
    expect(isPagePath('a.xml')).toBe(false)
    expect(isTextPath('sitemap.xml')).toBe(true)
    expect(isTextPath('a.png')).toBe(false)
    expect(pageUrlPath('index.html')).toBe('/')
    expect(pageUrlPath('yazilar/a/index.html')).toBe('/yazilar/a/')
    expect(pageUrlPath('404.html')).toBe('/404.html')
  })
})

describe('htmlForDiff', () => {
  it('puts adjacent tags on their own lines', () => {
    expect(htmlForDiff('<p>a</p><p>b</p>\r\n<b>x</b> <i>')).toBe('<p>a</p>\n<p>b</p>\n<b>x</b> <i>')
  })
})

describe('diffWindow', () => {
  it('keeps the changed middle with some context', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 10', 'LINE 10')
    const window = diffWindow(before, after, 2)
    expect(window.skipped).toBe(8)
    expect(window.before.split('\n')).toEqual(['line 8', 'line 9', 'line 10', 'line 11', 'line 12'])
    expect(window.after.split('\n')).toEqual(['line 8', 'line 9', 'LINE 10', 'line 11', 'line 12'])
    expect(window.truncated).toBe(false)
  })

  it('cuts very long middles', () => {
    const before = Array.from({ length: 50 }, (_, i) => `a${i}`).join('\n')
    const after = Array.from({ length: 50 }, (_, i) => `b${i}`).join('\n')
    const window = diffWindow(before, after, 3, 10)
    expect(window.truncated).toBe(true)
    expect(window.before.split('\n')).toHaveLength(10)
  })

  it('handles identical texts', () => {
    expect(diffWindow('a\nb', 'a\nb', 1)).toMatchObject({ before: 'b', after: 'b', truncated: false })
  })
})
