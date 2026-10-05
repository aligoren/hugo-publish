import { describe, expect, it, vi } from 'vitest'

import type { ConfigOp } from '../../lib/api'
import { FrontMatterReadOnlyError } from '../../lib/frontmatter'
import {
  editChanges,
  editTermList,
  frontMatterBlock,
  planTermEdit,
  rewriteTerms,
  tomlTermOps,
  writePlan,
  type TermEdit,
  type TomlDeps,
} from './termEdit'

const rename = (from: string | string[], to: string): TermEdit => ({
  kind: 'rename',
  from: Array.isArray(from) ? from : [from],
  to,
})
const remove = (...terms: string[]): TermEdit => ({ kind: 'delete', terms })

const noToml: TomlDeps = {
  tomlEditText: () => Promise.reject(new Error('not TOML')),
  tomlParseText: () => Promise.reject(new Error('not TOML')),
}

const yaml = (head: string, body = '\nMetin.\n') => `---\n${head}---\n${body}`

describe('editTermList', () => {
  it('renames in place and keeps order', () => {
    expect(editTermList(['a', 'kitap', 'b'], rename('kitap', 'roman'))).toEqual(['a', 'roman', 'b'])
  })

  it('merges and keeps the target once, where it first appears', () => {
    expect(editTermList(['Kitap', 'roman', 'kitap'], rename(['Kitap', 'kitap'], 'kitap'))).toEqual(['kitap', 'roman'])
    expect(editTermList(['roman', 'kitap', 'Kitap'], rename('Kitap', 'kitap'))).toEqual(['roman', 'kitap'])
    expect(editTermList(['kitaplar', 'roman', 'kitap'], rename('kitaplar', 'kitap'))).toEqual(['kitap', 'roman'])
  })

  it('deletes', () => {
    expect(editTermList(['a', 'b', 'c'], remove('a', 'c'))).toEqual(['b'])
  })

  it('leaves unrelated repeats alone', () => {
    expect(editTermList(['x', 'x', 'a'], rename('a', 'b'))).toEqual(['x', 'x', 'b'])
  })
})

describe('editChanges', () => {
  it('detects whether a value would change', () => {
    expect(editChanges(['a', 'b'], rename('a', 'c'))).toBe(true)
    expect(editChanges(['a', 'b'], rename('z', 'c'))).toBe(false)
    expect(editChanges('a', rename('a', 'a'))).toBe(false)
    expect(editChanges('a', remove('a'))).toBe(true)
    expect(editChanges([2024], rename('2024', '2024'))).toBe(false)
    expect(editChanges(undefined, remove('a'))).toBe(false)
  })
})

