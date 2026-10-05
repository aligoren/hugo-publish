import { describe, expect, it } from 'vitest'

import { emptyValue, imageFieldKeys, inferFieldKind, otherKeys } from './fieldKinds'

describe('inferFieldKind', () => {
  it.each([
    ['title', 'Merhaba', 'string'],
    ['body', 'satır 1\nsatır 2', 'text'],
    ['long', 'x'.repeat(120), 'text'],
    ['weight', 10, 'number'],
    ['ratio', 1.5, 'number'],
    ['toc', true, 'boolean'],
    ['published', '2026-10-03T00:11:40+03:00', 'date'],
    ['day', '2026-10-03', 'date'],
    ['series', ['ilk', 'ikinci'], 'stringList'],
    ['keywords', [], 'stringList'],
    ['images', ['/a.png'], 'imageList'],
    ['cover', '/kapak.png', 'image'],
    ['thumbnail', '', 'image'],
    ['featured_image', 'a.png', 'image'],
    ['cover', { image: '', alt: '', relative: false }, 'group'],
    ['params', { toc: true, keywords: ['a'] }, 'group'],
    ['params', { nested: { deep: 1 } }, 'snippet'],
    ['menu', [{ name: 'a' }], 'snippet'],
    ['numbers', [1, 2], 'snippet'],
    ['empty', {}, 'snippet'],
    ['nothing', null, 'empty'],
  ])('%s = %j → %s', (key, value, kind) => {
    expect(inferFieldKind(key, value)).toBe(kind)
  })
})

describe('otherKeys / imageFieldKeys', () => {
  const values = {
    title: 'x',
    Description: 'y',
    date: '2026-10-03',
    tags: [],
    series: ['a'],
    cover: { image: '', alt: '' },
    build: { list: 'never' },
    sitemap: { disable: true, priority: 0.5 },
    params: { toc: true },
    weight: 1,
  }

  it('leaves out keys with their own fields (any case), taxonomies and simple build options', () => {
    const images = imageFieldKeys(values)
    expect(images).toEqual(['cover'])
    expect(otherKeys(values, ['tags', 'series'], images)).toEqual(['sitemap', 'params'])
  })

  it('starts new fields empty', () => {
    expect(emptyValue('string')).toBe('')
    expect(emptyValue('number')).toBe(0)
    expect(emptyValue('boolean')).toBe(false)
    expect(emptyValue('stringList')).toEqual([])
  })
})
