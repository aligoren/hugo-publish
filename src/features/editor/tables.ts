// GFM table editing. With the cursor in a table, Tab / Shift-Tab move
// between cells (Tab in the last cell adds a row), and in live preview a
// small toolbar above the table adds and removes rows and columns and
// realigns the columns. Every edit touches only the table's own lines, and
// only the characters that change; new lines use the document's separator.
// Rows keep their prefix (`> ` in a blockquote, indentation in a list).

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  StateEffect,
  StateField,
  Text,
  type ChangeSpec,
  type EditorState,
  type Extension,
  type SelectionRange,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip, type TooltipView, type ViewUpdate } from '@codemirror/view'
import { livePreviewEnabled } from './config'
import type { SyntaxNode, SyntaxTree } from './syntax'

/** The raw text between two pipes (padding included), as document positions. */
export interface TableCell {
  from: number
  to: number
}

export type TableLineKind = 'header' | 'delimiter' | 'row'

export interface TableLine {
  kind: TableLineKind
  /** The document line. */
  number: number
  from: number
  to: number
  /** Where the row starts: after a blockquote marker or list indentation. */
  start: number
  /** Where the row ends, before trailing whitespace. */
  end: number
  leading: boolean
  trailing: boolean
  cells: TableCell[]
}

export interface TableInfo {
  from: number
  to: number
  lines: TableLine[]
}

export type TableAlignment = 'left' | 'center' | 'right' | null

/**
 * Splits a table row into cells. Positions are offsets in `text`; a pipe
 * escaped with a backslash (`\|`) belongs to the cell.
 */
export function splitTableRow(text: string): Pick<TableLine, 'leading' | 'trailing' | 'cells'> & { start: number; end: number } {
  let start = 0
  while (start < text.length && (text[start] === ' ' || text[start] === '\t')) start++
  let end = text.length
  while (end > start && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--
  const pipes: number[] = []
  for (let i = start; i < end; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '|') pipes.push(i)
  }
  const leading = pipes.length > 0 && pipes[0] === start
  const trailing = pipes.length > (leading ? 1 : 0) && pipes[pipes.length - 1] === end - 1
  const bounds = [...(leading ? [] : [start - 1]), ...pipes, ...(trailing ? [] : [end])]
  const cells: TableCell[] = []
  for (let i = 0; i + 1 < bounds.length; i++) cells.push({ from: bounds[i] + 1, to: bounds[i + 1] })
  return { leading, trailing, cells, start, end }
}

function readLine(state: EditorState, kind: TableLineKind, nodeFrom: number): TableLine {
  const line = state.doc.lineAt(nodeFrom)
  // Read the row from the end of the line's prefix, whatever the node includes of indentation and the leading pipe.
  let rowFrom = nodeFrom
  while (rowFrom > line.from && /[ \t|]/.test(state.sliceDoc(rowFrom - 1, rowFrom))) rowFrom--
  const split = splitTableRow(state.sliceDoc(rowFrom, line.to))
  const shift = (pos: number) => rowFrom + pos
  return {
    kind,
    number: line.number,
    from: line.from,
    to: line.to,
    start: shift(split.start),
    end: shift(split.end),
    leading: split.leading,
    trailing: split.trailing,
    cells: split.cells.map((cell) => ({ from: shift(cell.from), to: shift(cell.to) })),
  }
}

function tableNodeAt(tree: SyntaxTree, pos: number): SyntaxNode | null {
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === 'Table') return node
    }
  }
  return null
}

/** The GFM table at `pos`, or null. */
export function tableAt(state: EditorState, pos: number, tree?: SyntaxTree): TableInfo | null {
  const node = tableNodeAt(tree ?? ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state), pos)
  if (!node) return null
  const lines: TableLine[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const kind: TableLineKind | null =
      child.name === 'TableHeader' ? 'header' : child.name === 'TableDelimiter' ? 'delimiter' : child.name === 'TableRow' ? 'row' : null
    if (kind && (lines.length === 0 || state.doc.lineAt(child.from).number !== lines[lines.length - 1].number)) {
      lines.push(readLine(state, kind, child.from))
    }
  }
  if (lines.length < 2 || lines[0].kind !== 'header' || lines[1].kind !== 'delimiter') return null
  return { from: node.from, to: node.to, lines }
}

