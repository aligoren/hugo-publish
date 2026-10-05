import { EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api', () => ({
  api: {},
  isAppError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && 'message' in e,
}))

import type { ConfigOp } from '../../../lib/api'
import { fakeTomlEdit, fakeTomlParse } from '../testing/fakeToml'
import {
  initialValues,
  missingRequired,
  parseSnippets,
  SNIPPETS_FILE_HEADER,
  snippetFromShortcode,
  snippetOps,
  starterSnippets,
  validateSnippet,
  type SnippetDef,
} from './definitions'
import { snippetInsertion } from './insert'
import { renderTemplate } from './template'
import { previewSnippetOps, readSnippetsFile } from './useSnippets'

const FILE = [
  '# Sitemizin kalıpları',
  '',
  '[[snippet]]',
  'id = "kitap"',
  'name = "Kitap"',
  'output = "markdown"',
  '# alanlar',
  'fields = [{ key = "title", label = "Başlık", kind = "text", required = true }, { key = "year", label = "Yıl", kind = "number" }]',
  'template = """',
  '> **{{title}}**{{#year}}, {{year}}{{/year}}',
  '"""',
  '',
  '[[snippet]]',
  'name = "Bozuk"',
  '',
  '[[snippet]]',
  'id = "video"',
  'name = "Video"',
  'output = "shortcode"',
  'fields = [{ key = "id", label = "Kimlik", kind = "unknown" }]',
  "template = '{{< youtube \"{{id}}\" >}}'",
  '',
].join('\n')

const toml = { tomlEditText: async (text: string, ops: ConfigOp[]) => fakeTomlEdit(text, ops) }

describe('parseSnippets', () => {
  it('reads definitions and reports broken entries', () => {
    const { snippets, problems } = parseSnippets(fakeTomlParse(FILE))
    expect(problems).toEqual(['#2: template'])
    expect(snippets.map((s) => [s.index, s.id, s.output])).toEqual([
      [0, 'kitap', 'markdown'],
      [2, 'video', 'shortcode'],
    ])
    expect(snippets[0].fields).toEqual([
      { key: 'title', label: 'Başlık', kind: 'text', required: true },
      { key: 'year', label: 'Yıl', kind: 'number' },
    ])
    // Unknown kinds fall back to text.
    expect(snippets[1].fields[0].kind).toBe('text')
    expect(snippets[0].template).toBe('> **{{title}}**{{#year}}, {{year}}{{/year}}\n')
  })
})

describe('writing definitions', () => {
  const { snippets } = parseSnippets(fakeTomlParse(FILE))

  it('sets only the changed keys of an edited snippet, keeping comments', async () => {
    const edited = { ...snippets[0], name: 'Kitap künyesi' }
    const ops = snippetOps(snippets, [edited, snippets[1]])
    expect(ops).toEqual([{ op: 'set', path: ['snippet', 0, 'name'], value: 'Kitap künyesi' }])
    const text = await toml.tomlEditText(FILE, ops)
    expect(text).toBe(FILE.replace('name = "Kitap"', 'name = "Kitap künyesi"'))
  })

  it('appends new snippets and deletes removed ones, last first', async () => {
    const quote = starterSnippets(labels).find((s) => s.id === 'quote')!
    const ops = snippetOps(snippets, [quote])
    expect(ops.map((op) => [op.op, op.path])).toEqual([
      ['appendTable', ['snippet']],
      ['remove', ['snippet', 2]],
      ['remove', ['snippet', 0]],
    ])
    const text = await toml.tomlEditText(FILE, ops)
    const parsed = parseSnippets(fakeTomlParse(text))
    expect(parsed.snippets.map((s) => s.id)).toEqual(['quote'])
    expect(parsed.snippets[0].template).toBe(quote.template)
    expect(text.startsWith('# Sitemizin kalıpları\n')).toBe(true)
  })

  it('creates a missing file with a header comment', async () => {
    const file = await readSnippetsFile({
      readText: async () => Promise.reject({ code: 'io', message: 'not found' }),
      tomlParseText: async (text) => ({ values: fakeTomlParse(text) }),
    })
    expect(file).toEqual({ text: '', version: null, snippets: [], problems: [] })
    const book = starterSnippets(labels)[0]
    const text = await previewSnippetOps(file, snippetOps([], [book]), toml)
    expect(text.startsWith(SNIPPETS_FILE_HEADER)).toBe(true)
    expect(parseSnippets(fakeTomlParse(text)).snippets[0]).toMatchObject({ id: 'book', fields: book.fields, template: book.template })
  })

  it('validates definitions', () => {
    const def: SnippetDef = { id: 'kitap', name: ' ', output: 'markdown', fields: [{ key: '1x', label: '', kind: 'select' }, { key: '1x', label: '', kind: 'text' }], template: '' }
    expect(validateSnippet(def, snippets)).toEqual(['name', 'idTaken', 'template', 'fieldKey', 'fieldDuplicate', 'options'])
    expect(validateSnippet(starterSnippets(labels)[0], snippets)).toEqual([])
  })
})

