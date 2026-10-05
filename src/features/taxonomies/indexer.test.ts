import { describe, expect, it, vi } from 'vitest'

import {
  buildTermIndex,
  filesUsingTerms,
  isTaxonomyPage,
  loadRecords,
  parseRecord,
  preferredEol,
  recordDraft,
  recordTitle,
  termsOf,
  type FileRecord,
} from './indexer'
import { DEFAULT_PATH_OPTIONS } from './urlize'

const FILES: Record<string, string> = {
  'content/yazilar/siir-notu.md':
    '---\ntitle: "Şiir Notu: 140"\ndraft: false\ncategories: ["deneme"]\ntags: ["siir", "alinti"]\n---\n\nMetin\n',
  'content/yazilar/kitap.md': '---\r\ntitle: Örnek Kitap\r\ndraft: true\r\ncategories: kitap\r\nTags:\r\n  - Kitap\r\n  - roman\r\n  - Kitap\r\n---\r\n',
  'content/yazilar/toml.md': '+++\ntitle = "TOML örneği"\ntags = ["toml", "kitap", 2024]\n+++\n',
  'content/yazilar/json.md': '{\n  "title": "JSON",\n  "categories": ["kitap"]\n}\n',
  'content/yazilar/bozuk.md': '---\ntags: [a\n---\n',
  'content/hakkinda.md': 'Front matter yok.\n',
  'content/tags/kitap/_index.md': '---\ntitle: Kitaplar\ntags: [meta]\n---\n',
}

const tomlParse = vi.fn(async (text: string) => {
  // A tiny stand-in for the Rust TOML parser, enough for the fixture.
  const values: Record<string, unknown> = {}
  for (const line of text.split('\n')) {
    const match = /^(\w+) = (.*)$/.exec(line)
    if (match) values[match[1]] = JSON.parse(match[2])
  }
  return values
})

async function records(): Promise<FileRecord[]> {
  const files = Object.keys(FILES).map((path) => ({ path, modifiedMs: 1 }))
  const map = await loadRecords(files, new Map(), {
    readText: async (path) => ({ text: FILES[path] }),
    tomlParse,
  })
  return [...map.values()]
}

describe('termsOf', () => {
  it('reads single strings and lists, skipping empties, non-terms and repeats', () => {
    expect(termsOf('kitap')).toEqual(['kitap'])
    expect(termsOf('a, b')).toEqual(['a, b'])
    expect(termsOf(['a', '', ' ', 'a', 3, true, null, { x: 1 }])).toEqual(['a', '3', 'true'])
    expect(termsOf(undefined)).toEqual([])
    expect(termsOf('')).toEqual([])
  })
})

describe('parseRecord', () => {
  it('parses YAML, JSON and TOML front matter and reports errors', async () => {
    const yaml = await parseRecord({ path: 'a.md', modifiedMs: 1 }, FILES['content/yazilar/kitap.md'], tomlParse)
    expect(yaml.format).toBe('yaml')
    expect(yaml.eol).toBe('crlf')
    expect(yaml.data.Tags).toEqual(['Kitap', 'roman', 'Kitap'])

    const toml = await parseRecord({ path: 'b.md', modifiedMs: 1 }, FILES['content/yazilar/toml.md'], tomlParse)
    expect(toml.format).toBe('toml')
    expect(tomlParse).toHaveBeenCalledWith('title = "TOML örneği"\ntags = ["toml", "kitap", 2024]\n')
    expect(toml.data.tags).toEqual(['toml', 'kitap', 2024])

    const broken = await parseRecord({ path: 'c.md', modifiedMs: 1 }, FILES['content/yazilar/bozuk.md'], tomlParse)
    expect(broken.error).toMatch(/YAML/)
    expect(broken.data).toEqual({})
  })

  it('uses the title, then the file list title, then the file name', async () => {
    const withTitle = await parseRecord({ path: 'content/a.md', modifiedMs: 1 }, '---\ntitle: Başlık\n---\n', tomlParse)
    expect(recordTitle(withTitle)).toBe('Başlık')
    const listed = await parseRecord({ path: 'content/a.md', modifiedMs: 1, title: 'Listeden' }, 'x', tomlParse)
    expect(recordTitle(listed)).toBe('Listeden')
    const bundle = await parseRecord({ path: 'content/posts/gezi/index.md', modifiedMs: 1 }, 'x', tomlParse)
    expect(recordTitle(bundle)).toBe('gezi')
    expect(recordDraft(bundle)).toBe(false)
  })
})

