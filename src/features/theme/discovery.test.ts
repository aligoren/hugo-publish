import { describe, expect, it } from 'vitest'

import type { ConfigFileData } from '../config-edit'
import {
  caseDuplicates,
  defaultParamsTarget,
  isModulePath,
  mergeParams,
  moduleImports,
  ownerOf,
  paramsSources,
  siteLanguages,
  themeFolderCandidates,
  themeNamesFromConfig,
  themesDirFromConfig,
  versionAtLeast,
  writePath,
} from './discovery'
import { planFeature, type FeatureContext } from './features'
import { arrayOfTablesOps, changeFor, expandOps, isArrayOfTables, splitTomlKey } from './paramsWrite'
import { papermod } from './schemas/papermod'
import { blowfish } from './schemas/blowfish'

const config = (path: string, values: Record<string, unknown>, text = ''): ConfigFileData => ({
  path,
  format: path.endsWith('.toml') ? 'toml' : path.endsWith('.json') ? 'json' : 'yaml',
  text,
  version: 'v',
  values,
  comments: {},
})

describe('theme discovery', () => {
  it('reads theme names (string or list), themesDir and module imports by precedence', () => {
    expect(themeNamesFromConfig([config('hugo.toml', { theme: 'PaperMod' })])).toEqual(['PaperMod'])
    expect(themeNamesFromConfig([config('hugo.toml', { theme: 'a' }), config('config/_default/hugo.yaml', { theme: ['comp', 'main'] })])).toEqual([
      'comp',
      'main',
    ])
    expect(themeNamesFromConfig([config('config/_default/params.toml', { theme: 'nope' })])).toEqual([])
    expect(themesDirFromConfig([config('hugo.toml', { themesDir: './my-themes/' })])).toBe('my-themes')
    expect(themesDirFromConfig([config('hugo.toml', {})])).toBe('themes')
    expect(moduleImports([config('hugo.toml', { module: { imports: [{ path: 'github.com/a/b' }] } }), config('config/_default/module.toml', { imports: [{ path: 'github.com/c/d' }] })])).toEqual([
      'github.com/a/b',
      'github.com/c/d',
    ])
    expect(themeFolderCandidates('github.com/user/theme', 'themes').map((c) => c.root)).toEqual(['themes/github.com/user/theme', '_vendor/github.com/user/theme', 'themes/theme'])
    expect(themeFolderCandidates('PaperMod', '../..')).toEqual([])
    expect(isModulePath('github.com/user/theme')).toBe(true)
    expect(isModulePath('PaperMod')).toBe(false)
  })

  it('compares versions and finds the site languages', () => {
    expect(versionAtLeast({ major: 0, minor: 167, patch: 0 }, '0.146.0')).toBe(true)
    expect(versionAtLeast({ major: 0, minor: 145, patch: 9 }, '0.146.0')).toBe(false)
    expect(versionAtLeast({ major: 0, minor: 146, patch: 0 }, 'v0.146')).toBe(true)
    expect(versionAtLeast(null, '0.1')).toBeNull()
    expect(siteLanguages([config('hugo.toml', { locale: 'tr-TR' })])).toEqual(['tr'])
    expect(siteLanguages([config('hugo.toml', { defaultContentLanguage: 'tr', languages: { en: {}, tr: {} } })])).toEqual(['tr', 'en'])
    expect(siteLanguages([config('hugo.toml', {})])).toEqual(['en'])
  })
})

describe('params ownership', () => {
  const root = config('hugo.toml', { title: 'x', params: { ShowToc: true, profileMode: { enabled: true } } })
  const split = config('config/_default/params.toml', { showreadingtime: false })
  const wrapped = config('config/_default/params.yaml', { params: { a: 1 } })

  it('lists sources low to high and picks the write target', () => {
    const sources = paramsSources([split, root])
    expect(sources.map((s) => [s.file, s.prefix])).toEqual([
      ['hugo.toml', ['params']],
      ['config/_default/params.toml', []],
    ])
    expect(defaultParamsTarget(sources)?.file).toBe('config/_default/params.toml')
    expect(defaultParamsTarget(paramsSources([root]))?.file).toBe('hugo.toml')
    expect(paramsSources([wrapped])[0].prefix).toEqual(['params'])
    expect(mergeParams(sources)).toEqual({ ShowToc: true, profileMode: { enabled: true }, showreadingtime: false })
  })

  it('keeps the file casing for existing keys and finds the owner case-insensitively', () => {
    const sources = paramsSources([split, root])
    const owner = ownerOf(sources, ['ShowReadingTime'])
    expect(owner?.source.file).toBe('config/_default/params.toml')
    expect(writePath(owner!.source, ['ShowReadingTime'])).toEqual(['showreadingtime'])
    expect(writePath(sources[0], ['profilemode', 'imageUrl'])).toEqual(['params', 'profileMode', 'imageUrl'])
    expect(ownerOf(sources, ['missing'])).toBeNull()
    expect(caseDuplicates({ ShowToc: 1, showtoc: 2, a: { X: 1, x: 2 } })).toEqual([['ShowToc', 'showtoc'], ['a.X', 'a.x']])
  })
})

