import { describe, expect, it } from 'vitest'
import { fixture, markdownFixtures } from '../features/editor/testing/fixtures'
import { detectEol, splitLinesKeepEol } from './eol'
import {
  deleteField,
  editFrontMatter,
  editYamlText,
  ensureYamlFrontMatter,
  FrontMatterError,
  FrontMatterReadOnlyError,
  getField,
  isFrontMatterEditable,
  isFrontMatterReadOnly,
  joinFrontMatter,
  readFrontMatter,
  setField,
  splitFrontMatter,
  type FrontMatterFormat,
} from './frontmatter'

/** Line-level diff: lines (with their line break) only in `a`, and only in `b`. */
function lineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const x = splitLinesKeepEol(a).map((l) => l.text + l.eol)
  const y = splitLinesKeepEol(b).map((l) => l.text + l.eol)
  const table = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const removed: string[] = []
  const added: string[] = []
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      i++
      j++
    } else if (j < y.length && (i === x.length || table[i][j + 1] >= table[i + 1][j])) {
      added.push(y[j++])
    } else {
      removed.push(x[i++])
    }
  }
  return { removed, added }
}

function edit(name: string, change: (parts: ReturnType<typeof splitFrontMatter>) => ReturnType<typeof splitFrontMatter>) {
  const original = fixture(name)
  const result = joinFrontMatter(change(splitFrontMatter(original)))
  return { original, result, diff: lineDiff(original, result) }
}

const expectedFormats: Record<string, FrontMatterFormat | null> = {
  'alerts.md': 'yaml',
  'archetype.md': 'yaml',
  'bom-crlf.md': 'yaml',
  'bom.md': 'yaml',
  'crlf.md': 'yaml',
  'empty-frontmatter.md': 'yaml',
  'footnotes.md': 'yaml',
  'frontmatter-json.md': 'json',
  'frontmatter-only.md': 'yaml',
  'frontmatter-toml.md': 'toml',
  'frontmatter-yaml.md': 'yaml',
  'html-comments.md': 'yaml',
  'mixed-eol.md': 'yaml',
  'no-frontmatter.md': null,
  'no-trailing-newline.md': 'yaml',
  'rtl-block.md': 'yaml',
  'shortcodes.md': 'yaml',
  'tables-tasks.md': 'yaml',
  'toml-crlf.md': 'toml',
  'turkish-placeholders.md': 'yaml',
  'yaml-unusual-format.md': 'yaml',
}

describe('fixture corpus', () => {
  it('has every expected fixture', () => {
    expect(Object.keys(markdownFixtures).sort()).toEqual(Object.keys(expectedFormats).sort())
  })

  for (const [name, content] of Object.entries(markdownFixtures)) {
    it(`${name}: join(split(x)) === x and the format is detected`, () => {
      const parts = splitFrontMatter(content)
      expect(joinFrontMatter(parts)).toBe(content)
      expect(parts.format).toBe(expectedFormats[name])
    })
  }

  for (const [name, content] of Object.entries(markdownFixtures)) {
    const parts = splitFrontMatter(content)
    if (parts.format !== 'yaml' || name === 'archetype.md') continue
    it(`${name}: a no-op YAML edit is byte-identical`, () => {
      expect(joinFrontMatter(editFrontMatter(parts, () => {}))).toBe(content)
      // Setting a field to its current value changes nothing either.
      const data = readFrontMatter(parts) ?? {}
      for (const [key, value] of Object.entries(data)) {
        expect(joinFrontMatter(setField(parts, [key], value as never))).toBe(content)
      }
    })
  }
})

