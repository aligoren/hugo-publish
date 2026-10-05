import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { joinFrontMatter, splitFrontMatter } from '../../lib/frontmatter'
import { createEditorState, editorEolInfo, getDocText, replaceDocSpec } from './setup'
import { markdownFixtures } from './testing/fixtures'

/** Opens a whole file the way the app does: split, give the body to the editor. */
function open(content: string) {
  const parts = splitFrontMatter(content)
  const info = editorEolInfo(parts.body, parts.eol === 'crlf' ? 'crlf' : 'lf')
  const state = createEditorState(parts.body, { eol: info.eol })
  return { parts, info, state }
}

describe('open → save without edits is byte-identical', () => {
  for (const [name, content] of Object.entries(markdownFixtures)) {
    it(name, () => {
      const { parts, state } = open(content)
      expect(getDocText(state)).toBe(parts.body)
      expect(joinFrontMatter({ ...parts, body: getDocText(state) })).toBe(content)
    })
  }

  it('flags mixed line endings but still keeps every byte', () => {
    const { parts, info, state } = open(markdownFixtures['mixed-eol.md'])
    expect(info.mixed).toBe(true)
    expect(info.eol).toBe('lf')
    expect(getDocText(state)).toBe(parts.body)
    expect(state.doc.line(3).text).toBe('CRLF satırı.\r') // the stray \r stays inside its line
  })

  it('uses the CRLF separator for CRLF bodies (doc.toString() would give LF)', () => {
    const { info, state } = open(markdownFixtures['crlf.md'])
    expect(info).toEqual({ eol: 'crlf', mixed: false })
    expect(state.lineBreak).toBe('\r\n')
    expect(state.doc.toString()).not.toContain('\r')
  })
})

describe('edits produce minimal diffs in the file line ending', () => {
  it('typing a word in a CRLF file changes only that line', () => {
    const content = markdownFixtures['crlf.md']
    const { parts, state } = open(content)
    const line = state.doc.line(4)
    expect(line.text).toBe('Merhaba dünya, **kalın** ve *italik*.')
    const edited = state.update({ changes: { from: line.to, insert: ' Yeni.' } }).state
    const saved = joinFrontMatter({ ...parts, body: getDocText(edited) })
    const before = content.split('\r\n')
    const after = saved.split('\r\n')
    expect(after.length).toBe(before.length)
    const changed = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null)
    expect(changed).toHaveLength(1)
    expect(after[changed[0]!]).toBe('Merhaba dünya, **kalın** ve *italik*. Yeni.')
  })

  it('a new line typed in a CRLF document is CRLF', () => {
    const { state } = open('a\r\nb\r\n')
    const edited = state.update({ changes: { from: 1, insert: state.lineBreak + 'x' } }).state
    expect(getDocText(edited)).toBe('a\r\nx\r\nb\r\n')
  })

  it('pasted text is converted to the document line ending', () => {
    for (const [doc, separator] of [
      ['a\r\n', '\r\n'],
      ['a\n', '\n'],
    ] as const) {
      const { state } = open(doc)
      const filters = state.facet(EditorView.clipboardInputFilter)
      const pasted = filters.reduce((text, filter) => filter(text, state), 'bir\nüç\r\niki\rdört')
      expect(pasted).toBe(['bir', 'üç', 'iki', 'dört'].join(separator))
    }
  })
})

describe('replaceDocSpec', () => {
  function apply(current: string, value: string, eol: 'lf' | 'crlf') {
    const state = createEditorState(current, { eol })
    const spec = replaceDocSpec(state, value)
    return { spec, result: spec ? getDocText(state.update(spec).state) : current }
  }

  it('returns null when nothing changed', () => {
    expect(apply('a\r\nb', 'a\r\nb', 'crlf').spec).toBe(null)
  })

  it('replaces only the differing middle part', () => {
    const { spec, result } = apply('başlık\n\nbir iki üç\n', 'başlık\n\nbir 2 üç\n', 'lf')
    expect(result).toBe('başlık\n\nbir 2 üç\n')
    expect(spec?.changes).toEqual({ from: 12, to: 15, insert: '2' })
  })

  it('maps CRLF offsets to document positions and never splits a line break', () => {
    const cases: [string, string][] = [
      ['a\r\nb\r\nc', 'a\r\nB\r\nc'],
      ['a\r\nb', 'a\rX'],
      ['a\rb', 'a\r\nb'],
      ['satır\r\n\r\nson', 'satır\r\nek\r\n\r\nson'],
      ['x', ''],
      ['', 'y\r\nz'],
    ]
    for (const [current, value] of cases) {
      expect(apply(current, value, 'crlf').result).toBe(value)
    }
    const { spec } = apply('a\r\nb\r\nc', 'a\r\nB\r\nc', 'crlf')
    expect(spec?.changes).toEqual({ from: 2, to: 3, insert: 'B' })
  })
})
