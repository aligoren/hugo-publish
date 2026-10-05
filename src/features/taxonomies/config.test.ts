import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_TAXONOMIES,
  listPageEnabled,
  loadTaxonomySettings,
  parseTaxonomies,
  settingsFromEffective,
  settingsFromFiles,
  termPagesEnabled,
} from './config'

describe('parseTaxonomies', () => {
  it('uses Hugo’s defaults when nothing is configured', () => {
    expect(parseTaxonomies(undefined)).toEqual(DEFAULT_TAXONOMIES)
  })

  it('treats an empty map as turned off', () => {
    expect(parseTaxonomies({})).toEqual([])
  })

  it('reads custom taxonomies and skips invalid entries', () => {
    expect(parseTaxonomies({ series: 'series', tag: 'tags', bad: 3, empty: '' })).toEqual([
      { singular: 'series', plural: 'series' },
      { singular: 'tag', plural: 'tags' },
    ])
  })
})

describe('settings', () => {
  it('reads hugo config output (lower-cased keys)', () => {
    const settings = settingsFromEffective({
      taxonomies: { category: 'categories', tag: 'tags' },
      disablekinds: ['taxonomy'],
      removepathaccents: true,
      disablepathtolower: false,
    })
    expect(settings.taxonomies.map((t) => t.plural)).toEqual(['categories', 'tags'])
    expect(settings.disableKinds).toEqual(['taxonomy'])
    expect(settings.removePathAccents).toBe(true)
    expect(settings.source).toBe('hugo')
    expect(termPagesEnabled(settings)).toBe(true)
    expect(listPageEnabled(settings)).toBe(false)
  })

  it('merges config files: root file, then config/_default with taxonomies.toml as the map', () => {
    const settings = settingsFromFiles([
      { path: 'hugo.toml', values: { removePathAccents: true, disableKinds: ['Term'], taxonomies: { tag: 'tags' } } },
      { path: 'config/_default/params.toml', values: { taxonomies: { nope: 'nope' } } },
      { path: 'config/_default/taxonomies.toml', values: { category: 'categories', series: 'series' } },
    ])
    expect(settings.taxonomies.map((t) => t.plural)).toEqual(['categories', 'series'])
    expect(settings.disableKinds).toEqual(['term'])
    expect(settings.removePathAccents).toBe(true)
    expect(termPagesEnabled(settings)).toBe(false)
    expect(settings.source).toBe('files')
  })

  it('falls back to the files when hugo config fails', async () => {
    const error = { code: 'hugo_not_found', message: 'no hugo' }
    const readConfigFile = vi.fn(async (path: string) => {
      if (path === 'broken.json') throw new Error('bad')
      return { values: { taxonomies: {} } }
    })
    const result = await loadTaxonomySettings(['hugo.toml', 'broken.json'], {
      configEffective: () => Promise.reject(error),
      readConfigFile,
    })
    expect(result.hugoError).toBe(error)
    expect(result.settings.taxonomies).toEqual([])
    expect(readConfigFile).toHaveBeenCalledTimes(2)
  })

  it('prefers hugo config when it works', async () => {
    const readConfigFile = vi.fn()
    const result = await loadTaxonomySettings(['hugo.toml'], {
      configEffective: async () => ({ values: { taxonomies: { tag: 'tags' } }, messages: [] }),
      readConfigFile,
    })
    expect(result.settings.taxonomies).toEqual([{ singular: 'tag', plural: 'tags' }])
    expect(result.hugoError).toBeNull()
    expect(readConfigFile).not.toHaveBeenCalled()
  })
})
