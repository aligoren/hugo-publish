import { describe, expect, it } from 'vitest'

import { commentedTomlKeys, commentedYamlKeys, extractOptions, parseComment, parseTomlValue } from './comments'

describe('parseComment', () => {
  it('reads trailing "valid options" comments (Blowfish)', () => {
    expect(parseComment('valid options: light or dark')).toMatchObject({ options: ['light', 'dark'] })
    expect(parseComment('valid options: basic, fixed, fixed-fill, fixed-gradient, fixed-fill-blur, floating').options).toEqual([
      'basic',
      'fixed',
      'fixed-fill',
      'fixed-gradient',
      'fixed-fill-blur',
      'floating',
    ])
    expect(parseComment('Valid values are "sha512" (default), "sha384", "sha256"')).toMatchObject({
      options: ['sha512', 'sha384', 'sha256'],
      default: 'sha512',
    })
    expect(parseComment('disable to use native scrollbar style (defaults to true)').default).toBe(true)
    expect(parseComment('Controls the fallback order. Valid values are "summary", "description", and "site".').options).toEqual([
      'summary',
      'description',
      'site',
    ])
  })

  it('reads leading comments with accepted values and colon lists (Stack)', () => {
    expect(parseComment('Accepted values: "default", "lastmod"\ndefault = see https://gohugo.io/x\nlastmod = sort by date')).toMatchObject({
      options: ['default', 'lastmod'],
      docLink: 'https://gohugo.io/x',
    })
    expect(parseComment('Visual style: classic or handDrawn (sketch style)').options).toEqual(['classic', 'handDrawn'])
    expect(parseComment('Security level: strict (default), loose, antiscript, sandbox\nSet to "loose" to enable HTML labels')).toMatchObject({
      options: ['strict', 'loose', 'antiscript', 'sandbox'],
      default: 'strict',
    })
    expect(parseComment('Make diagram backgrounds transparent (default: false)').default).toBe(false)
  })

  it('reads the structured Hugo Book convention', () => {
    const info = parseComment(
      '(Optional, default light) Sets color theme: light, dark or auto.\nTheme \'auto\' switches between dark and light modes',
    )
    expect(info).toMatchObject({ optional: true, default: 'light', options: ['light', 'dark', 'auto'] })
    expect(info.description).toBe("Sets color theme: light, dark or auto. Theme 'auto' switches between dark and light modes")
    const toc = parseComment('(Optional, default true) Controls table of contents.\nYou can also specify this parameter per page in front matter.')
    expect(toc).toMatchObject({ optional: true, default: true, pageOverridable: true })
    expect(parseComment("(Optional, default 'January 2, 2006') Configure the date format").default).toBe('January 2, 2006')
    expect(parseComment('(Optional, default none) Set the path to a logo.').default).toBeUndefined()
    expect(parseComment('(Optional, experimental, default false)\nPossible values are false | \'warning\' | \'error\'')).toMatchObject({
      experimental: true,
      default: false,
      options: [false, 'warning', 'error'],
    })
    expect(parseComment('Can be overwritten by same param in page frontmatter').pageOverridable).toBe(true)
  })

  it('reads bare lists and ignores prose', () => {
    expect(extractOptions('debug, info, warning, error')?.values).toEqual(['debug', 'info', 'warning', 'error'])
    expect(extractOptions('options: left, center, right')?.values).toEqual(['left', 'center', 'right'])
    expect(extractOptions('These options control how the theme functions and allow you to')).toBeNull()
    expect(extractOptions('Refer to the docs\nhttps://blowfish.page/docs/configuration/#theme-parameters')).toBeNull()
    expect(extractOptions('Showing article tags in the list view (e.g. homepage, section pages)')).toBeNull()
  })
})

describe('commentedTomlKeys', () => {
  it('finds commented-out keys with their table, value and comments', () => {
    const text = [
      'colorScheme = "blowfish"',
      '# enableStyledScrollbar = true # disable to use native scrollbar style (defaults to true)',
      '',
      '# mainSections = ["section1", "section2"]',
      '[header]',
      '  layout = "basic" # valid options: basic, fixed',
      '  # mobileMenuStyle = "fullscreen" # valid options: fullscreen, dropdown',
      '[buymeacoffee]',
      '  # globalWidgetColor = "#FFDD00"',
      '[ananke.social.follow]',
      '# add networks to this list in your local config to enable them.',
      '# networks = [',
      '#   "facebook",',
      '#   "bluesky"',
      '# ]',
      '# [[params.extra]]',
      '#   name = "x"',
    ].join('\r\n')
    const keys = commentedTomlKeys(text)
    expect(keys.map((k) => k.path.join('.'))).toEqual([
      'enableStyledScrollbar',
      'mainSections',
      'header.mobileMenuStyle',
      'buymeacoffee.globalWidgetColor',
      'ananke.social.follow.networks',
      'params.extra.name',
    ])
    expect(keys[0]).toMatchObject({ value: true, comment: 'disable to use native scrollbar style (defaults to true)', line: 2 })
    expect(keys[1].value).toEqual(['section1', 'section2'])
    expect(keys[3].value).toBe('#FFDD00')
    expect(keys[4]).toMatchObject({ value: ['facebook', 'bluesky'], comment: 'add networks to this list in your local config to enable them.' })
  })
})

describe('commentedYamlKeys', () => {
  it('uses the indentation of # to find the parent', () => {
    const text = ['params:', '  # ShowToc: true', '  profileMode:', '    enabled: false', '    # title: "Hi"', '# top: 1'].join('\n')
    expect(commentedYamlKeys(text).map((k) => [k.path.join('.'), k.value])).toEqual([
      ['params.ShowToc', true],
      ['params.profileMode.title', 'Hi'],
      ['top', 1],
    ])
  })
})

describe('parseTomlValue', () => {
  it('reads strings, numbers, booleans, arrays and inline tables', () => {
    expect(parseTomlValue('"a # b"')).toBe('a # b')
    expect(parseTomlValue("'x'")).toBe('x')
    expect(parseTomlValue('1_000')).toBe(1000)
    expect(parseTomlValue('[1, "two", false]')).toEqual([1, 'two', false])
    expect(parseTomlValue('{ primaryColor = "#ff0000", n = 2 }')).toEqual({ primaryColor: '#ff0000', n: 2 })
    expect(parseTomlValue('"unterminated')).toBe('unterminated')
    expect(parseTomlValue('[1, 2')).toBeUndefined()
  })
})