/** Column alignments from the delimiter row (`:--`, `:-:`, `--:`). */
export function tableAlignments(state: EditorState, table: TableInfo): TableAlignment[] {
  return table.lines[1].cells.map((cell) => {
    const text = state.sliceDoc(cell.from, cell.to).trim()
    const left = text.startsWith(':')
    const right = text.endsWith(':') && text.length > 1
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null
  })
}

/** Columns a character takes in a monospace font (East Asian wide characters and emoji take two). */
function charWidth(code: number): number {
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    if (/[\p{M}​-‏⁠﻿]/u.test(ch)) continue
    width += charWidth(ch.codePointAt(0) as number)
  }
  return width
}

// ---------------------------------------------------------------------------
// Edits

function lineIndexAt(table: TableInfo, pos: number): number {
  const index = table.lines.findIndex((line) => pos >= line.from && pos <= line.to)
  return index === -1 ? (pos < table.lines[0].from ? 0 : table.lines.length - 1) : index
}

/** The cell index of `pos` in a line (a position at a pipe belongs to the cell before it). */
export function cellIndexAt(line: TableLine, pos: number): number {
  for (let i = 0; i < line.cells.length; i++) if (pos <= line.cells[i].to) return i
  return Math.max(0, line.cells.length - 1)
}

function rawCells(state: EditorState, line: TableLine): string[] {
  return line.cells.map((cell) => state.sliceDoc(cell.from, cell.to))
}

/**
 * A row's text. Pipes that GFM needs are added: a leading one before an
 * empty first cell, a trailing one after an empty last cell, both around a
 * single cell.
 */
function rowText(prefix: string, leading: boolean, cells: readonly string[], trailing: boolean, rest = ''): string {
  if (cells.length === 1 && !leading && !trailing) leading = trailing = true
  if (!leading && cells[0].trim() === '') leading = true
  if (!trailing && cells[cells.length - 1].trim() === '') trailing = true
  return prefix + (leading ? '|' : '') + cells.join('|') + (trailing ? '|' : '') + rest
}

function rebuild(state: EditorState, line: TableLine, cells: readonly string[], leading = line.leading, trailing = line.trailing): string {
  return rowText(state.sliceDoc(line.from, line.start), leading, cells, trailing, state.sliceDoc(line.end, line.to))
}

/** The smallest change turning `oldText` (at `from`) into `newText`. */
function textChange(from: number, oldText: string, newText: string): ChangeSpec | null {
  if (oldText === newText) return null
  const max = Math.min(oldText.length, newText.length)
  let start = 0
  while (start < max && oldText[start] === newText[start]) start++
  let end = 0
  while (end < max - start && oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]) end++
  return { from: from + start, to: from + oldText.length - end, insert: newText.slice(start, newText.length - end) }
}

interface TableEdit {
  /** New text of existing lines (by index), or null to delete the line. */
  lines?: Map<number, string | null>
  /** A new line next to an existing one. */
  insert?: { at: number; below: boolean; text: string }
  /** Where the cursor goes: a line (existing index, or `'inserted'`) and a cell. */
  target: { line: number | 'inserted'; cell: number; mode: 'select' | 'start' | { offset: number } }
}

function cellRange(lineStart: number, text: string, prefixLength: number, cell: number, mode: TableEdit['target']['mode']): SelectionRange {
  const split = splitTableRow(text.slice(prefixLength))
  const index = Math.max(0, Math.min(cell, split.cells.length - 1))
  const span = split.cells[index] ?? { from: split.start, to: split.start }
  const raw = text.slice(prefixLength + span.from, prefixLength + span.to)
  const lead = raw.length - raw.trimStart().length
  const content = raw.trim()
  const base = lineStart + prefixLength + span.from
  if (content === '') return EditorSelection.cursor(base + Math.min(1, raw.length))
  if (mode === 'select') return EditorSelection.range(base + lead, base + lead + content.length)
  const offset = mode === 'start' ? 0 : Math.max(0, Math.min(mode.offset, content.length))
  return EditorSelection.cursor(base + lead + offset)
}

