// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorState } from './setup'
import { editShortcodeAtCursor, editableShortcodeAt, openShortcodeFormEffect, shortcodeFormField } from './shortcodeForm'
import { stateFor } from './testing/harness'

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((v) => v.destroy()))

function mount(doc: string, options: Parameters<typeof createEditorState>[1] = {}) {
  const view = new EditorView({ state: createEditorState(doc, options), parent: document.body })
  views.push(view)
  return view
}

function form(view: EditorView) {
  const dom = view.dom.querySelector<HTMLFormElement>('form.cm-sc-form')
  const input = (name: string) => dom!.querySelector<HTMLInputElement & HTMLSelectElement>(`[name="${name}"]`)!
  const submit = () => dom!.dispatchEvent(new Event('submit', { cancelable: true }))
  return { dom, input, submit }
}

describe('editableShortcodeAt', () => {
  it('finds known opening tags with parameters only', () => {
    const state = stateFor('{{< figure src="a" >}} {{< /details >}} {{< bilinmeyen >}} {{</* figure */>}}|')
    expect(editableShortcodeAt(state, 3)?.def.name).toBe('figure')
    expect(editableShortcodeAt(state, 26)).toBe(null)
    expect(editableShortcodeAt(state, 45)).toBe(null)
    expect(editableShortcodeAt(state, 62)).toBe(null)
  })
})

describe('shortcode parameter form', () => {
  it('opens with Alt+Enter at a tag, shows its values and writes minimal edits (CRLF kept)', () => {
    const doc = 'Önce\r\n{{< figure\r\n  src="/img/a.jpg"\r\n  alt=`eski`\r\n>}}\r\nSonra'
    const view = mount(doc, { eol: 'crlf' })
    view.dispatch({ selection: EditorSelection.cursor(8) })
    expect(editShortcodeAtCursor(view)).toBe(true)
    const f = form(view)
    expect(f.dom).not.toBeNull()
    expect(f.input('src').value).toBe('/img/a.jpg')
    expect(f.input('alt').value).toBe('eski')
    expect(document.activeElement).toBe(f.input('src'))
    f.input('alt').value = 'yeni “alt”'
    f.input('caption').value = 'Başlık'
    f.submit()
    expect(view.state.sliceDoc()).toBe('Önce\r\n{{< figure\r\n  src="/img/a.jpg"\r\n  alt=`yeni “alt”`\r\n  caption="Başlık"\r\n>}}\r\nSonra')
    expect(view.state.field(shortcodeFormField)).toBe(null)
  })

  it('validates required parameters', () => {
    const view = mount('{{< youtube >}}')
    view.dispatch({ effects: openShortcodeFormEffect.of({ pos: 0, focus: false }) })
    const f = form(view)
    f.submit()
    expect(view.state.sliceDoc()).toBe('{{< youtube >}}')
    expect(f.input('id').getAttribute('aria-invalid')).toBe('true')
    expect(f.dom!.textContent).toContain('id is required')
    f.input('id').value = 'abc'
    f.input('autoplay').value = 'true'
    f.submit()
    expect(view.state.sliceDoc()).toBe('{{< youtube id="abc" autoplay=true >}}')
  })

  it('keeps positional style and closes with Escape', () => {
    const view = mount('{{< highlight go >}}\nx\n{{< /highlight >}}')
    view.dispatch({ effects: openShortcodeFormEffect.of({ pos: 2, focus: true }) })
    const f = form(view)
    expect(f.input('lang').value).toBe('go')
    f.input('options').value = 'linenos=table'
    f.submit()
    expect(view.state.sliceDoc()).toBe('{{< highlight go "linenos=table" >}}\nx\n{{< /highlight >}}')
    view.dispatch({ effects: openShortcodeFormEffect.of({ pos: 2, focus: true }) })
    form(view).dom!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(view.state.field(shortcodeFormField)).toBe(null)
  })

  it('follows the tag through edits and closes when the tag goes away', () => {
    const view = mount('{{< figure src="a" >}}')
    view.dispatch({ effects: openShortcodeFormEffect.of({ pos: 0, focus: false }) })
    view.dispatch({ changes: { from: 0, insert: 'Metin ' } })
    expect(view.state.field(shortcodeFormField)?.from).toBe(6)
    view.dispatch({ changes: { from: 6, to: view.state.doc.length } })
    expect(view.state.field(shortcodeFormField)).toBe(null)
  })

  it('opens when a known chip is clicked while the editor is not focused (live preview)', () => {
    const view = mount('Metin\n\n{{< figure src="a" >}}')
    const chip = view.contentDOM.querySelector<HTMLElement>('.cm-sc-known')!
    chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(view.state.field(shortcodeFormField)?.name).toBe('figure')
  })
})
