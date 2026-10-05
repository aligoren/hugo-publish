// @vitest-environment jsdom
import i18next from 'i18next'
import { act, createRef, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'
import { linkStyle } from './config'
import type { EditorStats, LinkTarget } from './contract'
import { EditorStatusBar } from './EditorStatusBar'
import { EditorToolbar } from './EditorToolbar'
import { lockedShortcodeField } from './shortcodes'
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor'
import { messages } from './messages'
import { editorHost } from './host'
import { shortcodeDefinitions } from './shortcodeDefs'
import { CompletionContext, type Completion } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import type { SlashItem } from './contract'
import { slashCompletionSource } from './slashMenu'
import type { SpellWorkerLike } from './spell/client'
import { spellcheckConfig } from './spell/extension'
import { createSpellService, type SpellRequest, type SpellResponse } from './spell/protocol'

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
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return { container, rerender: (next: ReactElement) => act(() => root.render(next)) }
}

async function turkish() {
  const instance = i18next.createInstance()
  await instance.init({
    lng: 'tr',
    fallbackLng: 'en',
    resources: { tr: { translation: { editor: messages.tr } }, en: { translation: { editor: messages.en } } },
    interpolation: { escapeValue: false },
  })
  return instance
}

describe('EditorToolbar additions', () => {
  it('inserts tables, code blocks and images; toggles focus mode', () => {
    const ref = createRef<MarkdownEditorHandle>()
    const changes: string[] = []
    let focus = false
    const { container } = mount(
      <>
        <EditorToolbar editor={ref} focusMode={focus} onFocusModeChange={(v) => (focus = v)} />
        <MarkdownEditor ref={ref} value="" onChange={(v) => changes.push(v)} />
      </>,
    )
    const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
    act(() => button('Code block').click())
    expect(changes.at(-1)).toBe('```\n\n```')
    act(() => ref.current!.view!.dispatch({ changes: { from: 0, to: ref.current!.view!.state.doc.length } }))
    act(() => button('Table').click())
    expect(changes.at(-1)!.split('\n')[0]).toBe('| Column 1 | Column 2 |')
    act(() => ref.current!.view!.dispatch({ changes: { from: 0, to: ref.current!.view!.state.doc.length } }))
    act(() => button('Image').click())
    expect(changes.at(-1)).toBe('![]()')
    act(() => button('Focus mode').click())
    expect(focus).toBe(true)
    expect(button('Focus mode').getAttribute('aria-pressed')).toBe('false')
  })

  it('uses the editor.toolbar translations, with the labels prop still winning', async () => {
    const i18n = await turkish()
    const ref = createRef<MarkdownEditorHandle>()
    const { container } = mount(
      <I18nextProvider i18n={i18n}>
        <EditorToolbar editor={ref} labels={{ bold: 'Koyu' }} />
      </I18nextProvider>,
    )
    expect(container.querySelector('[role="toolbar"]')!.getAttribute('aria-label')).toBe('Biçimlendirme')
    expect(container.querySelector('button[aria-label="Tablo"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="Koyu"]')).not.toBeNull()
  })
})

