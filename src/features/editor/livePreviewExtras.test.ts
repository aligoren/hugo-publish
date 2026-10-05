// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { buildLivePreviewDecorations } from './livePreview'
import { createEditorState } from './setup'
import { stateFor } from './testing/harness'

interface Item {
  from: number
  to: number
  text: string
}

/** Decorations as readable strings (widgets show their DOM text or class). */
function preview(marked: string, active?: number[]): string[] {
  const state = stateFor(marked)
  const items: Item[] = []
  const set = buildLivePreviewDecorations(state, active ? { active: new Set(active) } : {})
  set.between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: string; widget?: { toDOM?: (view: unknown) => HTMLElement }; attributes?: Record<string, string> }
    const line = state.doc.lineAt(from).number
    const source = JSON.stringify(state.sliceDoc(from, to))
    let text: string
    if (spec.widget) {
      const dom = (spec.widget as { toDOM(view: unknown): HTMLElement }).toDOM(null)
      const shown = dom instanceof HTMLInputElement ? `checkbox:${dom.checked}` : dom.textContent || dom.className
      text = `widget L${line} ${source} → ${shown}`
    } else if (spec.class && from === to) text = `line L${line} ${spec.class}`
    else if (spec.class) text = `mark ${source} ${spec.class}${spec.attributes?.title ? ` [${spec.attributes.title}]` : ''}`
    else text = `hide L${line} ${source}`
    items.push({ from, to: from === to ? -1 : to, text })
  })
  return items.sort((a, b) => a.from - b.from || a.to - b.to).map((item) => item.text)
}

describe('lists and tasks', () => {
  it('shows bullets by depth and styles numbers, unless the cursor is on the marker', () => {
    const items = preview('- bir\n  * iki\n1. üç\n\n|')
    expect(items).toEqual(['widget L1 "-" → •', 'widget L2 "*" → ◦', 'mark "1." cm-lp-list-number'])
    // On the item's text the bullet stays rendered; on the marker itself the source shows.
    expect(preview('- bir|')).toEqual(['widget L1 "-" → •'])
    expect(preview('-| bir')).toEqual([])
  })

  it('turns task markers into checkboxes and hides the bullet', () => {
    const items = preview('- [ ] yap\n- [x] bitti\n\n|')
    expect(items).toEqual([
      'hide L1 "- "',
      'widget L1 "[ ]" → checkbox:false',
      'hide L2 "- "',
      'widget L2 "[x]" → checkbox:true',
      'mark " bitti" cm-lp-task-done',
    ])
    expect(preview('- [ |] yap')).toEqual([])
  })
})

describe('code blocks, setext headings, tables, links', () => {
  it('replaces the opening fence with the language and hides the closing fence', () => {
    const items = preview('```go {linenos=true}\nx := 1\n```\n\n|')
    expect(items).toContain('widget L1 "```go {linenos=true}" → go')
    expect(items).toContain('hide L3 "```"')
    expect(preview('```\nx\n```\n\n|')).toContain('hide L1 "```"')
    expect(preview('```go|\nx\n```').filter((i) => i.startsWith('widget'))).toEqual([])
  })

  it('hides a setext underline off the cursor', () => {
    const items = preview('Başlık\n======\n\n|')
    expect(items).toContain('line L2 cm-lp-setext-mark cm-lp-setext-hidden')
    expect(items).toContain('hide L2 "======"')
    expect(preview('Başlık\n===|===')).toContain('line L2 cm-lp-setext-mark')
    expect(preview('Başlık\n===|===').some((i) => i.startsWith('hide'))).toBe(false)
  })

  it('styles the table header, rule and pipes', () => {
    const items = preview('«»| a | b |\n|---|:-:|\n| c | d |\n')
    expect(items).toContain('mark "| a | b |" cm-lp-table-header')
    expect(items).toContain('mark "|---|:-:|" cm-lp-table-rule')
    expect(items.filter((i) => i.endsWith('cm-lp-table-pipe'))).toHaveLength(6)
  })

  it('shows link destinations and titles as a tooltip', () => {
    expect(preview('[metin](https://ornek.com "Başlık")\n|')).toContain('mark "metin" cm-lp-link [https://ornek.com – Başlık]')
    expect(preview('[metin][ref]\n\n[ref]: /a\n|')).toContain('mark "metin" cm-lp-link [[ref]]')
    expect(preview('![kedi](/img/kedi.jpg)\n|')).toContain('mark "![kedi](/img/kedi.jpg)" cm-lp-image [/img/kedi.jpg]')
  })
})

describe('task checkbox in a view', () => {
  const views: EditorView[] = []
  afterEach(() => views.splice(0).forEach((v) => v.destroy()))

  it('toggles the marker with a single-character change', () => {
    const view = new EditorView({ state: createEditorState('- [ ] yap\r\n- [x] bitti\r\n', { eol: 'crlf' }), parent: document.body })
    views.push(view)
    const boxes = view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-lp-task')
    expect(boxes).toHaveLength(2)
    boxes[0].click()
    expect(view.state.sliceDoc()).toBe('- [x] yap\r\n- [x] bitti\r\n')
    view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-lp-task')[1].click()
    expect(view.state.sliceDoc()).toBe('- [x] yap\r\n- [ ] bitti\r\n')
  })
})
