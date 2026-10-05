import { describe, expect, it } from 'vitest'

import {
  applyManagedBlock,
  BLOCK_END,
  BLOCK_START,
  detectDarkSelector,
  fromHex,
  generateOverrideFile,
  GENERATED_HEADER,
  kindOf,
  parseCssVariables,
  readOverrides,
  toHex,
} from './css'

const PAPERMOD_VARS = `:root {
    --gap: 24px;
    --main-width: 720px;
    --theme: rgb(255, 255, 255);
    --primary: rgb(30, 30, 30);
    color-scheme: light;
}

:root[data-theme="dark"] {
    --theme: rgb(29, 30, 32);
    --primary: rgb(218, 218, 219);
    color-scheme: dark;
}

.list {
    background: var(--code-bg);
}`

const ZMEDIA = `@media screen and (max-width: 768px) {
    /* theme-vars */
    :root {
        --gap: 14px;
    }
    .profile img { transform: scale(0.85); }
}`

describe('parseCssVariables', () => {
  it('reads light, dark and responsive values (PaperMod)', () => {
    const vars = parseCssVariables([
      { path: 'assets/css/core/theme-vars.css', text: PAPERMOD_VARS },
      { path: 'assets/css/core/zmedia.css', text: ZMEDIA },
    ])
    expect(vars.map((v) => v.name)).toEqual(['--gap', '--main-width', '--theme', '--primary'])
    expect(vars.find((v) => v.name === '--theme')).toMatchObject({
      light: 'rgb(255, 255, 255)',
      dark: 'rgb(29, 30, 32)',
      kind: 'color',
      file: 'assets/css/core/theme-vars.css',
    })
    expect(vars.find((v) => v.name === '--gap')).toMatchObject({
      light: '24px',
      kind: 'length',
      responsive: [{ media: 'screen and (max-width: 768px)', value: '14px' }],
    })
  })

  it('understands .dark, prefers-color-scheme, data-scheme, RGB triplets and SCSS', () => {
    const vars = parseCssVariables([
      { path: 'a.css', text: ':root{--color-primary-500: 59, 130, 246; --bg:#fff}\n.dark{--bg:#111}\n@media (prefers-color-scheme: dark){:root{--fg: #eee}}' },
      { path: 'b.scss', text: '// a comment {\n:root {\n  --card: #{$x};\n  --accent: hsl(210, 50%, 40%);\n  &[data-scheme="dark"] { --accent: #123456; }\n}\n' },
      { path: 'c.css', text: 'a { --not-root: red } @font-face { src: url(//cdn/x.woff) }' },
    ])
    const byName = Object.fromEntries(vars.map((v) => [v.name, v]))
    expect(byName['--color-primary-500']).toMatchObject({ light: '59, 130, 246', kind: 'triplet' })
    expect(byName['--bg']).toMatchObject({ light: '#fff', dark: '#111' })
    expect(byName['--fg']).toMatchObject({ dark: '#eee' })
    expect(byName['--card']).toBeUndefined()
    expect(byName['--accent']).toMatchObject({ light: 'hsl(210, 50%, 40%)', dark: '#123456' })
    expect(byName['--not-root']).toBeUndefined()
  })

  it('detects the dark selector', () => {
    expect(detectDarkSelector([{ path: 'x.css', text: PAPERMOD_VARS }])).toBe(':root[data-theme="dark"]')
    expect(detectDarkSelector([{ path: 'x.css', text: '@media (prefers-color-scheme: dark) { :root { --a: #000 } }' }])).toBe(
      '@media (prefers-color-scheme: dark)',
    )
    expect(detectDarkSelector([{ path: 'x.css', text: 'html.dark { --a: #000 }' }])).toBe('html.dark')
  })
})

