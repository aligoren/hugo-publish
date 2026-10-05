// What a page looks like when shared or found: values for the mock cards and hints about
// missing or overlong tags.

import type { PageMeta } from './html'

/** Rough cut-off points of the places the cards imitate. */
export const LIMITS = {
  /** Google shows about 60 characters of a title. */
  searchTitle: 60,
  /** …and about 160 of a description. */
  searchDescription: 160,
  /** Below this a description says little. */
  descriptionMin: 50,
  /** Most share cards show about this much of a title… */
  cardTitle: 70,
  /** …and of a description. */
  cardDescription: 200,
}

export interface CardInfo {
  title: string
  description: string
  /** Image URL as given (absolute or not), or null. */
  image: string | null
  imageAlt: string | null
  siteName: string | null
  /** Host shown on cards. */
  domain: string
  /** The page address shown in search results. */
  url: string
  /** `summary`, `summary_large_image`… or null when not set. */
  twitterCard: string | null
}

const length = (text: string) => [...text].length

/** Cuts `text` to `max` characters with an ellipsis. */
export function truncate(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/** Card values, with the fallbacks platforms use (og → twitter → title/description). */
export function cardInfo(meta: PageMeta, pageUrl: string): CardInfo {
  const url = meta.og.url || meta.canonical || pageUrl
  let domain = ''
  try {
    domain = new URL(url).hostname
  } catch {
    try {
      domain = new URL(pageUrl).hostname
    } catch {
      domain = ''
    }
  }
  return {
    title: meta.og.title || meta.twitter.title || meta.title || '',
    description: meta.og.description || meta.twitter.description || meta.description || '',
    image: meta.og.image || meta.twitter.image || meta.twitter['image:src'] || null,
    imageAlt: meta.og['image:alt'] || meta.twitter['image:alt'] || null,
    siteName: meta.og.site_name || null,
    domain: domain.replace(/^www\./, ''),
    url,
    twitterCard: meta.twitter.card || null,
  }
}

/** The X (Twitter) card values: its own tags first. */
export function xCard(meta: PageMeta, info: CardInfo): { title: string; description: string; image: string | null; large: boolean } {
  return {
    title: meta.twitter.title || info.title,
    description: meta.twitter.description || info.description,
    image: meta.twitter.image || meta.twitter['image:src'] || info.image,
    large: (info.twitterCard ?? '') === 'summary_large_image',
  }
}

export interface CardHint {
  /** `health.social.hints.<key>` */
  key: string
  severity: 'warn' | 'info'
  params?: Record<string, string | number>
}

/** Missing tags and overlong texts. */
export function cardHints(meta: PageMeta): CardHint[] {
  const hints: CardHint[] = []
  if (!meta.title) hints.push({ key: 'noTitle', severity: 'warn' })
  else if (length(meta.title) > LIMITS.searchTitle)
    hints.push({ key: 'titleLong', severity: 'warn', params: { count: length(meta.title), max: LIMITS.searchTitle } })
  if (!meta.description) hints.push({ key: 'noDescription', severity: 'warn' })
  else if (length(meta.description) > LIMITS.searchDescription)
    hints.push({
      key: 'descriptionLong',
      severity: 'warn',
      params: { count: length(meta.description), max: LIMITS.searchDescription },
    })
  else if (length(meta.description) < LIMITS.descriptionMin)
    hints.push({ key: 'descriptionShort', severity: 'info', params: { count: length(meta.description), min: LIMITS.descriptionMin } })
  if (!meta.og.title) hints.push({ key: 'noOgTitle', severity: 'warn' })
  if (!meta.og.description) hints.push({ key: 'noOgDescription', severity: 'info' })
  const image = meta.og.image || meta.twitter.image
  if (!image) hints.push({ key: 'noImage', severity: 'warn' })
  else if (!/^https?:\/\//i.test(image)) hints.push({ key: 'imageRelative', severity: 'warn', params: { url: image } })
  if (!meta.twitter.card) hints.push({ key: 'noTwitterCard', severity: 'info' })
  if (!meta.og.site_name) hints.push({ key: 'noSiteName', severity: 'info' })
  if (meta.robots && /\bnoindex\b/i.test(meta.robots)) hints.push({ key: 'noindex', severity: 'warn' })
  return hints
}
