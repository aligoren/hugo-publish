import { describe, expect, it } from 'vitest'

import { addPageMenuOps, fileLanguage, pageMenuEntries, removePageMenuOps, setPageMenuOps } from './pageMenus'

describe('page menus in front matter', () => {
  it('reads the string, list and map forms and the menu alias', () => {
    expect(pageMenuEntries('a.md', { menus: 'main' })).toEqual([{ file: 'a.md', menu: 'main', key: 'menus', form: 'string', values: {}, allMenus: ['main'] }])
    expect(pageMenuEntries('a.md', { menu: ['main', 'footer'] }).map((e) => [e.key, e.menu, e.form])).toEqual([
      ['menu', 'main', 'list'],
      ['menu', 'footer', 'list'],
    ])
    expect(pageMenuEntries('a.md', { Menus: { main: { weight: 5, parent: 'docs' }, footer: null } }).map((e) => [e.menu, e.values])).toEqual([
      ['main', { weight: 5, parent: 'docs' }],
      ['footer', {}],
    ])
    expect(pageMenuEntries('a.md', { title: 'x' })).toEqual([])
    expect(pageMenuEntries('a.md', null)).toEqual([])
  })

  it('changes only the fields that differ in the map form', () => {
    const [entry] = pageMenuEntries('a.md', { menus: { main: { weight: 5, parent: 'docs', params: { icon: 'x' } } } })
    expect(setPageMenuOps(entry, { weight: 20, parent: undefined })).toEqual([
      { op: 'remove', path: ['menus', 'main', 'parent'] },
      { op: 'set', path: ['menus', 'main', 'weight'], value: 20 },
    ])
    expect(setPageMenuOps(entry, { weight: 5, parent: 'docs' })).toEqual([])
  })

  it('keeps an empty map when the last field goes', () => {
    const [entry] = pageMenuEntries('a.md', { menus: { main: { weight: 5 } } })
    expect(setPageMenuOps(entry, {})).toEqual([{ op: 'set', path: ['menus', 'main'], value: {} }])
  })

  it('switches the string and list forms to a map only when a field is written', () => {
    const [single] = pageMenuEntries('a.md', { menu: 'main' })
    expect(setPageMenuOps(single, {})).toEqual([])
    expect(setPageMenuOps(single, { weight: 10 })).toEqual([{ op: 'set', path: ['menu'], value: { main: { weight: 10 } } }])
    const [, footer] = pageMenuEntries('a.md', { menus: ['main', 'footer'] })
    expect(setPageMenuOps(footer, { weight: 30 })).toEqual([{ op: 'set', path: ['menus'], value: { main: {}, footer: { weight: 30 } } }])
  })

  it('adds a page to a menu in the form it already uses', () => {
    expect(addPageMenuOps({ title: 'x' }, 'main')).toEqual([{ op: 'set', path: ['menus'], value: 'main' }])
    expect(addPageMenuOps({ title: 'x' }, 'main', { weight: 40 })).toEqual([{ op: 'set', path: ['menus', 'main'], value: { weight: 40 } }])
    expect(addPageMenuOps({ menu: 'main' }, 'footer')).toEqual([{ op: 'set', path: ['menu'], value: ['main', 'footer'] }])
    expect(addPageMenuOps({ menus: { main: {} } }, 'footer', { weight: 10 })).toEqual([{ op: 'set', path: ['menus', 'footer'], value: { weight: 10 } }])
    expect(addPageMenuOps({ menus: 'main' }, 'main')).toEqual([])
  })

  it('removes a page from a menu', () => {
    expect(removePageMenuOps(pageMenuEntries('a.md', { menus: 'main' })[0])).toEqual([{ op: 'remove', path: ['menus'] }])
    expect(removePageMenuOps(pageMenuEntries('a.md', { menus: ['main', 'footer'] })[0])).toEqual([{ op: 'set', path: ['menus'], value: 'footer' }])
    expect(removePageMenuOps(pageMenuEntries('a.md', { menus: { main: {}, footer: {} } })[1])).toEqual([{ op: 'remove', path: ['menus', 'footer'] }])
  })

  it('reads the language from the file name', () => {
    expect(fileLanguage('content/about.tr.md', ['en', 'tr'])).toBe('tr')
    expect(fileLanguage('content/about.md', ['en', 'tr'])).toBeNull()
    expect(fileLanguage('content/v1.2.md', ['en'])).toBeNull()
    expect(fileLanguage('content/about._language_tr_.md', ['en', 'tr'])).toBe('tr')
    expect(fileLanguage('content/about._role_member_.md', ['en', 'tr'])).toBeNull()
  })
})
