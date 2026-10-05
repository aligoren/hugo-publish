// Editing commands for the toolbar and keyboard shortcuts.
//
// Each command is a CodeMirror `StateCommand`, so it can run against a view
// (`cmd(view)`) or, in tests, against `{ state, dispatch }`. The `*Spec`
// functions are the pure part: they map a state to a transaction spec.
// Inserted text is built as `Text` lines, so line breaks always come out as
// the document's own separator (`\n` or `\r\n`).

import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  Text,
  type ChangeSpec,
  type EditorState,
  type Line,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state'
import { alertAt, alertField, findAlerts } from './alerts'
import type { AlertType } from './config'
import type { InsertedImage, ShortcodeDef } from './contract'
import { shortcodeSkeleton } from './shortcodeArgs'
import type { SyntaxNode } from './syntax'

/** Text with `\n` line breaks as a CodeMirror `Text` (independent of the document's separator). */
function lines(text: string): Text {
  return Text.of(text.split('\n'))
}

function run(spec: (state: EditorState) => TransactionSpec | null, userEvent = 'input'): StateCommand {
  return ({ state, dispatch }) => {
    const result = spec(state)
    if (!result) return false
    dispatch(state.update(result, { userEvent, scrollIntoView: true }))
    return true
  }
}

const isBlank = (line: Line) => line.text.trim() === ''

/** Lines covered by a range; a range ending at the start of a line does not include that line. */
function linesOfRange(state: EditorState, from: number, to: number): Line[] {
  const first = state.doc.lineAt(from)
  let last = state.doc.lineAt(to)
  if (to > from && last.from === to && last.number > first.number) last = state.doc.line(last.number - 1)
  const result: Line[] = []
  for (let n = first.number; n <= last.number; n++) result.push(state.doc.line(n))
  return result
}

/** Unique lines touched by any selection range, in document order. */
function selectedLines(state: EditorState): Line[] {
  const seen = new Map<number, Line>()
  for (const range of state.selection.ranges) {
    for (const line of linesOfRange(state, range.from, range.to)) seen.set(line.number, line)
  }
  return [...seen.values()].sort((a, b) => a.number - b.number)
}

// ---------------------------------------------------------------------------
// Bold / italic

function runLength(text: string, ch: string, fromEnd: boolean): number {
  let n = 0
  if (fromEnd) for (let i = text.length - 1; i >= 0 && text[i] === ch; i--) n++
  else for (let i = 0; i < text.length && text[i] === ch; i++) n++
  return n
}

/** Is a marker of `size` (1 = italic, 2 = bold) present in a run of `n` marker characters? */
function hasMarker(n: number, size: 1 | 2): boolean {
  return size === 2 ? n >= 2 : n % 2 === 1
}

function toggleInlineSpec(state: EditorState, size: 1 | 2): TransactionSpec {
  const marker = size === 2 ? '**' : '*'
  const nodeName = size === 2 ? 'StrongEmphasis' : 'Emphasis'
  const doc = state.doc
  return state.changeByRange((range) => {
    let { from, to } = range
    if (!range.empty) {
      const text = doc.sliceString(from, to)
      from += text.length - text.trimStart().length
      to -= text.length - text.trimEnd().length
      if (from >= to) return { range }
    }
    const make = (a: number, b: number) =>
      range.anchor > range.head ? EditorSelection.range(b, a) : EditorSelection.range(a, b)

    // 1. Markers right around the selection: `**|text|**`.
    for (const ch of ['*', '_']) {
      const before = runLength(doc.sliceString(Math.max(0, from - 3), from), ch, true)
      const after = runLength(doc.sliceString(to, Math.min(doc.length, to + 3)), ch, false)
      if (hasMarker(Math.min(before, after), size)) {
        return {
          changes: [
            { from: from - size, to: from },
            { from: to, to: to + size },
          ],
          range: make(from - size, to - size),
        }
      }
    }

    // 2. The selection includes the markers: `|**text**|`.
    if (!range.empty) {
      const text = doc.sliceString(from, to)
      for (const ch of ['*', '_']) {
        const n = Math.min(runLength(text, ch, false), runLength(text, ch, true))
        if (text.length > 2 * size && hasMarker(n, size)) {
          return {
            changes: [
              { from, to: from + size },
              { from: to - size, to },
            ],
            range: make(from, to - 2 * size),
          }
        }
      }
    }

    // 3. A cursor inside an emphasis span: remove that span's markers.
    if (range.empty) {
      for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, -1); node; node = node.parent) {
        if (node.name !== nodeName) continue
        const open = node.firstChild
        const close = node.lastChild
        if (open && close && open !== close && from >= open.to && from <= close.from) {
          const openSize = open.to - open.from
          return {
            changes: [
              { from: open.from, to: open.to },
              { from: close.from, to: close.to },
            ],
            range: EditorSelection.cursor(from - openSize),
          }
        }
        break
      }
    }

    // 4. A cursor inside a word: wrap the word.
    if (range.empty) {
      const word = state.wordAt(from)
      if (word && word.from < from && from < word.to) {
        return {
          changes: [
            { from: word.from, insert: marker },
            { from: word.to, insert: marker },
          ],
          range: EditorSelection.cursor(from + size),
        }
      }
    }

    // 5. Wrap the selection, or insert an empty pair around the cursor.
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      range: make(from + size, to + size),
    }
  })
}