describe('EditorStatusBar', () => {
  const stats: EditorStats = { words: 1, characters: 5, readingMinutes: 1, selectionWords: 0 }

  it('shows the numbers in English by default and in Turkish with i18n', async () => {
    const { container, rerender } = mount(<EditorStatusBar stats={stats} />)
    expect(container.textContent).toBe('1 words5 characters1 min read')
    rerender(<EditorStatusBar stats={null} />)
    expect(container.textContent).toBe('')
    const i18n = await turkish()
    rerender(
      <I18nextProvider i18n={i18n}>
        <EditorStatusBar stats={{ ...stats, words: 250, readingMinutes: 2, selectionWords: 3 }} />
      </I18nextProvider>,
    )
    expect(container.querySelector('[role="status"]')!.getAttribute('aria-label')).toBe('Yazı istatistikleri')
    expect([...container.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['250 kelime', '5 karakter', '2 dk okuma', '3 kelime seçili'])
  })
})

describe('MarkdownEditor integration props', () => {
  const pages: LinkTarget[] = [{ title: 'A', path: 'content/a.md', permalink: 'https://x/a/' }]

  it('passes host data lazily and reconfigures shortcodes, focus mode and phrases', async () => {
    const ref = createRef<MarkdownEditorHandle>()
    const stats: EditorStats[] = []
    const element = (extra: object = {}) => (
      <MarkdownEditor ref={ref} value={'{{< not >}}\n'} pages={pages} onStats={(s) => stats.push(s)} {...extra} />
    )
    const { rerender } = mount(element())
    const view = ref.current!.view!
    expect(view.state.facet(editorHost).pages).toBe(pages)
    expect(view.state.field(lockedShortcodeField).tokens.map((t) => t.name)).toEqual(['not'])
    rerender(element({ shortcodes: [{ name: 'not', params: [], paired: true, source: 'site' }], focusMode: true, linkStyle: 'permalink' }))
    expect(ref.current!.view).toBe(view)
    expect(view.state.facet(shortcodeDefinitions).has('not')).toBe(true)
    expect(view.state.field(lockedShortcodeField).tokens).toEqual([])
    expect(view.dom.classList.contains('cm-focus-mode')).toBe(true)
    expect(view.state.facet(linkStyle)).toBe('permalink')
    const newPages: LinkTarget[] = []
    rerender(element({ pages: newPages }))
    expect(view.state.facet(editorHost).pages).toBe(newPages)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(stats.at(-1)?.words).toBe(0)
  })

  it('translates the extensions through phrases', async () => {
    const i18n = await turkish()
    const ref = createRef<MarkdownEditorHandle>()
    mount(
      <I18nextProvider i18n={i18n}>
        <MarkdownEditor ref={ref} value="x" />
      </I18nextProvider>,
    )
    expect(ref.current!.view!.state.phrase('Add to dictionary')).toBe('Sözlüğe ekle')
    expect(ref.current!.view!.state.phrase('Column $', 2)).toBe('Sütun 2')
  })

  it('keeps the document byte for byte through the new extensions', () => {
    const ref = createRef<MarkdownEditorHandle>()
    const value = '# Başlık\r\n\r\n- [ ] iş\r\n\r\n```go\r\nx\r\n```\r\n\r\n{{< bilinmeyen >}}\r\n\r\n![a](a.png)\r\n'
    mount(<MarkdownEditor ref={ref} value={value} eol="crlf" focusMode resolveImage={async () => 'data:,'} />)
    expect(ref.current!.getValue()).toBe(value)
  })
})

describe('spellcheck languages and slash items', () => {
  function fakeWorker(log: SpellRequest[]): () => SpellWorkerLike {
    return () => {
      const listeners: ((event: MessageEvent<SpellResponse>) => void)[] = []
      const handle = createSpellService(async () => ({ correct: () => true, suggest: () => [], add: () => {} }), (response) =>
        queueMicrotask(() => listeners.forEach((l) => l({ data: response } as MessageEvent<SpellResponse>))),
      )
      return {
        postMessage(message) {
          log.push(message)
          void handle(message)
        },
        addEventListener: (_type, listener) => void listeners.push(listener),
        terminate() {},
      }
    }
  }

  it('uses the worker for tr and en (one worker, switched in place) and the browser for other languages', () => {
    const ref = createRef<MarkdownEditorHandle>()
    const log: SpellRequest[] = []
    const spell = (language: string | null) => ({ language, personalWords: ['Hugo'], onAddWord: () => {} })
    const element = (language: string | null) => <MarkdownEditor ref={ref} value="x" spellcheck={spell(language)} spellWorker={fakeWorker(log)} />
    const { rerender } = mount(element('en'))
    const attr = () => ref.current!.view!.contentDOM.getAttribute('spellcheck')
    expect(attr()).toBe('false')
    expect(ref.current!.view!.state.facet(spellcheckConfig)?.client.language).toBe('en')
    rerender(element('tr'))
    expect(ref.current!.view!.state.facet(spellcheckConfig)?.client.language).toBe('tr')
    expect(log.filter((m) => m.type === 'init').map((m) => (m as { language: string }).language)).toEqual(['en', 'tr'])
    rerender(element('ar'))
    expect(ref.current!.view!.state.facet(spellcheckConfig)).toBe(null)
    expect(attr()).toBe('true')
    expect(ref.current!.view!.contentDOM.getAttribute('lang')).toBe('ar')
    rerender(element(null))
    expect(attr()).toBe('false')
  })

  it('lists the host slash items (read lazily) and runs them after removing /query', () => {
    const ref = createRef<MarkdownEditorHandle>()
    const ran: string[] = []
    const items = (label: string): SlashItem[] => [
      {
        id: 'imza',
        label,
        keywords: ['signature'],
        run: (view) => {
          ran.push(view.state.sliceDoc())
          view.dispatch(view.state.replaceSelection('— Ali'))
        },
      },
      { id: 'kod', label: 'Kod örneği', section: 'Benim', run: () => ran.push('kod') },
    ]
    const { rerender } = mount(<MarkdownEditor ref={ref} value="Metin /" extraSlashItems={items('İmza')} />)
    rerender(<MarkdownEditor ref={ref} value="Metin /" extraSlashItems={items('İmzam')} />)
    const view = ref.current!.view!
    view.dispatch({ selection: { anchor: 7 } })
    const all = slashCompletionSource(new CompletionContext(view.state, 7, false))!
    const imza = all.options.find((o) => o.label === 'İmzam')!
    expect((imza.section as { name: string }).name).toBe('Snippets')
    expect((all.options.find((o) => o.label === 'Kod örneği')!.section as { name: string }).name).toBe('Benim')
    view.dispatch({ changes: { from: 7, insert: 'signa' }, selection: { anchor: 12 } })
    const filtered = slashCompletionSource(new CompletionContext(view.state, 12, false))!
    expect(filtered.options[0].label).toBe('İmzam')
    act(() => (filtered.options[0].apply as (v: EditorView, c: Completion, f: number, t: number) => void)(view, filtered.options[0], filtered.from, 12))
    expect(ran).toEqual(['Metin '])
    expect(view.state.sliceDoc()).toBe('Metin — Ali')
  })
})
