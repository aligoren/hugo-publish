// Site-wide settings the document pane needs, read once per site and config version from
// `hugo config` (the effective configuration, with Hugo's lower-cased keys).

import { api, type EffectiveConfig } from '../../lib/api'
import { effectiveValueAt } from '../config-edit'
import { isRecord } from './frontMatterOps'

export interface SiteSettings {
  /** Front matter keys of the site's taxonomies (plural names), e.g. `categories`, `tags`. */
  taxonomies: string[]
  defaultContentLanguage: string | null
  locale: string | null
  baseURL: string | null
  /** Theme folder names under `themes/`. */
  themes: string[]
}

export const DEFAULT_TAXONOMIES = ['categories', 'tags']

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

export function siteSettingsFromConfig(values: Record<string, unknown> | null): SiteSettings {
  if (!values) {
    return { taxonomies: DEFAULT_TAXONOMIES, defaultContentLanguage: null, locale: null, baseURL: null, themes: [] }
  }
  const taxonomyMap = effectiveValueAt(values, ['taxonomies'])
  const taxonomies = isRecord(taxonomyMap)
    ? [...new Set(Object.values(taxonomyMap).filter((v): v is string => typeof v === 'string' && v !== ''))]
    : DEFAULT_TAXONOMIES
  const language = str(effectiveValueAt(values, ['defaultContentLanguage']))
  const locale =
    str(effectiveValueAt(values, ['locale'])) ??
    (language ? str(effectiveValueAt(values, ['languages', language.toLowerCase(), 'locale'])) : null) ??
    str(effectiveValueAt(values, ['languageCode']))
  const theme = effectiveValueAt(values, ['theme'])
  const themes = (Array.isArray(theme) ? theme : [theme]).filter((t): t is string => typeof t === 'string' && t !== '')
  return {
    taxonomies,
    defaultContentLanguage: language,
    locale,
    baseURL: str(effectiveValueAt(values, ['baseURL'])),
    themes,
  }
}

/**
 * Spellchecking language for the editor: `tr` and `en` (bundled dictionaries) for Turkish and
 * English sites, any other language tag as written (the browser's checker), null when unknown.
 */
export function spellLanguage(settings: SiteSettings | null): string | null {
  if (!settings) return null
  const tag = settings.locale ?? settings.defaultContentLanguage
  if (!tag) return null
  const primary = tag.split(/[-_]/)[0].toLowerCase()
  return primary === 'tr' || primary === 'en' ? primary : tag
}

const cache = new Map<string, Promise<SiteSettings>>()

/**
 * Reads the settings once per site and config version. Without Hugo (or with a broken config)
 * the defaults are used: categories and tags, no language.
 */
export function loadSiteSettings(
  siteRoot: string,
  configVersion: number,
  read: () => Promise<EffectiveConfig> = () => api.configEffective(),
): Promise<SiteSettings> {
  const key = `${siteRoot}\n${configVersion}`
  let promise = cache.get(key)
  if (!promise) {
    promise = read()
      .then((config) => siteSettingsFromConfig(config.values))
      .catch(() => siteSettingsFromConfig(null))
    cache.set(key, promise)
  }
  return promise
}

/** For tests. */
export function clearSiteSettingsCache(): void {
  cache.clear()
}
