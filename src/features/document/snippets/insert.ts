// Putting a rendered snippet into the editor at the cursor.

import type { EditorState, TransactionSpec } from '@codemirror/state'

/**
 * The transaction that inserts `text` (LF line breaks) at the selection, written with the
 * document's own line break. A multi-line snippet is a block: it gets a blank line before and
 * after it when the cursor is inside a paragraph, so it does not merge with the text around it.
 */
export function snippetInsertion(state: EditorState, text: string): TransactionSpec {
  const { from, to } = state.selection.main
  let body = text.replace(/\r\n?/g, '\n')
  if (body.includes('\n')) {
    body = body.replace(/^\n+|\n+$/g, '')
    const startLine = state.doc.lineAt(from)
    const endLine = state.doc.lineAt(to)
    const textBefore = state.sliceDoc(startLine.from, from).trim() !== ''
    const textAfter = state.sliceDoc(to, endLine.to).trim() !== ''
    const previousLine = startLine.number > 1 ? state.doc.line(startLine.number - 1).text.trim() : ''
    const nextLine = endLine.number < state.doc.lines ? state.doc.line(endLine.number + 1).text.trim() : ''
    const before = textBefore ? '\n\n' : previousLine !== '' ? '\n' : ''
    const after = textAfter ? '\n\n' : nextLine !== '' ? '\n' : ''
    body = before + body + after
  }
  const insert = body.split('\n').join(state.lineBreak)
  // The cursor goes to the end of the snippet itself, not past the separating blank line.
  const trailing = body.length - body.replace(/\n+$/, '').length
  const cursor = from + insert.length - trailing * state.lineBreak.length
  return { changes: { from, to, insert }, selection: { anchor: cursor }, scrollIntoView: true }
}
