// @vitest-environment jsdom
import type { EditorState, StateCommand } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorState, type EditorEol } from './setup'
import {
  addTableColumnLeft,
  addTableColumnRight,
  addTableRowAbove,
  addTableRowBelow,
  deleteTableColumn,
  deleteTableRow,
  displayWidth,
  formatTable,
  nextTableCell,
  previousTableCell,
  splitTableRow,
  tableAt,
  tableFocusEffect,
  tableToolbarField,
} from './tables'
import { stateFor } from './testing/harness'

// jsdom has no layout; the toolbar tooltip measures text ranges.
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

// Tables are full of `|`, the harness's usual cursor marker: here `«»` is a cursor and `«…»` a selection.

const lines = (...rows: string[]) => rows.join('\n')

const TABLE = lines('Önce', '', '| Şehir | Nüfus |', '| ----- | ----: |', '| İzmir | 4 |', '| Bursa | 3 |', '', 'Sonra')

/** `doc` with a cursor before the first `before`. */
function at(before: string, doc = TABLE): string {
  const i = doc.indexOf(before)
  if (i === -1) throw new Error(`not found: ${before}`)
  return doc.slice(0, i) + '«»' + doc.slice(i)
}

/** The document (with its own line breaks) and the main selection as `«…»`. */
function show(state: EditorState): string {
  const { from, to } = state.selection.main
  const text = state.sliceDoc()
  const a = state.sliceDoc(0, from).length
  const b = state.sliceDoc(0, to).length
  return text.slice(0, a) + '«' + text.slice(a, b) + '»' + text.slice(b)
}

function run(command: StateCommand, input: string, eol: EditorEol = 'lf'): string | null {
  let state = stateFor(input, eol)
  let ran = false
  command({
    state,
    dispatch: (tr) => {
      state = tr.state
      ran = true
    },
  })
  return ran ? show(state) : null
}

const crlf = (text: string) => text.replace(/\n/g, '\r\n')

describe('table structure', () => {
  it('splits rows into cells, with escaped pipes inside cells', () => {
    const text = '| a | b \\| c |  '
    const row = splitTableRow(text)
    expect([row.leading, row.trailing]).toEqual([true, true])
    expect(row.cells.map((c) => text.slice(c.from, c.to))).toEqual([' a ', ' b \\| c '])
    const bare = splitTableRow('a | b')
    expect([bare.leading, bare.trailing]).toEqual([false, false])
    expect(bare.cells.map((c) => 'a | b'.slice(c.from, c.to))).toEqual(['a ', ' b'])
  })

  it('finds the table at a position, also inside a blockquote', () => {
    const state = stateFor(at('İzmir'))
    const table = tableAt(state, state.selection.main.head)!
    expect(table.lines.map((l) => l.kind)).toEqual(['header', 'delimiter', 'row', 'row'])
    expect(tableAt(state, 2)).toBe(null)
    const quoted = stateFor('> | a | b |\n> | - | - |\n> | c | d |\n«»')
    const inQuote = tableAt(quoted, 4)!
    expect(inQuote.lines.map((l) => quoted.sliceDoc(l.from, l.start))).toEqual(['> ', '> ', '> '])
    expect(inQuote.lines.every((l) => l.leading && l.trailing && l.cells.length === 2)).toBe(true)
  })

  it('measures wide characters as two columns', () => {
    expect(displayWidth('Şehir')).toBe(5)
    expect(displayWidth('東京')).toBe(4)
    expect(displayWidth('é')).toBe(1)
  })
})

describe('moving between cells', () => {
  it('selects the next and previous cell, across rows and past the delimiter row', () => {
    expect(run(nextTableCell, at('Şehir'))).toBe(TABLE.replace('Nüfus', '«Nüfus»'))
    expect(run(nextTableCell, at('Nüfus'))).toBe(TABLE.replace('İzmir', '«İzmir»'))
    expect(run(previousTableCell, at('İzmir'))).toBe(TABLE.replace('Nüfus', '«Nüfus»'))
    expect(run(previousTableCell, at('Şehir'))).toBe(TABLE.replace('Şehir', '«Şehir»'))
    expect(run(nextTableCell, 'Metin«»')).toBe(null)
  })

  it('adds a row shaped like the delimiter row after the last cell, with the document line ending', () => {
    const expected = TABLE.replace('| Bursa | 3 |', '| Bursa | 3 |\n| «»      |       |')
    expect(run(nextTableCell, at('3 |'))).toBe(expected)
    expect(run(nextTableCell, at('3 |'), 'crlf')).toBe(crlf(expected))
    // Without outer pipes the new row gets them, as an empty first cell needs one.
    expect(run(nextTableCell, 'a | b\n--|--\nc | «»d')).toBe('a | b\n--|--\nc | d\n| «» |  |')
  })
})

