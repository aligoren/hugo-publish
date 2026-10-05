import { describe, expect, it } from 'vitest'

import { listMode, listOps, mergeOps, rowsOf, type ListRow } from './lists'
import { compareEntries, findMenus, menuOfPath, menuTree, moveEntry, newMenuTarget, nextWeight } from './menus'
import { sourcesOf } from './testing'
import { arrayOfTablesHeaders, isArrayOfTables, splitDottedKey, tomlDocument } from './toml'

const ROOT_TEXT = `[menu]
  [[menu.main]]
    name = "Home"
    url = "/"
    weight = 10
  [[menu.main]]
    name = "About"
    url = "/about/"
    weight = 20
`

function row(values: Record<string, unknown>, orig: number | null = null): ListRow {
  return { orig, values }
}

describe('finding menus', () => {
  it('collects menus from the alias, category files and languages, newest precedence last', () => {
    const sources = sourcesOf({
      'hugo.toml': {
        values: {
          menu: { main: [{ name: 'Home', url: '/' }], footer: [{ name: 'Imprint', url: '/imprint/' }] },
          languages: { tr: { menus: { main: [{ name: 'Ana sayfa', url: '/' }] } } },
        },
        text: ROOT_TEXT,
      },
      'config/_default/menus.toml': { main: [{ name: 'Start', url: '/' }] },
      'config/_default/menus.en.toml': { main: [{ name: 'Start (en)', url: '/' }] },
    })
    const menus = findMenus(sources, null)
    expect(menus.map((m) => [m.source.path, m.lang, m.name, m.filePath, m.overridden])).toEqual([
      ['hugo.toml', null, 'main', ['menu', 'main'], true],
      ['hugo.toml', null, 'footer', ['menu', 'footer'], false],
      ['hugo.toml', 'tr', 'main', ['languages', 'tr', 'menus', 'main'], false],
      ['config/_default/menus.en.toml', 'en', 'main', ['main'], false],
      ['config/_default/menus.toml', null, 'main', ['main'], false],
    ])
    expect(menus[0].mode).toBe('aot')
    expect(menus[1].mode).toBe('value')
  })

  it('detects arrays of tables in TOML text', () => {
    expect(arrayOfTablesHeaders(ROOT_TEXT)).toEqual([
      ['menu', 'main'],
      ['menu', 'main'],
    ])
    expect(isArrayOfTables(ROOT_TEXT, ['menu', 'main'])).toBe(true)
    expect(isArrayOfTables(ROOT_TEXT, ['menus', 'main'])).toBe(false)
    expect(splitDottedKey(` languages . "en-US".'menus' `)).toEqual(['languages', 'en-US', 'menus'])
  })

  it('maps list paths back to menus', () => {
    expect(menuOfPath(['menus', 'main'])).toEqual({ lang: null, name: 'main' })
    expect(menuOfPath(['languages', 'tr', 'menu', 'footer'])).toEqual({ lang: 'tr', name: 'footer' })
    expect(menuOfPath(['server', 'redirects'])).toBeNull()
  })

  it('puts a new menu next to the existing ones', () => {
    const sources = sourcesOf({ 'hugo.toml': { menu: { main: [] } } })
    expect(newMenuTarget(sources, null, null, 'footer')).toMatchObject({ source: { path: 'hugo.toml' }, filePath: ['menu', 'footer'] })
    const split = sourcesOf({ 'hugo.toml': {}, 'config/_default/menus.tr.toml': { main: [] } })
    expect(newMenuTarget(split, null, 'tr', 'footer')).toMatchObject({ source: { path: 'config/_default/menus.tr.toml' }, filePath: ['footer'] })
    expect(newMenuTarget(split, null, null, 'footer')).toMatchObject({ source: { path: 'hugo.toml' }, filePath: ['menus', 'footer'] })
  })
})

