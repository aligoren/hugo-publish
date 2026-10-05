// @vitest-environment jsdom
import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete'
import { undo } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { TURKISH_ALERT_LABELS } from './config'
import type { LinkTarget } from './contract'
import { editorHost } from './host'
import { contentRelativePath, linkCompletionSource, pageLinkMarkdown, permalinkPath } from './linkCompletion'
import { createEditorState, type MarkdownEditorOptions } from './setup'
import { shortcodeFormField } from './shortcodeForm'
import { slashCompletionSource } from './slashMenu'
import { matchScore } from './text'

const PAGES: LinkTarget[] = [
  { title: 'İstanbul Gezisi', path: 'content/posts/istanbul.md', permalink: 'https://site.com/posts/istanbul/' },
  { title: 'Hakkında', path: 'content/about/index.md', permalink: 'https://site.com/about/' },
  { title: 'Kod [notları]', path: 'content/posts/kod.md', permalink: 'https://site.com/posts/kod/' },
]

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((v) => v.destroy()))

function at(doc: string, options: MarkdownEditorOptions = {}) {
  const pos = doc.indexOf('|')
  const text = doc.replace('|', '')
  const view = new EditorView({ state: createEditorState(options.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text, options), parent: document.body })
  view.dispatch({ selection: EditorSelection.cursor(pos) })
  views.push(view)
  return view
}

function complete(view: EditorView, source: (c: CompletionContext) => CompletionResult | null) {
  return source(new CompletionContext(view.state, view.state.selection.main.head, false))
}

function pick(view: EditorView, result: CompletionResult, label: string) {
  const option = result.options.find((o) => o.label === label) as Completion
  expect(option, label).toBeTruthy()
  ;(option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(view, option, result.from, result.to ?? view.state.selection.main.head)
}

describe('matchScore', () => {
  it('matches Turkish text without case or diacritics', () => {
    expect(matchScore('baslik', 'Başlık 1')).toBeGreaterThan(0)
    expect(matchScore('ipucu', 'İpucu')).toBe(4)
    expect(matchScore('IŞIK', 'ışık')).toBe(4)
    expect(matchScore('b1', 'Başlık 1')).toBeGreaterThan(0)
    expect(matchScore('zz', 'Başlık')).toBe(0)
  })
})

describe('slash menu', () => {
  it('opens at the start of a line or after a space, not inside words, code or URLs', () => {
    expect(complete(at('/|'), slashCompletionSource)).not.toBe(null)
    expect(complete(at('Metin /|'), slashCompletionSource)).not.toBe(null)
    expect(complete(at('ve/veya|'), slashCompletionSource)).toBe(null)
    expect(complete(at('```\n/|\n```'), slashCompletionSource)).toBe(null)
    expect(complete(at('`a /b|`'), slashCompletionSource)).toBe(null)
    expect(complete(at('/ |'), slashCompletionSource)).toBe(null)
  })

  it('lists commands in sections and filters as you type', () => {
    const all = complete(at('/|'), slashCompletionSource)!
    const labels = all.options.map((o) => o.label)
    expect(labels.slice(0, 5)).toEqual(['Paragraph', 'Heading 1', 'Heading 2', 'Heading 3', 'Quote'])
    expect(labels).toEqual(expect.arrayContaining(['Note', 'Caution', 'Image', 'Link', 'Footnote', 'Table', 'figure', 'youtube']))
    const filtered = complete(at('/h2|'), slashCompletionSource)!
    expect(filtered.options[0].label).toBe('Heading 2')
    expect(filtered.from).toBe(0)
  })

  it('uses translated phrases and alert labels', () => {
    const view = at('/ipu|', {
      alertLabels: TURKISH_ALERT_LABELS,
      phrases: { 'Heading 1': 'Başlık 1' },
    })
    expect(complete(view, slashCompletionSource)!.options[0].label).toBe('İpucu')
    expect(complete(at('/basl|', { phrases: { 'Heading 1': 'Başlık 1' } }), slashCompletionSource)!.options[0].label).toBe('Başlık 1')
  })

  it('replaces /query with the block, in the document line ending, as one undo step', () => {
    const view = at('Önce\n\n/tab|', { eol: 'crlf' })
    pick(view, complete(view, slashCompletionSource)!, 'Table')
    expect(view.state.sliceDoc()).toBe('Önce\r\n\r\n| Column 1 | Column 2 |\r\n| -------- | -------- |\r\n|          |          |\r\n|          |          |')
    undo(view)
    expect(view.state.sliceDoc()).toBe('Önce\r\n\r\n/tab')

    const heading = at('/h1|')
    heading.dispatch({ changes: { from: 3, insert: ' Başlık' } })
    heading.dispatch({ selection: EditorSelection.cursor(3) })
    pick(heading, complete(heading, slashCompletionSource)!, 'Heading 1')
    expect(heading.state.sliceDoc()).toBe('# Başlık')

    const note = at('/not|')
    pick(note, complete(note, slashCompletionSource)!, 'Note')
    expect(note.state.sliceDoc()).toBe('> [!NOTE]\n> ')

    const footnote = at('Cümle /dip|', { phrases: { Footnote: 'Dipnot' } })
    pick(footnote, complete(footnote, slashCompletionSource)!, 'Dipnot')
    expect(footnote.state.sliceDoc()).toBe('Cümle [^1]\n\n[^1]: ')
  })

  it('inserts shortcode skeletons and opens the parameter form', () => {
    const view = at('Metin /fig|')
    pick(view, complete(view, slashCompletionSource)!, 'figure')
    expect(view.state.sliceDoc()).toBe('Metin {{< figure src="" >}}')
    expect(view.state.field(shortcodeFormField)?.name).toBe('figure')
    const site = at('/|', { shortcodes: [{ name: 'not', params: [], paired: true, source: 'site', markdown: true }] })
    pick(site, complete(site, slashCompletionSource)!, 'not')
    expect(site.state.sliceDoc()).toBe('{{< not >}}\n\n{{< /not >}}')
  })

  it('asks the host for an image', async () => {
    const view = at('/res|', { host: { onRequestImage: async () => ({ src: '/img/kedi.jpg', alt: 'Kedi' }) } })
    pick(view, complete(view, slashCompletionSource)!, 'Image')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.state.sliceDoc()).toBe('![Kedi](/img/kedi.jpg)')
    const fallback = at('/image|')
    pick(fallback, complete(fallback, slashCompletionSource)!, 'Image')
    expect(fallback.state.sliceDoc()).toBe('![]()')
  })
})