function applyEdit(state: EditorState, table: TableInfo, edit: TableEdit): TransactionSpec {
  const changes: ChangeSpec[] = []
  const lines = table.lines
  for (const [index, text] of edit.lines ?? []) {
    const line = lines[index]
    if (text === null) {
      // Delete the line with one of its line breaks.
      if (line.number < state.doc.lines) changes.push({ from: line.from, to: state.doc.line(line.number + 1).from })
      else changes.push({ from: state.doc.line(line.number - 1).to, to: line.to })
      continue
    }
    const change = textChange(line.from, state.sliceDoc(line.from, line.to), text)
    if (change) changes.push(change)
  }
  if (edit.insert) {
    const line = lines[edit.insert.at]
    changes.push(
      edit.insert.below
        ? { from: line.to, insert: Text.of(['', edit.insert.text]) }
        : { from: line.from, insert: Text.of([edit.insert.text, '']) },
    )
  }
  const set = state.changes(changes)
  const { target } = edit
  let lineStart: number
  let text: string
  let prefixLength: number
  if (target.line === 'inserted' && edit.insert) {
    const anchor = lines[edit.insert.at]
    lineStart = edit.insert.below ? set.mapPos(anchor.to, -1) + 1 : set.mapPos(anchor.from, -1)
    text = edit.insert.text
    prefixLength = anchor.start - anchor.from
  } else {
    const line = lines[target.line as number]
    lineStart = set.mapPos(line.from, -1)
    text = edit.lines?.get(target.line as number) ?? state.sliceDoc(line.from, line.to)
    prefixLength = line.start - line.from
  }
  return { changes: set, selection: EditorSelection.create([cellRange(lineStart, text, prefixLength, target.cell, target.mode)]) }
}

interface Context {
  table: TableInfo
  index: number
  line: TableLine
  cell: number
}

function context(state: EditorState, tree?: SyntaxTree): Context | null {
  const head = state.selection.main.head
  const table = tableAt(state, head, tree)
  if (!table) return null
  const index = lineIndexAt(table, head)
  const line = table.lines[index]
  return { table, index, line, cell: cellIndexAt(line, head) }
}

/** An empty row shaped like the delimiter row (so an aligned table stays aligned). */
function emptyRow(state: EditorState, table: TableInfo, prefixFrom: TableLine): string {
  const delimiter = table.lines[1]
  const cells = delimiter.cells.map((cell) => ' '.repeat(Math.max(1, cell.to - cell.from)))
  return rowText(state.sliceDoc(prefixFrom.from, prefixFrom.start), delimiter.leading, cells, delimiter.trailing)
}

/** Adds an empty row below the cursor's row (below the header from the header row), or above a body row. */
export function addTableRowSpec(state: EditorState, below = true): TransactionSpec | null {
  const ctx = context(state)
  if (!ctx) return null
  const { table, index, cell } = ctx
  if (!below && ctx.line.kind !== 'row') return null
  const at = below && index < 1 ? 1 : index
  return applyEdit(state, table, {
    insert: { at, below, text: emptyRow(state, table, table.lines[at]) },
    target: { line: 'inserted', cell, mode: 'start' },
  })
}

/** Deletes the cursor's body row (the header and delimiter rows stay). */
export function deleteTableRowSpec(state: EditorState): TransactionSpec | null {
  const ctx = context(state)
  if (!ctx || ctx.line.kind !== 'row') return null
  const { table, index, cell } = ctx
  const next = index + 1 < table.lines.length ? index + 1 : index - 1
  // The delimiter row has no cells to land in: go to the header instead.
  const target = table.lines[next].kind === 'delimiter' ? 0 : next
  return applyEdit(state, table, { lines: new Map([[index, null]]), target: { line: target, cell, mode: 'start' } })
}

