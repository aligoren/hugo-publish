// Markdown language setup and small helpers shared by the editor extensions.

import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree, type LanguageSupport } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { GFM } from '@lezer/markdown'

export type SyntaxTree = ReturnType<typeof syntaxTree>
export type SyntaxNode = ReturnType<SyntaxTree['resolveInner']>

/** CommonMark + GFM (tables, task lists, strikethrough, autolinks), like Hugo's Goldmark defaults. */
export function hugoMarkdown(): LanguageSupport {
  return markdown({ extensions: [GFM], completeHTMLTags: false })
}

/**
 * The syntax tree of the whole document, parsing synchronously if needed.
 * Meant for tests and one-off analysis; extensions use `syntaxTree(state)`
 * and react to tree updates instead.
 */
export function fullSyntaxTree(state: EditorState, timeout = 5000): SyntaxTree {
  return ensureSyntaxTree(state, state.doc.length, timeout) ?? syntaxTree(state)
}

/** An editor state with the Markdown language, for analysing a text without a view. */
export function createMarkdownState(text: string, extensions: Extension = []): EditorState {
  return EditorState.create({ doc: text, extensions: [hugoMarkdown(), extensions] })
}

/** Line numbers (1-based) touched by any selection range. */
export function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

/** Node names whose children can be blocks (used to skip inline content quickly). */
export const BLOCK_CONTAINERS: ReadonlySet<string> = new Set([
  'Document',
  'Blockquote',
  'BulletList',
  'OrderedList',
  'ListItem',
])