export const toggleBoldSpec = (state: EditorState): TransactionSpec => toggleInlineSpec(state, 2)
export const toggleItalicSpec = (state: EditorState): TransactionSpec => toggleInlineSpec(state, 1)
export const toggleBold: StateCommand = run(toggleBoldSpec)
export const toggleItalic: StateCommand = run(toggleItalicSpec)

// ---------------------------------------------------------------------------
// Headings

const QUOTE_PREFIX = /^(?:[ \t]{0,3}>[ \t]?)*/
const HEADING_MARK = /^([ \t]{0,3})(#{1,6})(?=[ \t]|$)[ \t]*/

/** ATX heading level (0 = not a heading) of a line, looking past blockquote markers. */
export function headingLevel(lineText: string): number {
  const quote = QUOTE_PREFIX.exec(lineText)?.[0].length ?? 0
  const match = HEADING_MARK.exec(lineText.slice(quote))
  return match ? match[2].length : 0
}

export function setHeadingSpec(state: EditorState, level: number): TransactionSpec | null {
  if (!Number.isInteger(level) || level < 0 || level > 6) throw new RangeError(`Heading level must be 0-6, got ${level}`)
  const all = selectedLines(state)
  const targets = all.length > 1 ? all.filter((line) => !isBlank(line)) : all
  const prefix = level > 0 ? '#'.repeat(level) + ' ' : ''
  const changes: ChangeSpec[] = []
  for (const line of targets) {
    const quote = QUOTE_PREFIX.exec(line.text)?.[0].length ?? 0
    const rest = line.text.slice(quote)
    const match = HEADING_MARK.exec(rest)
    if (match) {
      const from = line.from + quote + match[1].length
      const to = line.from + quote + match[0].length
      if (state.sliceDoc(from, to) !== prefix) changes.push({ from, to, insert: prefix })
    } else if (level > 0) {
      const indent = /^[ \t]{0,3}/.exec(rest)?.[0].length ?? 0
      changes.push({ from: line.from + quote + indent, insert: prefix })
    }
  }
  if (changes.length === 0) return null
  const changeSet = state.changes(changes)
  return { changes: changeSet, selection: state.selection.map(changeSet, 1) }
}

/** Makes the selected lines headings of `level` (0 turns them back into paragraphs). */
export function setHeading(level: number): StateCommand {
  return run((state) => setHeadingSpec(state, level))
}

/** Paragraph → H1 → H2 → … → H6 → paragraph, based on the first selected line. */
export const cycleHeadingSpec = (state: EditorState): TransactionSpec | null => {
  const first = selectedLines(state).find((line) => !isBlank(line)) ?? state.doc.lineAt(state.selection.main.head)
  return setHeadingSpec(state, (headingLevel(first.text) + 1) % 7)
}
export const cycleHeading: StateCommand = run(cycleHeadingSpec)

// ---------------------------------------------------------------------------
// Blockquote

const QUOTED = /^([ \t]{0,3})>[ \t]?/

export function toggleBlockquoteSpec(state: EditorState): TransactionSpec | null {
  const targets = selectedLines(state)
  const content = targets.filter((line) => !isBlank(line))
  const unquote = content.length > 0 && content.every((line) => QUOTED.test(line.text))
  const changes: ChangeSpec[] = []
  for (const line of targets) {
    if (unquote) {
      const match = QUOTED.exec(line.text)
      if (match) changes.push({ from: line.from + match[1].length, to: line.from + match[0].length })
    } else if (!QUOTED.test(line.text)) {
      changes.push({ from: line.from, insert: isBlank(line) && targets.length > 1 ? '>' : '> ' })
    }
  }
  if (changes.length === 0) return null
  const changeSet = state.changes(changes)
  return { changes: changeSet, selection: state.selection.map(changeSet, 1) }
}
export const toggleBlockquote: StateCommand = run(toggleBlockquoteSpec)

// ---------------------------------------------------------------------------
// Blocks (alert, RTL, horizontal rule)

/**
 * Inserts a block of lines at the cursor with blank lines around it. On a
 * blank line the block replaces it; otherwise it goes after the current
 * paragraph. The cursor ends at `cursorLine`/`cursorColumn` of the block.
 */
function insertBlockSpec(state: EditorState, block: readonly string[], cursorLine: number, cursorColumn: number): TransactionSpec {
  const doc = state.doc
  let line = doc.lineAt(state.selection.main.head)
  let from: number
  let to: number
  let before = ''
  let after = ''
  if (isBlank(line)) {
    from = line.from
    to = line.to
    if (line.number > 1 && !isBlank(doc.line(line.number - 1))) before = '\n'
    if (line.number < doc.lines && !isBlank(doc.line(line.number + 1))) after = '\n'
  } else {
    while (line.number < doc.lines && !isBlank(doc.line(line.number + 1))) line = doc.line(line.number + 1)
    from = to = line.to
    before = '\n\n'
  }
  const text = before + block.join('\n') + after
  let cursor = from + before.length
  for (let i = 0; i < cursorLine; i++) cursor += block[i].length + 1
  cursor += cursorColumn
  return { changes: { from, to, insert: lines(text) }, selection: EditorSelection.cursor(cursor) }
}

/** Wraps the lines of the main selection: `open` lines before, `close` lines after, blank lines around. */
function wrapLinesSpec(
  state: EditorState,
  open: readonly string[],
  close: readonly string[],
  prefixLine?: (line: Line) => string,
): TransactionSpec {
  const doc = state.doc
  const sel = state.selection.main
  const targets = linesOfRange(state, sel.from, sel.to)
  const first = targets[0]
  const last = targets[targets.length - 1]
  const blankBefore = first.number > 1 && !isBlank(doc.line(first.number - 1)) ? '\n' : ''
  const blankAfter = last.number < doc.lines && !isBlank(doc.line(last.number + 1)) ? '\n' : ''
  const changes: ChangeSpec[] = []
  const openText = open.length > 0 ? blankBefore + open.join('\n') + '\n' : ''
  targets.forEach((line, i) => {
    const prefix = prefixLine?.(line) ?? ''
    const insert = (i === 0 ? openText : '') + prefix
    if (insert) changes.push({ from: line.from, insert: lines(insert) })
  })
  const closeText = (close.length > 0 ? '\n' + close.join('\n') : '') + blankAfter
  if (closeText) changes.push({ from: last.to, insert: lines(closeText) })
  const changeSet = state.changes(changes)
  return { changes: changeSet, selection: state.selection.map(changeSet, 1) }
}

/**
 * Inserts a GitHub alert (`> [!NOTE]`). With a selection, the selected lines
 * become the alert's content. Inside an existing alert, changes its type.
 */
export function insertAlertSpec(state: EditorState, type: AlertType): TransactionSpec {
  const marker = `[!${type.toUpperCase()}]`
  const alerts = state.field(alertField, false) ?? findAlerts(state)
  const current = alertAt(alerts, state, state.selection.main.head)
  if (current) {
    const from = current.markerFrom + 2
    const to = from + current.rawType.length
    if (state.sliceDoc(from, to) === type.toUpperCase()) return {}
    return { changes: { from, to, insert: type.toUpperCase() } }
  }
  const sel = state.selection.main
  if (sel.empty) return insertBlockSpec(state, [`> ${marker}`, '> '], 1, 2)
  const targets = linesOfRange(state, sel.from, sel.to)
  const alreadyQuoted = targets.every((line) => isBlank(line) || QUOTED.test(line.text))
  return wrapLinesSpec(state, [`> ${marker}`], [], (line) => {
    if (alreadyQuoted) return ''
    return isBlank(line) ? '>' : '> '
  })
}

export function insertAlert(type: AlertType): StateCommand {
  return run((state) => insertAlertSpec(state, type))
}

/** Changes the type of the alert at the cursor. Does nothing outside an alert. */
export function setAlertTypeSpec(state: EditorState, type: AlertType): TransactionSpec | null {
  const alerts = state.field(alertField, false) ?? findAlerts(state)
  if (!alertAt(alerts, state, state.selection.main.head)) return null
  return insertAlertSpec(state, type)
}

export function setAlertType(type: AlertType): StateCommand {
  return run((state) => setAlertTypeSpec(state, type))
}

export const RTL_OPEN_TAG = '<div dir="rtl" style="text-align: center;">'

/**
 * Inserts a centred RTL block. The blank lines inside are required: without
 * them Hugo treats the content as raw HTML and does not parse its Markdown.
 * With a selection, the selected lines become the block's content.
 */
export function insertRtlBlockSpec(state: EditorState): TransactionSpec {
  if (state.selection.main.empty) return insertBlockSpec(state, [RTL_OPEN_TAG, '', '', '', '</div>'], 2, 0)
  return wrapLinesSpec(state, [RTL_OPEN_TAG, ''], ['', '</div>'])
}
export const insertRtlBlock: StateCommand = run(insertRtlBlockSpec)

/** Inserts a thematic break (`---`) with blank lines around it, so it is never read as a heading underline. */
export function insertHorizontalRuleSpec(state: EditorState): TransactionSpec {
  // On the first line of the body, `---` could be read as a front matter delimiter.
  const line = state.doc.lineAt(state.selection.main.head)
  const rule = line.number === 1 && isBlank(line) ? '***' : '---'
  return insertBlockSpec(state, [rule], 0, 3)
}
export const insertHorizontalRule: StateCommand = run(insertHorizontalRuleSpec)

// ---------------------------------------------------------------------------
// Links

export interface LinkOptions {
  url?: string
  /** Link text when nothing is selected. */
  text?: string
}

/**
 * Wraps the selection in `[…](url)`, or inserts `[text](url)`. The cursor
 * goes where typing is needed next: the empty text, then the empty URL,
 * otherwise after the link.
 */
export function insertLinkSpec(state: EditorState, options: LinkOptions = {}): TransactionSpec {
  const url = options.url ?? ''
  const sel = state.selection.main
  if (!sel.empty) {
    const textEnd = sel.to + 1
    const linkEnd = textEnd + 2 + url.length + 1
    return {
      changes: [
        { from: sel.from, insert: '[' },
        { from: sel.to, insert: lines(`](${url})`) },
      ],
      selection: EditorSelection.cursor(url ? linkEnd : textEnd + 2),
    }
  }
  const text = options.text ?? ''
  const inserted = lines(`[${text}](${url})`)
  const textStart = sel.from + 1
  const textEnd = textStart + lines(text).length
  const cursor = !text ? textStart : !url ? textEnd + 2 : sel.from + inserted.length
  return { changes: { from: sel.from, insert: inserted }, selection: EditorSelection.cursor(cursor) }
}

export function insertLink(options: LinkOptions = {}): StateCommand {
  return run((state) => insertLinkSpec(state, options))
}

/** `![alt]()` with the selection as alt text; the cursor goes into the empty destination (or the empty alt). */
export function insertImageSyntaxSpec(state: EditorState): TransactionSpec {
  const sel = state.selection.main
  const alt = state.sliceDoc(sel.from, sel.to)
  const text = `![${escapeImageAlt(alt)}]()`
  const cursor = alt ? sel.from + text.length - 1 : sel.from + 2
  return { changes: { from: sel.from, to: sel.to, insert: text }, selection: EditorSelection.cursor(cursor) }
}
export const insertImageSyntax: StateCommand = run(insertImageSyntaxSpec)

// ---------------------------------------------------------------------------
// Table, code block, footnote

/** `| a | b |` for the given cell texts. */
function tableRow(cells: readonly string[]): string {
  return '| ' + cells.join(' | ') + ' |'
}

/**
 * Inserts a table skeleton: a header row with `Column 1`, `Column 2`, … (the
 * `Column $` phrase), the delimiter row and empty body rows. The first header
 * cell's text is selected so typing replaces it.
 */
export function insertTableSpec(state: EditorState, columns = 2, rows = 2): TransactionSpec {
  const headers = Array.from({ length: columns }, (_, i) => state.phrase('Column $', i + 1))
  const widths = headers.map((h) => Math.max(3, h.length))
  const block = [
    tableRow(headers),
    tableRow(widths.map((w) => '-'.repeat(w))),
    ...Array.from({ length: rows }, () => tableRow(widths.map((w) => ' '.repeat(w)))),
  ]
  const spec = insertBlockSpec(state, block, 0, 2)
  const cursor = (spec.selection as { head: number }).head
  return { ...spec, selection: EditorSelection.single(cursor, cursor + headers[0].length) }
}
export const insertTable: StateCommand = run((state) => insertTableSpec(state))

/** Inserts a fenced code block, or fences the selected lines. */
export function insertCodeBlockSpec(state: EditorState, language = ''): TransactionSpec {
  if (state.selection.main.empty) return insertBlockSpec(state, ['```' + language, '', '```'], 1, 0)
  return wrapLinesSpec(state, ['```' + language], ['```'])
}
export const insertCodeBlock: StateCommand = run((state) => insertCodeBlockSpec(state))

const FOOTNOTE_REF = /\[\^(\d+)\]/g
const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]\s]+\]:/

