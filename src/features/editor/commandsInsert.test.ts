import { EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  escapeImageAlt,
  formatImageSrc,
  insertCodeBlock,
  insertFootnote,
  insertImagesSpec,
  insertShortcode,
  insertTable,
  nextFootnoteNumber,
  toggleTaskAtCursor,
  toggleTaskSpec,
} from './commands'
import { BUILTIN_SHORTCODES } from './shortcodeDefs'
import { crlf, marked, runCommand, stateFor } from './testing/harness'

function check(command: StateCommand, input: string, expected: string | null) {
  expect(runCommand(command, input, 'lf')).toBe(expected)
  expect(runCommand(command, input, 'crlf')).toBe(expected === null ? null : crlf(expected))
}

describe('insertTable', () => {
  it('inserts a 2-column skeleton with the first header selected', () => {
    check(
      insertTable,
      'Metin\n|',
      'Metin\n\n| «Column 1» | Column 2 |\n| -------- | -------- |\n|          |          |\n|          |          |',
    )
  })

  it('uses the Column phrase', () => {
    const state = stateFor('|')
    const tr = EditorState.create({
      doc: '',
      extensions: [EditorState.phrases.of({ 'Column $': 'Sütun $' }), state.facet(EditorState.lineSeparator) ? [] : []],
    })
    let result = ''
    insertTable({ state: tr, dispatch: (t) => (result = t.state.sliceDoc()) })
    expect(result.split('\n')[0]).toBe('| Sütun 1 | Sütun 2 |')
  })
})

describe('insertCodeBlock', () => {
  it('inserts an empty fenced block, or fences the selected lines', () => {
    check(insertCodeBlock, 'a\n|\nb', 'a\n\n```\n|\n```\n\nb')
    check(insertCodeBlock, '«x := 1\ny := 2»', '```\n«x := 1\ny := 2»\n```')
  })
})

describe('insertFootnote', () => {
  it('numbers after existing footnotes and adds the definition at the end', () => {
    check(insertFootnote, 'Bir cümle|.\n', 'Bir cümle[^1].\n\n[^1]: |\n')
    check(insertFootnote, 'Bir[^1] iki|.\n\n[^1]: Var.\n', 'Bir[^1] iki[^2].\n\n[^1]: Var.\n[^2]: |\n')
    check(insertFootnote, 'Bir[^1] iki|.\n\n[^1]: Var.\n    Devam.', 'Bir[^1] iki[^2].\n\n[^1]: Var.\n    Devam.\n[^2]: |')
  })

  it('handles an empty document and a reference at the end of the text', () => {
    check(insertFootnote, '|', '[^1]\n\n[^1]: |')
    check(insertFootnote, 'Son|', 'Son[^1]\n\n[^1]: |')
  })

  it('finds the next number', () => {
    expect(nextFootnoteNumber('a[^3] b[^not] c[^10]')).toBe(11)
    expect(nextFootnoteNumber('')).toBe(1)
  })
})

describe('images', () => {
  it('escapes alt text and wraps awkward sources', () => {
    expect(escapeImageAlt('a [b] \\ c\nd')).toBe('a \\[b\\] \\\\ c d')
    expect(formatImageSrc('/img/a.jpg')).toBe('/img/a.jpg')
    expect(formatImageSrc('my photo (1).jpg')).toBe('<my photo (1).jpg>')
  })

  it('inserts one image inline and several on their own lines', () => {
    const one = stateFor('Metin |son')
    const spec = insertImagesSpec(one, [{ src: 'a.jpg', alt: 'Kedi' }])!
    expect(marked(one.update(spec).state)).toBe('Metin ![Kedi](a.jpg)|son')

    for (const eol of ['lf', 'crlf'] as const) {
      const many = stateFor('Metin |son', eol)
      const result = many.update(insertImagesSpec(many, [{ src: 'a.jpg', alt: '' }, { src: 'b.jpg', alt: 'B' }])!).state
      // The cursor waits in the empty alt text.
      const expected = 'Metin \n![|](a.jpg)\n![B](b.jpg)\nson'
      expect(marked(result)).toBe(eol === 'lf' ? expected : crlf(expected))
      const second = many.update(insertImagesSpec(many, [{ src: 'a.jpg', alt: 'A' }, { src: 'b.jpg', alt: '' }])!).state
      expect(marked(second)).toBe((eol === 'lf' ? (s: string) => s : crlf)('Metin \n![A](a.jpg)\n![|](b.jpg)\nson'))
    }
    const generic = stateFor('Metin |')
    expect(marked(generic.update(insertImagesSpec(generic, [{ src: '/img/x.png', alt: '' }])!).state)).toBe('Metin ![|](/img/x.png)')
    const drop = stateFor('|ab\n')
    expect(marked(drop.update(insertImagesSpec(drop, [{ src: 'x.png', alt: 'x' }], 3)!).state)).toBe('ab\n![x](x.png)|')
    expect(insertImagesSpec(drop, [])).toBe(null)
  })
})

describe('tasks', () => {
  it('toggles a marker with a one-character edit', () => {
    const state = stateFor('- [ ] iş\n- [x] bitti|')
    const spec = toggleTaskSpec(state, 2)!
    expect(spec.changes).toEqual({ from: 3, to: 4, insert: 'x' })
    expect(state.update(toggleTaskSpec(state, 11)!).state.sliceDoc()).toBe('- [ ] iş\n- [ ] bitti')
    expect(toggleTaskSpec(state, 0)).toBe(null)
  })

  it('toggles the tasks on the selected lines only', () => {
    check(toggleTaskAtCursor, '- [ ] bir|\n- [ ] iki', '- [x] bir|\n- [ ] iki')
    check(toggleTaskAtCursor, '> 1. [X] «bir\n> 2. [ ] iki»', '> 1. [ ] «bir\n> 2. [x] iki»')
    check(toggleTaskAtCursor, 'düz metin|', null)
  })
})

describe('insertShortcode', () => {
  const def = (name: string) => BUILTIN_SHORTCODES.find((d) => d.name === name)!
  it('inserts single tags inline and paired ones as blocks', () => {
    check(insertShortcode(def('figure')), 'Önce |sonra', 'Önce {{< figure src="|" >}}sonra')
    check(insertShortcode(def('details')), 'Metin|', 'Metin\n\n{{< details >}}\n|\n{{< /details >}}')
  })
})
