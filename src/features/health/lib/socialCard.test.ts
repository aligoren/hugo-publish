import { describe, expect, it } from 'vitest'

import type { PageMeta } from './html'
import { cardHints, cardInfo, truncate, xCard } from './socialCard'

function meta(partial: Partial<PageMeta> = {}): PageMeta {
  return { title: null, description: null, canonical: null, robots: null, lang: null, og: {}, twitter: {}, ...partial }
}

describe('cardInfo', () => {
  it('falls back from og to twitter to the plain tags', () => {
    const info = cardInfo(
      meta({ title: 'Sayfa', description: 'Açıklama', twitter: { image: 'https://example.org/x.png', card: 'summary' } }),
      'https://www.example.org/a/',
    )
    expect(info).toMatchObject({
      title: 'Sayfa',
      description: 'Açıklama',
      image: 'https://example.org/x.png',
      domain: 'example.org',
      url: 'https://www.example.org/a/',
      twitterCard: 'summary',
      siteName: null,
    })
    const og = cardInfo(meta({ title: 'T', og: { title: 'OG', url: 'https://site.org/p/', site_name: 'Site' } }), 'https://x.org/')
    expect(og).toMatchObject({ title: 'OG', domain: 'site.org', siteName: 'Site' })
  })

  it('prefers twitter tags for the X card', () => {
    const m = meta({ og: { title: 'OG', image: 'https://a/og.png' }, twitter: { title: 'X', card: 'summary_large_image' } })
    expect(xCard(m, cardInfo(m, 'https://a/'))).toEqual({ title: 'X', description: '', image: 'https://a/og.png', large: true })
  })
})

describe('cardHints', () => {
  it('reports missing tags', () => {
    expect(cardHints(meta()).map((h) => h.key)).toEqual([
      'noTitle',
      'noDescription',
      'noOgTitle',
      'noOgDescription',
      'noImage',
      'noTwitterCard',
      'noSiteName',
    ])
  })

  it('reports long or short texts, relative images and noindex', () => {
    const hints = cardHints(
      meta({
        title: 'x'.repeat(61),
        description: 'kısa',
        robots: 'noindex, nofollow',
        og: { title: 't', description: 'd', image: '/cover.jpg', site_name: 's' },
        twitter: { card: 'summary' },
      }),
    )
    expect(hints).toEqual([
      { key: 'titleLong', severity: 'warn', params: { count: 61, max: 60 } },
      { key: 'descriptionShort', severity: 'info', params: { count: 4, min: 50 } },
      { key: 'imageRelative', severity: 'warn', params: { url: '/cover.jpg' } },
      { key: 'noindex', severity: 'warn' },
    ])
    expect(cardHints(meta({ title: 't', description: 'ç'.repeat(161) })).find((h) => h.key === 'descriptionLong')?.params).toEqual({
      count: 161,
      max: 160,
    })
  })
})

describe('truncate', () => {
  it('cuts by characters with an ellipsis', () => {
    expect(truncate('kısa', 10)).toBe('kısa')
    expect(truncate('çok uzun bir başlık', 8)).toBe('çok uzu…')
  })
})
