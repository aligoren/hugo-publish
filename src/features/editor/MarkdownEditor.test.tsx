// @vitest-environment jsdom
import { undoDepth } from '@codemirror/commands'
import { act, createRef, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { toggleBold } from './commands'
import { alertLabels, livePreviewEnabled, TURKISH_ALERT_LABELS } from './config'
import { EditorToolbar } from './EditorToolbar'
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorProps } from './MarkdownEditor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(element))
  const unmount = () => {
    act(() => root.unmount())
    container.remove()
  }
  cleanups.push(() => {
    if (container.isConnected) unmount()
  })
  return { container, rerender: (next: ReactElement) => act(() => root.render(next)), unmount }
}

describe('MarkdownEditor', () => {
  function setup(props: Partial<MarkdownEditorProps> = {}) {
    const changes: string[] = []
    const ref = createRef<MarkdownEditorHandle>()
    const element = (extra: Partial<MarkdownEditorProps> = {}) => (
      <MarkdownEditor ref={ref} value={'a\r\nb\r\n'} eol="crlf" onChange={(v) => changes.push(v)} {...props} {...extra} />
    )
    const mounted = mount(element())
    return { ...mounted, ref, changes, element, view: () => ref.current!.view! }
  }

  it('creates one view and reports edits with the file line ending', () => {
    const { ref, changes, view, container } = setup()
    expect(container.querySelector('.cm-editor')).not.toBeNull()
    expect(ref.current!.getValue()).toBe('a\r\nb\r\n')
    act(() => view().dispatch({ changes: { from: 1, insert: view().state.lineBreak + 'x' } }))
    expect(changes).toEqual(['a\r\nx\r\nb\r\n'])
  })

  it('applies outside value changes in place without echoing them', () => {
    const { rerender, element, changes, view } = setup()
    const first = view()
    rerender(element({ value: 'a\r\nb\r\n' }))
    rerender(element({ value: 'a\r\nB\r\nc\r\n' }))
    expect(view()).toBe(first)
    expect(first.state.sliceDoc()).toBe('a\r\nB\r\nc\r\n')
    expect(changes).toEqual([])
  })

  it('reconfigures options without recreating the view', () => {
    const { rerender, element, view } = setup()
    const first = view()
    rerender(element({ alertLabels: TURKISH_ALERT_LABELS, livePreview: false }))
    expect(view()).toBe(first)
    expect(first.state.facet(alertLabels).note).toBe('Bilgi')
    expect(first.state.facet(livePreviewEnabled)).toBe(false)
  })

  it('resets document and undo history when documentKey changes', () => {
    const { rerender, element, view } = setup({ documentKey: 'a.md' })
    act(() => view().dispatch({ changes: { from: 0, insert: 'z' } }))
    expect(undoDepth(view().state)).toBe(1)
    rerender(element({ documentKey: 'b.md', value: 'yeni\n', eol: undefined }))
    expect(view().state.sliceDoc()).toBe('yeni\n')
    expect(view().state.lineBreak).toBe('\n')
    expect(undoDepth(view().state)).toBe(0)
  })

  it('runs commands through the handle and cleans up on unmount', () => {
    const { ref, view, unmount, changes } = setup({ value: 'kelime', eol: 'lf' })
    const editorView = view()
    act(() => {
      editorView.dispatch({ selection: { anchor: 0, head: 6 } })
      ref.current!.run(toggleBold)
    })
    expect(changes).toEqual(['**kelime**'])
    unmount()
    expect(editorView.dom.isConnected).toBe(false)
    expect(ref.current).toBe(null)
  })
})

describe('EditorToolbar', () => {
  it('runs commands on the editor', () => {
    const ref = createRef<MarkdownEditorHandle>()
    const changes: string[] = []
    const { container } = mount(
      <>
        <EditorToolbar editor={ref} alertLabels={TURKISH_ALERT_LABELS} />
        <MarkdownEditor ref={ref} value="Merhaba" onChange={(v) => changes.push(v)} />
      </>,
    )
    act(() => ref.current!.view!.dispatch({ selection: { anchor: 7 } }))
    const rtl = container.querySelector<HTMLButtonElement>('button[aria-label="Right-to-left block"]')!
    act(() => rtl.click())
    expect(changes.at(-1)).toBe('Merhaba\n\n<div dir="rtl" style="text-align: center;">\n\n\n\n</div>')

    const alertSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Alert"]')!
    expect([...alertSelect.options].map((o) => o.textContent)).toEqual(['Alert', 'Bilgi', 'İpucu', 'Önemli', 'Uyarı', 'Dikkat'])
    act(() => {
      alertSelect.value = 'tip'
      alertSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(changes.at(-1)).toContain('> [!TIP]\n> ')
    expect(alertSelect.value).toBe('')
  })
})
