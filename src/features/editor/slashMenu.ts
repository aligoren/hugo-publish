// The `/` command menu: typing `/` at the start of a line (or after a space)
// lists blocks and inserts (filtered as you type, Turkish-insensitive). The
// chosen command replaces the typed `/query`. It is a completion source for
// @codemirror/autocomplete, which provides the list UI and keyboard navigation.

import { pickedCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSection } from '@codemirror/autocomplete'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  insertAlertSpec,
  insertCodeBlockSpec,
  insertFootnoteSpec,
  insertHorizontalRuleSpec,
  insertLinkSpec,
  insertRtlBlockSpec,
  insertShortcodeSpec,
  insertTableSpec,
  setHeadingSpec,
  toggleBlockquoteSpec,
} from './commands'
import { ALERT_TYPES, alertLabels } from './config'
import type { ShortcodeDef } from './contract'
import { editorHost } from './host'
import { requestImage } from './images'
import { shortcodeDefinitions } from './shortcodeDefs'
import { openShortcodeFormEffect } from './shortcodeForm'
import { insideShortcode, shortcodeField } from './shortcodes'
import type { SyntaxNode } from './syntax'
import { matchScore } from './text'

export interface SlashCommand {
  id: string
  label: string
  /** Extra search words (English names, Markdown syntax). */
  keywords: string[]
  /** A built-in section, or the heading of a host-defined one. */
  section: 'blocks' | 'alerts' | 'insert' | 'shortcodes' | (string & {})
  /** Icon type (`cm-completionIcon-<type>`). */
  type: string
  detail?: string
  /** Changes the state once the `/query` text is removed; null = nothing to do. */
  spec?: (state: EditorState) => TransactionSpec | null
  /** Runs after the `/query` text is removed (for asynchronous commands). */
  run?: (view: EditorView) => void
}

/** The commands available in a state (alerts use the alert label facet, shortcodes the definitions). */
export function slashCommands(state: EditorState): SlashCommand[] {
  const phrase = (text: string) => state.phrase(text)
  const labels = state.facet(alertLabels)
  const commands: SlashCommand[] = [
    { id: 'paragraph', label: phrase('Paragraph'), keywords: ['paragraph', 'text', 'p'], section: 'blocks', type: 'paragraph', spec: (s) => setHeadingSpec(s, 0) ?? {} },
    ...[1, 2, 3].map(
      (level): SlashCommand => ({
        id: `heading${level}`,
        label: phrase(`Heading ${level}`),
        keywords: [`heading ${level}`, `h${level}`, '#'.repeat(level)],
        section: 'blocks',
        type: `heading${level}`,
        spec: (s) => setHeadingSpec(s, level) ?? {},
      }),
    ),
    { id: 'quote', label: phrase('Quote'), keywords: ['quote', 'blockquote', '>'], section: 'blocks', type: 'quote', spec: (s) => toggleBlockquoteSpec(s) },
    { id: 'codeBlock', label: phrase('Code block'), keywords: ['code', 'fence', '```'], section: 'blocks', type: 'code', spec: (s) => insertCodeBlockSpec(s) },
    { id: 'table', label: phrase('Table'), keywords: ['table', '|'], section: 'blocks', type: 'table', spec: (s) => insertTableSpec(s) },
    { id: 'divider', label: phrase('Divider'), keywords: ['divider', 'horizontal rule', 'hr', '---'], section: 'blocks', type: 'divider', spec: insertHorizontalRuleSpec },
    { id: 'rtl', label: phrase('Right-to-left block'), keywords: ['rtl', 'arabic', 'arapça', 'right to left'], section: 'blocks', type: 'rtl', spec: insertRtlBlockSpec },
    ...ALERT_TYPES.map(
      (type): SlashCommand => ({
        id: `alert-${type}`,
        label: labels[type],
        keywords: [type, 'alert', 'callout', `[!${type.toUpperCase()}]`],
        section: 'alerts',
        type: `alert-${type}`,
        spec: (s) => insertAlertSpec(s, type),
      }),
    ),
    { id: 'link', label: phrase('Link'), keywords: ['link', 'url', '[]()'], section: 'insert', type: 'link', spec: (s) => insertLinkSpec(s) },
    { id: 'footnote', label: phrase('Footnote'), keywords: ['footnote', '[^1]'], section: 'insert', type: 'footnote', spec: insertFootnoteSpec },
  ]
  // The host's image picker, or the `![]()` syntax without one.
  commands.splice(commands.length - 2, 0, {
    id: 'image',
    label: phrase('Image'),
    keywords: ['image', 'picture', 'img', 'resim', '![]()'],
    section: 'insert',
    type: 'image',
    run: (view) => void requestImage(view),
  })
  // Host-defined entries (snippets), read when the menu opens.
  for (const item of state.facet(editorHost).extraSlashItems ?? []) {
    commands.push({
      id: `extra-${item.id}`,
      label: item.label,
      keywords: [...(item.keywords ?? [])],
      section: item.section || phrase('Snippets'),
      type: 'snippet',
      run: (view) => item.run(view),
    })
  }
  const defs = [...state.facet(shortcodeDefinitions).values()].sort((a, b) => a.name.localeCompare(b.name))
  for (const def of defs) commands.push(shortcodeCommand(def))
  return commands
}