/** The next free numeric footnote label. */
export function nextFootnoteNumber(text: string): number {
  let max = 0
  for (const match of text.matchAll(FOOTNOTE_REF)) max = Math.max(max, Number(match[1]))
  return max + 1
}

/**
 * Inserts a footnote reference `[^n]` after the selection and its definition
 * `[^n]: ` at the end of the document (after existing trailing definitions,
 * otherwise after a blank line). The cursor goes to the definition.
 */
export function insertFootnoteSpec(state: EditorState): TransactionSpec {
  const doc = state.doc
  const n = nextFootnoteNumber(doc.toString())
  const ref = `[^${n}]`
  let last = doc.lines
  while (last > 0 && isBlank(doc.line(last))) last--
  // Does the last paragraph hold footnote definitions? (Lines after one continue it.)
  let first = last
  while (first > 1 && !isBlank(doc.line(first - 1))) first--
  let inDefinitions = false
  for (let i = Math.max(first, 1); i <= last; i++) if (FOOTNOTE_DEF.test(doc.line(i).text)) inDefinitions = true
  const at = state.selection.main.to
  const defPos = last > 0 ? doc.line(last).to : 0
  const prefix = inDefinitions ? '\n' : '\n\n'
  const definition = `${prefix}[^${n}]: `
  const changes = [
    { from: at, insert: ref },
    { from: defPos, insert: lines(definition) },
  ]
  const changeSet = state.changes(changes)
  const cursor = changeSet.mapPos(defPos, 1)
  return { changes: changeSet, selection: EditorSelection.cursor(cursor) }
}
export const insertFootnote: StateCommand = run(insertFootnoteSpec)

