import { describe, expect, it } from 'vitest'

import { effectiveValueAt } from '../../config-edit'
import { columnCasing, editOps, resetOps } from './edits'
import { resolveKey } from './owner'
import { classifyConfigPath, discoverSources, environmentsOf, globalTree, layerFor, stackFor, toGlobalPath } from './sources'
import { sourcesOf } from './testing'
import { applyOps, lookup, subtreeOps, writePath } from './values'

describe('config file discovery', () => {
  it('classifies root, category, language and environment files', () => {
    expect(classifyConfigPath('hugo.toml')).toMatchObject({ layer: 'root', kind: 'root', editable: true })
    expect(classifyConfigPath('config.yaml')).toMatchObject({ layer: 'root', kind: 'root', format: 'yaml' })
    expect(classifyConfigPath('hugo.json')).toMatchObject({ kind: 'root', editable: false })
    expect(classifyConfigPath('config/_default/markup.toml')).toMatchObject({ layer: 'default', kind: 'category', category: 'markup' })
    expect(classifyConfigPath('config/_default/menus.tr.toml')).toMatchObject({ category: 'menus', lang: 'tr' })
    expect(classifyConfigPath('config/_default/menu.toml')).toMatchObject({ category: 'menus', baseName: 'menu' })
    expect(classifyConfigPath('config/_default/httpcache.toml')).toMatchObject({ category: 'HTTPCache' })
    expect(classifyConfigPath('config/_default/nested/params.yml')).toMatchObject({ category: 'params', format: 'yaml' })
    expect(classifyConfigPath('config/production/hugo.toml')).toMatchObject({ layer: 'env', env: 'production', kind: 'root' })
    expect(classifyConfigPath('config/hugo.toml')).toBeNull()
    expect(classifyConfigPath('README.md')).toBeNull()
    expect(classifyConfigPath('theme.toml')).toBeNull()
  })

  it('orders sources by precedence and loads only the first root file', () => {
    const sources = discoverSources(
      ['config.toml', 'hugo.toml'],
      ['config/production/hugo.toml', 'config/_default/params.toml', 'config/_default/markup.toml', 'config/development/server.toml'],
    )
    expect(sources.map((s) => [s.path, s.active])).toEqual([
      ['hugo.toml', true],
      ['config.toml', false],
      ['config/_default/markup.toml', true],
      ['config/_default/params.toml', true],
      ['config/development/server.toml', true],
      ['config/production/hugo.toml', true],
    ])
    expect(environmentsOf(sources)).toEqual(['development', 'production'])
    expect(stackFor(sources, 'production').map((s) => s.path)).toEqual([
      'hugo.toml',
      'config/_default/markup.toml',
      'config/_default/params.toml',
      'config/production/hugo.toml',
    ])
    expect(layerFor(sources, null).map((s) => s.path)).toEqual(['hugo.toml', 'config/_default/markup.toml', 'config/_default/params.toml'])
    expect(layerFor(sources, 'development').map((s) => s.path)).toEqual(['config/development/server.toml'])
  })

  it('detects category files wrapped under their own key', () => {
    const [wrapped, unwrapped, twoKeys] = sourcesOf({
      'config/_default/markup.toml': { Markup: { highlight: { style: 'vim' } } },
      'config/_default/params.toml': { markup: 'not a wrapper' },
      'config/_default/privacy.toml': { privacy: { x: {} }, youTube: {} },
    })
    expect(wrapped.wrapperKey).toBe('Markup')
    expect(globalTree(wrapped)).toEqual({ markup: { highlight: { style: 'vim' } } })
    expect(unwrapped.wrapperKey).toBeNull()
    expect(globalTree(unwrapped)).toEqual({ params: { markup: 'not a wrapper' } })
    expect(twoKeys.wrapperKey).toBeNull()
    expect(toGlobalPath(wrapped, ['Markup', 'highlight'])).toEqual(['markup', 'highlight'])
  })
})

