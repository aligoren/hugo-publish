import { describe, expect, it } from 'vitest'

import { slugify } from './slug'

describe('slugify', () => {
  it.each([
    ['Gündem Yazısı', 'gundem-yazisi'],
    ['IŞIK ve İnsan', 'isik-ve-insan'],
    ['Çağdaş Şiir: Öykü & Üslup', 'cagdas-siir-oyku-uslup'],
    ['İstanbul’un Hâli', 'istanbulun-hali'],
    ['Café crème', 'cafe-creme'],
    ['  --Merhaba,   Dünya!--  ', 'merhaba-dunya'],
    ['2026 Notları', '2026-notlari'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })
})
