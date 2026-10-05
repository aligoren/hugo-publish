import { describe, expect, it } from 'vitest'

import { changedItems, dropItem, indentItem, itemTree, moveItem, newIdentifier, outdentItem, type MenuItem } from './menuEdit'

const items: MenuItem[] = [
  { id: 'c:0', values: { name: 'Home', url: '/', weight: 10 } },
  { id: 'c:1', values: { name: 'Docs', url: '/docs/', weight: 20 } },
  { id: 'c:2', values: { name: 'Install', url: '/docs/install/', parent: 'Docs', weight: 10 } },
  { id: 'p:content/about.md', values: {}, fallbackName: 'About Us', fallbackWeight: 30 },
]

function shape(list: readonly MenuItem[] | null) {
  return itemTree(list ?? []).map(({ item, depth }) => `${'  '.repeat(depth)}${String(item.values.name ?? item.fallbackName)}`)
}

function values(list: readonly MenuItem[] | null, id: string) {
  return list?.find((i) => i.id === id)?.values
}

describe('menu editing', () => {
  it('shows the tree in Hugo’s order, with page fallbacks', () => {
    expect(shape(items)).toEqual(['Home', 'Docs', '  Install', 'About Us'])
  })

  it('drops before and after a sibling and rewrites the weights', () => {
    const next = dropItem(items, 'p:content/about.md', 'c:0', 'before')
    expect(shape(next)).toEqual(['About Us', 'Home', 'Docs', '  Install'])
    expect(values(next, 'p:content/about.md')).toEqual({ weight: 10 })
    expect(values(next, 'c:1')).toMatchObject({ weight: 30 })
    expect(shape(dropItem(items, 'c:0', 'c:1', 'after'))).toEqual(['Docs', '  Install', 'Home', 'About Us'])
  })

  it('moves an entry into another one and gives the parent an identifier', () => {
    const next = dropItem(items, 'p:content/about.md', 'c:1', 'inside')
    expect(shape(next)).toEqual(['Home', 'Docs', '  Install', '  About Us'])
    expect(values(next, 'c:1')).toMatchObject({ identifier: 'docs' })
    // The existing child follows the new identifier.
    expect(values(next, 'c:2')).toMatchObject({ parent: 'docs' })
    expect(values(next, 'p:content/about.md')).toEqual({ parent: 'docs', weight: 20 })
  })

  it('moves a child back to the top level', () => {
    const next = dropItem(items, 'c:2', 'c:0', 'after')
    expect(shape(next)).toEqual(['Home', 'Install', 'Docs', 'About Us'])
    expect(values(next, 'c:2')).toEqual({ name: 'Install', url: '/docs/install/', weight: 20 })
  })

  it('refuses to drop an entry into itself or its children', () => {
    expect(dropItem(items, 'c:1', 'c:1', 'inside')).toBeNull()
    expect(dropItem(items, 'c:1', 'c:2', 'inside')).toBeNull()
  })

  it('offers keyboard moves: up, down, indent, outdent', () => {
    expect(shape(moveItem(items, 'c:1', -1))).toEqual(['Docs', '  Install', 'Home', 'About Us'])
    expect(moveItem(items, 'c:0', -1)).toBeNull()
    expect(shape(indentItem(items, 'p:content/about.md'))).toEqual(['Home', 'Docs', '  Install', '  About Us'])
    expect(indentItem(items, 'c:0')).toBeNull()
    expect(shape(outdentItem(items, 'c:2'))).toEqual(['Home', 'Docs', 'Install', 'About Us'])
    expect(outdentItem(items, 'c:0')).toBeNull()
  })

  it('makes unique identifiers and lists what changed', () => {
    const list: MenuItem[] = [
      { id: 'a', values: { name: 'Blog', identifier: 'blog' } },
      { id: 'b', values: { name: 'Blog' } },
    ]
    expect(newIdentifier(list, list[1])).toBe('blog-2')
    const next = moveItem(items, 'c:1', -1)!
    expect(changedItems(items, next).map((i) => i.id)).toEqual(['c:0', 'c:1', 'p:content/about.md'])
  })
})