describe('writing values', () => {
  it('applies the value rules', () => {
    expect(changeFor({ type: 'boolean', writeFalse: 'omit' }, false)).toEqual({ kind: 'remove' })
    expect(changeFor({ type: 'boolean', writeFalse: 'omit' }, true)).toEqual({ kind: 'set', value: true })
    expect(changeFor({ type: 'boolean' }, false)).toEqual({ kind: 'set', value: false })
    expect(changeFor({ type: 'stringOrList', stringOrList: true }, ['Ali'])).toEqual({ kind: 'set', value: 'Ali' })
    expect(changeFor({ type: 'stringOrList', stringOrList: true }, ['A', 'B'])).toEqual({ kind: 'set', value: ['A', 'B'] })
    expect(changeFor({ type: 'stringList' }, ['', ''])).toEqual({ kind: 'remove' })
    expect(changeFor({ type: 'string' }, '')).toEqual({ kind: 'remove' })
    expect(changeFor({ type: 'integer' }, '42')).toEqual({ kind: 'set', value: 42 })
    expect(changeFor({ type: 'integer' }, 'x')).toEqual({ kind: 'remove' })
  })

  it('edits TOML arrays of tables entry by entry', () => {
    const text = '[params]\n  [[params.socialIcons]]\n    name = "github"\n    url = "a"\n  [[params.socialIcons]]\n    name = "x"\n    url = "b"\n'
    expect(splitTomlKey('params."social icons".x')).toEqual(['params', 'social icons', 'x'])
    expect(isArrayOfTables(text, ['params', 'socialicons'])).toBe(true)
    expect(isArrayOfTables(text, ['params'])).toBe(false)
    const before = [
      { name: 'github', url: 'a' },
      { name: 'x', url: 'b' },
    ]
    expect(arrayOfTablesOps(['params', 'socialIcons'], before, [{ name: 'github', url: 'A', title: 'GH' }])).toEqual([
      { op: 'set', path: ['params', 'socialIcons', 0, 'url'], value: 'A' },
      { op: 'set', path: ['params', 'socialIcons', 0, 'title'], value: 'GH' },
      { op: 'remove', path: ['params', 'socialIcons', 1] },
    ])
    expect(arrayOfTablesOps(['p'], [{ a: 1 }], [{ a: 1 }, { a: 2 }])).toEqual([{ op: 'appendTable', path: ['p'], entries: { a: 2 } }])
    const file = { path: 'hugo.toml', format: 'toml' as const, text, values: { params: { socialIcons: before } } }
    const set = { op: 'set' as const, path: ['params', 'socialIcons'], value: [{ name: 'x', url: 'b' }] }
    expect(expandOps(file, [set])).toEqual([
      { op: 'set', path: ['params', 'socialIcons', 0, 'name'], value: 'x' },
      { op: 'set', path: ['params', 'socialIcons', 0, 'url'], value: 'b' },
      { op: 'remove', path: ['params', 'socialIcons', 1] },
    ])
    expect(expandOps({ ...file, format: 'yaml' }, [set])).toEqual([set])
    expect(expandOps({ ...file, text: '[params]\nsocialIcons = []\n' }, [set])).toEqual([set])
  })
})

describe('planFeature', () => {
  const ctx = (configs: ConfigFileData[], extra: Partial<FeatureContext> = {}): FeatureContext => ({
    configs,
    paramsSources: paramsSources(configs),
    contentDir: 'content',
    language: 'tr',
    existingLayouts: new Set(),
    existingFiles: new Set(),
    ...extra,
  })

  it('plans PaperMod search: JSON output, search page and an optional menu entry', () => {
    const configs = [config('hugo.toml', { outputs: { home: ['HTML', 'RSS', 'llms'] }, menu: { main: [{ name: 'Hakkında', url: '/hakkinda/' }] } })]
    const plan = planFeature(papermod['x-features']!.search, ctx(configs), { addMenu: true })
    expect(plan.enabled).toBe(false)
    expect(plan.configOps).toEqual({
      'hugo.toml': [
        { op: 'set', path: ['outputs', 'home'], value: ['HTML', 'RSS', 'llms', 'JSON'] },
        { op: 'appendTable', path: ['menu', 'main'], entries: { name: 'Ara', url: '/search/', weight: 90 } },
      ],
    })
    expect(plan.newFiles).toEqual([
      { path: 'content/search.md', text: '---\ntitle: Ara\nlayout: search\nplaceholder: ""\nsummary: search\n---\n' },
    ])
    const withoutMenu = planFeature(papermod['x-features']!.search, ctx(configs), { addMenu: false })
    expect(withoutMenu.configOps['hugo.toml']).toHaveLength(1)
  })

  it('uses Hugo defaults when outputs.home is unset and reports finished features', () => {
    const plan = planFeature(papermod['x-features']!.search, ctx([config('hugo.toml', {})]), { addMenu: false })
    expect(plan.configOps['hugo.toml']).toEqual([{ op: 'set', path: ['outputs', 'home'], value: ['HTML', 'RSS', 'JSON'] }])
    const done = planFeature(
      papermod['x-features']!.search,
      ctx([config('hugo.toml', { outputs: { home: ['html', 'json'] } })], { existingLayouts: new Set(['search']) }),
      { addMenu: false },
    )
    expect(done.enabled).toBe(true)
    expect(done.newFiles).toEqual([])
  })

  it('sets a param in the owning file (Blowfish search)', () => {
    const configs = [config('config/_default/params.toml', { enableSearch: false }), config('config/_default/hugo.toml', { outputs: { home: ['HTML', 'RSS', 'JSON'] } })]
    const plan = planFeature(blowfish['x-features']!.search, ctx(configs), { addMenu: false })
    expect(plan.configOps).toEqual({ 'config/_default/params.toml': [{ op: 'set', path: ['enableSearch'], value: true }] })
    expect(plan.steps.map((s) => s.state)).toEqual(['todo', 'done'])
  })
})