describe('splitFrontMatter', () => {
  it('splits YAML with exact delimiters', () => {
    const parts = splitFrontMatter('---\ntitle: x\n---\nbody\n')
    expect(parts).toEqual({
      bom: false,
      eol: 'lf',
      format: 'yaml',
      open: '---\n',
      frontMatterText: 'title: x\n',
      close: '---\n',
      body: 'body\n',
    })
  })

  it('keeps CRLF and BOM out of the YAML text', () => {
    const parts = splitFrontMatter(fixture('bom-crlf.md'))
    expect(parts.bom).toBe(true)
    expect(parts.eol).toBe('crlf')
    expect(parts.open).toBe('---\r\n')
    expect(parts.close).toBe('---\r\n')
    expect(parts.frontMatterText.startsWith('title:')).toBe(true)
    expect(parts.body.startsWith('\r\n> [!TIP]')).toBe(true)
  })

  it('handles a closing delimiter at the end of the file', () => {
    const parts = splitFrontMatter(fixture('frontmatter-only.md'))
    expect(parts.close).toBe('---')
    expect(parts.body).toBe('')
  })

  it('handles empty front matter', () => {
    const parts = splitFrontMatter(fixture('empty-frontmatter.md'))
    expect(parts.frontMatterText).toBe('')
    expect(parts.body).toBe('\nBoş ön bilgi.\n')
  })

  it('splits TOML and JSON and marks them read-only', () => {
    const toml = splitFrontMatter(fixture('frontmatter-toml.md'))
    expect(toml.open).toBe('+++\n')
    expect(toml.close).toBe('+++\n')
    expect(toml.frontMatterText).toContain('[params]')
    expect(isFrontMatterReadOnly(toml)).toBe(true)
    expect(isFrontMatterEditable(toml)).toBe(false)

    const json = splitFrontMatter(fixture('frontmatter-json.md'))
    expect(json.open).toBe('')
    expect(json.frontMatterText.startsWith('{')).toBe(true)
    expect(json.frontMatterText.endsWith('}')).toBe(true)
    expect(json.close).toBe('\n')
    expect(json.body).toBe('\nMerhaba dünya. Ön bilgi JSON.\n')
    expect(isFrontMatterReadOnly(json)).toBe(true)
  })

  it('does not treat a horizontal rule or a leading shortcode as front matter', () => {
    expect(splitFrontMatter(fixture('no-frontmatter.md')).format).toBe(null)
    expect(splitFrontMatter('{{< figure src="a.jpg" >}}\n').format).toBe(null)
    expect(splitFrontMatter('---\nno closing delimiter\n').format).toBe(null)
    expect(splitFrontMatter('---').format).toBe(null)
  })

  it('allows leading blank lines like Hugo does', () => {
    const parts = splitFrontMatter('\n---\na: 1\n---\nx')
    expect(parts.format).toBe('yaml')
    expect(parts.open).toBe('\n---\n')
    expect(joinFrontMatter(parts)).toBe('\n---\na: 1\n---\nx')
  })
})

describe('readFrontMatter', () => {
  it('keeps dates as the strings written in the file', () => {
    const parts = splitFrontMatter(fixture('frontmatter-yaml.md'))
    const data = readFrontMatter(parts)
    expect(data?.date).toBe('2026-10-03T00:11:40+03:00')
    expect(data?.tags).toEqual(['kitap', 'deneme'])
    expect(data?.description).toBe('')
    expect(getField(parts, 'cover.image')).toBe('')
    expect(getField(parts, ['series', 1])).toBe('ikinci')
    expect(getField(parts, 'missing.key')).toBe(undefined)
  })

  it('reads JSON, returns null for TOML and for no front matter', () => {
    expect(readFrontMatter(splitFrontMatter(fixture('frontmatter-json.md')))?.title).toBe('JSON örneği')
    expect(readFrontMatter(splitFrontMatter(fixture('frontmatter-toml.md')))).toBe(null)
    expect(readFrontMatter(splitFrontMatter(fixture('no-frontmatter.md')))).toBe(null)
    expect(readFrontMatter(splitFrontMatter(fixture('empty-frontmatter.md')))).toEqual({})
  })

  it('reports invalid YAML', () => {
    const parts = splitFrontMatter('---\ntitle: [unclosed\n---\n')
    expect(() => readFrontMatter(parts)).toThrow(FrontMatterError)
    expect(() => setField(parts, 'title', 'x')).toThrow(FrontMatterError)
  })
})

