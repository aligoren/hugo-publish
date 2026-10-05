import i18n from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'

import '../../i18n'
import {
  CLOUDFLARE_DEFAULT_HUGO,
  isLocalTheme,
  parityWarnings,
  rootValues,
  severity,
  themeName,
  themeRequirement,
  usedFeatures,
  type ParityInput,
  type ParityWarning,
} from './parity'
import { warningText } from './warningText'

const active = { version: '0.167.0', extended: true }

function kinds(warnings: ParityWarning[]) {
  return warnings.map((w) => ('target' in w ? `${w.kind}:${w.target}` : w.kind))
}

function input(overrides: Partial<ParityInput>): ParityInput {
  return { active, pinned: null, hosting: null, theme: null, features: [], ...overrides }
}

describe('config features', () => {
  it('places split config files at their root key', () => {
    expect(rootValues('hugo.toml', { a: 1 })).toEqual({ a: 1 })
    expect(rootValues('config/_default/hugo.toml', { a: 1 })).toEqual({ a: 1 })
    expect(rootValues('config/_default/config.yaml', { a: 1 })).toEqual({ a: 1 })
    expect(rootValues('config/_default/languages.toml', { tr: {} })).toEqual({ languages: { tr: {} } })
  })

  it('finds version-dependent keys in any config file, case-insensitively', () => {
    const features = usedFeatures([
      { file: 'hugo.toml', values: { title: 'x', Pagination: { pagerSize: 5 } } },
      { file: 'config/_default/languages.toml', values: { tr: { locale: 'tr-TR' }, en: {} } },
      { file: 'config/_default/markup.toml', values: { goldmark: { extensions: { passthrough: { enable: true } } } } },
    ])
    expect(features).toEqual([
      { key: 'pagination', minVersion: '0.128.0' },
      { key: 'locale', minVersion: '0.158.0' },
      { key: 'markup.goldmark.extensions.passthrough', minVersion: '0.122.0' },
    ])
    expect(usedFeatures([{ file: 'hugo.toml', values: { locale: 'tr-TR' } }])).toEqual([
      { key: 'locale', minVersion: '0.158.0' },
    ])
    expect(usedFeatures([{ file: 'hugo.toml', values: { languages: { tr: { languageName: 'Türkçe' } } } }])).toEqual([])
  })

  it('reads the theme name and its requirement', () => {
    expect(themeName([{ file: 'hugo.toml', values: { theme: 'PaperMod' } }])).toBe('PaperMod')
    expect(themeName([{ file: 'hugo.toml', values: { theme: ['hugo-book', 'base'] } }])).toBe('hugo-book')
    expect(themeName([{ file: 'config/_default/hugo.toml', values: {} }])).toBeNull()
    expect(isLocalTheme('PaperMod')).toBe(true)
    expect(isLocalTheme('github.com/adityatelange/hugo-PaperMod')).toBe(false)
    expect(isLocalTheme('..')).toBe(false)

    expect(themeRequirement('PaperMod', { min_version: '0.146.0' }, null)).toEqual({
      name: 'PaperMod',
      minVersion: '0.146.0',
      extended: false,
    })
    // The stricter of theme.toml and module.hugoVersion wins; a float min_version is understood.
    expect(
      themeRequirement('t', { min_version: 0.41 }, { module: { hugoVersion: { min: '0.120.0', extended: true } } }),
    ).toEqual({ name: 't', minVersion: '0.120.0', extended: true })
    expect(themeRequirement('t', null, null).minVersion).toBeNull()
  })
})