describe('rows and columns', () => {
  it('adds rows below and above (below the header from the header row)', () => {
    expect(run(addTableRowBelow, at('İzmir'))).toBe(TABLE.replace('| İzmir | 4 |', '| İzmir | 4 |\n| «»      |       |'))
    expect(run(addTableRowAbove, at('İzmir'))).toBe(TABLE.replace('| İzmir | 4 |', '| «»      |       |\n| İzmir | 4 |'))
    expect(run(addTableRowBelow, at('Şehir'))).toBe(TABLE.replace('| İzmir | 4 |', '| «»      |       |\n| İzmir | 4 |'))
    expect(run(addTableRowAbove, at('Şehir'))).toBe(null)
    expect(run(addTableRowBelow, '> | a | b |\n> | - | - |\n> | «»c | d |\n')).toBe('> | a | b |\n> | - | - |\n> | c | d |\n> | «»  |   |\n')
  })

  it('deletes a body row only', () => {
    expect(run(deleteTableRow, at('İzmir'))).toBe(TABLE.replace('| İzmir | 4 |\n| Bursa', '| «»Bursa'))
    expect(run(deleteTableRow, at('Bursa'), 'crlf')).toBe(crlf(TABLE.replace('| İzmir | 4 |\n| Bursa | 3 |', '| «»İzmir | 4 |')))
    expect(run(deleteTableRow, at('Şehir'))).toBe(null)
    expect(run(deleteTableRow, at('-----'))).toBe(null)
  })

  it('adds columns in every row, keeping the line endings', () => {
    expect(run(addTableColumnRight, at('Şehir'))).toBe(
      lines('Önce', '', '| Şehir | «»    | Nüfus |', '| ----- | --- | ----: |', '| İzmir |     | 4 |', '| Bursa |     | 3 |', '', 'Sonra'),
    )
    expect(run(addTableColumnLeft, at('Şehir'), 'crlf')).toBe(
      crlf(lines('Önce', '', '| «»    | Şehir | Nüfus |', '| --- | ----- | ----: |', '|     | İzmir | 4 |', '|     | Bursa | 3 |', '', 'Sonra')),
    )
    expect(run(addTableColumnRight, '> | «»a | b |\n> | - | - |\n> | c | d |\n')).toBe('> | a | «»    | b |\n> | - | --- | - |\n> | c |     | d |\n')
  })

  it('deletes columns but never the last one', () => {
    expect(run(deleteTableColumn, at('Nüfus'))).toBe(lines('Önce', '', '| «»Şehir |', '| ----- |', '| İzmir |', '| Bursa |', '', 'Sonra'))
    expect(run(deleteTableColumn, at('İzmir'))).toBe(lines('Önce', '', '| Nüfus |', '| ----: |', '| «»4 |', '| 3 |', '', 'Sonra'))
    expect(run(deleteTableColumn, '| a |\n| - |\n| «»b |')).toBe(null)
  })

  it('keeps tables without outer pipes valid', () => {
    expect(run(addTableColumnRight, 'a | «»b\n--|--\nc | d')).toBe('a | b| «»    |\n--|--| --- |\nc | d|     |')
    expect(run(addTableColumnLeft, '«»a | b\n--|--\nc | d')).toBe('| «»    |a | b\n| --- |--|--\n|     |c | d')
    expect(run(deleteTableColumn, '«»a | b\n--|--\nc | d')).toBe('| «»b|\n|--|\n| d|')
  })
})

