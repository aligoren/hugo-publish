// Host-supplied editor configuration, exposed as CodeMirror facets.

import { Facet, type EditorState } from '@codemirror/state'

export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type AlertType = (typeof ALERT_TYPES)[number]
export type AlertLabels = Record<AlertType, string>

export const DEFAULT_ALERT_LABELS: Readonly<AlertLabels> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

/** The labels the site's Turkish render hook uses; a convenience for the host. */
export const TURKISH_ALERT_LABELS: Readonly<AlertLabels> = {
  note: 'Bilgi',
  tip: 'İpucu',
  important: 'Önemli',
  warning: 'Uyarı',
  caution: 'Dikkat',
}

export function isAlertType(value: string): value is AlertType {
  return (ALERT_TYPES as readonly string[]).includes(value)
}

/** Labels shown for GitHub alerts. Later values override earlier ones; missing types use the defaults. */
export const alertLabels = Facet.define<Partial<AlertLabels>, AlertLabels>({
  combine: (values) => Object.assign({}, DEFAULT_ALERT_LABELS, ...values),
})

/** Hugo's built-in shortcodes. */
export const DEFAULT_KNOWN_SHORTCODES: readonly string[] = [
  'figure',
  'highlight',
  'ref',
  'relref',
  'youtube',
  'vimeo',
  'x',
  'instagram',
  'param',
  'qr',
  'details',
]

/**
 * Shortcode names the site defines (layouts/_shortcodes, theme). They are
 * added to {@link DEFAULT_KNOWN_SHORTCODES}; any other name is "unknown".
 */
export const knownShortcodes = Facet.define<readonly string[], ReadonlySet<string>>({
  combine: (values) => new Set([...DEFAULT_KNOWN_SHORTCODES, ...values.flat()]),
})

/**
 * Whether markup is hidden off the cursor line (live preview). `false` is the
 * raw source mode: alerts, RTL blocks and shortcodes keep their colours but
 * nothing is hidden or replaced by widgets. The last provided value wins.
 */
export const livePreviewEnabled = Facet.define<boolean, boolean>({
  combine: (values) => (values.length > 0 ? values[values.length - 1] : true),
})

export function getAlertLabel(state: EditorState, type: AlertType): string {
  return state.facet(alertLabels)[type]
}

/** Toolbar button names (tooltips and accessible labels). */
export interface ToolbarLabels {
  bold: string
  italic: string
  heading: string
  paragraph: string
  quote: string
  alert: string
  rtlBlock: string
  link: string
  horizontalRule: string
  livePreview: string
  image: string
  table: string
  codeBlock: string
  focusMode: string
  /** Accessible name of the toolbar itself. */
  toolbar: string
}

export const DEFAULT_TOOLBAR_LABELS: Readonly<ToolbarLabels> = {
  bold: 'Bold',
  italic: 'Italic',
  heading: 'Heading',
  paragraph: 'Paragraph',
  quote: 'Quote',
  alert: 'Alert',
  rtlBlock: 'Right-to-left block',
  link: 'Link',
  horizontalRule: 'Divider',
  livePreview: 'Live preview',
  image: 'Image',
  table: 'Table',
  codeBlock: 'Code block',
  focusMode: 'Focus mode',
  toolbar: 'Formatting',
}

/** How `[[` link completion writes the link target. */
export type LinkStyle = 'relref' | 'permalink'

/**
 * `relref` (default) inserts `[Title]({{< relref "/posts/x.md" >}})`, which
 * Hugo checks at build time; `permalink` inserts the page's URL path. The
 * last provided value wins.
 */
export const linkStyle = Facet.define<LinkStyle, LinkStyle>({
  combine: (values) => (values.length > 0 ? values[values.length - 1] : 'relref'),
})

/** The site's content folder (site-relative), used to make `relref` paths. Default `content`. */
export const contentDir = Facet.define<string, string>({
  combine: (values) => (values.length > 0 ? values[values.length - 1] : 'content').replace(/^\/+|\/+$/g, ''),
})