/** Adds an empty column left or right of the cursor's column. */
export function addTableColumnSpec(state: EditorState, right = true): TransactionSpec | null {
  const ctx = context(state)
  if (!ctx) return null
  const { table, index, cell } = ctx
  const at = right ? cell + 1 : cell
  const lines = new Map<number, string>()
  table.lines.forEach((line, i) => {
    const cells = rawCells(state, line)
    if (at > cells.length) return // a short row: its missing cells are empty anyway
    // A new first or last column brings its outer pipe (`a | b` → `| x |a | b`).
    const edge = at === 0 ? 'leading' : at === cells.length ? 'trailing' : null
    cells.splice(at, 0, line.kind === 'delimiter' ? ' --- ' : '     ')
    lines.set(i, rebuild(state, line, cells, line.leading || edge === 'leading', line.trailing || edge === 'trailing'))
  })
  return applyEdit(state, table, { lines, target: { line: index, cell: at, mode: 'start' } })
}

/** Deletes the cursor's column (not the last one). */
export function deleteTableColumnSpec(state: EditorState): TransactionSpec | null {
  const ctx = context(state)
  if (!ctx || ctx.table.lines[0].cells.length < 2) return null
  const { table, index, cell } = ctx
  const lines = new Map<number, string>()
  table.lines.forEach((line, i) => {
    const cells = rawCells(state, line)
    if (cell >= cells.length) return
    cells.splice(cell, 1)
    lines.set(i, rebuild(state, line, cells.length > 0 ? cells : [' ']))
  })
  return applyEdit(state, table, { lines, target: { line: index, cell: Math.max(0, cell - (cell >= table.lines[0].cells.length - 1 ? 1 : 0)), mode: 'start' } })
}

function pad(text: string, width: number, align: TableAlignment): string {
  const missing = Math.max(0, width - displayWidth(text))
  if (align === 'right') return ' '.repeat(missing) + text
  if (align === 'center') return ' '.repeat(Math.floor(missing / 2)) + text + ' '.repeat(Math.ceil(missing / 2))
  return text + ' '.repeat(missing)
}

function delimiterText(width: number, align: TableAlignment): string {
  if (align === 'center') return ':' + '-'.repeat(Math.max(1, width - 2)) + ':'
  if (align === 'right') return '-'.repeat(Math.max(2, width - 1)) + ':'
  if (align === 'left') return ':' + '-'.repeat(Math.max(2, width - 1))
  return '-'.repeat(Math.max(3, width))
}

/**
 * Realigns the table: cells padded so the pipes line up (by alignment),
 * short rows filled, pipes on both ends. The cursor stays in its cell.
 */
export function formatTableSpec(state: EditorState): TransactionSpec | null {
  const ctx = context(state)
  if (!ctx) return null
  const { table, index, line, cell } = ctx
  const columns = table.lines[0].cells.length
  const aligns = tableAlignments(state, table)
  const contents = table.lines.map((l) => rawCells(state, l).map((text) => text.trim()))
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(3, ...contents.map((row, r) => (table.lines[r].kind === 'delimiter' ? 0 : displayWidth(row[c] ?? '')))),
  )
  const lines = new Map<number, string>()
  table.lines.forEach((l, r) => {
    const cells = contents[r].map((text, c) => {
      if (c >= columns) return ` ${text} `
      if (l.kind === 'delimiter') return ` ${delimiterText(widths[c], aligns[c] ?? null)} `
      return ` ${pad(text, widths[c], aligns[c] ?? null)} `
    })
    for (let c = cells.length; c < columns; c++) cells.push(l.kind === 'delimiter' ? ` ${delimiterText(widths[c], aligns[c] ?? null)} ` : ` ${' '.repeat(widths[c])} `)
    lines.set(r, rowText(state.sliceDoc(l.from, l.start), true, cells, true))
  })
  // Keep the cursor at the same place in its cell's text.
  const head = state.selection.main.head
  const span = line.cells[cell]
  let offset = 0
  if (span) {
    const raw = state.sliceDoc(span.from, span.to)
    offset = head - (span.from + raw.length - raw.trimStart().length)
  }
  return applyEdit(state, table, { lines, target: { line: index, cell, mode: { offset } } })
}