describe('colours', () => {
  it('classifies and converts values for the colour picker', () => {
    expect(kindOf('rgb(1, 2, 3)')).toBe('color')
    expect(kindOf('1.5rem')).toBe('length')
    expect(kindOf('var(--x)')).toBe('other')
    expect(toHex('rgb(30, 30, 30)')).toBe('#1e1e1e')
    expect(toHex('#abc')).toBe('#aabbcc')
    expect(toHex('59, 130, 246')).toBe('#3b82f6')
    expect(toHex('hsl(0, 100%, 50%)')).toBe('#ff0000')
    expect(toHex('white')).toBe('#ffffff')
    expect(toHex('var(--x)')).toBeNull()
    expect(fromHex('#142850', 'rgb(30, 30, 30)')).toBe('rgb(20, 40, 80)')
    expect(fromHex('#142850', 'rgba(30, 30, 30, 0.5)')).toBe('rgba(20, 40, 80, 0.5)')
    expect(fromHex('#142850', '59, 130, 246')).toBe('20, 40, 80')
    expect(fromHex('#142850', '59 130 246')).toBe('20 40 80')
    expect(fromHex('#142850', '#fff')).toBe('#142850')
  })
})

describe('override file', () => {
  const themeVars = parseCssVariables([
    { path: 'assets/css/core/theme-vars.css', text: PAPERMOD_VARS },
    { path: 'assets/css/core/zmedia.css', text: ZMEDIA },
  ])

  it('generates the app-owned file with a header, dark rules and repeated media values', () => {
    const text = generateOverrideFile(
      { light: { '--primary': 'rgb(20, 40, 80)', '--gap': '30px' }, dark: { '--primary': 'rgb(210, 220, 240)' } },
      ':root[data-theme="dark"]',
      themeVars,
    )
    expect(text).toBe(
      [
        GENERATED_HEADER,
        ':root {',
        '  --primary: rgb(20, 40, 80);',
        '  --gap: 30px;',
        '}',
        ':root[data-theme="dark"] {',
        '  --primary: rgb(210, 220, 240);',
        '}',
        "/* Repeats the theme's value for this screen size, which the rule above would otherwise replace. */",
        '@media screen and (max-width: 768px) {',
        '  :root {',
        '    --gap: 14px;',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
    expect(readOverrides(text, ':root[data-theme="dark"]')).toEqual({
      light: { '--primary': 'rgb(20, 40, 80)', '--gap': '30px' },
      dark: { '--primary': 'rgb(210, 220, 240)' },
    })
  })

  it('uses a media query for prefers-color-scheme themes', () => {
    const text = generateOverrideFile({ light: {}, dark: { '--bg': '#000' } }, '@media (prefers-color-scheme: dark)')
    expect(text).toContain('@media (prefers-color-scheme: dark) {\n  :root {\n    --bg: #000;\n  }\n}')
    expect(readOverrides(text, '@media (prefers-color-scheme: dark)').dark).toEqual({ '--bg': '#000' })
  })

  it('manages a marked block inside a user file, keeping the rest', () => {
    const user = '.mine { color: red; }\r\n'
    const added = applyManagedBlock(user, { light: { '--a': '#111111' }, dark: {} }, '.dark')
    expect(added).toBe(`.mine { color: red; }\r\n\r\n${BLOCK_START}\r\n:root {\r\n  --a: #111111;\r\n}\r\n${BLOCK_END}\r\n`)
    const updated = applyManagedBlock(added, { light: { '--a': '#222222' }, dark: {} }, '.dark')
    expect(updated).toContain('--a: #222222;')
    expect(updated.startsWith('.mine')).toBe(true)
    expect(readOverrides(updated, '.dark').light).toEqual({ '--a': '#222222' })
    expect(applyManagedBlock(updated, { light: {}, dark: {} }, '.dark')).toBe('.mine { color: red; }\r\n')
    expect(applyManagedBlock(null, { light: { '--a': '#1' }, dark: {} }, '.dark').startsWith(BLOCK_START)).toBe(true)
    expect(readOverrides('.x { --a: red }', '.dark')).toEqual({ light: {}, dark: {} })
  })
})