describe('realigning', () => {
  it('pads cells by alignment, fills short rows and touches only the table lines (CRLF)', () => {
    const input = lines('Önce', '', '|Şehir|Nüfus|Not|', '|:-:|--:|:--|', '|İstanbul|15|kalabalık \\| büyük|', '|Ka«»rs|0.3', '', 'Sonra')
    expect(run(formatTable, input, 'crlf')).toBe(
      crlf(
        lines(
          'Önce',
          '',
          '|  Şehir   | Nüfus | Not                |',
          '| :------: | ----: | :----------------- |',
          '| İstanbul |    15 | kalabalık \\| büyük |',
          '|   Ka«»rs   |   0.3 |                    |',
          '',
          'Sonra',
        ),
      ),
    )
  })

  it('keeps prefixes and extra cells', () => {
    expect(run(formatTable, '> |«»a|bbbbb|\n> |-|-|\n> |c|d|\n')).toBe('> | «»a   | bbbbb |\n> | --- | ----- |\n> | c   | d     |\n')
    expect(run(formatTable, '| a | b |\n|---|---|\n| 1 | 2 | 3«» |\n')).toBe('| a   | b   |\n| --- | --- |\n| 1   | 2   | 3«» |\n')
  })

  it('changes nothing in an aligned table', () => {
    const aligned = '| a   | b   |\n| --- | --- |\n| «»1   | 2   |'
    expect(run(formatTable, aligned)).toBe(aligned)
  })
})

describe('in a view', () => {
  const views: EditorView[] = []
  afterEach(() => views.splice(0).forEach((v) => v.destroy()))

  function mount(doc: string, cursor: number, livePreview = true) {
    const view = new EditorView({ state: createEditorState(doc, { livePreview }), parent: document.body })
    view.dispatch({ selection: EditorSelection.cursor(cursor), effects: tableFocusEffect.of(true) })
    views.push(view)
    return view
  }

  const selected = (view: EditorView) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)

  it('moves with Tab and Shift-Tab inside tables only', () => {
    const view = mount(TABLE, TABLE.indexOf('Şehir'))
    const key = (key: string, shiftKey = false) =>
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
    key('Tab')
    expect(selected(view)).toBe('Nüfus')
    key('Tab', true)
    expect(selected(view)).toBe('Şehir')
    view.dispatch({ selection: EditorSelection.cursor(0) })
    key('Tab')
    expect(view.state.sliceDoc()).toBe(TABLE)
  })

  it('shows the toolbar in live preview while editing a table and runs its buttons', () => {
    const view = mount(TABLE, TABLE.indexOf('İzmir'))
    expect(view.state.field(tableToolbarField)?.pos).toBe(TABLE.indexOf('| Şehir'))
    const toolbar = view.dom.querySelector('.cm-table-toolbar')!
    expect(toolbar.getAttribute('aria-label')).toBe('Table tools')
    const button = (label: string) => view.dom.querySelector<HTMLButtonElement>(`.cm-table-toolbar button[aria-label="${label}"]`)!
    expect([...toolbar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Add row above',
      'Add row below',
      'Delete row',
      'Add column left',
      'Add column right',
      'Delete column',
      'Align columns',
    ])
    button('Delete row').click()
    expect(view.state.sliceDoc()).toBe(TABLE.replace('| İzmir | 4 |\n', ''))
    view.dispatch({ selection: EditorSelection.cursor(TABLE.indexOf('Şehir')) })
    expect(button('Delete row').disabled).toBe(true)
    expect(button('Add row below').disabled).toBe(false)
    button('Align columns').click()
    expect(view.state.sliceDoc()).toContain('| Bursa |     3 |')
    view.dispatch({ selection: EditorSelection.cursor(0) })
    expect(view.state.field(tableToolbarField)).toBe(null)
    expect(view.dom.querySelector('.cm-table-toolbar')).toBe(null)
  })

  it('hides the toolbar without focus, in raw mode and when read-only', () => {
    const view = mount(TABLE, TABLE.indexOf('İzmir'))
    view.dispatch({ effects: tableFocusEffect.of(false) })
    expect(view.state.field(tableToolbarField)).toBe(null)
    expect(mount(TABLE, TABLE.indexOf('İzmir'), false).state.field(tableToolbarField)).toBe(null)
    const readOnly = new EditorView({ state: createEditorState(TABLE, { readOnly: true }), parent: document.body })
    views.push(readOnly)
    readOnly.dispatch({ selection: EditorSelection.cursor(TABLE.indexOf('İzmir')), effects: tableFocusEffect.of(true) })
    expect(readOnly.state.field(tableToolbarField)).toBe(null)
    expect(nextTableCell(readOnly)).toBe(false)
  })
})
