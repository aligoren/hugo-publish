// Focus mode: every line but the current paragraph is dimmed, and the
// cursor line is kept near the vertical centre while typing (typewriter
// scrolling). View-only; the document is never touched.

import { EditorState, type Extension, type Range, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/** First and last line (1-based) of the paragraph around `pos`: the non-blank lines around it. */
export function paragraphLines(state: EditorState, pos: number): { first: number; last: number } {
  const doc = state.doc
  const line = doc.lineAt(pos)
  if (line.text.trim() === '') return { first: line.number, last: line.number }
  let first = line.number
  let last = line.number
  while (first > 1 && doc.line(first - 1).text.trim() !== '') first--
  while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last++
  return { first, last }
}

const dimmed = Decoration.line({ class: 'cm-focus-dim' })

/** Dim decorations for the lines of `ranges` outside the current paragraph (exported for tests). */
export function buildFocusDecorations(state: EditorState, ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }]): DecorationSet {
  const { first, last } = paragraphLines(state, state.selection.main.head)
  const out: Range<Decoration>[] = []
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      if (line.number < first || line.number > last) out.push(dimmed.range(line.from))
      pos = line.to + 1
    }
  }
  return Decoration.set(out, true)
}

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildFocusDecorations(view.state, view.visibleRanges)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildFocusDecorations(update.state, update.view.visibleRanges)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** Keyboard edits and keyboard cursor moves scroll the cursor line to the middle. */
export function typewriterScroll(tr: Transaction) {
  if (!tr.docChanged && !tr.selection) return null
  if (!tr.isUserEvent('input') && !tr.isUserEvent('delete') && !tr.isUserEvent('select') && !tr.isUserEvent('undo') && !tr.isUserEvent('redo')) return null
  if (tr.isUserEvent('select.pointer')) return null // clicking should not move the text away from the mouse
  return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) }
}

/** Focus mode (dimming + typewriter scrolling) when `enabled`. */
export function focusMode(enabled: boolean): Extension {
  if (!enabled) return []
  return [focusPlugin, EditorState.transactionExtender.of(typewriterScroll), EditorView.editorAttributes.of({ class: 'cm-focus-mode' })]
}