describe('key owner resolution', () => {
  it('finds a key in the root file, in any casing', () => {
    const sources = sourcesOf({ 'hugo.toml': { baseurl: 'https://a.example/', Title: 'A' } })
    const r = resolveKey(sources, null, ['baseURL'])
    expect(r.owner?.source.path).toBe('hugo.toml')
    expect(r.owner?.value).toBe('https://a.example/')
    expect(r.target).toMatchObject({ filePath: ['baseurl'] })
    expect(resolveKey(sources, null, ['title']).target?.filePath).toEqual(['Title'])
  })

  it('lets config/_default win over the root file and reports both', () => {
    const sources = sourcesOf({
      'hugo.toml': { markup: { highlight: { style: 'monokai' } } },
      'config/_default/markup.toml': { highlight: { style: 'dracula' } },
    })
    const r = resolveKey(sources, null, ['markup', 'highlight', 'style'])
    expect(r.owner?.source.path).toBe('config/_default/markup.toml')
    expect(r.owner?.value).toBe('dracula')
    expect(r.layerLocations.map((l) => l.source.path)).toEqual(['hugo.toml', 'config/_default/markup.toml'])
    expect(r.target).toMatchObject({ filePath: ['highlight', 'style'] })
  })

  it('writes a new key to its category file, wrapped or not, else to the root file', () => {
    const unwrapped = sourcesOf({ 'hugo.toml': { title: 'x' }, 'config/_default/markup.toml': { goldmark: {} } })
    const a = resolveKey(unwrapped, null, ['markup', 'highlight', 'style'])
    expect(a.owner).toBeNull()
    expect(a.target?.source.path).toBe('config/_default/markup.toml')
    expect(a.target?.filePath).toEqual(['highlight', 'style'])

    const wrapped = sourcesOf({ 'hugo.toml': {}, 'config/_default/markup.toml': { MARKUP: { goldmark: {} } } })
    expect(resolveKey(wrapped, null, ['markup', 'highlight', 'style']).target?.filePath).toEqual(['MARKUP', 'highlight', 'style'])

    const rootOnly = sourcesOf({ 'hugo.toml': { Markup: { Highlight: { noClasses: true } } } })
    const c = resolveKey(rootOnly, null, ['markup', 'highlight', 'style'])
    expect(c.target?.source.path).toBe('hugo.toml')
    // Existing tables keep the file's casing; the new key uses the documented one.
    expect(c.target?.filePath).toEqual(['Markup', 'Highlight', 'style'])

    const splitOnly = sourcesOf({ 'config/_default/hugo.toml': { title: 'x' }, 'config/_default/params.toml': {} })
    expect(resolveKey(splitOnly, null, ['baseURL']).target).toMatchObject({ source: { path: 'config/_default/hugo.toml' }, filePath: ['baseURL'] })
  })

  it('maps language suffix files to languages.<lang>.<category>', () => {
    const sources = sourcesOf({
      'hugo.toml': { languages: { tr: { label: 'Türkçe' } } },
      'config/_default/menus.tr.toml': { main: [{ name: 'Ana sayfa', url: '/' }] },
    })
    const r = resolveKey(sources, null, ['languages', 'tr', 'menus', 'main'])
    expect(r.owner?.source.path).toBe('config/_default/menus.tr.toml')
    expect(r.owner?.filePath).toEqual(['main'])
    // A new menu of that language goes to the same file.
    expect(resolveKey(sources, null, ['languages', 'tr', 'menus', 'footer']).target?.filePath).toEqual(['footer'])
    // Other languages' keys don't belong there.
    expect(resolveKey(sources, null, ['languages', 'en', 'menus', 'main']).target?.source.path).toBe('hugo.toml')
  })

  it('reads the menu alias as menus', () => {
    const sources = sourcesOf({ 'hugo.toml': { menu: { main: [{ name: 'About', url: '/about/' }] } } })
    const r = resolveKey(sources, null, ['menus', 'main'])
    expect(r.owner?.actual).toEqual(['menu', 'main'])
    expect(r.target?.filePath).toEqual(['menu', 'main'])
  })

  it('handles environment overlays', () => {
    const sources = sourcesOf({
      'hugo.toml': { baseURL: 'https://example.com/', title: 'Site' },
      'config/production/hugo.toml': { baseURL: 'https://www.example.com/' },
      'config/development/server.toml': { headers: [] },
    })
    const base = resolveKey(sources, null, ['baseURL'])
    expect(base.owner?.source.path).toBe('hugo.toml')
    expect(base.overriddenIn.map((l) => l.source.path)).toEqual(['config/production/hugo.toml'])

    const production = resolveKey(sources, 'production', ['baseURL'])
    expect(production.owner?.value).toBe('https://www.example.com/')
    expect(production.target?.source.path).toBe('config/production/hugo.toml')

    // A key only set in the base files is inherited; an override goes to the environment file.
    const title = resolveKey(sources, 'production', ['title'])
    expect(title.owner?.source.path).toBe('hugo.toml')
    expect(title.layerLocations).toEqual([])
    expect(title.target).toMatchObject({ source: { path: 'config/production/hugo.toml' }, filePath: ['title'] })

    // development has a server.toml but no root file.
    expect(resolveKey(sources, 'development', ['server', 'redirects']).target).toMatchObject({
      source: { path: 'config/development/server.toml' },
      filePath: ['redirects'],
    })
    expect(resolveKey(sources, 'development', ['title']).target).toBeNull()
    expect(resolveKey(sources, 'staging', ['title']).target).toBeNull()
  })

  it('does not write to JSON files', () => {
    const sources = sourcesOf({ 'hugo.json': { title: 'From JSON' } })
    const r = resolveKey(sources, null, ['title'])
    expect(r.owner?.value).toBe('From JSON')
    expect(r.target).toBeNull()
    expect(resolveKey(sources, null, ['copyright']).target).toBeNull()
  })

  it('resolves against pending values when asked', () => {
    const sources = sourcesOf({ 'hugo.toml': { title: 'Old' } })
    const pending = applyOps(sources[0].values, [{ op: 'remove', path: ['title'] }])
    expect(resolveKey(sources, null, ['title'], () => pending).owner).toBeNull()
  })
})