/** Moves to the next (`dir` 1) or previous (-1) cell, selecting its text. Tab in the last cell adds a row. */
export function moveTableCellSpec(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const ctx = context(state)
  if (!ctx) return null
  const { table, index, line, cell } = ctx
  const lines = table.lines
  const select = (i: number, c: number): TransactionSpec => {
    const l = lines[i]
    return { selection: EditorSelection.create([cellRange(l.from, state.sliceDoc(l.from, l.to), l.start - l.from, c, 'select')]) }
  }
  const usable = (i: number) => lines[i].kind !== 'delimiter' && lines[i].cells.length > 0
  if (dir > 0) {
    if (line.kind !== 'delimiter' && cell + 1 < line.cells.length) return select(index, cell + 1)
    for (let i = index + 1; i < lines.length; i++) if (usable(i)) return select(i, 0)
    const last = lines.length - 1
    return applyEdit(state, table, {
      insert: { at: last, below: true, text: emptyRow(state, table, lines[last]) },
      target: { line: 'inserted', cell: 0, mode: 'start' },
    })
  }
  if (line.kind !== 'delimiter' && cell > 0) return select(index, cell - 1)
  for (let i = index - 1; i >= 0; i--) if (usable(i)) return select(i, lines[i].cells.length - 1)
  return select(0, 0)
}

function command(spec: (state: EditorState) => TransactionSpec | null, userEvent: string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false
    const result = spec(state)
    if (!result) return false
    dispatch(state.update(result, { userEvent: result.changes ? userEvent : 'select', scrollIntoView: true }))
    return true
  }
}

export const nextTableCell: StateCommand = command((state) => moveTableCellSpec(state, 1), 'input')
export const previousTableCell: StateCommand = command((state) => moveTableCellSpec(state, -1), 'input')
export const addTableRowBelow: StateCommand = command((state) => addTableRowSpec(state, true), 'input')
export const addTableRowAbove: StateCommand = command((state) => addTableRowSpec(state, false), 'input')
export const deleteTableRow: StateCommand = command(deleteTableRowSpec, 'delete')
export const addTableColumnRight: StateCommand = command((state) => addTableColumnSpec(state, true), 'input')
export const addTableColumnLeft: StateCommand = command((state) => addTableColumnSpec(state, false), 'input')
export const deleteTableColumn: StateCommand = command(deleteTableColumnSpec, 'delete')
export const formatTable: StateCommand = command(formatTableSpec, 'input')

// ---------------------------------------------------------------------------
// Toolbar (live preview)

/** Focus changes of the editor (exported for tests, where jsdom has no real focus). */
export const tableFocusEffect = StateEffect.define<boolean>()
const focusEffect = tableFocusEffect

/** Whether the editor has focus (the toolbar only shows while editing). */
const focusedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(focusEffect)) value = effect.value
    return value
  },
})

interface ToolbarButton {
  label: string
  icon: string
  run: StateCommand
  /** Whether the command applies at the cursor's place in the table. */
  applies: (ctx: Context) => boolean
}

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">${body}</svg>`