describe('menu entry ops', () => {
  const disk = [
    { name: 'Home', url: '/', weight: 10 },
    { name: 'About', url: '/about/', weight: 20 },
    { name: 'Blog', url: '/blog/', weight: 30 },
  ]

  it('edits entries in place by index, removes from the end, then appends', () => {
    const rows = rowsOf(disk)
    const next = [
      row({ ...disk[0], weight: 5 }, 0),
      // About (index 1) removed; Blog loses its url and gets a pageRef.
      row({ name: 'Blog', pageRef: '/blog', weight: 30 }, 2),
      row({ name: 'Contact', url: '/contact/', weight: 40, identifier: '' }),
    ]
    expect(rows).toHaveLength(3)
    expect(listOps({ file: 'hugo.toml', path: ['menu', 'main'], mode: 'aot', disk, rows: next })).toEqual([
      { op: 'set', path: ['menu', 'main', 0, 'weight'], value: 5 },
      { op: 'remove', path: ['menu', 'main', 2, 'url'] },
      { op: 'set', path: ['menu', 'main', 2, 'pageRef'], value: '/blog' },
      { op: 'remove', path: ['menu', 'main', 1] },
      { op: 'appendTable', path: ['menu', 'main'], entries: { name: 'Contact', url: '/contact/', weight: 40 } },
    ])
  })

  it('removes several entries from the highest index down', () => {
    const ops = listOps({ file: 'hugo.toml', path: ['menus', 'main'], mode: 'aot', disk, rows: [row(disk[1], 1)] })
    expect(ops).toEqual([
      { op: 'remove', path: ['menus', 'main', 2] },
      { op: 'remove', path: ['menus', 'main', 0] },
    ])
  })

  it('writes inline arrays and YAML lists whole, and a new TOML menu as [[entries]]', () => {
    const rows = [row(disk[0], 0), row({ name: 'New', url: '/new/', weight: 15 })]
    expect(listOps({ file: 'hugo.yaml', path: ['menus', 'main'], mode: 'value', disk: [disk[0]], rows })).toEqual([
      { op: 'set', path: ['menus', 'main'], value: [disk[0], { name: 'New', url: '/new/', weight: 15 }] },
    ])
    expect(listOps({ file: 'hugo.yaml', path: ['menus', 'main'], mode: 'value', disk: [disk[0]], rows: [row(disk[0], 0)] })).toEqual([])
    expect(listOps({ file: 'hugo.toml', path: ['menus', 'footer'], mode: 'append', disk: null, rows: [row({ name: 'Imprint', url: '/imprint/' })] })).toEqual([
      { op: 'appendTable', path: ['menus', 'footer'], entries: { name: 'Imprint', url: '/imprint/' } },
    ])
  })

  it('chooses the list mode from the file', () => {
    const [toml, yaml] = sourcesOf({ 'hugo.toml': { values: { menu: { main: disk } }, text: ROOT_TEXT }, 'config/_default/menus.yaml': {} })
    expect(listMode(toml, ['menu', 'main'], true)).toBe('aot')
    expect(listMode(toml, ['menu', 'footer'], false)).toBe('append')
    expect(listMode(yaml, ['main'], false)).toBe('value')
  })

  it('keeps field ops before list ops for the same file', () => {
    expect(
      mergeOps({ 'hugo.toml': [{ op: 'set', path: ['title'], value: 'x' }] }, { 'hugo.toml': [{ op: 'remove', path: ['menu', 'main', 0] }], 'a.toml': [] }),
    ).toEqual({
      'hugo.toml': [
        { op: 'set', path: ['title'], value: 'x' },
        { op: 'remove', path: ['menu', 'main', 0] },
      ],
    })
  })
})

describe('menu order', () => {
  it('sorts by weight with unweighted entries last, then by name', () => {
    const rows = [row({ name: 'B' }), row({ name: 'C', weight: 2 }), row({ name: 'A', weight: 2 }), row({ name: 'D', weight: 1 })]
    expect([...rows].sort(compareEntries).map((r) => r.values.name)).toEqual(['D', 'A', 'C', 'B'])
  })

  it('nests children under their parent', () => {
    const rows = rowsOf([
      { name: 'Docs', identifier: 'docs', weight: 20 },
      { name: 'Install', parent: 'docs', weight: 2 },
      { name: 'Home', weight: 10 },
      { name: 'Usage', parent: 'docs', weight: 1 },
    ])
    expect(menuTree(rows).map((n) => [n.row.values.name, n.depth, n.index])).toEqual([
      ['Home', 0, 2],
      ['Docs', 0, 0],
      ['Usage', 1, 3],
      ['Install', 1, 1],
    ])
  })

  it('moves an entry among its siblings and rewrites their weights to 10, 20, 30', () => {
    const rows = rowsOf([
      { name: 'Home', weight: 1 },
      { name: 'Docs', identifier: 'docs', weight: 5 },
      { name: 'Usage', parent: 'docs', weight: 1 },
      { name: 'About', weight: 9 },
    ])
    const moved = moveEntry(rows, 3, -1)
    expect(moved.map((r) => [r.values.name, r.values.weight])).toEqual([
      ['Home', 10],
      ['Docs', 30],
      ['Usage', 1],
      ['About', 20],
    ])
    expect(moved.map((r) => r.orig)).toEqual([0, 1, 2, 3])
    // Moving the first entry up changes nothing.
    expect(moveEntry(rows, 0, -1)).toEqual(rows)
    expect(listOps({ file: 'hugo.toml', path: ['menu', 'main'], mode: 'aot', disk: rows.map((r) => r.values), rows: moved })).toEqual([
      { op: 'set', path: ['menu', 'main', 0, 'weight'], value: 10 },
      { op: 'set', path: ['menu', 'main', 1, 'weight'], value: 30 },
      { op: 'set', path: ['menu', 'main', 3, 'weight'], value: 20 },
    ])
  })

  it('suggests the next weight', () => {
    expect(nextWeight([])).toBe(10)
    expect(nextWeight(rowsOf([{ weight: 10 }, { weight: 25 }]))).toBe(30)
  })
})

describe('new TOML files', () => {
  it('writes values, tables and arrays of tables', () => {
    expect(
      tomlDocument({ headers: [{ for: '/**', values: { 'X-Frame-Options': 'DENY', "it's": 'x' } }], disableLiveReload: false }, ['Preview server', '']),
    ).toBe(
      ['# Preview server', '#', 'disableLiveReload = false', '', '[[headers]]', "for = '/**'", '', '[headers.values]', "X-Frame-Options = 'DENY'", `"it's" = 'x'`, ''].join(
        '\n',
      ),
    )
    expect(tomlDocument({}, ['Only a comment'])).toBe('# Only a comment\n')
    expect(tomlDocument({ delimiters: { block: [['\\[', '\\]']] } })).toBe("[delimiters]\nblock = [['\\[', '\\]']]\n")
  })
})
