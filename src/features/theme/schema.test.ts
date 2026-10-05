import { describe, expect, it } from 'vitest'

import { canonicalThemePath, flattenSchema, matchSchema, normalizeThemeName, schemaProblems, type ThemeIdentity } from './schema'
import { curatedSchemas } from './schemas'
import { papermod } from './schemas/papermod'

const identity = (over: Partial<ThemeIdentity>): ThemeIdentity => ({ folderName: 'x', urls: [], files: new Set(), ...over })

describe('curated schemas', () => {
  it.each(curatedSchemas.map((s) => [s['x-theme'].id, s] as const))('%s is complete: unique keys, en+tr labels, known groups', (_, schema) => {
    expect(schemaProblems(schema)).toEqual([])
  })

  it('have unique ids', () => {
    const ids = curatedSchemas.map((s) => s['x-theme'].id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers PaperMod in full', () => {
    const site = flattenSchema(papermod.properties).map((f) => f.key)
    const page = flattenSchema(papermod['x-pageParams'] ?? {}).map((f) => f.key)
    expect(site.length).toBeGreaterThanOrEqual(75)
    expect(page.length).toBeGreaterThanOrEqual(45)
    for (const key of ['defaultTheme', 'profileMode.buttons', 'socialIcons', 'fuseOpts.ignoreLocation', 'analytics.naver.SiteVerificationTag', 'label.iconSVG']) {
      expect(site).toContain(key)
    }
    const hidden = papermod['x-pageParams']!.hiddenInHomeList
    expect(hidden['x-writeFalse']).toBe('omit')
    expect(papermod.properties.author['x-stringOrList']).toBe(true)
    expect(Object.keys(papermod['x-features'] ?? {})).toEqual(['search', 'archives'])
  })

  it('flattens nested objects but keeps lists and key/value objects whole', () => {
    const keys = flattenSchema(papermod.properties).map((f) => f.key)
    expect(keys).toContain('profileMode.enabled')
    expect(keys).toContain('profileMode.buttons')
    expect(keys).not.toContain('profileMode.buttons.name')
    const groups = new Map(flattenSchema(papermod.properties).map((f) => [f.key, f.field['x-group']]))
    expect(groups.get('analytics.google.SiteVerificationTag')).toBe('analytics')
  })
})

describe('matchSchema', () => {
  it('matches by theme.toml name, repository, folder name and fingerprint', () => {
    expect(matchSchema(curatedSchemas, identity({ themeTomlName: 'PaperMod' }))?.reason).toBe('themeToml')
    expect(matchSchema(curatedSchemas, identity({ urls: ['https://github.com/CaiJimmy/hugo-theme-stack/'] }))).toMatchObject({
      reason: 'repo',
      schema: { 'x-theme': { id: 'stack' } },
    })
    expect(matchSchema(curatedSchemas, identity({ urls: ['github.com/nunocoracao/blowfish/v2'] }))?.schema['x-theme'].id).toBe('blowfish')
    expect(matchSchema(curatedSchemas, identity({ folderName: 'hugo-book' }))?.schema['x-theme'].id).toBe('hugo-book')
    expect(matchSchema(curatedSchemas, identity({ folderName: 'gohugo-theme-ananke' }))?.schema['x-theme'].id).toBe('ananke')
    const forked = identity({
      folderName: 'my-fork',
      files: new Set(['layouts/partials/index_profile.html', 'layouts/partials/home_info.html', 'assets/css/core/theme-vars.css']),
    })
    expect(matchSchema(curatedSchemas, forked)).toMatchObject({ reason: 'fingerprint', schema: { 'x-theme': { id: 'papermod' } } })
    expect(matchSchema(curatedSchemas, identity({ folderName: 'mainroad' }))).toBeNull()
  })

  it('normalises theme folder names and layout paths', () => {
    expect(normalizeThemeName('hugo-theme-stack')).toBe('stack')
    expect(normalizeThemeName('hugo-PaperMod')).toBe('papermod')
    expect(normalizeThemeName('gohugo-theme-ananke')).toBe('ananke')
    expect(canonicalThemePath('layouts/partials/x.html')).toBe('layouts/_partials/x.html')
    expect(canonicalThemePath('layouts/_default/single.html')).toBe('layouts/single.html')
    expect(canonicalThemePath('assets/x.css')).toBe('assets/x.css')
  })
})