describe('[[ link completion', () => {
  it('needs pages and a [[ before the cursor', () => {
    expect(complete(at('[[ist|'), linkCompletionSource)).toBe(null)
    expect(complete(at('ist|', { host: { pages: PAGES } }), linkCompletionSource)).toBe(null)
    const result = complete(at('Bak: [[ist|', { host: { pages: PAGES } }), linkCompletionSource)!
    expect(result.options.map((o) => [o.label, o.detail])).toEqual([['İstanbul Gezisi', 'posts/istanbul.md']])
    expect(complete(at('[[|', { host: { pages: PAGES } }), linkCompletionSource)!.options).toHaveLength(3)
  })

  it('inserts a relref link replacing [[query (and a typed ]])', () => {
    const view = at('Bak: [[hakk|]] sonra', { host: { pages: PAGES } })
    pick(view, complete(view, linkCompletionSource)!, 'Hakkında')
    expect(view.state.sliceDoc()).toBe('Bak: [Hakkında]({{< relref "about/index.md" >}}) sonra')
    expect(view.state.selection.main.head).toBe('Bak: [Hakkında]({{< relref "about/index.md" >}})'.length)
  })

  it('can insert the permalink path, and escapes brackets in titles', () => {
    const state = EditorState.create({ extensions: [editorHost.of({ pages: PAGES })] })
    expect(pageLinkMarkdown(state, PAGES[2])).toBe('[Kod \\[notları\\]]({{< relref "posts/kod.md" >}})')
    const view = at('[[kod|', { host: { pages: PAGES }, linkStyle: 'permalink' })
    pick(view, complete(view, linkCompletionSource)!, 'Kod [notları]')
    expect(view.state.sliceDoc()).toBe('[Kod \\[notları\\]](/posts/kod/)')
  })

  it('makes content-relative paths and permalink paths', () => {
    expect(contentRelativePath('content/posts/a.md')).toBe('posts/a.md')
    expect(contentRelativePath('icerik/a.md', 'icerik/')).toBe('a.md')
    expect(contentRelativePath('other/a.md')).toBe('other/a.md')
    expect(permalinkPath('https://x.com/a/b/?q=1')).toBe('/a/b/?q=1')
    expect(permalinkPath('/a/')).toBe('/a/')
  })
})
