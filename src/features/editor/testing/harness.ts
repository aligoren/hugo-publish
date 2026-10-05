// Test-only helpers: build editor states from strings with cursor markers and
// read the result back the same way.

import { EditorSelection, type EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { createEditorState, type EditorEol, type MarkdownEditorOptions } from '../setup'
import { fullSyntaxTree } from '../syntax'

/**
 * `«` and `»` mark the selection's anchor and head (`«»` is a cursor);
 * otherwise the first `|` marks the cursor.
 */
export function parseMarked(text: string): { doc: string; anchor: number; head: number } {
  const open = text.indexOf('«')
  const close = text.indexOf('»')
  if (open === -1 || close === -1) {
    const cursor = text.indexOf('|')
    if (cursor === -1) return { doc: text, anchor: 0, head: 0 }
    return { doc: text.slice(0, cursor) + text.slice(cursor + 1), anchor: cursor, head: cursor }
  }
  const doc = text.replace('«', '').replace('»', '')
  return open < close ? { doc, anchor: open, head: close - 1 } : { doc, anchor: open - 1, head: close }
}

/**
 * An editor state for `marked` (written with `\n`), converted to `eol`.
 * Positions are mapped so the markers land on the same characters.
 */
export function stateFor(marked: string, eol: EditorEol = 'lf', options: MarkdownEditorOptions = {}): EditorState {
  const { doc, anchor, head } = parseMarked(marked)
  // CodeMirror counts a line break as one position whatever the separator is,
  // so positions in the `\n` text are valid document positions.
  const text = eol === 'crlf' ? doc.replace(/\n/g, '\r\n') : doc
  const initial = createEditorState(text, { ...options, eol })
  // Parse everything, then apply a transaction so `syntaxTree(state)` sees the full tree.
  fullSyntaxTree(initial)
  return initial.update({ selection: EditorSelection.single(anchor, head) }).state
}

/** The document with markers re-inserted, using the document's own line breaks. */
export function marked(state: EditorState): string {
  const { anchor, head, empty } = state.selection.main
  const at = (pos: number) => state.sliceDoc(0, pos).length
  const text = state.sliceDoc()
  if (empty) return text.slice(0, at(head)) + '|' + text.slice(at(head))
  const a = at(anchor)
  const h = at(head)
  const [first, second] = a < h ? [a, h] : [h, a]
  const [m1, m2] = a < h ? ['«', '»'] : ['»', '«']
  return text.slice(0, first) + m1 + text.slice(first, second) + m2 + text.slice(second)
}

/** Runs a command and returns the marked result (or null when the command declined). */
export function runCommand(command: StateCommand, input: string, eol: EditorEol = 'lf'): string | null {
  let state = stateFor(input, eol)
  let ran = false
  command({
    state,
    dispatch: (tr: Transaction) => {
      state = tr.state
      ran = true
    },
  })
  return ran ? marked(state) : null
}

export const crlf = (text: string): string => text.replace(/\n/g, '\r\n')
