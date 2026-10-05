// Which taxonomies a site has, and the config keys that shape term URLs.
//
// The effective config (`hugo config`) is the reliable source: it applies Hugo's defaults,
// config directories, environments and themes. When Hugo cannot be asked (not installed, or the
// config does not load), the site's own config files are read instead.

import type { EffectiveConfig } from '../../lib/api'
import type { PathOptions } from './urlize'

export interface TaxonomyDef {
  /** Config key, e.g. `category`. */
  singular: string
  /** Front matter key and URL section, e.g. `categories`. */
  plural: string
}

export type SettingsSource = 'hugo' | 'files' | 'defaults'

export interface TaxonomySettings extends PathOptions {
  /** Empty when the site turns taxonomies off (`taxonomies = {}`). */
  taxonomies: TaxonomyDef[]
  /** `disableKinds`, lower-cased (`taxonomy` = the list page, `term` = each term's page). */
  disableKinds: string[]
  source: SettingsSource
}

/** Hugo's built-in taxonomies, used when the config does not define `taxonomies`. */
export const DEFAULT_TAXONOMIES: readonly TaxonomyDef[] = [
  { singular: 'category', plural: 'categories' },
  { singular: 'tag', plural: 'tags' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Value of a config key, ignoring case like Hugo does. */
export function configValue(values: Record<string, unknown>, key: string): unknown {
  if (key in values) return values[key]
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(values)) if (k.toLowerCase() === lower) return v
  return undefined
}

/**
 * The `taxonomies` map as definitions. `undefined` (not configured) gives Hugo's defaults;
 * an empty map turns taxonomies off. Entries without a plural name are ignored.
 */
export function parseTaxonomies(value: unknown): TaxonomyDef[] {
  if (value === undefined || value === null) return [...DEFAULT_TAXONOMIES]
  if (!isRecord(value)) return [...DEFAULT_TAXONOMIES]
  const result: TaxonomyDef[] = []
  for (const [singular, plural] of Object.entries(value)) {
    if (typeof plural !== 'string' || plural.trim() === '') continue
    if (result.some((t) => t.plural.toLowerCase() === plural.toLowerCase())) continue
    result.push({ singular, plural })
  }
  return result
}

function parseKinds(value: unknown): string[] {
  if (typeof value === 'string') return [value.toLowerCase()]
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase())
}

function settingsFrom(values: Record<string, unknown>, taxonomies: unknown, source: SettingsSource): TaxonomySettings {
  return {
    taxonomies: parseTaxonomies(taxonomies),
    disableKinds: parseKinds(configValue(values, 'disableKinds')),
    removePathAccents: configValue(values, 'removePathAccents') === true,
    disablePathToLower: configValue(values, 'disablePathToLower') === true,
    source,
  }
}

/** Settings from `hugo config` output (keys are lower-cased by Hugo). */
export function settingsFromEffective(values: Record<string, unknown>): TaxonomySettings {
  return settingsFrom(values, configValue(values, 'taxonomies'), 'hugo')
}

export interface ConfigFileValues {
  /** Site-relative path, e.g. `hugo.toml` or `config/_default/taxonomies.toml`. */
  path: string
  values: Record<string, unknown>
}

function baseName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.indexOf('.')
  return dot === -1 ? name : name.slice(0, dot)
}

/**
 * Settings from the site's config files, in the order `SiteInfo.configFiles` lists them
 * (later files override earlier ones). `config/_default/taxonomies.*` holds the map itself.
 */
export function settingsFromFiles(files: readonly ConfigFileValues[]): TaxonomySettings {
  const merged: Record<string, unknown> = {}
  let taxonomies: unknown
  for (const file of files) {
    const inConfigDir = file.path.startsWith('config/')
    const name = baseName(file.path)
    if (inConfigDir && name === 'taxonomies') {
      taxonomies = file.values
      continue
    }
    if (inConfigDir && name !== 'hugo' && name !== 'config') continue
    for (const key of ['disableKinds', 'removePathAccents', 'disablePathToLower']) {
      const value = configValue(file.values, key)
      if (value !== undefined) merged[key] = value
    }
    const map = configValue(file.values, 'taxonomies')
    if (map !== undefined) taxonomies = map
  }
  return settingsFrom(merged, taxonomies, files.length > 0 ? 'files' : 'defaults')
}

export interface SettingsDeps {
  configEffective(): Promise<EffectiveConfig>
  readConfigFile(path: string): Promise<{ values: Record<string, unknown> }>
}

export interface LoadedSettings {
  settings: TaxonomySettings
  /** Why `hugo config` could not be used (the files were read instead). */
  hugoError: unknown
}

export async function loadTaxonomySettings(configFiles: readonly string[], deps: SettingsDeps): Promise<LoadedSettings> {
  let hugoError: unknown = null
  try {
    const effective = await deps.configEffective()
    if (isRecord(effective.values) && Object.keys(effective.values).length > 0) {
      return { settings: settingsFromEffective(effective.values), hugoError: null }
    }
  } catch (error) {
    hugoError = error
  }
  const files: ConfigFileValues[] = []
  for (const path of configFiles) {
    try {
      const { values } = await deps.readConfigFile(path)
      files.push({ path, values })
    } catch {
      // Unreadable or unsupported files are skipped; Hugo's defaults fill the gaps.
    }
  }
  return { settings: settingsFromFiles(files), hugoError }
}

/** Hugo renders a page for every term unless `disableKinds` contains `term`. */
export function termPagesEnabled(settings: TaxonomySettings): boolean {
  return !settings.disableKinds.includes('term')
}

/** The `/<plural>/` list page exists unless `disableKinds` contains `taxonomy`. */
export function listPageEnabled(settings: TaxonomySettings): boolean {
  return !settings.disableKinds.includes('taxonomy')
}