describe('rewriteTerms: YAML', () => {
  it('keeps a flow list flow and quoted, touching only that line', async () => {
    const text = yaml('title: "Şiir Notu: 140"\ncategories: ["deneme"]\ntags: ["siir", "alinti"] # not\n')
    const out = await rewriteTerms(text, 'tags', rename('alinti', 'alintilar'), noToml)
    expect(out).toBe(yaml('title: "Şiir Notu: 140"\ncategories: ["deneme"]\ntags: ["siir", "alintilar"] # not\n'))
  })

  it('keeps a block list block, with the quote style and comment of the changed item', async () => {
    const text = yaml("title: x\ntags:\n  - bir   # ilk\n  - 'iki' # yorum\n  - üç\ndate: 2026-10-01\n")
    const out = await rewriteTerms(text, 'tags', rename('iki', 'İki'), noToml)
    expect(out).toBe(yaml("title: x\ntags:\n  - bir   # ilk\n  - 'İki' # yorum\n  - üç\ndate: 2026-10-01\n"))
  })

  it('removes items from a block list and keeps the others byte for byte', async () => {
    const text = yaml('tags:\n- bir\n- iki\n- üç\n')
    expect(await rewriteTerms(text, 'tags', remove('iki'), noToml)).toBe(yaml('tags:\n- bir\n- üç\n'))
  })

  it('dedupes when merging into a term the post already has', async () => {
    const text = yaml('tags: [Kitap, roman, kitap]\n')
    expect(await rewriteTerms(text, 'tags', rename(['Kitap', 'kitap'], 'kitap'), noToml)).toBe(yaml('tags: [kitap, roman]\n'))
    const block = yaml('tags:\n  - "roman"\n  - "kitap"\n  - "Kitap"\n')
    expect(await rewriteTerms(block, 'tags', rename('Kitap', 'kitap'), noToml)).toBe(yaml('tags:\n  - "roman"\n  - "kitap"\n'))
  })

  it('renames a single string value and keeps its quotes', async () => {
    const text = yaml("categories: 'kitap'\ntags: []\n")
    expect(await rewriteTerms(text, 'categories', rename('kitap', 'roman'), noToml)).toBe(
      yaml("categories: 'roman'\ntags: []\n"),
    )
  })

  it('deletes a single string value by removing the key', async () => {
    const text = yaml('title: x\ncategories: kitap\ndraft: false\n')
    expect(await rewriteTerms(text, 'categories', remove('kitap'), noToml)).toBe(yaml('title: x\ndraft: false\n'))
  })

  it('keeps the comment above a removed single-value key', async () => {
    const text = yaml('title: x\n# kategori\ncategories: kitap\ndraft: false\n')
    expect(await rewriteTerms(text, 'categories', remove('kitap'), noToml)).toBe(yaml('title: x\n# kategori\ndraft: false\n'))
  })

  it('leaves an empty list when the last term is deleted', async () => {
    expect(await rewriteTerms(yaml('tags: ["a"]\n'), 'tags', remove('a'), noToml)).toBe(yaml('tags: []\n'))
    expect(await rewriteTerms(yaml('tags:\n  - a\nx: 1\n'), 'tags', remove('a'), noToml)).toBe(yaml('tags: []\nx: 1\n'))
  })

  it('preserves CRLF line endings and the BOM', async () => {
    const text = '\uFEFF---\r\ntitle: "Başlık"\r\ntags: ["a", "b"]\r\n---\r\n\r\nGövde\r\n'
    const out = await rewriteTerms(text, 'tags', rename('b', 'c d'), noToml)
    expect(out).toBe('\uFEFF---\r\ntitle: "Başlık"\r\ntags: ["a", "c d"]\r\n---\r\n\r\nGövde\r\n')
  })

  it('matches the key without regard to case', async () => {
    const text = yaml('Tags: [a]\n')
    expect(await rewriteTerms(text, 'tags', rename('a', 'b'), noToml)).toBe(yaml('Tags: [b]\n'))
  })

  it('quotes a new value when the plain form would mean something else', async () => {
    const text = yaml('tags: [a, b]\n')
    const out = await rewriteTerms(text, 'tags', rename('a', 'x, y'), noToml)
    expect(out).toContain('"x, y"')
    const numberLike = await rewriteTerms(yaml('tags:\n  - a\n'), 'tags', rename('a', '2024'), noToml)
    expect(numberLike).toMatch(/- ["']2024["']/)
  })

  it('returns the text unchanged when the post does not use the term', async () => {
    const text = yaml('tags: [a]\n')
    expect(await rewriteTerms(text, 'tags', rename('z', 'y'), noToml)).toBe(text)
    expect(await rewriteTerms('Just text\n', 'tags', rename('z', 'y'), noToml)).toBe('Just text\n')
  })

  it('does not touch the body even when it contains the term', async () => {
    const text = yaml('tags: [kitap]\n', '\ntags: [kitap]\n')
    expect(await rewriteTerms(text, 'tags', rename('kitap', 'roman'), noToml)).toBe(yaml('tags: [roman]\n', '\ntags: [kitap]\n'))
  })
})

describe('rewriteTerms: TOML', () => {
  function tomlDeps(values: Record<string, unknown>, result: string) {
    const deps = {
      tomlParseText: vi.fn(async () => values),
      tomlEditText: vi.fn(async (_text: string, _ops: ConfigOp[]) => result),
    }
    return deps
  }

  it('sends set ops for lists through tomlEditText and keeps the fences and body', async () => {
    const head = '# yorum\r\ntitle = "TOML"\r\ntags = ["toml", "örnek"]\r\n'
    const text = `+++\r\n${head}+++\r\n\r\nGövde\r\n`
    const newHead = '# yorum\r\ntitle = "TOML"\r\ntags = ["toml", "misal"]\r\n'
    const deps = tomlDeps({ title: 'TOML', tags: ['toml', 'örnek'] }, newHead)
    const out = await rewriteTerms(text, 'tags', rename('örnek', 'misal'), deps)
    expect(deps.tomlParseText).toHaveBeenCalledWith(head)
    expect(deps.tomlEditText).toHaveBeenCalledWith(head, [{ op: 'set', path: ['tags'], value: ['toml', 'misal'] }])
    expect(out).toBe(`+++\r\n${newHead}+++\r\n\r\nGövde\r\n`)
  })

  it('does not call tomlEditText when nothing changes', async () => {
    const deps = tomlDeps({ tags: ['a'] }, 'unused')
    const text = '+++\ntags = ["a"]\n+++\n'
    expect(await rewriteTerms(text, 'tags', rename('b', 'c'), deps)).toBe(text)
    expect(deps.tomlEditText).not.toHaveBeenCalled()
  })

  it('builds ops for single values, deletes and merges', () => {
    expect(tomlTermOps({ Categories: 'kitap' }, 'categories', rename('kitap', 'roman'))).toEqual([
      { op: 'set', path: ['Categories'], value: 'roman' },
    ])
    expect(tomlTermOps({ categories: 'kitap' }, 'categories', remove('kitap'))).toEqual([
      { op: 'remove', path: ['categories'] },
    ])
    expect(tomlTermOps({ tags: ['Kitap', 'kitap', 3] }, 'tags', rename(['Kitap', 'kitap'], 'kitap'))).toEqual([
      { op: 'set', path: ['tags'], value: ['kitap', 3] },
    ])
  })
})

describe('rewriteTerms: JSON', () => {
  it('refuses to change JSON front matter that uses the term', async () => {
    const text = '{\n  "title": "x",\n  "tags": ["a"]\n}\n\nMetin\n'
    await expect(rewriteTerms(text, 'tags', rename('a', 'b'), noToml)).rejects.toBeInstanceOf(FrontMatterReadOnlyError)
    expect(await rewriteTerms(text, 'tags', rename('z', 'b'), noToml)).toBe(text)
  })
})

describe('planTermEdit and writePlan', () => {
  const files: Record<string, string> = {
    'content/a.md': yaml('tags: [kitap]\n'),
    'content/b.md': '{"tags": ["kitap"]}\n',
    'content/c.md': yaml('tags: [x\n'),
    'content/d.md': yaml('tags: [roman]\n'),
  }
  const deps = {
    ...noToml,
    readText: vi.fn(async (path: string) => ({ text: files[path], version: `v-${path}` })),
  }

  it('reads files fresh, computes changes and reports files it cannot change', async () => {
    const progress: number[] = []
    const plan = await planTermEdit(Object.keys(files), 'tags', rename('kitap', 'roman'), deps, (done) => progress.push(done))
    expect(plan.files).toEqual([
      { path: 'content/a.md', before: files['content/a.md'], after: yaml('tags: [roman]\n'), version: 'v-content/a.md' },
    ])
    expect(plan.skipped.map((s) => [s.path, s.reason])).toEqual([
      ['content/b.md', 'readOnly'],
      ['content/c.md', 'error'],
    ])
    expect(progress).toEqual([1, 2, 3, 4])
  })

  it('writes with the expected version and keeps going after a conflict', async () => {
    const conflict = { code: 'conflict', message: 'changed' }
    const writeText = vi.fn(async (path: string) => {
      if (path === 'x.md') throw conflict
      return 'new'
    })
    const snapshot = vi.fn(async () => undefined)
    const outcome = await writePlan(
      [
        { path: 'x.md', before: 'a', after: 'b', version: 'v1' },
        { path: 'y.md', before: 'c', after: 'd', version: 'v2' },
      ],
      { writeText, snapshot },
    )
    expect(writeText).toHaveBeenCalledWith('x.md', 'b', 'v1')
    expect(writeText).toHaveBeenCalledWith('y.md', 'd', 'v2')
    expect(snapshot).toHaveBeenCalledWith('y.md', 'c')
    expect(outcome).toEqual({ written: ['y.md'], failed: [{ path: 'x.md', error: conflict }] })
  })
})

describe('writePlan snapshots', () => {
  it('writes even when the history snapshot fails', async () => {
    const writeText = vi.fn(async () => 'v')
    const outcome = await writePlan([{ path: 'a.md', before: 'a', after: 'b', version: 'v1' }], {
      writeText,
      snapshot: () => Promise.reject(new Error('no history')),
    })
    expect(outcome.written).toEqual(['a.md'])
  })
})

describe('frontMatterBlock', () => {
  it('returns the fenced front matter only', () => {
    expect(frontMatterBlock(yaml('tags: [a]\n'))).toBe('---\ntags: [a]\n---\n')
  })
})
