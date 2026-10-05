// A calm writing theme. All colours and fonts go through CSS custom
// properties: the host can set `--hp-editor-*` on any ancestor (for example
// on `:root` or a `.dark` wrapper) to restyle the editor without global CSS.
//
// Public variables (all optional): --hp-editor-bg, --hp-editor-fg,
// --hp-editor-muted, --hp-editor-faint, --hp-editor-link, --hp-editor-accent,
// --hp-editor-selection, --hp-editor-code-bg, --hp-editor-border,
// --hp-editor-font, --hp-editor-mono-font, --hp-editor-arabic-font,
// --hp-editor-font-size, --hp-editor-max-width.

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

export const WRITING_FONT = '"Charter", "Bitstream Charter", "Sitka Text", "Iowan Old Style", Cambria, Georgia, serif'
export const MONO_FONT = 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
export const ARABIC_FONT = '"Amiri", "Noto Naskh Arabic", "Scheherazade New", "Traditional Arabic", serif'
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif'

interface Palette {
  bg: string
  fg: string
  muted: string
  faint: string
  link: string
  accent: string
  selection: string
  codeBg: string
  border: string
  alerts: Record<'note' | 'tip' | 'important' | 'warning' | 'caution', string>
  alertAlpha: number
  shortcode: { known: string; unknown: string }
}

const light: Palette = {
  bg: '#fffefb',
  fg: '#1f2328',
  muted: '#59636e',
  faint: '#8c959f',
  link: '#0b62c4',
  accent: '#0969da',
  selection: '#cfe3ff',
  codeBg: '#f4f2ee',
  border: '#d8dde3',
  alerts: { note: '#0969da', tip: '#1a7f37', important: '#8250df', warning: '#9a6700', caution: '#cf222e' },
  alertAlpha: 0.07,
  shortcode: { known: '#0969da', unknown: '#bc4c00' },
}

const dark: Palette = {
  bg: '#1b1d21',
  fg: '#e6e6e3',
  muted: '#a2a9b1',
  faint: '#6f7781',
  link: '#6cb6ff',
  accent: '#4493f8',
  selection: '#2d4a6e',
  codeBg: '#26292e',
  border: '#3a3f46',
  alerts: { note: '#4493f8', tip: '#3fb950', important: '#ab7df8', warning: '#d29922', caution: '#f85149' },
  alertAlpha: 0.13,
  shortcode: { known: '#6cb6ff', unknown: '#f0883e' },
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Glyphs for the slash menu / link completion icon types. */
const COMPLETION_ICONS: Record<string, string> = {
  paragraph: '¶',
  heading1: 'H1',
  heading2: 'H2',
  heading3: 'H3',
  quote: '“',
  code: '{}',
  table: '▦',
  divider: '―',
  rtl: 'ع',
  image: '▣',
  link: '🔗',
  footnote: '¹',
  shortcode: '{{',
  snippet: '✎',
  page: '📄',
  'alert-note': 'ℹ',
  'alert-tip': '✓',
  'alert-important': '!',
  'alert-warning': '⚠',
  'alert-caution': '⛔',
}

const completionIcons: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(COMPLETION_ICONS).map(([type, glyph]) => [`.cm-completionIcon-${type}:after`, { content: JSON.stringify(glyph) }]),
)

