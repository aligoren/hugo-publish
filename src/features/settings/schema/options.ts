// Fixed suggestion lists used by the schema.

/** Common RFC 5646 tags; any other tag can be typed. */
export const COMMON_LOCALES: readonly string[] = [
  'tr',
  'tr-TR',
  'en',
  'en-US',
  'en-GB',
  'de',
  'de-DE',
  'fr',
  'fr-FR',
  'es',
  'es-ES',
  'it',
  'nl',
  'pt',
  'pt-BR',
  'ar',
  'fa',
  'he',
  'ur',
  'ru',
  'uk',
  'pl',
  'az',
  'ja',
  'ko',
  'zh-CN',
  'zh-TW',
]

/** Common IANA zones; any other zone can be typed. */
export const COMMON_TIME_ZONES: readonly string[] = [
  'UTC',
  'Local',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Amsterdam',
  'Europe/Moscow',
  'Asia/Baku',
  'Asia/Dubai',
  'Asia/Tehran',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
]

/** Output formats every Hugo site has. */
export const BUILTIN_OUTPUT_FORMATS: readonly string[] = [
  'html',
  'rss',
  'json',
  'markdown',
  'calendar',
  'csv',
  'css',
  'amp',
  'robots',
  'sitemap',
  'sitemapindex',
  'webappmanifest',
  'gotmpl',
  'alias',
  '404',
]

export const PAGE_KINDS: readonly string[] = ['404', 'home', 'page', 'robotstxt', 'rss', 'section', 'sitemap', 'taxonomy', 'term']