// ---------------------------------------------------------------------------
// Images

/** Alt text with the characters that would end it escaped. */
export function escapeImageAlt(alt: string): string {
  return alt.replace(/[\\[\]]/g, (ch) => '\\' + ch).replace(/\s*\n\s*/g, ' ')
}

/** An image destination; wrapped in `<…>` when it contains spaces or parentheses. */
export function formatImageSrc(src: string): string {
  return /[\s()<>]/.test(src) ? `<${src.replace(/[<>]/g, encodeURIComponent)}>` : src
}

export function imageMarkdown(image: InsertedImage): string {
  return `![${escapeImageAlt(image.alt)}](${formatImageSrc(image.src)})`
}

/**
 * Inserts images at `pos` (default: replacing the main selection). Several
 * images go one per line, on lines of their own. The cursor goes after the
 * images, or into the first empty alt text (`![|](…)`) so the description
 * can be typed right away (left empty if the user moves on).
 */
export function insertImagesSpec(state: EditorState, images: readonly InsertedImage[], pos?: number): TransactionSpec | null {
  if (images.length === 0) return null
  const from = pos ?? state.selection.main.from
  const to = pos ?? state.selection.main.to
  const parts = images.map(imageMarkdown)
  let before = ''
  let after = ''
  if (images.length > 1) {
    const line = state.doc.lineAt(from)
    if (state.sliceDoc(line.from, from).trim() !== '') before = '\n'
    if (state.sliceDoc(to, state.doc.lineAt(to).to).trim() !== '') after = '\n'
  }
  const inserted = lines(before + parts.join('\n') + after)
  // Offsets in the `\n` text are document positions (a line break is one position whatever the separator).
  let cursor = from + inserted.length
  const empty = images.findIndex((image) => escapeImageAlt(image.alt) === '')
  if (empty !== -1) {
    cursor = from + before.length + 2
    for (let i = 0; i < empty; i++) cursor += parts[i].length + 1
  }
  return { changes: { from, to, insert: inserted }, selection: EditorSelection.cursor(cursor) }
}