describe('effective values and lookups', () => {
  it('reads hugo config output, which lower-cases every key', () => {
    const effective = {
      baseurl: 'https://example.com/',
      languages: { 'en-us': { label: 'English' } },
      markup: { highlight: { hl_lines: '2-3', noclasses: false } },
    }
    expect(effectiveValueAt(effective, ['baseURL'])).toBe('https://example.com/')
    expect(effectiveValueAt(effective, ['languages', 'en-US', 'label'])).toBe('English')
    expect(effectiveValueAt(effective, ['markup', 'highlight', 'hl_Lines'])).toBe('2-3')
    expect(effectiveValueAt(effective, ['markup', 'highlight', 'noClasses'])).toBe(false)
  })

  it('looks keys up in any casing and keeps the file casing for writes', () => {
    const tree = { Params: { ShowToc: true }, menu: { main: [{ Name: 'x' }] } }
    expect(lookup(tree, ['params', 'showtoc'])).toEqual({ value: true, actual: ['Params', 'ShowToc'] })
    expect(lookup(tree, ['menus', 'main', 0, 'name'])).toEqual({ value: 'x', actual: ['menu', 'main', 0, 'Name'] })
    expect(writePath(tree, ['params', 'newKey'])).toEqual(['Params', 'newKey'])
    expect(lookup(tree, ['menus', 'main', 3])).toBeNull()
  })
})

