import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api', () => ({ api: {} }))

import { canSplit, rootFilesInTheWay, splitChanges, splitValidationFiles, verifySplit } from './splitApply'
import { checkSplit, jsonMembers, planSplit } from './splitConfig'
import { sourceOf, sourcesOf } from './testing'

const JSON_TEXT = [
  '{',
  '  "baseURL": "https://example.org/",',
  '  "params": {',
  '    "author": "x",',
  '    "ratio": 1.50,',
  '    "zz": true,',
  '    "aa": "\\u00e7"',
  '  },',
  '  "menu": {',
  '    "main": [',
  '      { "name": "Home", "url": "/" }',
  '    ]',
  '  },',
  '  "cascade": [{ "params": { "a": 1 } }],',
  '  "title": "Example"',
  '}',
  '',
].join('\r\n')

describe('splitting a JSON config', () => {
  const plan = planSplit('hugo.json', JSON_TEXT, 'json')!

  it('moves each map category into its own file as written, one level to the left', () => {
    expect(plan.format).toBe('json')
    expect(plan.movedTo).toBe('config/_default/hugo.json')
    expect(plan.files.map((f) => f.path)).toEqual(['config/_default/params.json', 'config/_default/menus.json'])
    // Key order, number formatting and escapes are kept.
    expect(plan.files[0].text).toBe(['{', '  "author": "x",', '  "ratio": 1.50,', '  "zz": true,', '  "aa": "\\u00e7"', '}', ''].join('\r\n'))
    expect(plan.files[1].text).toBe(['{', '  "main": [', '    { "name": "Home", "url": "/" }', '  ]', '}', ''].join('\r\n'))
  })

  it('keeps root keys and lists in the remainder', () => {
    expect(plan.remainder).toBe(['{', '  "baseURL": "https://example.org/",', '  "cascade": [{ "params": { "a": 1 } }],', '  "title": "Example"', '}', ''].join('\r\n'))
    const parsed = { remainder: JSON.parse(plan.remainder), files: plan.files.map((f) => ({ category: f.category, values: JSON.parse(f.text) })) }
    expect(checkSplit(JSON.parse(JSON_TEXT), parsed)).toEqual([])
  })

  it('follows tab and compact styles', () => {
    const tabs = planSplit('hugo.json', '{\n\t"title": "x",\n\t"params": {\n\t\t"a": 1\n\t}\n}\n', 'json')!
    expect(tabs.files[0].text).toBe('{\n\t"a": 1\n}\n')
    expect(tabs.remainder).toBe('{\n\t"title": "x"\n}\n')
    const compact = planSplit('hugo.json', '{"title":"x","params":{"a":1}}', 'json')!
    expect([compact.files[0].text, compact.remainder]).toEqual(['{"a":1}', '{"title":"x"}'])
    expect(planSplit('hugo.json', '{"params":{"a":1}}', 'json')!.remainder).toBe('{}')
  })

  it('leaves files it cannot split safely', () => {
    expect(planSplit('hugo.json', '{"title": "x"}', 'json')).toBeNull()
    expect(planSplit('hugo.json', '{"params": {"params": {"a": 1}}}', 'json')).toBeNull()
    expect(planSplit('hugo.json', '{"params": {"a": 1},}', 'json')).toBeNull()
    expect(planSplit('hugo.json', '[1]', 'json')).toBeNull()
    expect(jsonMembers('{"a": "}", "b": [1, {"c": "]"}]}')?.map((m) => m.key)).toEqual(['a', 'b'])
    expect(jsonMembers('{}')).toEqual([])
  })
})

describe('applying a split', () => {
  const deps = {
    readText: async () => ({ text: JSON_TEXT, version: 'v1' }),
    tomlParseText: async () => ({ values: {} }),
  }

  it('creates the category files, then moves the root file, and checks the JSON result', async () => {
    const root = sourceOf('hugo.json', JSON.parse(JSON_TEXT), JSON_TEXT)
    const changes = await splitChanges(root, deps)
    expect(changes.map((c) => [c.path, c.version, c.moveTo])).toEqual([
      ['config/_default/params.json', '', undefined],
      ['config/_default/menus.json', '', undefined],
      ['hugo.json', 'v1', 'config/_default/hugo.json'],
    ])
    expect(await verifySplit(root, changes, deps)).toEqual([])
    expect(splitValidationFiles(changes)).toEqual([
      { path: 'config/_default/params.json', text: changes[0].after },
      { path: 'config/_default/menus.json', text: changes[1].after },
      { path: 'hugo.json', text: null },
      { path: 'config/_default/hugo.json', text: changes[2].after },
    ])
  })

  it('offers the split for JSON and names root files that would take over', () => {
    const sources = sourcesOf({ 'hugo.json': { values: JSON.parse(JSON_TEXT), text: JSON_TEXT }, 'config.toml': { values: {}, text: '' } })
    expect(canSplit(sources)).toBe(true)
    expect(rootFilesInTheWay(sources, sources[0])).toEqual(['config.toml'])
    expect(canSplit(sourcesOf({ 'hugo.json': { values: {}, text: '{"title": "x"}' } }))).toBe(false)
  })
})
