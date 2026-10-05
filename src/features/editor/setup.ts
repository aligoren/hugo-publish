// Assembles the Markdown editor's extensions.

import { autocompletion } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec, type Extension, type TransactionSpec } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, highlightSpecialChars, keymap, type KeyBinding } from '@codemirror/view'
import { detectEol, dominantEol, eolToSeparator } from '../../lib/eol'
import { alerts } from './alerts'
import { cycleHeading, insertLink, setHeading, toggleBlockquote, toggleBold, toggleItalic, toggleTaskAtCursor } from './commands'
import { alertLabels, contentDir, knownShortcodes, linkStyle, livePreviewEnabled, type AlertLabels, type LinkStyle } from './config'
import type { ShortcodeDef } from './contract'
import { focusMode } from './focusMode'
import { editorHost, type EditorHost } from './host'
import { images } from './images'
import { linkCompletionSource } from './linkCompletion'
import { livePreview } from './livePreview'
import { pasteHtmlAsMarkdown } from './pasteHtml'
import { autoLineDirection, rtlBlocks } from './rtl'
import { shortcodeDefinitions } from './shortcodeDefs'
import { shortcodeForm } from './shortcodeForm'
import { shortcodes } from './shortcodes'
import { slashCompletionSource } from './slashMenu'
import { spellcheck, type SpellcheckConfig } from './spell/extension'
import { statsReporter } from './stats'
import { tables } from './tables'
import { hugoMarkdown } from './syntax'
import { editorTheme } from './theme'

export type EditorEol = 'lf' | 'crlf'
export type TextDirection = 'ltr' | 'rtl' | 'auto'
export type ColorScheme = 'light' | 'dark'

/**
 * Line ending handling. The document is split only on the file's own
 * separator and joined with it again, so `state.sliceDoc()` returns the
 * original text byte for byte (a stray line ending of the other kind stays
 * inside its line and is shown as a special character). Pasted and dropped
 * text is converted to the separator.
 */
export function eolExtension(eol: EditorEol): Extension {
  const separator = eolToSeparator(eol)
  return [
    EditorState.lineSeparator.of(separator),
    EditorView.clipboardInputFilter.of((text) => text.replace(/\r\n?|\n/g, separator)),
  ]
}

export interface EditorEolInfo {
  /** The separator to give the editor: the text's most common line ending. */
  eol: EditorEol
  /** The text mixes line endings; the UI may want to warn. Bytes are still preserved. */
  mixed: boolean
}

/** Picks the editor line separator for a body text. */
export function editorEolInfo(text: string, fallback: EditorEol = 'lf'): EditorEolInfo {
  return { eol: dominantEol(text, fallback), mixed: detectEol(text) === 'mixed' }
}

/**
 * The document exactly as it should be saved. Use this, not
 * `state.doc.toString()`, which always joins lines with `\n`.
 */
export function getDocText(state: EditorState): string {
  return state.sliceDoc()
}

export const markdownKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-k', run: insertLink() },
  { key: 'Mod-Shift-.', run: toggleBlockquote },
  { key: 'Mod-0', run: setHeading(0) },
  { key: 'Mod-1', run: setHeading(1) },
  { key: 'Mod-2', run: setHeading(2) },
  { key: 'Mod-3', run: setHeading(3) },
  { key: 'Mod-4', run: setHeading(4) },
  { key: 'Mod-5', run: setHeading(5) },
  { key: 'Mod-6', run: setHeading(6) },
  { key: 'Mod-h', run: cycleHeading },
  // On a task line, toggles `[ ]` / `[x]`; elsewhere falls through to the default (insert blank line).
  { key: 'Mod-Enter', run: toggleTaskAtCursor },
]

export interface MarkdownEditorOptions {
  /** Line separator of the text (see {@link editorEolInfo}). Default `lf`. */
  eol?: EditorEol
  alertLabels?: Partial<AlertLabels>
  /** Shortcodes the site defines, in addition to Hugo's built-ins. */
  knownShortcodes?: readonly string[]
  /** Live preview (default) or raw source mode. */
  livePreview?: boolean
  /** Base text direction. `auto` lays out each line by its first strong character. Default `ltr`. */
  dir?: TextDirection
  readOnly?: boolean
  colorScheme?: ColorScheme
  /** Site and theme shortcode definitions (merged with Hugo's built-ins; their names count as known). */
  shortcodes?: readonly ShortcodeDef[]
  /** Dim all but the current paragraph and keep the cursor line centred. */
  focusMode?: boolean
  /** What `[[` completion inserts. Default `relref`. */
  linkStyle?: LinkStyle
  /** The site's content folder, for `relref` paths. Default `content`. */
  contentDir?: string
  /** Callbacks and data from the host (read lazily, see host.ts). */
  host?: EditorHost
  /** Translations of the editor's phrases (`editorPhrases(t)`). */
  phrases?: Readonly<Record<string, string>>
  /**
   * Spellchecking: a worker-backed client (Turkish), or `{ native: 'en' }`
   * for the browser's own spellchecker. Default off.
   */
  spellcheck?: SpellcheckConfig | { native: string } | null
}

/** Compartments for the options that can change while the editor is open. */
export interface EditorCompartments {
  eol: Compartment
  alertLabels: Compartment
  knownShortcodes: Compartment
  livePreview: Compartment
  dir: Compartment
  readOnly: Compartment
  theme: Compartment
  shortcodes: Compartment
  focusMode: Compartment
  links: Compartment
  host: Compartment
  phrases: Compartment
  spellcheck: Compartment
}

