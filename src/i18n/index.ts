import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { messages as checks } from '../features/checks/messages'
import { messages as document } from '../features/document/messages'
import { messages as editor } from '../features/editor/messages'
import { messages as health } from '../features/health/messages'
import { messages as hugo } from '../features/hugo/messages'
import { messages as media } from '../features/media/messages'
import { messages as newPost } from '../features/newpost/messages'
import { messages as pages } from '../features/pages/messages'
import { messages as publish } from '../features/publish/messages'
import { messages as settings } from '../features/settings/messages'
import { messages as taxonomies } from '../features/taxonomies/messages'
import { messages as theme } from '../features/theme/messages'
import { messages as translations } from '../features/translations/messages'
import { isAppError } from '../lib/api'
import { en } from './en'
import { tr } from './tr'

// Each feature keeps its strings next to its code and gets its own namespace: t('settings.x').
const features = { document, editor, pages, settings, theme, publish, newPost, checks, media, taxonomies, health, hugo, translations }

function withFeatures(base: object, language: 'en' | 'tr') {
  const merged: Record<string, unknown> = { ...base }
  for (const [name, feature] of Object.entries(features)) merged[name] = feature[language]
  return merged
}

export const languages = ['tr', 'en'] as const
export type Language = (typeof languages)[number]

const STORAGE_KEY = 'hugo-publisher.language'

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'tr' || stored === 'en') return stored
  } catch {
    // Storage can be unavailable; fall back to the system language.
  }
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: withFeatures(en, 'en') },
    tr: { translation: withFeatures(tr, 'tr') },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export function setLanguage(language: Language) {
  void i18n.changeLanguage(language)
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Not persisted; the choice still applies to this session.
  }
}

/** A user-facing message for anything a command can throw. */
export function errorMessage(error: unknown): { summary: string; detail?: string } {
  if (isAppError(error)) {
    const key = `errors.${error.code}`
    const summary = i18n.exists(key) ? i18n.t(key) : i18n.t('errors.unknown')
    return { summary, detail: error.message }
  }
  return { summary: i18n.t('errors.unknown'), detail: String(error) }
}

export default i18n
