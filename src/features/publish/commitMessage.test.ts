import { describe, expect, it } from 'vitest'

import i18n from '../../i18n'
import { suggestCommitMessage, type Translate } from './commitMessage'
import { toChangeItems } from './groups'
import { gitFile } from './testing'

const tr: Translate = (key, options) => i18n.getFixedT('tr')(key, options)
const en: Translate = (key, options) => i18n.getFixedT('en')(key, options)

const titles = [
  { path: 'content/posts/ilk.md', title: 'İlk yazı', modifiedMs: 0 },
  { path: 'content/posts/iki.md', title: 'İkinci yazı', modifiedMs: 0 },
  { path: 'content/hakkında.md', title: 'Hakkında', modifiedMs: 0 },
]

function suggest(files: ReturnType<typeof gitFile>[], language: 'tr' | 'en') {
  return suggestCommitMessage(toChangeItems(files, titles), language === 'tr' ? tr : en, language)
}

describe('suggestCommitMessage', () => {
  it('names a single post with its title', () => {
    expect(suggest([gitFile('content/posts/ilk.md', 'untracked')], 'tr')).toBe('Yazı eklendi: İlk yazı')
    expect(suggest([gitFile('content/posts/ilk.md', 'untracked')], 'en')).toBe('Add post: İlk yazı')
    expect(suggest([gitFile('content/posts/ilk.md')], 'tr')).toBe('Yazı güncellendi: İlk yazı')
    expect(suggest([gitFile('content/posts/eski-yazi.md', 'deleted')], 'tr')).toBe('Yazı silindi: eski-yazi')
    expect(suggest([gitFile('content/hakkında.md')], 'tr')).toBe('Sayfa güncellendi: Hakkında')
    expect(suggest([gitFile('content/hakkında.md')], 'en')).toBe('Update page: Hakkında')
  })

  it('treats renames as updates', () => {
    expect(suggest([gitFile('content/posts/ilk.md', 'renamed', 'content/posts/first.md')], 'en')).toBe('Update post: İlk yazı')
  })

  it('names settings, theme, media and other changes', () => {
    expect(suggest([gitFile('hugo.toml')], 'tr')).toBe('Site ayarları güncellendi')
    expect(suggest([gitFile('hugo.toml')], 'en')).toBe('Update site settings')
    expect(suggest([gitFile('layouts/partials/x.html')], 'tr')).toBe('Tema ve şablonlar güncellendi')
    expect(suggest([gitFile('static/a.png', 'untracked')], 'tr')).toBe('1 görsel eklendi')
    expect(suggest([gitFile('static/a.png', 'untracked')], 'en')).toBe('Add an image')
    expect(suggest([gitFile('static/a.png', 'untracked'), gitFile('static/b.jpg', 'added')], 'en')).toBe('Add 2 images')
    expect(suggest([gitFile('static/a.pdf', 'deleted')], 'tr')).toBe('1 dosya silindi')
    expect(suggest([gitFile('static/a.png', 'deleted'), gitFile('static/b.png')], 'tr')).toBe('Medya dosyaları güncellendi')
    expect(suggest([gitFile('README.md')], 'en')).toBe('Update other files')
  })

  it('combines parts, lowercasing all but the first', () => {
    const files = [
      gitFile('content/posts/ilk.md', 'untracked'),
      gitFile('content/posts/ilk/kapak.jpg', 'untracked'),
      gitFile('hugo.toml'),
    ]
    expect(suggest(files, 'tr')).toBe('Yazı eklendi: İlk yazı; 1 görsel eklendi; site ayarları güncellendi')
    expect(suggest(files, 'en')).toBe('Add post: İlk yazı; add an image; update site settings')
  })

  it('counts several posts and lists them in the body', () => {
    const files = [
      gitFile('content/posts/ilk.md', 'untracked'),
      gitFile('content/posts/iki.md', 'untracked'),
      gitFile('content/posts/gezi/index.md'),
      gitFile('content/posts/silinen.md', 'deleted'),
    ]
    expect(suggest(files, 'tr')).toBe(
      [
        '2 yazı eklendi; yazı güncellendi: gezi; yazı silindi: silinen',
        '',
        '- Eklendi: İlk yazı',
        '- Eklendi: İkinci yazı',
        '- Güncellendi: gezi',
        '- Silindi: silinen',
      ].join('\n'),
    )
    expect(suggest(files.slice(0, 2), 'en')).toBe('Add 2 posts\n\n- Added: İlk yazı\n- Added: İkinci yazı')
  })

  it('suggests nothing for nothing', () => {
    expect(suggest([], 'tr')).toBe('')
  })
})