describe('setField / deleteField: minimal diffs', () => {
  it('changes only the title line and keeps double quotes', () => {
    const { diff } = edit('frontmatter-yaml.md', (p) => setField(p, 'title', 'Yeni başlık'))
    expect(diff).toEqual({ removed: ['title: "Merhaba dünya"\n'], added: ['title: "Yeni başlık"\n'] })
  })

  it('keeps single quotes and date strings verbatim', () => {
    const { diff } = edit('frontmatter-yaml.md', (p) =>
      setField(setField(p, 'summary', 'Kısa özet'), 'lastmod', '2026-10-05T10:00:00+03:00'),
    )
    expect(diff.removed).toEqual(["lastmod: 2026-10-04T08:05:00+03:00\n", "summary: ''\n"])
    expect(diff.added).toEqual(['lastmod: 2026-10-05T10:00:00+03:00\n', "summary: 'Kısa özet'\n"])
  })

  it('fills an empty string value', () => {
    const { diff } = edit('frontmatter-yaml.md', (p) => setField(p, 'description', 'Bir özet: iki nokta ile'))
    expect(diff).toEqual({ removed: ['description: ""\n'], added: ['description: "Bir özet: iki nokta ile"\n'] })
  })

  it('updates a flow array in place', () => {
    const { diff } = edit('frontmatter-yaml.md', (p) => setField(p, 'tags', ['kitap', 'deneme', 'yeni']))
    expect(diff).toEqual({ removed: ['tags: ["kitap", "deneme"]\n'], added: ['tags: ["kitap", "deneme", "yeni"]\n'] })
  })

  it('fills an empty flow array with the quote style of sibling arrays', () => {
    const { diff } = edit('frontmatter-yaml.md', (p) => setField(p, 'aliases', ['/eski-adres/']))
    expect(diff).toEqual({ removed: ['aliases: []\n'], added: ['aliases: ["/eski-adres/"]\n'] })
  })

  it('creates a new array as flow when siblings are flow', () => {
    const { diff } = edit('frontmatter-yaml.md', (p) => setField(p, 'keywords', ['bir', 'iki']))
    expect(diff).toEqual({ removed: [], added: ['keywords: ["bir", "iki"]\n'] })
  })

  it('creates new strings in the sibling style (dates stay plain)', () => {
    const { result, diff } = edit('frontmatter-yaml.md', (p) =>
      setField(setField(p, 'subtitle', 'Alt başlık'), 'publishDate', '2026-10-03T00:11:40+03:00'),
    )
    expect(diff).toEqual({
      removed: [],
      added: ['subtitle: "Alt başlık"\n', 'publishDate: 2026-10-03T00:11:40+03:00\n'],
    })
    expect(readFrontMatter(splitFrontMatter(result))?.publishDate).toBe('2026-10-03T00:11:40+03:00')
  })

  it('keeps a trailing comment on an edited nested value', () => {
    const { diff } = edit('frontmatter-yaml.md', (p) => setField(p, 'cover.image', '/img/kapak.jpg'))
    expect(diff).toEqual({
      removed: ['  image: "" # kapak görseli yolu\n'],
      added: ['  image: "/img/kapak.jpg" # kapak görseli yolu\n'],
    })
  })

  it('adds a nested key under an existing map', () => {
    const { result, diff } = edit('frontmatter-yaml.md', (p) => setField(p, ['params', 'math'], true))
    expect(diff).toEqual({ removed: [], added: ['  math: true\n'] })
    expect(result).toContain('params:\n  toc: true\n  math: true\nseries:')
  })

  it('creates a missing parent map', () => {
    const { diff } = edit('alerts.md', (p) => setField(p, 'params.toc', true))
    expect(diff).toEqual({ removed: [], added: ['params:\n', '  toc: true\n'] })
  })

  it('updates a block sequence in place', () => {
    const { diff } = edit('frontmatter-yaml.md', (p) => setField(p, 'series', ['ilk', 'ikinci', 'üçüncü']))
    expect(diff).toEqual({ removed: [], added: ['  - üçüncü\n'] })
  })

  it('writes multi-line strings as a literal block', () => {
    const { diff } = edit('frontmatter-yaml.md', (p) => setField(p, 'summary', 'satır 1\nsatır 2'))
    expect(diff.removed).toEqual(["summary: ''\n"])
    expect(diff.added).toEqual(['summary: |-\n', '  satır 1\n', '  satır 2\n'])
  })

  it('deletes a field and keeps the comment above it', () => {
    const { result, diff } = edit('frontmatter-yaml.md', (p) => deleteField(p, 'description'))
    expect(diff).toEqual({ removed: ['description: ""\n'], added: [] })
    expect(result).toContain("# 1-2 cümlelik özet yaz\nsummary: ''\n")
  })

  it('deletes a nested field and an array item', () => {
    expect(edit('frontmatter-yaml.md', (p) => deleteField(p, 'cover.relative')).diff).toEqual({
      removed: ['  relative: false\n'],
      added: [],
    })
    expect(edit('frontmatter-yaml.md', (p) => deleteField(p, ['series', 0])).diff).toEqual({
      removed: ['  - ilk\n'],
      added: [],
    })
  })

  it('deleting a missing field is a no-op', () => {
    const parts = splitFrontMatter(fixture('frontmatter-yaml.md'))
    expect(deleteField(parts, 'nope')).toBe(parts)
    expect(setField(parts, 'draft', false)).toBe(parts)
  })

  it('keeps CRLF line endings, including on new lines', () => {
    const { result, diff } = edit('crlf.md', (p) => setField(setField(p, 'title', 'Yeni'), 'slug', 'yeni'))
    expect(diff).toEqual({
      removed: ['title: "Satır sonu CRLF"\r\n'],
      // Sibling text values are double-quoted, so the new one is too.
      added: ['title: "Yeni"\r\n', 'slug: "yeni"\r\n'],
    })
    expect(detectEol(result)).toBe('crlf')
  })

  it('keeps BOM and CRLF when deleting', () => {
    const { result, diff } = edit('bom-crlf.md', (p) => deleteField(p, 'date'))
    expect(diff).toEqual({ removed: ['date: 2026-10-03T00:11:40+03:00\r\n'], added: [] })
    expect(result.charCodeAt(0)).toBe(0xfeff)
    expect(detectEol(result)).toBe('crlf')
  })

  it('keeps the line endings of untouched lines in a mixed file', () => {
    const { result, diff } = edit('mixed-eol.md', (p) => setField(p, 'tags', ['karisik', 'yeni']))
    expect(diff).toEqual({ removed: ['tags: ["karisik"]\n'], added: ['tags: ["karisik", "yeni"]\n'] })
    expect(result).toContain('title: "Karışık satır sonları"\r\n')
  })

  it('preserves untouched lines that yaml would reformat', () => {
    const name = 'yaml-unusual-format.md'
    expect(edit(name, (p) => setField(p, 'description', 'kısa')).diff).toEqual({
      removed: ['description: "uzun bir satır"\n'],
      added: ['description: "kısa"\n'],
    })
    expect(edit(name, (p) => setField(p, 'params.toc', false)).diff).toEqual({
      removed: ['    toc: true\n'],
      added: ['    toc: false\n'],
    })
    expect(edit(name, (p) => setField(p, 'params.nested.deep', 2)).diff).toEqual({
      removed: ['        deep: 1\n'],
      added: ['        deep: 2\n'],
    })
    expect(edit(name, (p) => setField(p, 'list', ['bir', 'iki', 'üç'])).diff).toEqual({
      removed: [],
      added: ['- üç\n'],
    })
    expect(edit(name, (p) => setField(p, 'params.yeni', 'x')).diff).toEqual({
      removed: [],
      added: ['    yeni: x\n'],
    })
    // The edited line itself is printed by yaml (single space before the comment).
    expect(edit(name, (p) => setField(p, 'title', 'Yeni')).diff).toEqual({
      removed: ['title:   "Biçimi alışılmadık"   # fazla boşluklu yorum\n'],
      added: ['title: "Yeni" # fazla boşluklu yorum\n'],
    })
  })

  it('writes into empty front matter and creates front matter when missing', () => {
    const empty = edit('empty-frontmatter.md', (p) => setField(p, 'title', 'Merhaba'))
    expect(empty.result).toBe('---\ntitle: Merhaba\n---\n\nBoş ön bilgi.\n')

    const none = edit('no-frontmatter.md', (p) => setField(ensureYamlFrontMatter(p), 'title', 'Başlık'))
    expect(none.result).toBe('---\ntitle: Başlık\n---\n' + fixture('no-frontmatter.md'))

    const crlf = joinFrontMatter(setField(ensureYamlFrontMatter(splitFrontMatter('a\r\nb\r\n')), 'x', 1))
    expect(crlf).toBe('---\r\nx: 1\r\n---\r\na\r\nb\r\n')
  })

  it('works on a file whose closing delimiter has no line break', () => {
    const { result } = edit('frontmatter-only.md', (p) => setField(p, 'draft', false))
    expect(result).toBe('---\ntitle: "Yalnızca ön bilgi"\ndraft: false\n---')
  })

  it('removing every field leaves empty front matter, not `{}`', () => {
    const parts = splitFrontMatter('---\na: 1\n---\n')
    expect(joinFrontMatter(deleteField(parts, 'a'))).toBe('---\n---\n')
  })

  it('refuses to edit TOML, JSON or missing front matter', () => {
    for (const name of ['frontmatter-toml.md', 'frontmatter-json.md', 'no-frontmatter.md']) {
      const parts = splitFrontMatter(fixture(name))
      expect(() => setField(parts, 'title', 'x')).toThrow(FrontMatterReadOnlyError)
      expect(() => deleteField(parts, 'title')).toThrow(FrontMatterReadOnlyError)
    }
  })
})

