import { describe, expect, it } from 'vitest'

import { compareTexts, findOverrides, isEmptyHook } from './overrides'

const THEME = [
  'layouts/baseof.html',
  'layouts/rss.xml',
  'layouts/_partials/templates/opengraph.html',
  'layouts/_partials/extend_post_content.html',
  'layouts/_shortcodes/figure.html',
  'assets/css/extended/blank.css',
  'assets/css/core/theme-vars.css',
  'i18n/tr.yaml',
  'archetypes/default.md',
  'theme.toml',
]

describe('findOverrides', () => {
  it('maps legacy and new layout paths and classifies additions', () => {
    const site = [
      'layouts/_default/baseof.html',
      'layouts/rss.xml',
      'layouts/partials/templates/opengraph.html',
      'layouts/_partials/extend_post_content.html',
      'layouts/shortcodes/figure.html',
      'layouts/_partials/banner.html',
      'layouts/_markup/render-blockquote.html',
      'assets/css/extended/alert.css',
      'assets/css/extended/hugo-publisher.css',
      'assets/css/core/theme-vars.css',
      'i18n/tr.yaml',
      'archetypes/default.md',
      'content/x.md',
      'static/CNAME',
    ]
    const entries = findOverrides(site, THEME, 'themes/PaperMod', ['assets/css/extended/hugo-publisher.css'])
    const by = Object.fromEntries(entries.map((e) => [e.sitePath, e]))
    expect(by['layouts/_default/baseof.html']).toMatchObject({ kind: 'override', themePath: 'themes/PaperMod/layouts/baseof.html', legacyPath: true })
    expect(by['layouts/rss.xml']).toMatchObject({ kind: 'override', legacyPath: false })
    expect(by['layouts/partials/templates/opengraph.html'].themePath).toBe('themes/PaperMod/layouts/_partials/templates/opengraph.html')
    expect(by['layouts/shortcodes/figure.html'].themePath).toBe('themes/PaperMod/layouts/_shortcodes/figure.html')
    expect(by['assets/css/core/theme-vars.css'].kind).toBe('override')
    expect(by['archetypes/default.md'].kind).toBe('override')
    expect(by['i18n/tr.yaml']).toMatchObject({ kind: 'merge' })
    expect(by['assets/css/extended/alert.css']).toMatchObject({ kind: 'addition', hookFolder: 'assets/css/extended/' })
    expect(by['layouts/_partials/banner.html']).toMatchObject({ kind: 'addition' })
    expect(by['layouts/_partials/banner.html'].hookFolder).toBeUndefined()
    expect(by['layouts/_markup/render-blockquote.html']).toMatchObject({ kind: 'addition' })
    expect(by['layouts/_markup/render-blockquote.html'].hookFolder).toBeUndefined()
    expect(by['content/x.md']).toBeUndefined()
    expect(by['assets/css/extended/hugo-publisher.css']).toBeUndefined()
    expect(entries[0].kind).toBe('override')
    expect(entries[entries.length - 1].kind).toBe('addition')
  })
})

describe('compareTexts and isEmptyHook', () => {
  it('flags identical copies, line-ending-only and whitespace-only differences', () => {
    expect(compareTexts('a\nb\n', 'a\nb\n')).toBe('identical')
    expect(compareTexts('a\r\nb\r\n', 'a\nb\n')).toBe('lineEndings')
    expect(compareTexts('a  \nb\n\n', 'a\nb\n')).toBe('whitespace')
    expect(compareTexts('a\nc\n', 'a\nb\n')).toBe('different')
  })

  it('recognises empty and comment-only hooks', () => {
    expect(isEmptyHook('')).toBe(true)
    expect(isEmptyHook('{{- /* Head custom content area start */ -}}\n{{- /* end */ -}}\n')).toBe(true)
    expect(isEmptyHook('<!-- comments -->\n/* blank */')).toBe(true)
    expect(isEmptyHook('{{ partial "x" . }}')).toBe(false)
  })
})