function buildTheme(p: Palette, isDark: boolean): Extension {
  const alertRules: Record<string, Record<string, string>> = {}
  for (const [type, color] of Object.entries(p.alerts)) {
    alertRules[`.cm-alert-${type}, .cm-alert-label-${type}`] = {
      '--hp-ed-alert': color,
      '--hp-ed-alert-bg': rgba(color, p.alertAlpha),
    }
  }
  return EditorView.theme(
    {
      '&': {
        '--hp-ed-bg': `var(--hp-editor-bg, ${p.bg})`,
        '--hp-ed-fg': `var(--hp-editor-fg, ${p.fg})`,
        '--hp-ed-muted': `var(--hp-editor-muted, ${p.muted})`,
        '--hp-ed-faint': `var(--hp-editor-faint, ${p.faint})`,
        '--hp-ed-link': `var(--hp-editor-link, ${p.link})`,
        '--hp-ed-accent': `var(--hp-editor-accent, ${p.accent})`,
        '--hp-ed-selection': `var(--hp-editor-selection, ${p.selection})`,
        '--hp-ed-code-bg': `var(--hp-editor-code-bg, ${p.codeBg})`,
        '--hp-ed-border': `var(--hp-editor-border, ${p.border})`,
        '--hp-ed-sc-known': p.shortcode.known,
        '--hp-ed-sc-unknown': p.shortcode.unknown,
        height: '100%',
        backgroundColor: 'var(--hp-ed-bg)',
        color: 'var(--hp-ed-fg)',
        fontSize: 'var(--hp-editor-font-size, 1.0625rem)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: `var(--hp-editor-font, ${WRITING_FONT})`,
        lineHeight: '1.7',
      },
      '.cm-content': {
        maxWidth: 'var(--hp-editor-max-width, 72ch)',
        width: '100%',
        margin: '0 auto',
        padding: '2rem 0 30vh',
        caretColor: 'var(--hp-ed-accent)',
      },
      '.cm-line': { padding: '0 1rem' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--hp-ed-accent)', borderLeftWidth: '2px' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: 'var(--hp-ed-selection)' },
      '.cm-panels': { backgroundColor: 'var(--hp-ed-bg)', color: 'var(--hp-ed-fg)', fontFamily: UI_FONT },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--hp-ed-border)' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--hp-ed-border)' },
      '.cm-searchMatch': { backgroundColor: rgba(p.alerts.warning, 0.25) },
      '.cm-searchMatch-selected': { backgroundColor: rgba(p.alerts.warning, 0.5) },

      // Live preview
      '.cm-lp-heading': { fontWeight: '700', lineHeight: '1.35', color: 'var(--hp-ed-fg)' },
      '.cm-lp-h1': { fontSize: '1.8em', paddingTop: '0.5em' },
      '.cm-lp-h2': { fontSize: '1.45em', paddingTop: '0.45em' },
      '.cm-lp-h3': { fontSize: '1.25em', paddingTop: '0.35em' },
      '.cm-lp-h4': { fontSize: '1.1em', paddingTop: '0.3em' },
      '.cm-lp-h5': { fontSize: '1em' },
      '.cm-lp-h6': { fontSize: '0.95em', color: 'var(--hp-ed-muted)' },
      '.cm-lp-setext-mark': { color: 'var(--hp-ed-faint)' },
      '.cm-lp-strong': { fontWeight: '700' },
      '.cm-lp-em': { fontStyle: 'italic' },
      '.cm-lp-strike': { textDecoration: 'line-through' },
      '.cm-lp-link': {
        color: 'var(--hp-ed-link)',
        textDecoration: 'underline',
        textUnderlineOffset: '0.18em',
        textDecorationThickness: '1px',
      },
      '.cm-lp-image': { color: 'var(--hp-ed-muted)' },
      '.cm-lp-code': {
        fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`,
        fontSize: '0.88em',
        backgroundColor: 'var(--hp-ed-code-bg)',
        borderRadius: '4px',
        padding: '0.1em 0.2em',
      },
      '.cm-line.cm-lp-codeblock': {
        fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`,
        fontSize: '0.88em',
        lineHeight: '1.55',
        backgroundColor: 'var(--hp-ed-code-bg)',
      },
      '.cm-lp-codeblock-first': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px' },
      '.cm-lp-codeblock-last': { borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px' },
      '.cm-line.cm-lp-quote': {
        borderLeft: '3px solid var(--hp-ed-border)',
        paddingLeft: 'calc(1rem + 0.75em)',
        color: 'var(--hp-ed-muted)',
      },
      '.cm-lp-hr': {
        display: 'inline-block',
        width: '100%',
        verticalAlign: 'middle',
        borderTop: '1px solid var(--hp-ed-border)',
      },
      '.cm-line.cm-lp-html': {
        fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`,
        fontSize: '0.85em',
        color: 'var(--hp-ed-muted)',
      },
      '.cm-lp-comment, .cm-line.cm-lp-comment': { color: 'var(--hp-ed-faint)' },
      '.cm-line.cm-lp-table': { fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`, fontSize: '0.88em' },

      // Alerts
      ...alertRules,
      '.cm-line.cm-alert': {
        borderLeft: '4px solid var(--hp-ed-alert)',
        backgroundColor: 'var(--hp-ed-alert-bg)',
        paddingLeft: 'calc(1rem + 0.75em)',
        color: 'var(--hp-ed-fg)',
      },
      '.cm-line.cm-alert-first': { paddingTop: '0.4em', borderTopRightRadius: '6px' },
      '.cm-line.cm-alert-last': { paddingBottom: '0.4em', borderBottomRightRadius: '6px' },
      '.cm-alert-label': {
        fontFamily: UI_FONT,
        fontWeight: '700',
        fontSize: '0.9em',
        letterSpacing: '0.02em',
        color: 'var(--hp-ed-alert)',
      },
      '.cm-alert-marker': {
        fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`,
        fontSize: '0.88em',
        color: 'var(--hp-ed-alert)',
      },
      '.cm-alert-title': { fontWeight: '700', color: 'var(--hp-ed-alert)' },

      // Right-to-left blocks
      '.cm-line.cm-rtl-line': {
        fontFamily: `var(--hp-editor-arabic-font, ${ARABIC_FONT})`,
        fontSize: '1.3em',
        lineHeight: '2',
      },
      '.cm-line.cm-rtl-center': { textAlign: 'center' },
      '.cm-line.cm-rtl-tag': {
        fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`,
        fontSize: '0.8em',
        color: 'var(--hp-ed-faint)',
      },

      // Shortcodes
      '.cm-sc': {
        fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`,
        fontSize: '0.85em',
        borderRadius: '4px',
        padding: '0.05em 0.25em',
      },
      '.cm-sc-known': {
        color: 'var(--hp-ed-sc-known)',
        backgroundColor: rgba(p.shortcode.known, isDark ? 0.14 : 0.08),
        border: `1px solid ${rgba(p.shortcode.known, 0.35)}`,
      },
      '.cm-sc-unknown': {
        color: 'var(--hp-ed-sc-unknown)',
        backgroundColor: rgba(p.shortcode.unknown, isDark ? 0.14 : 0.08),
        border: `1px dashed ${rgba(p.shortcode.unknown, 0.6)}`,
      },
      '.cm-sc-name': { fontWeight: '700' },
      '.cm-sc-escaped': {
        fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`,
        fontSize: '0.85em',
        color: 'var(--hp-ed-muted)',
      },
      '.cm-sc-known[title]': { cursor: 'pointer' },
      '.cm-sc-locked': { cursor: 'default', opacity: '0.9' },
      '.cm-sc-lock, .cm-sc-relock': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        verticalAlign: 'middle',
        width: '1.25em',
        height: '1.25em',
        margin: '0 0.15em 0 0',
        padding: '0',
        border: 'none',
        borderRadius: '3px',
        background: 'transparent',
        color: 'var(--hp-ed-sc-unknown)',
        cursor: 'pointer',
      },
      '.cm-sc-relock': { opacity: '0.55' },
      '.cm-sc-lock:hover, .cm-sc-lock:focus-visible, .cm-sc-relock:hover, .cm-sc-relock:focus-visible': {
        backgroundColor: rgba(p.shortcode.unknown, 0.18),
        opacity: '1',
        outline: 'none',
      },

      // Popovers (shortcode form, spelling menu, completions)
      '.cm-tooltip': {
        backgroundColor: 'var(--hp-ed-bg)',
        color: 'var(--hp-ed-fg)',
        border: '1px solid var(--hp-ed-border)',
        borderRadius: '8px',
        boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 24px rgba(31,35,40,0.15)',
        fontFamily: UI_FONT,
        fontSize: '0.875rem',
      },
      '.cm-sc-form': { display: 'grid', gap: '0.5rem', padding: '0.75rem', minWidth: '18rem', maxWidth: '28rem' },
      '.cm-sc-form-head': { display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' },
      '.cm-sc-form-head code': { fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`, fontWeight: '700', color: 'var(--hp-ed-sc-known)' },
      '.cm-sc-form-head span': { color: 'var(--hp-ed-muted)', fontSize: '0.8125rem' },
      '.cm-sc-form-fields': {
        display: 'grid',
        gridTemplateColumns: 'minmax(5rem, auto) 1fr',
        gap: '0.35rem 0.6rem',
        alignItems: 'start',
        maxHeight: '50vh',
        overflowY: 'auto',
      },
      '.cm-sc-form-fields label': { paddingTop: '0.3rem', color: 'var(--hp-ed-muted)', fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`, fontSize: '0.8125rem' },
      '.cm-sc-form-fields label small': { fontFamily: UI_FONT, color: 'var(--hp-ed-faint)' },
      '.cm-sc-form-fields abbr': { textDecoration: 'none', color: p.alerts.caution },
      '.cm-sc-form input, .cm-sc-form select': {
        width: '100%',
        boxSizing: 'border-box',
        padding: '0.25rem 0.4rem',
        border: '1px solid var(--hp-ed-border)',
        borderRadius: '5px',
        background: 'var(--hp-ed-bg)',
        color: 'var(--hp-ed-fg)',
        font: 'inherit',
      },
      '.cm-sc-form input:focus-visible, .cm-sc-form select:focus-visible, .cm-sc-form button:focus-visible, .cm-spell-menu button:focus':
        { outline: '2px solid var(--hp-ed-accent)', outlineOffset: '1px' },
      '.cm-sc-form [aria-invalid="true"]': { borderColor: p.alerts.caution },
      '.cm-sc-form-error': { display: 'block', color: p.alerts.caution, fontSize: '0.75rem', minHeight: '0' },
      '.cm-sc-form-error:empty': { display: 'none' },
      '.cm-sc-form-note': { margin: '0', color: 'var(--hp-ed-muted)', fontSize: '0.8125rem' },
      '.cm-sc-form-actions': { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' },
      '.cm-sc-form-actions button, .cm-spell-menu button': {
        font: 'inherit',
        padding: '0.25rem 0.75rem',
        borderRadius: '5px',
        border: '1px solid var(--hp-ed-border)',
        background: 'transparent',
        color: 'var(--hp-ed-fg)',
        cursor: 'pointer',
      },
      '.cm-sc-form-actions button[type="submit"]': { background: 'var(--hp-ed-accent)', borderColor: 'var(--hp-ed-accent)', color: '#fff' },

      // Spelling
      '.cm-spell-error': {
        textDecoration: `underline wavy ${p.alerts.caution}`,
        textDecorationThickness: '1px',
        textUnderlineOffset: '0.2em',
        textDecorationSkipInk: 'none',
      },
      '.cm-spell-menu': { display: 'flex', flexDirection: 'column', padding: '0.25rem', minWidth: '11rem' },
      '.cm-spell-menu button': { border: 'none', textAlign: 'start', padding: '0.3rem 0.6rem' },
      '.cm-spell-menu button:hover': { backgroundColor: 'var(--hp-ed-selection)' },
      '.cm-spell-menu .cm-spell-suggestion': { fontWeight: '600' },
      '.cm-spell-menu-note': { padding: '0.3rem 0.6rem', color: 'var(--hp-ed-muted)' },
      '.cm-spell-menu-separator': { height: '1px', margin: '0.25rem 0', backgroundColor: 'var(--hp-ed-border)' },

      // Live preview: lists, tasks, code labels, tables, setext, images
      '.cm-lp-bullet': { display: 'inline-block', minWidth: '0.6em', color: 'var(--hp-ed-muted)', textAlign: 'center' },
      '.cm-lp-list-number': { color: 'var(--hp-ed-muted)', fontVariantNumeric: 'tabular-nums' },
      '.cm-lp-task': { margin: '0 0.35em 0 0', verticalAlign: 'middle', width: '1em', height: '1em', accentColor: 'var(--hp-ed-accent)', cursor: 'pointer' },
      '.cm-lp-task-done': { color: 'var(--hp-ed-muted)', textDecoration: 'line-through', textDecorationColor: 'var(--hp-ed-faint)' },
      '.cm-lp-code-label': {
        float: 'right',
        fontFamily: UI_FONT,
        fontSize: '0.75em',
        color: 'var(--hp-ed-faint)',
        textTransform: 'lowercase',
        letterSpacing: '0.03em',
      },
      '.cm-lp-table-header': { fontWeight: '700' },
      '.cm-lp-table-rule, .cm-lp-table-pipe': { color: 'var(--hp-ed-faint)' },
      '.cm-table-toolbar': { display: 'flex', alignItems: 'center', gap: '1px', padding: '2px' },
      '.cm-table-toolbar button': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.75rem',
        height: '1.6rem',
        padding: '0',
        border: 'none',
        borderRadius: '5px',
        background: 'transparent',
        color: 'var(--hp-ed-muted)',
        cursor: 'pointer',
      },
      '.cm-table-toolbar button:hover:not(:disabled)': { backgroundColor: 'var(--hp-ed-selection)', color: 'var(--hp-ed-fg)' },
      '.cm-table-toolbar button:focus-visible': { outline: '2px solid var(--hp-ed-accent)', outlineOffset: '-1px' },
      '.cm-table-toolbar button:disabled': { opacity: '0.35', cursor: 'default' },
      '.cm-table-toolbar-separator': { width: '1px', height: '1rem', margin: '0 0.2rem', backgroundColor: 'var(--hp-ed-border)' },
      '.cm-image-importing': { color: 'var(--hp-ed-muted)', backgroundColor: 'var(--hp-ed-code-bg)', borderRadius: '3px' },
      '.cm-image-importing-badge': {
        display: 'inline-block',
        width: '0.8em',
        height: '0.8em',
        margin: '0 0.2em',
        verticalAlign: 'middle',
        borderRadius: '50%',
        border: '2px solid var(--hp-ed-border)',
        borderTopColor: 'var(--hp-ed-accent)',
        animation: 'cm-hp-spin 0.9s linear infinite',
      },
      '@keyframes cm-hp-spin': { to: { transform: 'rotate(360deg)' } },
      '.cm-paste-notice': { display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.6rem 0.75rem', maxWidth: '26rem' },
      '.cm-paste-notice p': { margin: '0', lineHeight: '1.45' },
      '.cm-paste-notice button': {
        flex: 'none',
        font: 'inherit',
        padding: '0.2rem 0.6rem',
        borderRadius: '5px',
        border: '1px solid var(--hp-ed-border)',
        background: 'transparent',
        color: 'var(--hp-ed-fg)',
        cursor: 'pointer',
      },
      '.cm-paste-notice button:focus-visible': { outline: '2px solid var(--hp-ed-accent)', outlineOffset: '1px' },
      '.cm-line.cm-lp-setext-hidden': { fontSize: '0.4em', lineHeight: '1' },
      '.cm-lp-image-preview': { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', padding: '0.35rem 1rem 0.6rem' },
      '.cm-lp-image-preview img': {
        maxWidth: 'min(100%, 22rem)',
        maxHeight: '14rem',
        objectFit: 'contain',
        borderRadius: '6px',
        border: '1px solid var(--hp-ed-border)',
        backgroundColor: 'var(--hp-ed-code-bg)',
      },

      // Focus mode
      '&.cm-focus-mode .cm-content': { paddingTop: '40vh', paddingBottom: '50vh' },
      '.cm-line.cm-focus-dim': { opacity: '0.32', transition: 'opacity 120ms ease-out' },

      // Completion menu (slash commands, [[ links)
      '.cm-tooltip.cm-hp-completion > ul': { fontFamily: UI_FONT, maxHeight: '22em', minWidth: '16em' },
      '.cm-tooltip.cm-hp-completion > ul > li': { padding: '0.2em 0.6em' },
      '.cm-tooltip.cm-hp-completion > ul > li[aria-selected]': { backgroundColor: 'var(--hp-ed-selection)', color: 'var(--hp-ed-fg)' },
      '.cm-tooltip.cm-hp-completion completion-section': {
        display: 'list-item',
        padding: '0.35em 0.6em 0.15em',
        fontSize: '0.75em',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--hp-ed-faint)',
        borderBottom: 'none',
      },
      '.cm-completionDetail': { color: 'var(--hp-ed-faint)', fontStyle: 'normal', marginLeft: '0.75em', fontSize: '0.85em' },
      '.cm-completionIcon': { width: '1.4em', opacity: '0.8', fontFamily: UI_FONT, fontSize: '0.85em', textAlign: 'center' },
      ...completionIcons,
    },
    { dark: isDark },
  )
}

