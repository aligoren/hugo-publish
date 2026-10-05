import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: {} }))

import { joinFrontMatter, splitFrontMatter } from '../../lib/frontmatter'
import {
  applyFrontMatterOps,
  applyOpsToValues,
  applyTomlOps,
  coalesceOps,
  findKey,
  getIn,
  type FrontMatterOp,
} from './frontMatterOps'
import { fakeTomlEdit } from './testing/fakeToml'

const YAML = [
  '---',
  '# Yazının ana bilgileri',
  'title: "Merhaba dünya"',
  'date: 2026-10-03T00:11:40+03:00',
  'draft: false',
  "summary: ''",
  'tags: ["kitap", "deneme"]',
  'series:',
  '  - ilk',
  '  - ikinci',
  'cover:',
  '  image: "" # kapak görseli yolu',
  '  alt: ""',
  '---',
  '',
  'Gövde.',
  '',
].join('\r\n')

const TOML = ['+++', '# TOML yorumu', 'title = "TOML örneği"', 'date = 2026-10-03T00:11:40+03:00', "tags = ['toml']", '', '[params]', '  toc = true', '+++', '', 'Gövde.', ''].join('\n')

const toml = { tomlEditText: vi.fn(async (text: string, ops: Parameters<typeof fakeTomlEdit>[1]) => fakeTomlEdit(text, ops)) }

async function edit(text: string, ops: FrontMatterOp[]) {
  return joinFrontMatter(await applyFrontMatterOps(splitFrontMatter(text), ops, toml))
}

describe('YAML front matter', () => {
  it('changes only the edited lines and keeps CRLF', async () => {
    const result = await edit(YAML, [{ op: 'set', path: ['title'], value: 'Yeni başlık' }])
    expect(result).toBe(YAML.replace('title: "Merhaba dünya"', 'title: "Yeni başlık"'))
  })

  it('keeps flow and block list styles', async () => {
    const result = await edit(YAML, [
      { op: 'set', path: ['tags'], value: ['kitap', 'deneme', 'roman'] },
      { op: 'set', path: ['series'], value: ['ilk', 'ikinci', 'üçüncü'] },
    ])
    expect(result).toBe(
      YAML.replace('tags: ["kitap", "deneme"]', 'tags: ["kitap", "deneme", "roman"]').replace(
        '  - ikinci\r\n',
        '  - ikinci\r\n  - üçüncü\r\n',
      ),
    )
  })

  it('sets nested keys and keeps their comments', async () => {
    const result = await edit(YAML, [{ op: 'set', path: ['cover', 'image'], value: '/images/kapak.png' }])
    expect(result).toBe(YAML.replace('image: "" # kapak', 'image: "/images/kapak.png" # kapak'))
  })

  it('keeps the date format as given and adds keys at the end', async () => {
    const result = await edit(YAML, [
      { op: 'set', path: ['date'], value: '2026-10-05T10:30:00+03:00' },
      { op: 'set', path: ['lastmod'], value: '2026-10-06' },
    ])
    expect(result).toContain('date: 2026-10-05T10:30:00+03:00\r\n')
    expect(result).toContain('  alt: ""\r\nlastmod: 2026-10-06\r\n---')
  })

  it('removes keys', async () => {
    const result = await edit(YAML, [{ op: 'remove', path: ['summary'] }])
    expect(result).toBe(YAML.replace("summary: ''\r\n", ''))
  })

  it('creates YAML front matter for a file without one', async () => {
    expect(await edit('Sadece gövde.\n', [{ op: 'set', path: ['title'], value: 'Başlık' }])).toBe('---\ntitle: Başlık\n---\nSadece gövde.\n')
  })

  it('refuses JSON front matter', async () => {
    await expect(edit('{"title": "x"}\n\nbody', [{ op: 'set', path: ['title'], value: 'y' }])).rejects.toThrow(/read-only/)
  })
})

describe('TOML front matter (through toml_edit)', () => {
  it('sends ops to the Rust editor and keeps the rest', async () => {
    toml.tomlEditText.mockClear()
    const result = await edit(TOML, [{ op: 'set', path: ['title'], value: 'Yeni' }])
    expect(toml.tomlEditText).toHaveBeenCalledWith(splitFrontMatter(TOML).frontMatterText, [{ op: 'set', path: ['title'], value: 'Yeni' }])
    expect(result).toBe(TOML.replace('"TOML örneği"', '"Yeni"'))
  })

  it('keeps a bare date-time bare and literal strings literal', async () => {
    const result = await edit(TOML, [
      { op: 'set', path: ['date'], value: '2026-10-05T10:30:00+03:00' },
      { op: 'set', path: ['tags'], value: ['toml', 'yeni'] },
    ])
    expect(result).toBe(TOML.replace('2026-10-03T00:11:40+03:00', '2026-10-05T10:30:00+03:00').replace("['toml']", "['toml', 'yeni']"))
  })

  it('writes a new date bare when asked', async () => {
    const result = await edit(TOML, [{ op: 'set', path: ['lastmod'], value: '2026-10-06T08:00:00+03:00', datetime: true }])
    expect(result).toContain("tags = ['toml']\nlastmod = 2026-10-06T08:00:00+03:00\n\n[params]")
  })

  it('edits keys in tables and removes keys', async () => {
    const result = await edit(TOML, [
      { op: 'set', path: ['params', 'toc'], value: false },
      { op: 'remove', path: ['tags'] },
    ])
    expect(result).toBe(TOML.replace('toc = true', 'toc = false').replace("tags = ['toml']\n", ''))
  })

  it('never sends null to TOML', async () => {
    await expect(applyTomlOps('a = 1\n', [{ op: 'set', path: ['a'], value: null }], toml)).rejects.toThrow()
  })
})

describe('helpers', () => {
  it('coalesces consecutive edits of the same field', () => {
    const ops: FrontMatterOp[] = [
      { op: 'set', path: ['title'], value: 'a' },
      { op: 'set', path: ['title'], value: 'ab' },
      { op: 'set', path: ['tags'], value: [] },
      { op: 'set', path: ['title'], value: 'abc' },
    ]
    expect(coalesceOps(ops)).toEqual([ops[1], ops[2], ops[3]])
  })

  it('applies ops to plain values', () => {
    const values = { title: 'x', cover: { image: '', alt: '' }, tags: ['a'] }
    const next = applyOpsToValues(values, [
      { op: 'set', path: ['cover', 'image'], value: 'a.png' },
      { op: 'remove', path: ['tags'] },
      { op: 'set', path: ['build', 'list'], value: 'never' },
    ])
    expect(next).toEqual({ title: 'x', cover: { image: 'a.png', alt: '' }, build: { list: 'never' } })
    expect(values.cover.image).toBe('')
    expect(getIn(next, ['cover', 'image'])).toBe('a.png')
  })

  it('finds keys regardless of case', () => {
    expect(findKey({ publishdate: 1, Tags: [] }, 'publishDate')).toBe('publishdate')
    expect(findKey({ Tags: [] }, 'tags')).toBe('Tags')
    expect(findKey(null, 'x')).toBeUndefined()
  })
})
