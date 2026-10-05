import { describe, expect, it, vi } from 'vitest'

import type { ConfigOp } from '../../lib/api'
import { FrontMatterReadOnlyError } from '../../lib/frontmatter'
import {
  findTermPages,
  newTermPage,
  planTermPageMove,
  readTermPage,
  termPageFolder,
  termPagePath,
  updateTermPage,
} from './termPage'
import { DEFAULT_PATH_OPTIONS, termSegment } from './urlize'

const BOM = String.fromCharCode(0xfeff)

const noToml = {
  tomlParseText: () => Promise.reject(new Error('not TOML')),
  tomlEditText: () => Promise.reject(new Error('not TOML')),
}

describe('paths', () => {
  it('builds and finds term pages', () => {
    expect(termPagePath('content', 'tags', 'kitap')).toBe('content/tags/kitap/_index.md')
    expect(termPageFolder('content/tags/kitap/_index.md')).toBe('content/tags/kitap')
    const pages = findTermPages(
      [
        'content/tags/Kitap Notu/_index.tr.md',
        'content/tags/Kitap Notu/_index.md',
        'content/tags/roman/_index.en.md',
        'content/tags/roman/index.md',
        'content/tags/_index.md',
        'content/categories/kitap/_index.md',
        'content/tags/a/b/_index.md',
      ],
      'content',
      'tags',
      DEFAULT_PATH_OPTIONS,
    )
    expect([...pages.entries()]).toEqual([
      ['kitap-notu', 'content/tags/Kitap Notu/_index.md'],
      ['roman', 'content/tags/roman/_index.en.md'],
    ])
  })
})

describe('reading and writing term pages', () => {
  it('reads title and description from YAML and TOML', async () => {
    const yaml = await readTermPage('---\nTitle: Kitaplar\ndescription: "Okuma notları"\n---\n', noToml)
    expect(yaml).toEqual({ fields: { title: 'Kitaplar', description: 'Okuma notları' }, editable: true })
    const toml = await readTermPage('+++\ntitle = "x"\n+++\n', { ...noToml, tomlParseText: async () => ({ title: 'x' }) })
    expect(toml.fields).toEqual({ title: 'x', description: '' })
    const json = await readTermPage('{"title": "j"}\n', noToml)
    expect(json).toEqual({ fields: { title: 'j', description: '' }, editable: false })
  })

  it('creates a new page with YAML front matter', () => {
    expect(newTermPage({ title: 'Kitap: notlar', description: '' })).toBe('---\ntitle: "Kitap: notlar"\n---\n')
    expect(newTermPage({ title: 'a', description: 'b "c"' }, '\r\n')).toBe('---\r\ntitle: "a"\r\ndescription: "b \\"c\\""\r\n---\r\n')
  })

  it('changes only the edited YAML fields', async () => {
    const text = "---\r\ntitle: 'Kitaplar' # başlık\r\ndate: 2026-01-01\r\n---\r\n\r\nGövde\r\n"
    const out = await updateTermPage(text, { title: 'Kitap Notları', description: 'Okuduklarım' }, noToml)
    expect(out).toBe("---\r\ntitle: 'Kitap Notları' # başlık\r\ndate: 2026-01-01\r\ndescription: 'Okuduklarım'\r\n---\r\n\r\nGövde\r\n")
    expect(await updateTermPage(text, { title: 'Kitaplar', description: '' }, noToml)).toBe(text)
  })

  it('removes a field that is emptied', async () => {
    const text = '---\ntitle: x\ndescription: y\n---\n'
    expect(await updateTermPage(text, { title: 'x', description: '' }, noToml)).toBe('---\ntitle: x\n---\n')
  })

  it('adds front matter to a page that has none, keeping the BOM and body', async () => {
    const out = await updateTermPage(`${BOM}Gövde\r\n`, { title: 'T', description: '' }, noToml)
    expect(out).toBe(`${BOM}---\r\ntitle: "T"\r\n---\r\nGövde\r\n`)
  })

  it('edits TOML through tomlEditText', async () => {
    const tomlEditText = vi.fn(async (_text: string, _ops: ConfigOp[]) => 'title = "Yeni"\n')
    const out = await updateTermPage('+++\ntitle = "Eski"\ndescription = "d"\n+++\nGövde\n', { title: 'Yeni', description: '' }, {
      tomlParseText: async () => ({ title: 'Eski', description: 'd' }),
      tomlEditText,
    })
    expect(tomlEditText).toHaveBeenCalledWith('title = "Eski"\ndescription = "d"\n', [
      { op: 'set', path: ['title'], value: 'Yeni' },
      { op: 'remove', path: ['description'] },
    ])
    expect(out).toBe('+++\ntitle = "Yeni"\n+++\nGövde\n')
  })

  it('refuses JSON', async () => {
    await expect(updateTermPage('{"title": "a"}\n', { title: 'b', description: '' }, noToml)).rejects.toBeInstanceOf(
      FrontMatterReadOnlyError,
    )
  })
})

describe('planTermPageMove', () => {
  const termsOf = (...names: string[]) => names.map((name) => ({ name, segment: termSegment(name) }))
  const pages = new Map([
    ['kitap', 'content/tags/kitap/_index.md'],
    ['roman', 'content/tags/roman/_index.md'],
  ])
  const plan = (edit: Parameters<typeof planTermPageMove>[0], names: string[]) =>
    planTermPageMove(edit, termsOf(...names), pages, 'content', 'tags', DEFAULT_PATH_OPTIONS)

  it('moves the page of a renamed term', () => {
    expect(plan({ kind: 'rename', from: ['kitap'], to: 'Kitap Notları' }, ['kitap', 'felsefe'])).toEqual({
      move: { from: 'content/tags/kitap', to: 'content/tags/kitap-notları' },
      kept: [],
    })
  })

  it('needs no move when the segment stays the same', () => {
    expect(plan({ kind: 'rename', from: ['kitap'], to: 'Kitap' }, ['kitap'])).toEqual({ move: null, kept: [] })
  })

  it('keeps pages when the target has a page or another term still uses it', () => {
    expect(plan({ kind: 'rename', from: ['kitap'], to: 'roman' }, ['kitap', 'roman'])).toEqual({
      move: null,
      kept: ['content/tags/kitap/_index.md'],
    })
    expect(plan({ kind: 'rename', from: ['Kitap'], to: 'book' }, ['Kitap', 'kitap'])).toEqual({ move: null, kept: [] })
  })

  it('keeps the pages of deleted terms', () => {
    expect(plan({ kind: 'delete', terms: ['kitap', 'roman'] }, ['kitap', 'roman'])).toEqual({
      move: null,
      kept: ['content/tags/kitap/_index.md', 'content/tags/roman/_index.md'],
    })
  })
})