describe('parity warnings', () => {
  it('is quiet when everything matches', () => {
    expect(parityWarnings(input({ pinned: '0.167.0', hosting: '0.167.0' }))).toEqual([])
  })

  it('reports an active version that differs from the pin', () => {
    const warnings = parityWarnings(input({ pinned: '0.167.0', hosting: '0.167.0', active: { version: '0.160.1', extended: true } }))
    expect(warnings[0]).toEqual({ kind: 'activeNotPinned', active: '0.160.1', pinned: '0.167.0' })
    expect(kinds(warnings)).toEqual(['activeNotPinned'])
  })

  it('reports a missing host version, assuming the Cloudflare default for requirements', () => {
    const warnings = parityWarnings(input({ features: [{ key: 'locale', minVersion: '0.158.0' }] }))
    expect(kinds(warnings)).toEqual(['featureTooNew:hosting', 'hostingMissing'])
    const feature = warnings[0]
    expect(feature).toMatchObject({ actual: CLOUDFLARE_DEFAULT_HUGO, assumed: true, feature: 'locale' })
    expect(severity(feature)).toBe('warn')
    expect(severity(warnings[1])).toBe('info')
  })

  it('checks the theme minimum against the active, pinned and host versions', () => {
    const theme = { name: 'PaperMod', minVersion: '0.146.0', extended: false }
    const warnings = parityWarnings(
      input({ active: { version: '0.145.0', extended: true }, pinned: '0.140.0', hosting: '0.120.0', theme }),
    )
    expect(kinds(warnings)).toEqual([
      'themeTooNew:active',
      'themeTooNew:hosting',
      'activeNotPinned',
      'themeTooNew:pinned',
      'hostingDiffers',
    ])
    expect(severity(warnings[0])).toBe('error')
    // Cloudflare's default 0.147.7 satisfies PaperMod.
    expect(parityWarnings(input({ theme })).map((w) => w.kind)).toEqual(['hostingMissing'])
  })

  it('warns when the theme needs extended but the active Hugo is standard', () => {
    const theme = { name: 'Doks', minVersion: null, extended: true }
    const warnings = parityWarnings(input({ hosting: '0.167.0', theme, active: { version: '0.167.0', extended: false } }))
    expect(kinds(warnings)).toEqual(['themeNeedsExtended'])
  })

  it('flags an old host and a host that differs from the pin', () => {
    const features = [{ key: 'locale', minVersion: '0.158.0' }]
    const warnings = parityWarnings(input({ pinned: '0.167.0', hosting: '0.147.7', features }))
    expect(kinds(warnings)).toEqual(['featureTooNew:hosting', 'hostingDiffers'])
    expect(warnings[0]).toMatchObject({ assumed: false })
    expect(warnings[1]).toEqual({ kind: 'hostingDiffers', hosting: '0.147.7', local: '0.167.0', localKind: 'pinned' })
  })

  it('handles a missing Hugo and invalid pins', () => {
    const warnings = parityWarnings(input({ active: null, pinned: 'latest', hosting: '0.167.0' }))
    expect(kinds(warnings)).toEqual(['noActive', 'invalidPin'])
  })

  describe('texts', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('en')
    })

    it('has a sentence for every warning in both languages', async () => {
      const all: ParityWarning[] = [
        { kind: 'noActive' },
        { kind: 'invalidPin', field: 'pinned', value: 'latest' },
        { kind: 'activeNotPinned', active: '0.160.1', pinned: '0.167.0' },
        { kind: 'themeTooNew', target: 'active', theme: 'PaperMod', required: '0.146.0', actual: '0.145.0', assumed: false },
        { kind: 'themeTooNew', target: 'pinned', theme: 'PaperMod', required: '0.146.0', actual: '0.145.0', assumed: false },
        { kind: 'themeTooNew', target: 'hosting', theme: 'PaperMod', required: '0.146.0', actual: '0.145.0', assumed: true },
        { kind: 'themeNeedsExtended', theme: 'Doks' },
        { kind: 'featureTooNew', target: 'hosting', feature: 'locale', required: '0.158.0', actual: '0.147.7', assumed: true },
        { kind: 'featureTooNew', target: 'active', feature: 'locale', required: '0.158.0', actual: '0.150.0', assumed: false },
        { kind: 'hostingMissing', assumed: '0.147.7' },
        { kind: 'hostingDiffers', hosting: '0.147.7', local: '0.167.0', localKind: 'pinned' },
        { kind: 'hostingDiffers', hosting: '0.147.7', local: '0.167.0', localKind: 'active' },
      ]
      for (const language of ['en', 'tr']) {
        await i18n.changeLanguage(language)
        for (const warning of all) {
          const text = warningText(i18n.t.bind(i18n), warning)
          expect(text, JSON.stringify(warning)).not.toMatch(/hugo\.warnings|{{/)
        }
      }
      await i18n.changeLanguage('en')
      expect(
        warningText(i18n.t.bind(i18n), {
          kind: 'featureTooNew',
          target: 'hosting',
          feature: 'locale',
          required: '0.158.0',
          actual: '0.147.7',
          assumed: true,
        }),
      ).toContain('set HUGO_VERSION')
    })
  })
})