describe('starters and shortcodes', () => {
  it('renders the starter examples', () => {
    const [book, quote] = starterSnippets(labels)
    const values = { ...initialValues(book), title: 'Suç ve Ceza', author: 'Dostoyevski', year: 1866 }
    expect(renderTemplate(book.template, { keys: book.fields.map((f) => f.key), values })).toBe('> **Suç ve Ceza** · Dostoyevski\n')
    expect(missingRequired(book, initialValues(book))).toEqual(['title'])
    const q = { text: 'Bir\niki', author: 'Yunus', source: '' }
    expect(renderTemplate(quote.template, { keys: quote.fields.map((f) => f.key), values: q })).toBe('> Bir\n> iki\n>\n> — Yunus\n')
  })

  it('makes a snippet from a shortcode with optional named parameters', () => {
    const def = snippetFromShortcode(
      {
        name: 'figure',
        source: 'builtin',
        paired: false,
        params: [
          { name: 'src', required: true },
          { name: 'caption' },
        ],
      },
      ['figure'],
    )
    expect(def.id).toBe('figure-2')
    expect(def.template).toBe('{{< figure src="{{src|attr}}"{{#caption}} caption="{{caption|attr}}"{{/caption}} >}}')
    const render = (values: Record<string, string>) => renderTemplate(def.template, { keys: def.fields.map((f) => f.key), values })
    expect(render({ src: '/a.png', caption: '' })).toBe('{{< figure src="/a.png" >}}')
    expect(render({ src: '/a.png', caption: 'Bir "kapak"' })).toBe('{{< figure src="/a.png" caption="Bir \\"kapak\\"" >}}')

    const paired = snippetFromShortcode({ name: 'details', source: 'theme', paired: true, markdown: true, params: [{ name: 'summary', positional: 0 }] }, [])
    expect(paired.template).toBe('{{% details "{{summary|attr}}" %}}\n{{inner}}\n{{% /details %}}')
  })
})

describe('snippetInsertion', () => {
  const apply = (doc: string, at: number, text: string, crlf = false) => {
    const state = EditorState.create({ doc, selection: { anchor: at }, extensions: crlf ? [EditorState.lineSeparator.of('\r\n')] : [] })
    const next = state.update(snippetInsertion(state, text)).state
    return { doc: next.sliceDoc(), cursor: next.selection.main.head }
  }

  it('inserts inline text at the cursor', () => {
    expect(apply('ab', 1, 'X')).toEqual({ doc: 'aXb', cursor: 2 })
  })

  it('puts a block on its own paragraph', () => {
    expect(apply('Paragraf.', 9, '> blok\n> iki\n').doc).toBe('Paragraf.\n\n> blok\n> iki')
    expect(apply('A\n\nB', 2, 'x\ny').doc).toBe('A\n\nx\ny\n\nB')
    expect(apply('', 0, 'x\ny\n')).toEqual({ doc: 'x\ny', cursor: 3 })
  })

  it('uses the document’s line break', () => {
    const result = apply('A\r\n\r\nB', 3, 'x\ny', true)
    expect(result.doc).toBe('A\r\n\r\nx\r\ny\r\n\r\nB')
    expect(result.cursor).toBe(3 + 'x\r\ny'.length)
  })
})

const labels = {
  book: 'Kitap',
  bookDescription: '',
  quote: 'Alıntı',
  quoteDescription: '',
  product: 'Ürün',
  productDescription: '',
  title: 'Başlık',
  author: 'Yazar',
  publisher: 'Yayınevi',
  year: 'Yıl',
  isbn: 'ISBN',
  link: 'Bağlantı',
  text: 'Metin',
  source: 'Kaynak',
  name: 'Ad',
  image: 'Görsel',
  price: 'Fiyat',
  description: 'Açıklama',
}