describe('loadRecords', () => {
  it('reuses unchanged records and reads changed or new files', async () => {
    const readText = vi.fn(async (path: string) => ({ text: `---\ntitle: ${path}\n---\n` }))
    const first = await loadRecords(
      [
        { path: 'a.md', modifiedMs: 1 },
        { path: 'b.md', modifiedMs: 1 },
      ],
      new Map(),
      { readText, tomlParse },
    )
    expect(readText).toHaveBeenCalledTimes(2)
    const progress: [number, number][] = []
    const second = await loadRecords(
      [
        { path: 'a.md', modifiedMs: 1 },
        { path: 'b.md', modifiedMs: 2 },
        { path: 'c.md', modifiedMs: 1 },
      ],
      first,
      { readText, tomlParse },
      { onProgress: (done, total) => progress.push([done, total]), concurrency: 2 },
    )
    expect(readText).toHaveBeenCalledTimes(4)
    expect([...second.keys()].sort()).toEqual(['a.md', 'b.md', 'c.md'])
    expect(second.get('a.md')).toEqual(first.get('a.md'))
    expect(progress[0]).toEqual([1, 3])
    expect(progress[progress.length - 1]).toEqual([3, 3])
  })

  it('turns read failures into records with an error and drops removed files', async () => {
    const previous = new Map([['gone.md', { path: 'gone.md' } as FileRecord]])
    const result = await loadRecords([{ path: 'x.md', modifiedMs: 1 }], previous, {
      readText: () => Promise.reject({ code: 'not_utf8', message: 'not UTF-8' }),
      tomlParse,
    })
    expect([...result.keys()]).toEqual(['x.md'])
    expect(result.get('x.md')?.error).toBe('not UTF-8')
  })

  it('stops early when cancelled', async () => {
    const signal = { cancelled: false }
    const readText = vi.fn(async () => {
      signal.cancelled = true
      return { text: '' }
    })
    const files = Array.from({ length: 10 }, (_, i) => ({ path: `${i}.md`, modifiedMs: 1 }))
    const result = await loadRecords(files, new Map(), { readText, tomlParse }, { signal, concurrency: 1 })
    expect(readText).toHaveBeenCalledTimes(1)
    expect(result.size).toBe(1)
  })
})

describe('buildTermIndex', () => {
  it('collects terms per taxonomy with posts, across YAML, TOML and JSON', async () => {
    const all = await records()
    const exclude = (path: string) => isTaxonomyPage(path, 'content', ['categories', 'tags'])
    const categories = buildTermIndex(all, 'categories', DEFAULT_PATH_OPTIONS, exclude)
    expect(categories.map((t) => [t.name, t.posts.length])).toEqual([
      ['deneme', 1],
      ['kitap', 2],
    ])
    const kitap = categories[1]
    expect(kitap.posts).toEqual([
      { path: 'content/yazilar/json.md', title: 'JSON', draft: false },
      { path: 'content/yazilar/kitap.md', title: 'Örnek Kitap', draft: true },
    ])

    const tags = buildTermIndex(all, 'tags', DEFAULT_PATH_OPTIONS, exclude)
    expect(tags.map((t) => `${t.name}:${t.posts.length}:${t.segment}`)).toEqual([
      '2024:1:2024',
      'alinti:1:alinti',
      'kitap:1:kitap',
      'Kitap:1:kitap',
      'roman:1:roman',
      'siir:1:siir',
      'toml:1:toml',
    ])
    // The term page itself is not a post.
    expect(tags.some((t) => t.name === 'meta')).toBe(false)
  })

  it('sorts with Turkish collation', () => {
    const make = (path: string, tags: string[]): FileRecord => ({
      path,
      modifiedMs: 1,
      format: 'yaml',
      data: { tags },
      eol: 'lf',
      error: null,
      fallbackTitle: null,
    })
    const terms = buildTermIndex([make('a.md', ['zeytin', 'çay', 'ılık', 'iyi', 'şeker', 'cam', 'sabah', 'ufuk', 'üzüm'])], 'tags', DEFAULT_PATH_OPTIONS)
    expect(terms.map((t) => t.name)).toEqual(['cam', 'çay', 'ılık', 'iyi', 'sabah', 'şeker', 'ufuk', 'üzüm', 'zeytin'])
  })

  it('finds the files that use given terms', async () => {
    const all = await records()
    expect(filesUsingTerms(all, 'tags', ['Kitap', 'kitap'])).toEqual(['content/yazilar/kitap.md', 'content/yazilar/toml.md'])
  })

  it('picks the line ending most files use', async () => {
    expect(preferredEol(await records())).toBe('\n')
  })
})
