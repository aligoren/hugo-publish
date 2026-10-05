// Public API of the Markdown editor feature.

export { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorProps } from './MarkdownEditor'
export { EditorToolbar, type EditorToolbarProps } from './EditorToolbar'
export { EditorStatusBar, type EditorStatusBarProps } from './EditorStatusBar'

export {
  ALERT_TYPES,
  DEFAULT_ALERT_LABELS,
  DEFAULT_KNOWN_SHORTCODES,
  DEFAULT_TOOLBAR_LABELS,
  TURKISH_ALERT_LABELS,
  alertLabels,
  contentDir,
  isAlertType,
  knownShortcodes,
  linkStyle,
  livePreviewEnabled,
  type AlertLabels,
  type AlertType,
  type LinkStyle,
  type ToolbarLabels,
} from './config'

export {
  cycleHeading,
  headingLevel,
  imageMarkdown,
  insertAlert,
  insertCodeBlock,
  insertFootnote,
  insertHorizontalRule,
  insertImageSyntax,
  insertImagesSpec,
  insertLink,
  insertRtlBlock,
  insertShortcode,
  insertTable,
  RTL_OPEN_TAG,
  setAlertType,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleItalic,
  toggleTaskAtCursor,
  type LinkOptions,
} from './commands'

export {
  createEditorState,
  editorEolInfo,
  getDocText,
  markdownEditorExtensions,
  markdownKeymap,
  replaceDocSpec,
  type ColorScheme,
  type EditorEol,
  type EditorEolInfo,
  type MarkdownEditorOptions,
  type TextDirection,
} from './setup'

export { alertField, findAlerts, findAlertsInText, type AlertBlock } from './alerts'
export { findRtlBlocks, findRtlBlocksInText, rtlField, type RtlBlock } from './rtl'
export {
  clearShortcodeUnlocks,
  lockShortcodeAtCursor,
  scanShortcodes,
  sessionShortcodeUnlocks,
  shortcodeField,
  shortcodeIdentity,
  unlockShortcodeAtCursor,
  type ShortcodeToken,
} from './shortcodes'
export { BUILTIN_SHORTCODES, isKnownShortcode, shortcodeDefinitions } from './shortcodeDefs'
export { parseShortcodeTag, shortcodeArgEdits, type ParsedShortcodeTag, type ShortcodeArg } from './shortcodeArgs'
export { editShortcodeAtCursor } from './shortcodeForm'
export { editorHost, type EditorHost } from './host'
export { requestImage } from './images'
export { convertPastedHtml, htmlToMarkdown, type PastedHtml } from './pasteHtml'
export { dataUrlToFile, imageNameFromText, pastedImageNames, type PastedImage } from './pasteImages'
export {
  addTableColumnLeft,
  addTableColumnRight,
  addTableRowAbove,
  addTableRowBelow,
  deleteTableColumn,
  deleteTableRow,
  formatTable,
  nextTableCell,
  previousTableCell,
  tableAt,
  type TableInfo,
} from './tables'
export { computeStats, countWords } from './stats'
export { PHRASES, editorPhrases } from './phrases'
export { SpellClient } from './spell/client'

export type {
  EditorIntegrationProps,
  EditorStats,
  InsertedImage,
  LinkTarget,
  ShortcodeDef,
  ShortcodeParam,
  SlashItem,
  SpellcheckOptions,
} from './contract'
export {
  discoverShortcodes,
  parseShortcodeTemplate,
  type DiscoverIo,
  type DiscoverOptions,
} from './discoverShortcodes'
