import { describe, expect, it } from 'vitest'

import type { ContentFile } from '../../lib/api'
import { automaticArchetype, buildPostPath, contentSections, findDuplicate, normalizeSection, setTitle, setTomlTitle } from './paths'

const file = (path: string): ContentFile => ({ path, title: null, modifiedMs: 0 })

describe('contentSections', () => {
  it('finds sections, counts posts and bundles, lists the top level last', () => {
    const files = [
      file('content/_index.md'),
      file('content/hakkında.md'),
      file('content/posts/_index.md'),
      file('content/posts/a.md'),
      file('content/posts/b/index.md'),
      file('content/posts/c/index.md'),
      file('content/notlar/x.md'),
      file('content/projeler/_index.md'),
      file('content/blog/2026/y.md'),
      file('static/z.md'),
    ]
    expect(contentSections(files)).toEqual([
      { path: 'posts', posts: 3, bundles: 2 },
      { path: 'blog/2026', posts: 1, bundles: 0 },
      { path: 'notlar', posts: 1, bundles: 0 },
      { path: 'projeler', posts: 0, bundles: 0 },
      { path: '', posts: 1, bundles: 0 },
    ])
  })

  it('handles an empty site', () => {
    expect(contentSections([])).toEqual([])
  })
})

describe('paths', () => {
  it('builds single-file and bundle paths', () => {
    expect(buildPostPath({ section: 'posts', slug: 'ilk-yazi', bundle: false })).toBe('content/posts/ilk-yazi.md')
    expect(buildPostPath({ section: 'posts', slug: 'ilk-yazi', bundle: true })).toBe('content/posts/ilk-yazi/index.md')
    expect(buildPostPath({ section: '', slug: 'hakkinda', bundle: false })).toBe('content/hakkinda.md')
    expect(buildPostPath({ contentDir: 'icerik', section: 'a/b', slug: 'c', bundle: false })).toBe('icerik/a/b/c.md')
  })

  it('normalizes typed section names', () => {
    expect(normalizeSection('Gezi Notları')).toBe('gezi-notlari')
    expect(normalizeSection(' Blog / 2026 \\ Ekim ')).toBe('blog/2026/ekim')
    expect(normalizeSection('///')).toBe('')
  })

  it('detects pages at the same address, ignoring case and the bundle form', () => {
    const files = [file('content/posts/ilk-yazi.md'), file('content/posts/Gezi/index.md'), file('content/notlar/_index.md')]
    expect(findDuplicate('content/posts/ilk-yazi.md', files)).toBe('content/posts/ilk-yazi.md')
    expect(findDuplicate('content/posts/ilk-yazi/index.md', files)).toBe('content/posts/ilk-yazi.md')
    expect(findDuplicate('content/posts/gezi.md', files)).toBe('content/posts/Gezi/index.md')
    expect(findDuplicate('content/notlar.md', files)).toBe('content/notlar/_index.md')
    expect(findDuplicate('content/posts/yeni.md', files)).toBeNull()
  })

  it('knows which archetype Hugo picks by itself', () => {
    expect(automaticArchetype('posts', ['default', 'posts'])).toBe('posts')
    expect(automaticArchetype('posts/2026', ['posts'])).toBe('posts')
    expect(automaticArchetype('notlar', ['default', 'posts'])).toBe('default')
    expect(automaticArchetype('', ['posts'])).toBeNull()
  })
})

describe('setTitle', () => {
  it('replaces a YAML title keeping everything else, CRLF included', () => {
    const text = '---\r\ntitle: "Ilk Yazi"\r\ndate: 2026-10-04T10:00:00+03:00\r\ndraft: true\r\n---\r\n\r\nBuraya.\r\n'
    expect(setTitle(text, 'İlk yazı: "Merhaba" & ğüş')).toBe(
      '---\r\ntitle: "İlk yazı: \\"Merhaba\\" & ğüş"\r\ndate: 2026-10-04T10:00:00+03:00\r\ndraft: true\r\n---\r\n\r\nBuraya.\r\n',
    )
  })

  it('adds a YAML title when missing, or front matter when there is none', () => {
    expect(setTitle('---\ndraft: true\n---\n', 'Başlık')).toBe('---\ndraft: true\ntitle: Başlık\n---\n')
    expect(setTitle('Sadece metin\n', 'Başlık')).toBe('---\ntitle: Başlık\n---\nSadece metin\n')
  })

  it('edits TOML titles, keeping literal quotes when possible', () => {
    const text = "+++\ndate = '2026-10-04'\ntitle = 'Ilk Yazi'\n[params]\ntitle = 'x'\n+++\n"
    expect(setTitle(text, 'İlk yazı')).toBe("+++\ndate = '2026-10-04'\ntitle = 'İlk yazı'\n[params]\ntitle = 'x'\n+++\n")
    expect(setTitle(text, "Ali'nin yazısı")).toBe("+++\ndate = '2026-10-04'\ntitle = \"Ali'nin yazısı\"\n[params]\ntitle = 'x'\n+++\n")
    expect(setTomlTitle('draft = true\r\n', 'A "b"', '\r\n')).toBe('title = "A \\"b\\""\r\ndraft = true\r\n')
    expect(setTomlTitle('[params]\ntitle = "x"\n', 'Y', '\n')).toBe('title = "Y"\n[params]\ntitle = "x"\n')
  })

  it('edits JSON titles', () => {
    expect(setTitle('{\n  "title": "Ilk",\n  "draft": true\n}\nMetin\n', 'İlk "yazı"')).toBe(
      '{\n  "title": "İlk \\"yazı\\"",\n  "draft": true\n}\nMetin\n',
    )
    expect(setTitle('{\n  "draft": true\n}\n', 'A')).toBe('{\n  "title": "A",\n  "draft": true\n}\n')
    expect(JSON.parse(setTitle('{}\n', 'A').trim())).toEqual({ title: 'A' })
  })
})
