import { useTranslation } from 'react-i18next'

import type { Localized } from './schema'

export type UiLanguage = keyof Localized

/** Picks the UI language's text of curated schema data (labels, descriptions, gotchas). */
export function useLoc() {
  const { i18n } = useTranslation()
  const lang: UiLanguage = (i18n.language ?? 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en'
  const loc = (value: Localized | string | undefined): string => {
    if (value === undefined) return ''
    if (typeof value === 'string') return value
    return value[lang] || value.en
  }
  return { lang, loc }
}

/** A short text for a value shown next to a field ("theme default: …"). */
export function formatValue(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value === '' ? '""' : value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) return value.map(String).join(', ')
  return JSON.stringify(value)
}
