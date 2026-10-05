import { describe, expect, it } from 'vitest'

import { fold, rank, score } from './match'

describe('palette matching', () => {
  it('folds Turkish letters and diacritics', () => {
    expect(fold('İSTANBUL Işık Çağ Gümüş')).toBe('istanbul isik cag gumus')
  })

  it('needs every word, in any order', () => {
    expect(score('Site ayarları', 'ayar site')).not.toBeNull()
    expect(score('Site ayarları', 'ayar tema')).toBeNull()
    expect(score('Anything', '')).toBe(0)
  })

  it('ranks word-start matches above inner matches', () => {
    const items = ['Medyaya git', 'Yeni yazı', 'Önizlemeyi başlat']
    expect(rank(items, 'yaz', (s) => s)[0]).toBe('Yeni yazı')
    expect(rank(items, 'onizleme', (s) => s)).toEqual(['Önizlemeyi başlat'])
  })

  it('keeps the original order for equal scores and respects the limit', () => {
    const items = ['a one', 'a two', 'a three']
    expect(rank(items, 'a', (s) => s, 2)).toEqual(['a one', 'a two'])
  })
})
