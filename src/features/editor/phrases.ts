// User-visible strings of the CodeMirror extensions. Extensions call
// `state.phrase('English text')`; the host translates them through
// CodeMirror's `EditorState.phrases` facet (`editorPhrases(t)` builds it
// from the `editor.phrases.*` i18n strings). `$` / `$1` are placeholders.

import { EditorState, type Extension } from '@codemirror/state'

/** i18n key (under `editor.phrases`) → English phrase. Also CodeMirror's own search and autocomplete phrases. */
export const PHRASES = {
  // Slash menu
  paragraph: 'Paragraph',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  quote: 'Quote',
  rtlBlock: 'Right-to-left block',
  image: 'Image',
  link: 'Link',
  table: 'Table',
  divider: 'Divider',
  codeBlock: 'Code block',
  footnote: 'Footnote',
  sectionBlocks: 'Blocks',
  sectionAlerts: 'Alerts',
  sectionInsert: 'Insert',
  sectionShortcodes: 'Shortcodes',
  sectionSnippets: 'Snippets',
  column: 'Column $',
  pages: 'Pages',
  // Shortcodes
  editShortcode: 'Edit parameters (Alt+Enter)',
  shortcodeParameters: 'Parameters of $',
  apply: 'Apply',
  cancel: 'Cancel',
  required: 'Required',
  requiredError: '$ is required',
  mixedError: 'Positional and named parameters cannot be mixed. Clear one of them.',
  position: 'Position $',
  notSet: 'Not set',
  innerMarkdown: 'The content between the tags is Markdown.',
  lockedShortcode: 'Unknown shortcode: locked so it is not changed by accident',
  unlockShortcode: 'Unlock shortcode for editing',
  relockShortcode: 'Lock shortcode again',
  // Live preview
  toggleTask: 'Toggle task',
  imagePreview: 'Preview of $',
  // Tables
  tableTools: 'Table tools',
  addRowAbove: 'Add row above',
  addRowBelow: 'Add row below',
  deleteRow: 'Delete row',
  addColumnLeft: 'Add column left',
  addColumnRight: 'Add column right',
  deleteColumn: 'Delete column',
  alignColumns: 'Align columns',
  // Pasting
  importingImage: 'Importing image…',
  wordImagesNotice:
    'Images from Word could not be pasted with the text: Word keeps them in temporary files the editor cannot read. Their descriptions were kept. Copy each image on its own and paste it separately.',
  dismiss: 'Dismiss',
  // Spelling
  spellingSuggestions: 'Spelling suggestions for $',
  addToDictionary: 'Add to dictionary',
  noSuggestions: 'No suggestions',
  // CodeMirror built-ins
  find: 'Find',
  replace: 'Replace',
  next: 'next',
  previous: 'previous',
  all: 'all',
  matchCase: 'match case',
  regexp: 'regexp',
  byWord: 'by word',
  replaceOne: 'replace',
  replaceAll: 'replace all',
  close: 'close',
  currentMatch: 'current match',
  onLine: 'on line',
  goToLine: 'Go to line',
  go: 'go',
  replacedMatchOnLine: 'replaced match on line $',
  replacedMatches: 'replaced $ matches',
  completions: 'Completions',
  controlCharacter: 'Control character',
  selectionDeleted: 'Selection deleted',
} as const

export type PhraseKey = keyof typeof PHRASES

/** A translate function like i18next's `t` (the default value is used when a key is missing). */
export type Translate = (key: string, options: { defaultValue: string }) => string

/** CodeMirror phrases for the current language, from the `editor.phrases.*` strings. */
export function editorPhrases(t: Translate): Record<string, string> {
  const phrases: Record<string, string> = {}
  for (const [key, english] of Object.entries(PHRASES)) {
    const translated = t(`editor.phrases.${key}`, { defaultValue: english })
    if (translated && translated !== english) phrases[english] = translated
  }
  return phrases
}

export function phrasesExtension(t: Translate): Extension {
  return EditorState.phrases.of(editorPhrases(t))
}
