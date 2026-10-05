import { describe, expect, it } from 'vitest'
import { buildLivePreviewDecorations } from './livePreview'
import { stateFor } from './testing/harness'

interface Item {
  from: number
  to: number
  text: string
}

/** Lists decorations as readable strings: hidden text, widgets, marks and line classes. */
function preview(marked: string, active?: number[]): string[] {
  const state = stateFor(marked)
  const items: Item[] = []
  const set = buildLivePreviewDecorations(state, active ? { active: new Set(active) } : {})
  set.between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: string; widget?: unknown }
    const line = state.doc.lineAt(from).number
    let text: string
    if (spec.widget) text = `widget L${line} ${JSON.stringify(state.sliceDoc(from, to))}`
    else if (spec.class && from === to) text = `line L${line} ${spec.class}`
    else if (spec.class) text = `mark ${JSON.stringify(state.sliceDoc(from, to))} ${spec.class}`
    else text = `hide L${line} ${JSON.stringify(state.sliceDoc(from, to))}`
    items.push({ from, to: from === to ? -1 : to, text })
  })
  // Line decorations first, then by end position.
  return items.sort((a, b) => a.from - b.from || a.to - b.to).map((item) => item.text)
}

const hidden = (items: string[]) => items.filter((i) => i.startsWith('hide')).map((i) => i.replace(/^hide L\d+ /, ''))

describe('live preview', () => {
  it('styles headings and hides # off the cursor line only', () => {
    expect(preview('## Başlık\n\nMetin|')).toEqual(['line L1 cm-lp-heading cm-lp-h2', 'hide L1 "## "'])
    expect(preview('## Baş|lık\n\nMetin')).toEqual(['line L1 cm-lp-heading cm-lp-h2'])
    expect(hidden(preview('# Başlık #\n\n|'))).toEqual(['"# "', '" #"'])
  })

  it('hides emphasis, strikethrough and inline code marks', () => {
    const items = preview('**kalın** *eğik* _alt_ ~~sil~~ `kod`\n|')
    expect(hidden(items)).toEqual(['"**"', '"**"', '"*"', '"*"', '"_"', '"_"', '"~~"', '"~~"', '"`"', '"`"'])
    expect(items).toContain('mark "**kalın**" cm-lp-strong')
    expect(items).toContain('mark "*eğik*" cm-lp-em')
    expect(items).toContain('mark "~~sil~~" cm-lp-strike')
    expect(items).toContain('mark "`kod`" cm-lp-code')
  })

  it('shows the raw source on every selected line', () => {
    expect(hidden(preview('**a**\n«**b**\n**c»**\n**d**'))).toEqual(['"**"', '"**"', '"**"', '"**"'])
  })

  it('shows only the link text of inline and reference links', () => {
    const items = preview('Bir [bağlantı](https://example.com "Başlık") ve [ref][1].\n|')
    expect(hidden(items)).toEqual(['"["', '"](https://example.com \\"Başlık\\")"', '"["', '"][1]"'])
    expect(items).toContain('mark "bağlantı" cm-lp-link')
  })

  it('leaves [bracket placeholders], footnote refs and alert markers alone', () => {
    expect(hidden(preview('[buraya özet yaz] ve dipnot[^1].\n|'))).toEqual([])
  })

  it('hides blockquote markers and styles the lines', () => {
    const items = preview('> Alıntı\n> ikinci\n\n|')
    expect(hidden(items)).toEqual(['"> "', '"> "'])
    expect(items.filter((i) => i.startsWith('line'))).toEqual(['line L1 cm-lp-quote', 'line L2 cm-lp-quote'])
  })

  it('replaces a horizontal rule with a widget', () => {
    expect(preview('Metin\n\n---\n\n|')).toEqual(['widget L3 "---"'])
    expect(preview('Metin\n\n---|\n\n')).toEqual([])
  })

  it('does not hide characters inside shortcodes', () => {
    expect(hidden(preview('{{< figure caption="*bir* **iki**" >}} *dış*\n|'))).toEqual(['"*"', '"*"'])
  })

  it('marks code blocks, HTML blocks, comments and tables by line', () => {
    // `«»` puts the cursor at the start (a `|` marker would clash with the table).
    const items = preview('«»```go\nx := 1\n```\n\n<div>\n</div>\n\n<!-- yorum -->\n\n| a |\n|---|\n')
    expect(items.filter((i) => i.startsWith('line'))).toEqual([
      'line L1 cm-lp-codeblock',
      'line L1 cm-lp-codeblock-first',
      'line L2 cm-lp-codeblock',
      'line L3 cm-lp-codeblock',
      'line L3 cm-lp-codeblock-last',
      'line L5 cm-lp-html',
      'line L6 cm-lp-html',
      'line L8 cm-lp-comment',
      'line L10 cm-lp-table',
      'line L11 cm-lp-table',
    ])
  })

  it('renders every line when no line is active (editor not focused)', () => {
    expect(hidden(preview('## Baş|lık', []))).toEqual(['"## "'])
  })
})
