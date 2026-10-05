import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { additionOf, enableCommentedMenu, findCommentedMenus } from './commentedMenus'
import { sourceOf } from './testing'

const TEXT = [
  'title = "Site"',
  '',
  '[[menus.main]]',
  '  name = "Home"',
  '  url = "/"',
  '',
  '# [[menus.main]]',
  '#   name = "Tags"',
  "#   url = '/tags/'",
  '#   weight = 30 # after posts',
  '',
  '# A note that is not a menu.',
  '[params]',
  '  # [[languages.tr.menus.footer]]',
  '  #   name = "Hakkında"',
  'author = "x"',
  '',
].join('\r\n')

describe('commented-out menu entries', () => {
  const source = sourceOf('hugo.toml', {}, TEXT)

  it('finds blocks with their values and checks what follows them', () => {
    const found = findCommentedMenus(source)
    expect(found.map((e) => [e.lang, e.menu, e.start, e.end, e.safe])).toEqual([
      [null, 'main', 6, 10, true],
      ['tr', 'footer', 13, 15, false],
    ])
    expect(found[0].values).toEqual({ name: 'Tags', url: '/tags/', weight: 30 })
  })

  it('uncomments exactly the block and keeps every other byte', () => {
    const [entry] = findCommentedMenus(source)
    const after = enableCommentedMenu(TEXT, entry)
    const lines = after.split('\r\n')
    expect(lines.slice(6, 10)).toEqual(['[[menus.main]]', '  name = "Tags"', "  url = '/tags/'", '  weight = 30 # after posts'])
    expect(lines.filter((_, i) => i < 6 || i >= 10)).toEqual(TEXT.split('\r\n').filter((_, i) => i < 6 || i >= 10))
  })

  it('reads menus.toml category files and refuses a changed file', () => {
    const menus = sourceOf('config/_default/menus.toml', {}, '# [[main]]\n# name = "Blog"\n')
    const [entry] = findCommentedMenus(menus)
    expect([entry.menu, entry.safe]).toEqual(['main', true])
    expect(enableCommentedMenu('# [[main]]\n# name = "Blog"\n', entry)).toBe('[[main]]\nname = "Blog"\n')
    expect(() => enableCommentedMenu('# [[main]]\n# name = "Other"\n', entry)).toThrow()
  })

  it('ignores TOML tables in YAML files and commented tables that are not menus', () => {
    expect(findCommentedMenus(sourceOf('hugo.yaml', {}, '# [[menus.main]]\n# name = "x"\n'))).toEqual([])
    expect(findCommentedMenus(sourceOf('hugo.toml', {}, '# [[server.redirects]]\n# from = "/a"\n'))).toEqual([])
  })
})

describe('commented-out menu entries in YAML', () => {
  const YAML = [
    'title: Site',
    'menus:',
    '  main:',
    '    - name: Home',
    '      url: /',
    '#    - name: Tags',
    '#      url: /tags/',
    '#      weight: 30',
    '    # - name: About',
    '    #   pageRef: /about',
    '  # footer:',
    '  #   - name: Privacy',
    '  #     url: /privacy/',
    '  #   - name: Terms',
    '  #     url: /terms/',
    'params:',
    '  # - not: a menu',
    '  author: x',
    '',
  ].join('\r\n')
  const source = sourceOf('hugo.yaml', {}, YAML)

  it('finds entries of a menu and whole menus, with the marker style that keeps the indentation', () => {
    const found = findCommentedMenus(source)
    expect(found.map((e) => [e.menu, e.start, e.end, e.count, e.strip, e.safe])).toEqual([
      ['main', 5, 8, 1, 'hash', true],
      ['main', 8, 10, 1, 'hashSpace', true],
      ['footer', 10, 15, 2, 'hashSpace', true],
    ])
    expect(found[0].values).toEqual({ name: 'Tags', url: '/tags/', weight: 30 })
    expect(found[2].values).toEqual({ name: 'Privacy', url: '/privacy/' })
  })

  it('uncomments exactly the block, and the result reads as before plus the entry', () => {
    const [tags, , footer] = findCommentedMenus(source)
    const after = enableCommentedMenu(YAML, tags)
    expect(after.split('\r\n').slice(5, 8)).toEqual(['    - name: Tags', '      url: /tags/', '      weight: 30'])
    expect(after.split('\r\n').filter((_, i) => i < 5 || i >= 8)).toEqual(YAML.split('\r\n').filter((_, i) => i < 5 || i >= 8))
    expect(parse(after).menus.main).toHaveLength(2)
    expect(parse(enableCommentedMenu(YAML, footer)).menus.footer).toEqual([
      { name: 'Privacy', url: '/privacy/' },
      { name: 'Terms', url: '/terms/' },
    ])
  })

  it('reads menus.yaml and language menus', () => {
    const menus = sourceOf('config/_default/menus.tr.yaml', {}, 'main:\n  - name: Ana sayfa\n  # - name: Etiketler\n  #   url: /etiketler/\n')
    expect(findCommentedMenus(menus).map((e) => [e.lang, e.menu, e.safe])).toEqual([['tr', 'main', true]])
    const nested = sourceOf('hugo.yaml', {}, 'languages:\n  tr:\n    menus:\n      # main:\n      #   - name: Blog\n')
    expect(findCommentedMenus(nested).map((e) => [e.lang, e.menu, e.safe])).toEqual([['tr', 'main', true]])
  })

  it('refuses blocks that would not read as entries where they are', () => {
    // The commented item is indented less than the list it belongs to.
    const text = 'menus:\n  main:\n    - name: Home\n#   - name: Odd\n#     url: /odd/\n'
    const [entry] = findCommentedMenus(sourceOf('hugo.yaml', {}, text))
    expect([entry.menu, entry.safe]).toEqual(['main', false])
    expect(findCommentedMenus(sourceOf('hugo.yaml', {}, 'params:\n  list:\n    - a\n#    - b\n'))).toEqual([])
    expect(findCommentedMenus(sourceOf('hugo.yaml', {}, 'menus: [\n# - name: x\n'))).toEqual([])
  })
})

describe('additionOf', () => {
  it('finds list items added in one place and nothing else', () => {
    expect(additionOf({ a: [1, 2] }, { a: [1, 3, 2] })).toEqual({ path: ['a'], added: [3] })
    expect(additionOf({ m: null }, { m: { main: [{ name: 'x' }] } })).toEqual({ path: ['m', 'main'], added: [{ name: 'x' }] })
    expect(additionOf({ a: [1], b: 1 }, { a: [1, 2], b: 2 })).toBe('other')
    expect(additionOf({ a: 1 }, { a: 1 })).toBeNull()
  })
})
