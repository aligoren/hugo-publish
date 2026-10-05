import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { checkSplit, planSplit } from './splitConfig'

const TOML = [
  '# Site config',
  'baseURL = "https://example.org/"',
  'title = "Example"',
  '',
  '# Theme settings',
  '[params]',
  '  author = "Someone" # inline note',
  '  [params.social]',
  '    github = "someone"',
  '',
  '[markup.goldmark.renderer]',
  '  unsafe = false',
  '',
  '[menu]',
  '  [[menu.main]]',
  '    name = "Home"',
  '    url = "/"',
  '',
  '# [[menu.main]]',
  '#   name = "Tags"',
  '#   url = "/tags/"',
  '',
  '[author]',
  '  name = "Old"',
  '',
  '[params.extra]',
  '  tags = [',
  '    "[not a header]",',
  '  ]',
  '',
].join('\r\n')

describe('splitting a TOML config', () => {
  const plan = planSplit('hugo.toml', TOML, 'toml')!

  it('moves each category into its own file and strips the first key of its headers', () => {
    expect(plan.movedTo).toBe('config/_default/hugo.toml')
    expect(plan.files.map((f) => f.path)).toEqual(['config/_default/params.toml', 'config/_default/markup.toml', 'config/_default/menus.toml'])
    expect(plan.files[0].text).toBe(
      ['# Theme settings', '  author = "Someone" # inline note', '  [social]', '    github = "someone"', '', '[extra]', '  tags = [', '    "[not a header]",', '  ]', ''].join('\r\n'),
    )
    expect(plan.files[1].text).toBe(['[goldmark.renderer]', '  unsafe = false', ''].join('\r\n'))
    expect(plan.files[2].text).toBe(['  [[main]]', '    name = "Home"', '    url = "/"', '', '# [[main]]', '#   name = "Tags"', '#   url = "/tags/"', ''].join('\r\n'))
  })

  it('keeps root keys, the file header and unknown tables in the remainder', () => {
    expect(plan.remainder).toBe(['# Site config', 'baseURL = "https://example.org/"', 'title = "Example"', '', '[author]', '  name = "Old"', ''].join('\r\n'))
  })

  it('returns null when there is nothing to move', () => {
    expect(planSplit('hugo.toml', 'title = "x"\n', 'toml')).toBeNull()
    expect(planSplit('hugo.json', '{}', 'json')).toBeNull()
  })

  it('keeps keys that follow a commented header in their table', () => {
    const text = '[params]\n  a = 1\n# [[menus.main]]\n  b = 2\n'
    const split = planSplit('hugo.toml', text, 'toml')!
    expect(split.files.map((f) => [f.path, f.text])).toEqual([['config/_default/params.toml', '  a = 1\n# [[menus.main]]\n  b = 2\n']])
  })
})

describe('splitting a YAML config', () => {
  const YAML = [
    'baseURL: https://example.org/',
    '# Menus',
    'menus:',
    '  main:',
    '    - name: Home # first',
    '      url: /',
    'params:',
    '  description: |',
    '    Line one',
    '      indented',
    '  # a comment',
    'mainSections:',
    '- posts',
    'outputs: {home: [HTML]}',
    '',
  ].join('\n')

  it('de-indents each category and checks the result', () => {
    const plan = planSplit('hugo.yaml', YAML, 'yaml')!
    expect(plan.files.map((f) => f.path)).toEqual(['config/_default/menus.yaml', 'config/_default/params.yaml'])
    expect(plan.files[0].text).toBe('# Menus\nmain:\n  - name: Home # first\n    url: /\n')
    expect(plan.files[1].text).toBe('description: |\n  Line one\n    indented\n# a comment\n')
    // Inline values and plain keys stay.
    expect(plan.remainder).toBe('baseURL: https://example.org/\n\nmainSections:\n- posts\noutputs: {home: [HTML]}\n')

    const original = parse(YAML) as Record<string, unknown>
    const parsed = {
      remainder: parse(plan.remainder) as Record<string, unknown>,
      files: plan.files.map((f) => ({ category: f.category, values: parse(f.text) as Record<string, unknown> })),
    }
    expect(checkSplit(original, parsed)).toEqual([])
  })
})

describe('checkSplit', () => {
  it('notices lost values and files Hugo would unwrap', () => {
    expect(checkSplit({ params: { a: 1 }, title: 'x' }, { remainder: { title: 'x' }, files: [{ category: 'params', values: { a: 2 } }] })).toEqual(['different values'])
    expect(checkSplit({ params: { params: { a: 1 } } }, { remainder: {}, files: [{ category: 'params', values: { params: { a: 1 } } }] })).toEqual(['params: wrapped'])
    expect(checkSplit({ menu: { main: [] } }, { remainder: {}, files: [{ category: 'menus', values: { main: [] } }] })).toEqual([])
  })
})