// ---------------------------------------------------------------------------
// Task lists

const TASK_LINE = /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]/

/** Flips the task marker whose `[` is at `markerFrom` with a one-character edit. */
export function toggleTaskSpec(state: EditorState, markerFrom: number): TransactionSpec | null {
  const text = state.sliceDoc(markerFrom, markerFrom + 3)
  if (!/^\[[ xX]\]$/.test(text)) return null
  const checked = text[1] !== ' '
  return { changes: { from: markerFrom + 1, to: markerFrom + 2, insert: checked ? ' ' : 'x' } }
}

/** Toggles the task on the cursor's line(s); does nothing on other lines. */
export function toggleTaskAtCursorSpec(state: EditorState): TransactionSpec | null {
  const changes: ChangeSpec[] = []
  for (const line of selectedLines(state)) {
    const match = TASK_LINE.exec(line.text)
    if (!match) continue
    const spec = toggleTaskSpec(state, line.from + match[1].length)
    if (spec?.changes) changes.push(spec.changes as ChangeSpec)
  }
  return changes.length > 0 ? { changes } : null
}
export const toggleTaskAtCursor: StateCommand = run(toggleTaskAtCursorSpec)

// ---------------------------------------------------------------------------
// Shortcodes

/**
 * Inserts a shortcode skeleton: inline at the cursor for single tags, as a
 * block (opening tag, empty line, closing tag) for paired shortcodes.
 */
export function insertShortcodeSpec(state: EditorState, def: ShortcodeDef): TransactionSpec {
  const skeleton = shortcodeSkeleton(def)
  if (skeleton.lines.length > 1) return insertBlockSpec(state, skeleton.lines, skeleton.cursorLine, skeleton.cursorColumn)
  const { from, to } = state.selection.main
  const text = skeleton.lines[0]
  return { changes: { from, to, insert: text }, selection: EditorSelection.cursor(from + skeleton.cursorColumn) }
}

export function insertShortcode(def: ShortcodeDef): StateCommand {
  return run((state) => insertShortcodeSpec(state, def))
}