export function createCompartments(): EditorCompartments {
  return {
    eol: new Compartment(),
    alertLabels: new Compartment(),
    knownShortcodes: new Compartment(),
    livePreview: new Compartment(),
    dir: new Compartment(),
    readOnly: new Compartment(),
    theme: new Compartment(),
    shortcodes: new Compartment(),
    focusMode: new Compartment(),
    links: new Compartment(),
    host: new Compartment(),
    phrases: new Compartment(),
    spellcheck: new Compartment(),
  }
}

export function linksExtension(style: LinkStyle = 'relref', dir = 'content'): Extension {
  return [linkStyle.of(style), contentDir.of(dir)]
}

/** The spellcheck compartment's content. The worker-backed checker turns the browser's own off. */
export function spellcheckExtension(option: MarkdownEditorOptions['spellcheck']): Extension {
  if (!option) return []
  if ('native' in option) return EditorView.contentAttributes.of({ spellcheck: 'true', lang: option.native })
  return [spellcheck(option), EditorView.contentAttributes.of({ spellcheck: 'false' })]
}

export function directionExtension(dir: TextDirection): Extension {
  if (dir === 'rtl') return EditorView.contentAttributes.of({ dir: 'rtl' })
  if (dir === 'auto') return autoLineDirection
  return []
}

export function readOnlyExtension(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

/** The extension for each compartment, from the options. */
export function optionExtensions(options: MarkdownEditorOptions): Record<keyof EditorCompartments, Extension> {
  return {
    eol: eolExtension(options.eol ?? 'lf'),
    alertLabels: alertLabels.of(options.alertLabels ?? {}),
    knownShortcodes: knownShortcodes.of(options.knownShortcodes ?? []),
    livePreview: livePreviewEnabled.of(options.livePreview ?? true),
    dir: directionExtension(options.dir ?? 'ltr'),
    readOnly: readOnlyExtension(options.readOnly ?? false),
    theme: editorTheme(options.colorScheme ?? 'light'),
    shortcodes: shortcodeDefinitions.of(options.shortcodes ?? []),
    focusMode: focusMode(options.focusMode ?? false),
    links: linksExtension(options.linkStyle, options.contentDir),
    host: options.host ? editorHost.of(options.host) : [],
    phrases: options.phrases ? EditorState.phrases.of(options.phrases) : [],
    spellcheck: spellcheckExtension(options.spellcheck),
  }
}

/** Language, Hugo-aware decorations and keymaps; independent of the options. */
export function baseExtensions(): Extension {
  return [
    hugoMarkdown(),
    history(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    EditorView.lineWrapping,
    search({ top: true }),
    Prec.high(keymap.of(markdownKeymap)),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    alerts(),
    rtlBlocks(),
    shortcodes(),
    shortcodeForm(),
    livePreview(),
    tables(),
    images(),
    pasteHtmlAsMarkdown(),
    autocompletion({
      override: [slashCompletionSource, linkCompletionSource],
      icons: true,
      closeOnBlur: true,
      maxRenderedOptions: 80,
      tooltipClass: () => 'cm-hp-completion',
    }),
    statsReporter(),
  ]
}

/**
 * All extensions of the Markdown editor. Pass compartments to be able to
 * reconfigure the options later (`compartments.x.reconfigure(...)`).
 */
export function markdownEditorExtensions(options: MarkdownEditorOptions = {}, compartments?: EditorCompartments): Extension {
  const parts = optionExtensions(options)
  const configured = (Object.keys(parts) as (keyof EditorCompartments)[]).map((key) =>
    compartments ? compartments[key].of(parts[key]) : parts[key],
  )
  return [baseExtensions(), configured]
}

/** An editor state for a Markdown body (also usable without a view, e.g. in tests). */
export function createEditorState(
  doc: string,
  options: MarkdownEditorOptions = {},
  compartments?: EditorCompartments,
  extensions: Extension = [],
): EditorState {
  return EditorState.create({ doc, extensions: [markdownEditorExtensions(options, compartments), extensions] })
}

/**
 * A transaction that turns the document into `value` by replacing only the
 * part that differs (so the cursor, scroll position and decorations of the
 * unchanged text stay put). Null when the document already equals `value`.
 */
export function replaceDocSpec(state: EditorState, value: string): TransactionSpec | null {
  const current = state.sliceDoc()
  if (current === value) return null
  const separator = state.lineBreak
  const max = Math.min(current.length, value.length)
  let start = 0
  while (start < max && current.charCodeAt(start) === value.charCodeAt(start)) start++
  let end = 0
  while (end < max - start && current.charCodeAt(current.length - 1 - end) === value.charCodeAt(value.length - 1 - end)) end++
  if (separator.length > 1) {
    // Never cut through a `\r\n` pair, in either text.
    const splits = (text: string, at: number) => text.charCodeAt(at - 1) === 13 && text.charCodeAt(at) === 10
    while (start > 0 && (splits(current, start) || splits(value, start))) start--
    while (end > 0 && (splits(current, current.length - end) || splits(value, value.length - end))) end--
  }
  const toPos = (raw: number) => {
    if (separator.length === 1) return raw
    let count = 0
    for (let i = current.indexOf(separator); i !== -1 && i + separator.length <= raw; i = current.indexOf(separator, i + separator.length)) count++
    return raw - count * (separator.length - 1)
  }
  return {
    changes: { from: toPos(start), to: toPos(current.length - end), insert: value.slice(start, value.length - end) },
  }
}
