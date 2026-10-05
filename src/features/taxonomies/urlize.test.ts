import { describe, expect, it } from 'vitest'

import { goToLower, removeAccents, sanitizePath, termSegment, termUrl } from './urlize'

const accents = { removePathAccents: true, disablePathToLower: false }

describe('sanitizePath (Hugo paths.Sanitize)', () => {
  it('turns runs of white space into one hyphen and drops other characters', () => {
    expect(sanitizePath('Vim (text editor)')).toBe('Vim-text-editor')
    expect(sanitizePath('a  \t b')).toBe('a-b')
    expect(sanitizePath('  leading and trailing  ')).toBe('leading-and-trailing')
    expect(sanitizePath('a - b')).toBe('a-b')
    expect(sanitizePath('C++ & Go!')).toBe('C++-Go')
    expect(sanitizePath('what?')).toBe('what')
  })

  it('keeps letters of every script, digits, marks and Hugo’s allowed punctuation', () => {
    expect(sanitizePath('Kitap Notları')).toBe('Kitap-Notları')
    expect(sanitizePath('قرآن كريم')).toBe('قرآن-كريم')
    expect(sanitizePath('a.b_c#d~e@f')).toBe('a.b_c#d~e@f')
    expect(sanitizePath('2024 özet')).toBe('2024-özet')
  })

  it('keeps percent escapes but drops a lone percent sign', () => {
    expect(sanitizePath('a%20b')).toBe('a%20b')
    expect(sanitizePath('100%')).toBe('100')
  })
})

describe('removeAccents and goToLower', () => {
  it('removes combining marks but keeps the dotless ı', () => {
    expect(removeAccents('Çiğdem şöyle ÜÖ')).toBe('Cigdem soyle UO')
    expect(removeAccents('İstanbul ılık')).toBe('Istanbul ılık')
    expect(removeAccents('café')).toBe('cafe')
  })

  it('lower-cases like Go: not Turkish aware, İ becomes a plain i', () => {
    expect(goToLower('IŞIK')).toBe('işik')
    expect(goToLower('İSTANBUL')).toBe('istanbul')
    expect(goToLower('ΟΔΟΣ')).toBe('οδοσ')
  })
})

describe('termSegment and termUrl', () => {
  it('lower-cases and hyphenates', () => {
    expect(termSegment('Kitap Notları')).toBe('kitap-notları')
    expect(termSegment('Kitap')).toBe(termSegment('kitap'))
    expect(termUrl('categories', 'Kitap Notları')).toBe('/categories/kitap-notları/')
  })

  it('applies removePathAccents when enabled', () => {
    expect(termSegment('Kitap Notları', accents)).toBe('kitap-notları')
    expect(termSegment('Çocuk Eğitimi', accents)).toBe('cocuk-egitimi')
    expect(termSegment('İslam', accents)).toBe('islam')
    expect(termSegment('Çocuk Eğitimi')).toBe('çocuk-eğitimi')
  })

  it('keeps the case with disablePathToLower', () => {
    expect(termSegment('Kitap Notu', { removePathAccents: false, disablePathToLower: true })).toBe('Kitap-Notu')
  })
})