describe('ops for edits and resets', () => {
  it('applies ops like the file editors do', () => {
    const values = { a: { b: 1 }, list: [{ x: 1 }, { x: 2 }] }
    expect(
      applyOps(values, [
        { op: 'set', path: ['a', 'c', 'd'], value: true },
        { op: 'remove', path: ['list', 0] },
        { op: 'set', path: ['list', 0, 'x'], value: 3 },
        { op: 'appendTable', path: ['list'], entries: { x: 4 } },
      ]),
    ).toEqual({ a: { b: 1, c: { d: true } }, list: [{ x: 3 }, { x: 4 }] })
    expect(values.list).toHaveLength(2)
  })

  it('diffs maps key by key and sets everything else whole', () => {
    expect(subtreeOps(['taxonomies'], { tag: 'tags', category: 'categories' }, { tag: 'tags', series: 'series' })).toEqual([
      { op: 'remove', path: ['taxonomies', 'category'] },
      { op: 'set', path: ['taxonomies', 'series'], value: 'series' },
    ])
    expect(subtreeOps(['outputFormats', 'llms'], undefined, { baseName: 'llms', isPlainText: true })).toEqual([
      { op: 'set', path: ['outputFormats', 'llms', 'baseName'], value: 'llms' },
      { op: 'set', path: ['outputFormats', 'llms', 'isPlainText'], value: true },
    ])
    expect(subtreeOps(['theme'], ['a'], ['a', 'b'])).toEqual([{ op: 'set', path: ['theme'], value: ['a', 'b'] }])
    expect(subtreeOps(['x'], 1, 1)).toEqual([])
    expect(subtreeOps(['x'], 1, undefined)).toEqual([{ op: 'remove', path: ['x'] }])
  })

  it('sets a value in the target and leaves files alone when the inherited value is chosen again', () => {
    const sources = sourcesOf({ 'hugo.toml': { title: 'Site' } })
    const r = resolveKey(sources, null, ['enableEmoji'])
    expect(editOps(r, true, false)).toEqual({ file: 'hugo.toml', base: ['enableEmoji'], ops: [{ op: 'set', path: ['enableEmoji'], value: true }] })
    expect(editOps(r, false, false)?.ops).toEqual([])
  })

  it('copies rows Hugo printed in the documented casing, without zero values', () => {
    const columns = [
      { key: 'name', type: 'text' as const },
      { key: 'toLower', type: 'toggle' as const },
      { key: 'cardinalityThreshold', type: 'number' as const },
      { key: 'weight', type: 'number' as const },
    ]
    expect(columnCasing({ name: 'tags', tolower: false, cardinalitythreshold: 0, weight: 80, pattern: '' }, columns)).toEqual({ name: 'tags', weight: 80 })
  })

  it('never produces an op without a path for a whole unwrapped category', () => {
    const sources = sourcesOf({ 'hugo.toml': {}, 'config/_default/taxonomies.toml': {} })
    const r = resolveKey(sources, null, ['taxonomies'])
    expect(r.target?.filePath).toEqual([])
    expect(editOps(r, {}, { tag: 'tags' })?.ops).toEqual([])
    expect(editOps(r, { series: 'series' }, { tag: 'tags' })?.ops).toEqual([{ op: 'set', path: ['series'], value: 'series' }])
  })

  it('resets by removing the key from every edited file, a whole unwrapped category key by key', () => {
    const sources = sourcesOf({
      'hugo.toml': { taxonomies: { tag: 'tags' } },
      'config/_default/taxonomies.toml': { tag: 'tags', series: 'series' },
      'config/production/hugo.toml': { taxonomies: { tag: 'tags' } },
    })
    expect(resetOps(resolveKey(sources, null, ['taxonomies'])).map((f) => [f.file, f.ops])).toEqual([
      ['hugo.toml', [{ op: 'remove', path: ['taxonomies'] }]],
      [
        'config/_default/taxonomies.toml',
        [
          { op: 'remove', path: ['tag'] },
          { op: 'remove', path: ['series'] },
        ],
      ],
    ])
    expect(resetOps(resolveKey(sources, 'production', ['taxonomies'])).map((f) => f.file)).toEqual(['config/production/hugo.toml'])
  })
})
