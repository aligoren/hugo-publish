import { describe, expect, it } from 'vitest'

import { mergeInto, planPreset, PRESETS, satisfies, type PresetId } from './presets'
import { sourcesOf } from './testing'

function preset(id: PresetId) {
  const found = PRESETS.find((p) => p.id === id)
  if (!found) throw new Error(id)
  return found
}

describe('presets', () => {
  it('adds the llms output format and keeps the home outputs', () => {
    const sources = sourcesOf({ 'hugo.toml': { title: 'Site' } })
    const plan = planPreset(preset('llms'), { sources, effective: { outputs: { home: ['html', 'rss'] } } })
    expect(plan.applied).toBe(false)
    expect(plan.newFiles).toEqual({})
    expect(plan.opsByFile).toEqual({
      'hugo.toml': [
        { op: 'set', path: ['outputFormats', 'llms', 'mediaType'], value: 'text/plain' },
        { op: 'set', path: ['outputFormats', 'llms', 'baseName'], value: 'llms' },
        { op: 'set', path: ['outputFormats', 'llms', 'isPlainText'], value: true },
        { op: 'set', path: ['outputFormats', 'llms', 'notAlternative'], value: true },
        { op: 'set', path: ['outputs', 'home'], value: ['html', 'rss', 'llms'] },
      ],
    })
  })

  it('recognizes a preset that is already set, whatever the casing', () => {
    const sources = sourcesOf({
      'hugo.toml': {
        outputFormats: { llms: { mediaType: 'text/plain', baseName: 'llms', isPlainText: true, notAlternative: true } },
        outputs: { home: ['HTML', 'RSS', 'llms'] },
      },
    })
    expect(planPreset(preset('llms'), { sources, effective: null }).applied).toBe(true)
  })

  it('turns on only the privacy switches that are not on yet', () => {
    const sources = sourcesOf({
      'hugo.toml': {},
      'config/_default/privacy.toml': {
        disqus: { disable: true },
        googleAnalytics: { disable: true },
        instagram: { disable: true },
        vimeo: { disable: true, enableDNT: true },
        x: { disable: true, enableDNT: true },
        youTube: { disable: false },
      },
    })
    const plan = planPreset(preset('privacy'), { sources, effective: { privacy: { googleanalytics: { respectdonottrack: true } } } })
    expect(plan.opsByFile).toEqual({
      'config/_default/privacy.toml': [
        { op: 'set', path: ['youTube', 'disable'], value: true },
        { op: 'set', path: ['youTube', 'privacyEnhanced'], value: true },
      ],
    })
  })

  it('sets Turkish-friendly URLs in the owning files', () => {
    const sources = sourcesOf({ 'hugo.toml': { removePathAccents: false }, 'config/_default/pagination.toml': { pagerSize: 5 } })
    expect(planPreset(preset('turkishUrls'), { sources, effective: null }).opsByFile).toEqual({
      'hugo.toml': [{ op: 'set', path: ['removePathAccents'], value: true }],
      'config/_default/pagination.toml': [{ op: 'set', path: ['path'], value: 'sayfa' }],
    })
  })

  it('adds math passthrough delimiters', () => {
    const sources = sourcesOf({ 'hugo.toml': { markup: { goldmark: { renderer: { unsafe: true } } } } })
    expect(planPreset(preset('math'), { sources, effective: null }).opsByFile['hugo.toml']).toEqual([
      { op: 'set', path: ['markup', 'goldmark', 'extensions', 'passthrough', 'enable'], value: true },
      {
        op: 'set',
        path: ['markup', 'goldmark', 'extensions', 'passthrough', 'delimiters', 'block'],
        value: [
          ['\\[', '\\]'],
          ['$$', '$$'],
        ],
      },
      { op: 'set', path: ['markup', 'goldmark', 'extensions', 'passthrough', 'delimiters', 'inline'], value: [['\\(', '\\)']] },
    ])
  })

  describe('dev server headers', () => {
    const devHeaders = preset('devHeaders')

    it('goes to [server] in hugo.toml for a single-file site', () => {
      const plan = planPreset(devHeaders, { sources: sourcesOf({ 'hugo.toml': { title: 'x' } }), effective: null })
      expect(plan.newFiles).toEqual({})
      expect(plan.opsByFile['hugo.toml']).toEqual([{ op: 'appendTable', path: ['server', 'headers'], entries: devHeaders.changes[0].kind === 'upsertRow' ? devHeaders.changes[0].row : {} }])
    })

    it('creates config/development/server.toml when the site uses config/', () => {
      const sources = sourcesOf({ 'hugo.toml': {}, 'config/_default/params.toml': {} })
      const plan = planPreset(devHeaders, { sources, effective: null, newFileHeader: ['Preview server'] })
      expect(plan.opsByFile).toEqual({})
      const text = plan.newFiles['config/development/server.toml']
      expect(text).toContain('# Preview server\n')
      expect(text).toContain("[[headers]]\nfor = '/**'\n\n[headers.values]\n")
      expect(text).toContain("Content-Security-Policy = 'script-src localhost:1313'")
    })

    it('updates the matching entry of an existing server.toml in place', () => {
      const sources = sourcesOf({
        'hugo.toml': {},
        'config/development/server.toml': {
          values: { headers: [{ for: '/**', values: { 'X-Frame-Options': 'SAMEORIGIN' } }] },
          text: "[[headers]]\nfor = '/**'\n[headers.values]\nX-Frame-Options = 'SAMEORIGIN'\n",
        },
      })
      const ops = planPreset(devHeaders, { sources, effective: null }).opsByFile['config/development/server.toml']
      expect(ops).toContainEqual({ op: 'set', path: ['headers', 0, 'values', 'X-Frame-Options'], value: 'DENY' })
      expect(ops).toContainEqual({ op: 'set', path: ['headers', 0, 'values', 'Referrer-Policy'], value: 'strict-origin-when-cross-origin' })
      expect(ops.some((op) => op.op === 'appendTable')).toBe(false)
    })

    it('appends to the [server] table of config/development/hugo.toml', () => {
      const sources = sourcesOf({ 'hugo.toml': {}, 'config/development/hugo.toml': { buildDrafts: true } })
      const plan = planPreset(devHeaders, { sources, effective: null })
      expect(plan.opsByFile['config/development/hugo.toml']).toMatchObject([{ op: 'appendTable', path: ['server', 'headers'] }])
    })
  })

  it('compares and merges like Hugo reads keys', () => {
    expect(satisfies({ MediaType: 'text/plain', extra: 1 }, { mediaType: 'text/plain' })).toBe(true)
    expect(satisfies({ mediaType: 'text/html' }, { mediaType: 'text/plain' })).toBe(false)
    expect(mergeInto({ BaseName: 'x', path: 'p' }, { baseName: 'llms' })).toEqual({ BaseName: 'llms', path: 'p' })
  })
})
