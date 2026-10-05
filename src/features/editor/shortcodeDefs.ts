// Shortcode definitions: Hugo's built-ins plus the site's and theme's own
// (see discoverShortcodes.ts). A definition drives the parameter form, the
// slash menu skeletons and whether a tag counts as "known".

import { Facet, type EditorState } from '@codemirror/state'
import { knownShortcodes } from './config'
import type { ShortcodeDef, ShortcodeParam } from './contract'

const p = (name: string, extra: Partial<ShortcodeParam> = {}): ShortcodeParam => ({ name, ...extra })

/** Hugo's embedded shortcodes (as of Hugo 0.150). */
export const BUILTIN_SHORTCODES: readonly ShortcodeDef[] = [
  {
    name: 'figure',
    source: 'builtin',
    paired: false,
    description: 'Image with caption (<figure>)',
    params: [
      p('src', { required: true }),
      p('alt'),
      p('caption'),
      p('title'),
      p('link'),
      p('target'),
      p('rel'),
      p('class'),
      p('width'),
      p('height'),
      p('loading'),
      p('attr'),
      p('attrlink'),
    ],
  },
  {
    name: 'youtube',
    source: 'builtin',
    paired: false,
    description: 'YouTube video',
    params: [
      p('id', { positional: 0, required: true }),
      p('start', { type: 'number' }),
      p('end', { type: 'number' }),
      p('autoplay', { type: 'boolean' }),
      p('loading'),
      p('title'),
    ],
  },
  {
    name: 'vimeo',
    source: 'builtin',
    paired: false,
    description: 'Vimeo video',
    params: [p('id', { positional: 0, required: true }), p('title'), p('class'), p('loading'), p('allowFullScreen', { type: 'boolean' })],
  },
  {
    name: 'x',
    source: 'builtin',
    paired: false,
    description: 'Post on X',
    params: [p('user', { required: true }), p('id', { required: true })],
  },
  {
    name: 'instagram',
    source: 'builtin',
    paired: false,
    description: 'Instagram post',
    params: [p('id', { positional: 0, required: true })],
  },
  {
    name: 'highlight',
    source: 'builtin',
    paired: true,
    description: 'Highlighted code',
    params: [
      p('lang', { positional: 0, positionalOnly: true, required: true }),
      p('options', { positional: 1, positionalOnly: true, description: 'e.g. linenos=table, hl_lines=2' }),
    ],
  },
  {
    name: 'ref',
    source: 'builtin',
    paired: false,
    description: 'Absolute link to a page',
    params: [p('path', { positional: 0, positionalOnly: true, required: true })],
  },
  {
    name: 'relref',
    source: 'builtin',
    paired: false,
    description: 'Relative link to a page',
    params: [p('path', { positional: 0, positionalOnly: true, required: true })],
  },
  {
    name: 'param',
    source: 'builtin',
    paired: false,
    description: 'Value of a page or site parameter',
    params: [p('name', { positional: 0, positionalOnly: true, required: true })],
  },
  {
    name: 'details',
    source: 'builtin',
    paired: true,
    markdown: true,
    description: 'Collapsible section (<details>)',
    params: [p('summary'), p('open', { type: 'boolean' }), p('class'), p('name'), p('title')],
  },
  {
    name: 'qr',
    source: 'builtin',
    paired: true,
    description: 'QR code',
    params: [p('text'), p('level'), p('scale', { type: 'number' }), p('targetDir'), p('alt'), p('class')],
  },
]

/**
 * Shortcode definitions by name: the built-ins, then every provided list in
 * order (a later definition with the same name replaces an earlier one, so
 * a site's own `figure` wins over Hugo's).
 */
export const shortcodeDefinitions = Facet.define<readonly ShortcodeDef[], ReadonlyMap<string, ShortcodeDef>>({
  combine(values) {
    const map = new Map<string, ShortcodeDef>()
    for (const def of BUILTIN_SHORTCODES) map.set(def.name, def)
    for (const list of values) for (const def of list) map.set(def.name, def)
    return map
  },
})

/** The definition of a shortcode, or null when the editor does not know it. */
export function shortcodeDef(state: EditorState, name: string): ShortcodeDef | null {
  return state.facet(shortcodeDefinitions).get(name) ?? null
}

/** Known = built-in, defined by the site/theme, or listed in {@link knownShortcodes}. */
export function isKnownShortcode(state: EditorState, name: string): boolean {
  return state.facet(knownShortcodes).has(name) || state.facet(shortcodeDefinitions).has(name)
}
