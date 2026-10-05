import { describe, expect, it } from 'vitest'

import { gitError } from './gitErrors'
import {
  changeGroup,
  commitPaths,
  displayName,
  groupChanges,
  isNoreplyEmail,
  isPagePath,
  toChangeItems,
} from './groups'
import { gitFile } from './testing'

describe('changeGroup', () => {
  it('sorts paths into human groups', () => {
    const cases: [string, string][] = [
      ['content/posts/a.md', 'content'],
      ['content/hakkında.md', 'content'],
      ['content/posts/gezi/index.md', 'content'],
      ['content/posts/gezi/data.json', 'content'],
      ['content/posts/gezi/kapak.jpg', 'media'],
      ['hugo.toml', 'settings'],
      ['config.yaml', 'settings'],
      ['config/_default/params.toml', 'settings'],
      ['themes/PaperMod/layouts/x.html', 'theme'],
      ['themes/PaperMod/images/screenshot.png', 'theme'],
      ['layouts/partials/head.html', 'theme'],
      ['assets/css/extended/x.css', 'theme'],
      ['assets/images/logo.png', 'theme'],
      ['i18n/tr.yaml', 'theme'],
      ['archetypes/posts.md', 'theme'],
      ['static/favicon.ico', 'media'],
      ['static/robots.txt', 'media'],
      ['images/x.webp', 'media'],
      ['README.md', 'other'],
      ['.github/workflows/deploy.yml', 'other'],
      ['data/kitaplar.yaml', 'other'],
    ]
    for (const [path, group] of cases) expect(changeGroup(path), path).toBe(group)
  })

  it('knows pages from posts', () => {
    expect(isPagePath('content/hakkında.md')).toBe(true)
    expect(isPagePath('content/hakkında/index.md')).toBe(true)
    expect(isPagePath('content/posts/_index.md')).toBe(true)
    expect(isPagePath('content/posts/a.md')).toBe(false)
    expect(isPagePath('content/posts/a/index.md')).toBe(false)
  })

  it('names title-less files by their file or bundle name', () => {
    expect(displayName('content/posts/ilk-yazı.md')).toBe('ilk-yazı')
    expect(displayName('content/posts/gezi/index.md')).toBe('gezi')
    expect(displayName('static/logo.png')).toBe('logo.png')
  })
})

describe('groupChanges', () => {
  it('groups in a fixed order with titles from the content list', () => {
    const files = [
      gitFile('static/a.png', 'untracked'),
      gitFile('hugo.toml'),
      gitFile('content/posts/b.md'),
      gitFile('content/posts/a.md', 'untracked'),
      gitFile('content/posts/silinen.md', 'deleted'),
    ]
    const items = toChangeItems(files, [
      { path: 'content/posts/a.md', title: 'Ağaç', modifiedMs: 0 },
      { path: 'content/posts/b.md', title: '  ', modifiedMs: 0 },
    ])
    const grouped = groupChanges(items)
    expect(grouped.map((g) => g.group)).toEqual(['content', 'settings', 'media'])
    expect(grouped[0].items.map((i) => [i.file.path, i.title, i.action])).toEqual([
      ['content/posts/a.md', 'Ağaç', 'added'],
      ['content/posts/b.md', null, 'updated'],
      ['content/posts/silinen.md', null, 'deleted'],
    ])
  })

  it('commits renames with their old path', () => {
    expect(commitPaths([gitFile('b.md', 'renamed', 'a.md'), gitFile('c.md'), gitFile('a.md')])).toEqual(['b.md', 'a.md', 'c.md'])
  })
})

describe('isNoreplyEmail', () => {
  it('recognizes noreply addresses', () => {
    expect(isNoreplyEmail('123+ali@users.noreply.github.com')).toBe(true)
    expect(isNoreplyEmail('ALI@USERS.NOREPLY.GITHUB.COM ')).toBe(true)
    expect(isNoreplyEmail('x@users.noreply.gitlab.com')).toBe(true)
    expect(isNoreplyEmail('ali@example.com')).toBe(false)
    expect(isNoreplyEmail('noreply.github.com@evil.example')).toBe(false)
    expect(isNoreplyEmail(null)).toBe(false)
  })
})

describe('gitError', () => {
  it('reads the code from the message today, and from a dedicated code later', () => {
    expect(gitError({ code: 'invalid', message: 'git_conflict: CONFLICT (content)\nmore' })).toEqual({
      code: 'git_conflict',
      detail: 'CONFLICT (content)\nmore',
    })
    expect(gitError({ code: 'git_rejected', message: 'git_rejected: ! [rejected]' })).toEqual({
      code: 'git_rejected',
      detail: '! [rejected]',
    })
    expect(gitError({ code: 'invalid', message: 'git_made_up: x' })).toBeNull()
    expect(gitError({ code: 'invalid', message: 'something else' })).toBeNull()
    expect(gitError(new Error('x'))).toBeNull()
  })
})