function shortcodeCommand(def: ShortcodeDef): SlashCommand {
  return {
    id: `shortcode-${def.name}`,
    label: def.name,
    keywords: ['shortcode', ...(def.description ? [def.description] : [])],
    section: 'shortcodes',
    type: 'shortcode',
    detail: def.description,
    spec: (state) => {
      const spec = insertShortcodeSpec(state, def)
      if (def.params.length === 0) return spec
      // Open the parameter form on the new tag (at the start of the inserted text).
      const changes = state.changes(spec.changes ?? [])
      let pos = state.selection.main.from
      changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
        const text = inserted.toString()
        const at = text.indexOf('{{')
        if (at !== -1) pos = fromB + at
      })
      return { ...spec, changes, effects: openShortcodeFormEffect.of({ pos, focus: true }) }
    },
  }
}

/**
 * One transaction that removes `[from, to)` and then applies `spec` (computed
 * on the state without that text), so undo takes both back in one step.
 */
export function afterRemoving(state: EditorState, from: number, to: number, spec: (state: EditorState) => TransactionSpec | null): TransactionSpec {
  const removal = state.changes({ from, to })
  const middle = state.update({ changes: removal }).state
  const next = spec(middle) ?? {}
  const second = middle.changes(next.changes ?? [])
  return {
    changes: removal.compose(second),
    selection: next.selection ?? middle.selection.map(second),
    effects: next.effects,
    scrollIntoView: true,
  }
}

const SECTIONS: Record<string, { phrase: string; rank: number }> = {
  blocks: { phrase: 'Blocks', rank: 0 },
  alerts: { phrase: 'Alerts', rank: 1 },
  insert: { phrase: 'Insert', rank: 2 },
  shortcodes: { phrase: 'Shortcodes', rank: 3 },
}

const SKIP = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock', 'Comment', 'URL', 'LinkLabel'])

/** True when `pos` is in code, HTML, a comment or a link destination. */
export function inLiteralText(state: EditorState, pos: number): boolean {
  const tree = ensureSyntaxTree(state, pos, 50) ?? syntaxTree(state)
  for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node; node = node.parent) {
    if (SKIP.has(node.name)) return true
  }
  return insideShortcode(state.field(shortcodeField, false) ?? [], pos, pos)
}

const SLASH = /(?:^|\s)\/([\p{L}\p{N}_-]{0,30})$/u

/** Completion source for the `/` menu. */
export function slashCompletionSource(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context
  const line = state.doc.lineAt(pos)
  const match = SLASH.exec(state.sliceDoc(line.from, pos))
  if (!match) return null
  const query = match[1]
  const from = pos - query.length - 1
  if (inLiteralText(state, from)) return null
  const sections = new Map<string, CompletionSection>()
  const section = (key: SlashCommand['section']) => {
    let value = sections.get(key)
    // Host-defined sections (already translated) come between Insert and Shortcodes.
    const known = SECTIONS[key]
    if (!value) sections.set(key, (value = known ? { name: state.phrase(known.phrase), rank: known.rank } : { name: key, rank: 2.5 }))
    return value
  }
  const scored = slashCommands(state)
    .map((command, index) => ({ command, index, score: matchScore(query, command.label, ...command.keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
  if (scored.length === 0) return null
  const options: Completion[] = scored.map(({ command }) => ({
    label: command.label,
    detail: command.detail,
    type: command.type,
    section: query ? undefined : section(command.section),
    apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
      if (command.run) {
        view.dispatch({ changes: { from: applyFrom, to: applyTo }, annotations: pickedCompletion.of(_completion), userEvent: 'delete' })
        command.run(view)
        return
      }
      // At the start of a line, a space after `/query` goes too (`/h1 Title` → `# Title`).
      const line = view.state.doc.lineAt(applyFrom)
      const atStart = view.state.sliceDoc(line.from, applyFrom).trim() === ''
      const end = atStart && view.state.sliceDoc(applyTo, applyTo + 1) === ' ' ? applyTo + 1 : applyTo
      const spec = afterRemoving(view.state, applyFrom, end, (s) => command.spec?.(s) ?? null)
      view.dispatch({ ...spec, annotations: pickedCompletion.of(_completion), userEvent: 'input.complete' })
    },
  }))
  return { from, to: pos, options, filter: false }
}
