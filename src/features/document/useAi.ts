// The opt-in AI assistant, as the document pane uses it: suggestions only appear when the user
// turned the assistant on and stored an API key.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../../lib/api'
import type { SiteSettings } from './siteSettings'

export interface AiHelper {
  /** Language for suggestions, e.g. `tr`. */
  language: string
  describe(title: string, body: string): Promise<string>
  titles(title: string, body: string): Promise<string[]>
  /** `path` is the image's site-relative path. */
  altText(path: string, context: string): Promise<string>
}

/** The AI helper when it is enabled and has a key; null otherwise (or while checking). */
export function useAi(settings: SiteSettings | null): AiHelper | null {
  const { i18n } = useTranslation()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => api.aiStatus())
      .then(
        (status) => !cancelled && setReady(Boolean(status?.enabled && status.hasKey)),
        () => !cancelled && setReady(false),
      )
    return () => {
      cancelled = true
    }
  }, [])
  if (!ready) return null
  const language = (settings?.locale ?? settings?.defaultContentLanguage ?? i18n.language ?? 'en').split(/[-_]/)[0].toLowerCase()
  return {
    language,
    describe: (title, body) => api.aiDescribe(title, body, language),
    titles: (title, body) => api.aiTitles(title, body, language),
    altText: (path, context) => api.aiAltText(path, context, language),
  }
}