const BUTTONS: (ToolbarButton | null)[] = [
  {
    label: 'Add row above',
    icon: svg('<rect x="2" y="8" width="12" height="6" rx="1"/><path d="M8 1.5v5M5.5 4h5"/>'),
    run: addTableRowAbove,
    applies: (ctx) => ctx.line.kind === 'row',
  },
  {
    label: 'Add row below',
    icon: svg('<rect x="2" y="2" width="12" height="6" rx="1"/><path d="M8 9.5v5M5.5 12h5"/>'),
    run: addTableRowBelow,
    applies: () => true,
  },
  {
    label: 'Delete row',
    icon: svg('<rect x="2" y="5" width="12" height="6" rx="1"/><path d="M6 6.5l4 3M10 6.5l-4 3"/>'),
    run: deleteTableRow,
    applies: (ctx) => ctx.line.kind === 'row',
  },
  null,
  {
    label: 'Add column left',
    icon: svg('<rect x="8" y="2" width="6" height="12" rx="1"/><path d="M1.5 8h5M4 5.5v5"/>'),
    run: addTableColumnLeft,
    applies: () => true,
  },
  {
    label: 'Add column right',
    icon: svg('<rect x="2" y="2" width="6" height="12" rx="1"/><path d="M9.5 8h5M12 5.5v5"/>'),
    run: addTableColumnRight,
    applies: () => true,
  },
  {
    label: 'Delete column',
    icon: svg('<rect x="5" y="2" width="6" height="12" rx="1"/><path d="M6.5 6l3 4M9.5 6l-3 4"/>'),
    run: deleteTableColumn,
    applies: (ctx) => ctx.table.lines[0].cells.length > 1,
  },
  null,
  {
    label: 'Align columns',
    icon: svg('<path d="M2 3.5h12M2 8h12M2 12.5h12M6 2v12M10 2v12"/>'),
    run: formatTable,
    applies: () => true,
  },
]

class TableToolbarView implements TooltipView {
  readonly dom: HTMLElement
  private readonly buttons: { button: HTMLButtonElement; spec: ToolbarButton }[] = []
  constructor(view: EditorView) {
    const dom = document.createElement('div')
    dom.className = 'cm-table-toolbar'
    dom.setAttribute('role', 'toolbar')
    dom.setAttribute('aria-label', view.state.phrase('Table tools'))
    for (const spec of BUTTONS) {
      if (!spec) {
        const separator = document.createElement('span')
        separator.className = 'cm-table-toolbar-separator'
        separator.setAttribute('aria-hidden', 'true')
        dom.append(separator)
        continue
      }
      const button = document.createElement('button')
      button.type = 'button'
      const label = view.state.phrase(spec.label)
      button.title = label
      button.setAttribute('aria-label', label)
      button.innerHTML = spec.icon
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', (event) => {
        event.preventDefault()
        spec.run(view)
        view.focus()
      })
      this.buttons.push({ button, spec })
      dom.append(button)
    }
    this.dom = dom
    this.refresh(view.state)
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet) this.refresh(update.state)
  }
  private refresh(state: EditorState) {
    // The tree the editor already has: no parsing forced on every keystroke.
    const ctx = context(state, syntaxTree(state))
    for (const { button, spec } of this.buttons) button.disabled = !ctx || !spec.applies(ctx)
  }
}

function toolbarFor(state: EditorState, previous: Tooltip | null): Tooltip | null {
  if (!state.facet(livePreviewEnabled) || state.readOnly || !state.field(focusedField, false)) return null
  const node = tableNodeAt(syntaxTree(state), state.selection.main.head)
  if (!node) return null
  if (previous && previous.pos === node.from) return previous
  return { pos: node.from, above: true, create: (view) => new TableToolbarView(view) }
}

export const tableToolbarField = StateField.define<Tooltip | null>({
  create: (state) => toolbarFor(state, null),
  update(value, tr) {
    if (!tr.docChanged && !tr.selection && !tr.reconfigured && !tr.effects.some((e) => e.is(focusEffect))) return value
    return toolbarFor(tr.state, value)
  },
  provide: (field) => showTooltip.from(field),
})

/** Tab / Shift-Tab between table cells; the table toolbar in live preview. */
export function tables(): Extension {
  return [
    focusedField,
    EditorView.focusChangeEffect.of((_state, focusing) => focusEffect.of(focusing)),
    tableToolbarField,
    keymap.of([
      { key: 'Tab', run: nextTableCell },
      { key: 'Shift-Tab', run: previousTableCell },
    ]),
  ]
}