/** Syntax colours for source shown as-is (raw mode, and the cursor line in live preview). */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  // Only URLs: `t.link` would also colour `[bracket placeholders]` and `[!NOTE]` like links.
  { tag: t.url, color: 'var(--hp-ed-link)' },
  { tag: t.monospace, fontFamily: `var(--hp-editor-mono-font, ${MONO_FONT})`, fontSize: '0.9em' },
  { tag: [t.processingInstruction, t.contentSeparator, t.labelName], color: 'var(--hp-ed-faint)' },
  { tag: [t.comment, t.meta], color: 'var(--hp-ed-faint)' },
  { tag: [t.angleBracket, t.tagName], color: 'var(--hp-ed-muted)' },
  { tag: [t.attributeName], color: 'var(--hp-ed-muted)' },
  { tag: [t.attributeValue, t.string], color: 'var(--hp-ed-link)' },
  { tag: t.escape, color: 'var(--hp-ed-faint)' },
])

export const lightTheme: Extension = [buildTheme(light, false), syntaxHighlighting(markdownHighlightStyle)]
export const darkTheme: Extension = [buildTheme(dark, true), syntaxHighlighting(markdownHighlightStyle)]

export function editorTheme(scheme: 'light' | 'dark'): Extension {
  return scheme === 'dark' ? darkTheme : lightTheme
}
