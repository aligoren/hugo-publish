import { describe, expect, it } from 'vitest'

import { editDistance, findNearDuplicates, pluralStems, turkishLower, typoThreshold, type TermCount } from './duplicates'
import { termSegment } from './urlize'

const terms = (...names: (string | [string, number])[]): TermCount[] =>
  names.map((n) => (Array.isArray(n) ? { name: n[0], count: n[1] } : { name: n, count: 1 }))

const groupsOf = (input: TermCount[]) => findNearDuplicates(input).map((g) => g.terms)

describe('helpers', () => {
  it('lower-cases with Turkish rules', () => {
    expect(turkishLower('KİTAP')).toBe('kitap')
    expect(turkishLower('IŞIK')).toBe('ışık')
    expect(turkishLower(' Kitap ')).toBe('kitap')
  })

  it('computes edit distance with swaps and a bound', () => {
    expect(editDistance('kitap', 'kitap')).toBe(0)
    expect(editDistance('kitap', 'ktiap')).toBe(1)
    expect(editDistance('kitap', 'kitab')).toBe(1)
    expect(editDistance('kitap', 'kit')).toBe(2)
    expect(editDistance('programlama', 'xxxxxxxxxxx', 2)).toBe(3)
    expect(editDistance('abc', 'abcdef', 1)).toBe(2)
  })

  it('allows more typos for longer terms', () => {
    expect(typoThreshold(4)).toBe(0)
    expect(typoThreshold(5)).toBe(1)
    expect(typoThreshold(7)).toBe(2)
  })

  it('finds plural stems', () => {
    expect(pluralStems('etiketler')).toContain('etiket')
    expect(pluralStems('kitaplar')).toContain('kitap')
    expect(pluralStems('evler')).toContain('ev')
    expect(pluralStems('books')).toContain('book')
    expect(pluralStems('boxes')).toContain('box')
    expect(pluralStems('bus')).toEqual([])
  })
})

describe('findNearDuplicates', () => {
  it('groups terms equal ignoring Turkish case and suggests the most used one', () => {
    const [group] = findNearDuplicates(terms(['Kitap', 1], ['kitap', 5], ['KİTAP', 2]))
    expect(group.terms).toEqual(['kitap', 'KİTAP', 'Kitap'])
    expect(group.suggested).toBe('kitap')
    expect(group.reasons).toContain('case')
  })

  it('knows that I and İ are different letters in Turkish', () => {
    expect(findNearDuplicates(terms('İstanbul', 'istanbul'))[0].reasons).toContain('case')
    // ISIK lower-cases to ısık in Turkish: not the same as ışık by case, but by letters.
    const [group] = findNearDuplicates(terms('ISIK', 'ışık'))
    expect(group.terms.sort()).toEqual(['ISIK', 'ışık'].sort())
    expect(group.reasons).toEqual(['accents'])
  })

  it('also matches English words with a capital I', () => {
    expect(findNearDuplicates(terms('Ideas', 'ideas'))[0].reasons).toEqual(['case'])
  })

  it('finds terms equal after removing accents', () => {
    const [group] = findNearDuplicates(terms('Çocuk Eğitimi', 'cocuk egitimi'))
    expect(group.reasons).toEqual(['accents'])
  })

  it('finds singular and plural forms', () => {
    expect(groupsOf(terms(['etiket', 3], 'etiketler'))).toEqual([['etiket', 'etiketler']])
    expect(groupsOf(terms('kitaplar', ['kitap', 2]))).toEqual([['kitap', 'kitaplar']])
    expect(groupsOf(terms('book', 'Books'))).toEqual([['book', 'Books']])
    expect(findNearDuplicates(terms('etiket', 'etiketler'))[0].reasons).toEqual(['plural'])
  })

  it('finds small typos in longer terms only', () => {
    expect(groupsOf(terms('programlama', 'proramlama'))).toHaveLength(1)
    expect(findNearDuplicates(terms('programlama', 'porgramlamaa'))[0].reasons).toEqual(['typo'])
    expect(groupsOf(terms('kitap', 'kitab'))).toHaveLength(1)
    expect(groupsOf(terms('kedi', 'kedu'))).toEqual([])
    expect(groupsOf(terms('felsefe', 'tarih'))).toEqual([])
  })

  it('does not treat numbered terms as typos', () => {
    expect(groupsOf(terms('python2', 'python3'))).toEqual([])
    expect(groupsOf(terms('özet 2023', 'özet 2024'))).toEqual([])
  })

  it('reports when Hugo already shows terms on one page', () => {
    const input = ['Kitap Notu', 'kitap notu'].map((name) => ({ name, count: 1, segment: termSegment(name) }))
    expect(findNearDuplicates(input)[0].reasons).toEqual(['sameUrl', 'case'])
  })

  it('ignores scripts slugify cannot handle instead of grouping them all', () => {
    expect(groupsOf(terms('قرآن', 'حديث', 'تفسير'))).toEqual([])
    expect(groupsOf(terms('قرآن', 'قرآن '))).toHaveLength(1)
  })

  it('orders groups by use and keeps unrelated terms out', () => {
    const groups = findNearDuplicates(terms(['roman', 1], ['Roman', 1], ['kitap', 4], ['Kitap', 2], ['felsefe', 9]))
    expect(groups.map((g) => g.suggested)).toEqual(['kitap', 'roman'])
  })

  it('skips the typo check for very many terms', () => {
    expect(findNearDuplicates(terms('programlama', 'proramlama'), { maxTermsForTypos: 1 })).toEqual([])
  })
})