describe('every edit parses back to the intended data', () => {
  const edits: [string, (p: ReturnType<typeof splitFrontMatter>) => ReturnType<typeof splitFrontMatter>, (d: Record<string, unknown>) => void][] = [
    ['set title', (p) => setField(p, 'title', 'Yeni: başlık'), (d) => (d.title = 'Yeni: başlık')],
    ['add tags', (p) => setField(p, 'tags', ['a', 'b c']), (d) => (d.tags = ['a', 'b c'])],
    ['nested', (p) => setField(p, 'params.toc', false), (d) => (d.params = { ...(d.params as object), toc: false })],
    ['delete date', (p) => deleteField(p, 'date'), (d) => delete d.date],
    ['number', (p) => setField(p, 'weight', 3), (d) => (d.weight = 3)],
  ]
  for (const [name, content] of Object.entries(markdownFixtures)) {
    const parts = splitFrontMatter(content)
    if (parts.format !== 'yaml' || name === 'archetype.md') continue
    it(name, () => {
      for (const [, apply, expectData] of edits) {
        const expected = structuredClone(readFrontMatter(parts) ?? {})
        expectData(expected)
        const result = joinFrontMatter(apply(parts))
        const reparsed = splitFrontMatter(result)
        expect(readFrontMatter(reparsed)).toEqual(expected)
        expect(reparsed.body).toBe(parts.body)
        expect(reparsed.bom).toBe(parts.bom)
      }
    })
  }
})

describe('editYamlText', () => {
  it('keeps comments and blank lines around an edit', () => {
    const text = '# baş\na: 1\n\n# bölüm\nb: 2 # satır sonu\n'
    const result = editYamlText(text, (doc) => doc.set('b', 3))
    expect(result).toBe('# baş\na: 1\n\n# bölüm\nb: 3 # satır sonu\n')
  })

  it('adds to a comment-only document without yaml placeholders', () => {
    expect(editYamlText('# yalnız yorum\n', (doc) => doc.set('a', 1))).toBe('# yalnız yorum\na: 1\n')
    expect(editYamlText('', (doc) => doc.set('a', 1))).toBe('a: 1\n')
  })

  it('uses the fallback line break when the text has none', () => {
    expect(editYamlText('', (doc) => doc.set('a', 1), { eol: '\r\n' })).toBe('a: 1\r\n')
  })
})
