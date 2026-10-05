// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorStats } from './contract'
import { buildFocusDecorations, paragraphLines, typewriterScroll } from './focusMode'
import { createEditorState } from './setup'
import { computeStats, countCharacters, countWords, readingMinutes } from './stats'

describe('writing statistics', () => {
  it('counts Turkish words with apostrophes and hyphens as one', () => {
    expect(countWords('İstanbul’un ılık ŞEHİR havası, e-posta ve 2024 yılı.')).toBe(8)
    expect(countWords('ışık Işık IŞIK')).toBe(3)
    expect(countWords('')).toBe(0)
  })

  it('leaves markup out', () => {
    const text = [
      '## Başlık {#id}',
      '',
      'Bir [bağlantı](https://ornek.com/uzun/yol "başlık") ve ![kedi](/img/kedi.jpg).',
      '{{< figure src="/a.jpg" caption="çok kelime var burada" >}}',
      '<div dir="rtl">',
      '<!-- yorum içindeki kelimeler -->',
      '> [!NOTE]',
      '> Dipnot[^1] https://example.com',
      '',
      '[^1]: Not.',
      '[ref]: /yol',
    ].join('\n')
    expect(countWords(text)).toBe(7) // Başlık, Bir, bağlantı, ve, kedi, Dipnot, Not
  })

  it('counts characters of the prose, and reading time', () => {
    expect(countCharacters('# Merhaba\n\n**dünya**')).toBe('Merhaba dünya'.length)
    expect(readingMinutes(0)).toBe(0)
    expect(readingMinutes(1)).toBe(1)
    expect(readingMinutes(200)).toBe(1)
    expect(readingMinutes(201)).toBe(2)
    expect(computeStats('bir iki üç', ['iki üç', ''])).toEqual({ words: 3, characters: 10, readingMinutes: 1, selectionWords: 2 })
  })

  it('reports to the host after a pause, only when the numbers change', () => {
    vi.useFakeTimers()
    try {
      const reports: EditorStats[] = []
      const view = new EditorView({
        state: createEditorState('bir iki', { host: { onStats: (s) => reports.push(s) } }),
        parent: document.body,
      })
      vi.advanceTimersByTime(10)
      expect(reports).toEqual([{ words: 2, characters: 7, readingMinutes: 1, selectionWords: 0 }])
      view.dispatch({ changes: { from: 7, insert: ' üç' } })
      view.dispatch({ selection: EditorSelection.range(0, 3) })
      vi.advanceTimersByTime(100)
      expect(reports).toHaveLength(1)
      vi.advanceTimersByTime(300)
      expect(reports.at(-1)).toEqual({ words: 3, characters: 10, readingMinutes: 1, selectionWords: 1 })
      view.dispatch({ selection: EditorSelection.range(0, 2) })
      vi.advanceTimersByTime(400)
      expect(reports).toHaveLength(2)
      view.destroy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('focus mode', () => {
  const doc = 'Bir\niki\n\nüç\ndört\n\nbeş'

  it('finds the paragraph around the cursor', () => {
    const state = EditorState.create({ doc })
    expect(paragraphLines(state, 0)).toEqual({ first: 1, last: 2 })
    expect(paragraphLines(state, doc.indexOf('dört'))).toEqual({ first: 4, last: 5 })
    expect(paragraphLines(state, doc.indexOf('\n\n') + 1)).toEqual({ first: 3, last: 3 })
  })

  it('dims every other line', () => {
    const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('üç') } })
    const dimmed: number[] = []
    buildFocusDecorations(state).between(0, doc.length, (from) => {
      dimmed.push(state.doc.lineAt(from).number)
    })
    expect(dimmed).toEqual([1, 2, 3, 6, 7])
  })

  it('centres the cursor on keyboard edits but not on clicks', () => {
    const state = EditorState.create({ doc })
    const typed = state.update({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })
    expect(typewriterScroll(typed)?.effects).toBeTruthy()
    expect(typewriterScroll(state.update({ selection: { anchor: 3 }, userEvent: 'select.pointer' }))).toBe(null)
    expect(typewriterScroll(state.update({ changes: { from: 0, insert: 'x' } }))).toBe(null)
  })

  const views: EditorView[] = []
  afterEach(() => views.splice(0).forEach((v) => v.destroy()))

  it('is switched on and off through the option', () => {
    const view = new EditorView({ state: createEditorState(doc, { focusMode: true }), parent: document.body })
    views.push(view)
    expect(view.dom.classList.contains('cm-focus-mode')).toBe(true)
    expect(view.contentDOM.querySelectorAll('.cm-focus-dim').length).toBe(5)
    const off = new EditorView({ state: createEditorState(doc), parent: document.body })
    views.push(off)
    expect(off.dom.classList.contains('cm-focus-mode')).toBe(false)
    expect(off.contentDOM.querySelectorAll('.cm-focus-dim').length).toBe(0)
  })
})
