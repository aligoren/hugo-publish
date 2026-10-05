// Which files make up the site config, and how each maps into the merged config tree.
import type { KeyPath } from '../../../lib/api'
import { configFormat, isEditableConfig, type ConfigFileData, type ConfigFormat } from '../../config-edit'
import { isPlainObject, sameKey, type Tree } from './values'

export type Layer = 'root' | 'default' | 'env'

/** Hugo loads the first of these in the project root and ignores the rest. */
export const ROOT_CONFIG_NAMES = ['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml', 'config.yaml', 'config.json']

export const CONFIG_EXTENSIONS = ['toml', 'yaml', 'yml', 'json']

/** Category file names (lower case) → documented key casing. */
const CATEGORIES: Record<string, string> = Object.fromEntries(
  [
    'build',
    'caches',
    'cascade',
    'contentTypes',
    'deployment',
    'frontmatter',
    'HTTPCache',
    'imaging',
    'languages',
    'markup',
    'mediaTypes',
    'menus',
    'minify',
    'module',
    'outputFormats',
    'outputs',
    'page',
    'pagination',
    'params',
    'permalinks',
    'privacy',
    'related',
    'roles',
    'security',
    'segments',
    'server',
    'services',
    'sitemap',
    'taxonomies',
    'uglyURLs',
    'versions',
  ].map((c) => [c.toLowerCase(), c]),
)

/** The documented key of a config category (`httpcache` → `HTTPCache`), or null for root keys. */
export function categoryKey(name: string): string | null {
  const lower = name.toLowerCase()
  return lower === 'menu' ? 'menus' : (CATEGORIES[lower] ?? null)
}

export interface ConfigSource {
  /** Site-relative path with forward slashes. */
  path: string
  layer: Layer
  /** Environment folder for `env` sources. */
  env: string | null
  /** `root`: holds root keys (`hugo.toml`, `config/_default/hugo.toml`); `category`: one category. */
  kind: 'root' | 'category'
  /** File base name as written (`markup`, `menus`), for category files. */
  baseName: string | null
  /** Documented key of the category (`markup`, `menus`, `HTTPCache`). */
  category: string | null
  /** Language of `menus.tr.toml`-style files. */
  lang: string | null
  format: ConfigFormat
  /** TOML and YAML can be edited; JSON is read-only. */
  editable: boolean
  /** False for a second root file that Hugo does not load. */
  active: boolean
}

/** Classifies a config path; null for files Hugo does not read as config. */
export function classifyConfigPath(path: string): Omit<ConfigSource, 'active'> | null {
  const format = configFormat(path)
  if (!format) return null
  const parts = path.split('/')
  const file = parts[parts.length - 1]
  const stem = file.slice(0, file.lastIndexOf('.'))
  const base = { path, format, editable: isEditableConfig(path) }
  if (parts.length === 1) {
    if (!ROOT_CONFIG_NAMES.includes(file.toLowerCase())) return null
    return { ...base, layer: 'root', env: null, kind: 'root', baseName: null, category: null, lang: null }
  }
  // config/<env>/... (sub-folders allowed); files directly in config/ are not read.
  if (parts[0] !== 'config' || parts.length < 3) return null
  const envDir = parts[1]
  const layer: Layer = envDir === '_default' ? 'default' : 'env'
  const env = layer === 'env' ? envDir : null
  const [name, lang = null] = stem.split('.')
  if (['hugo', 'config'].includes(name.toLowerCase())) {
    return { ...base, layer, env, kind: 'root', baseName: null, category: null, lang: null }
  }
  const category = categoryKey(name) ?? name
  return { ...base, layer, env, kind: 'category', baseName: name, category, lang }
}

/**
 * All config sources in Hugo's precedence order (lowest first): the root file, then
 * `config/_default/**`, then each `config/<env>/**`.
 */
export function discoverSources(siteConfigFiles: readonly string[], configDirFiles: readonly string[]): ConfigSource[] {
  const seen = new Set<string>()
  const classified: Omit<ConfigSource, 'active'>[] = []
  for (const path of [...siteConfigFiles, ...configDirFiles]) {
    const normalized = path.replace(/\\/g, '/')
    if (seen.has(normalized)) continue
    seen.add(normalized)
    const source = classifyConfigPath(normalized)
    if (source) classified.push(source)
  }
  const roots = classified
    .filter((s) => s.layer === 'root')
    .sort((a, b) => ROOT_CONFIG_NAMES.indexOf(a.path.toLowerCase()) - ROOT_CONFIG_NAMES.indexOf(b.path.toLowerCase()))
  const defaults = classified.filter((s) => s.layer === 'default').sort((a, b) => a.path.localeCompare(b.path))
  const envs = classified
    .filter((s) => s.layer === 'env')
    .sort((a, b) => (a.env === b.env ? a.path.localeCompare(b.path) : a.env!.localeCompare(b.env!)))
  return [
    ...roots.map((s, i) => ({ ...s, active: i === 0 })),
    ...defaults.map((s) => ({ ...s, active: true })),
    ...envs.map((s) => ({ ...s, active: true })),
  ]
}

/** Whether the site splits its config into `config/` folders. */
export function usesConfigDir(sources: readonly ConfigSource[]): boolean {
  return sources.some((s) => s.layer !== 'root')
}

export function environmentsOf(sources: readonly ConfigSource[]): string[] {
  return [...new Set(sources.filter((s) => s.env !== null).map((s) => s.env!))].sort()
}

export interface LoadedSource extends ConfigSource {
  text: string | null
  version: string | null
  /** Values with the file's key casing; empty when the file could not be read. */
  values: Tree
  error: unknown
  /** The category key wrapping the whole file (`[markup]` in markup.toml), if any. */
  wrapperKey: string | null
  /** Where the file's values sit in the merged config (`['languages', 'tr', 'menus']`). */
  prefix: string[]
}

export function loadedSource(source: ConfigSource, data: ConfigFileData | null, error: unknown = null): LoadedSource {
  const values = data?.values ?? {}
  return {
    ...source,
    text: data?.text ?? null,
    version: data?.version ?? null,
    values,
    error,
    wrapperKey: wrapperKeyOf(source, values),
    prefix: prefixOf(source),
  }
}

/**
 * Since Hugo 0.162 a category file may wrap its keys under the category (`[params]` in
 * params.toml). Hugo unwraps only when that is the file's sole key and matches its base name.
 */
export function wrapperKeyOf(source: ConfigSource, values: Tree): string | null {
  if (source.kind !== 'category' || !source.baseName) return null
  const keys = Object.keys(values)
  return keys.length === 1 && keys[0].toLowerCase() === source.baseName.toLowerCase() ? keys[0] : null
}

export function prefixOf(source: ConfigSource): string[] {
  if (source.kind !== 'category' || !source.category) return []
  return source.lang ? ['languages', source.lang, source.category] : [source.category]
}

/** The file's values placed where they sit in the merged config. */
export function globalTree(source: LoadedSource, values: Tree = source.values): Tree {
  const inner: unknown = source.wrapperKey ? values[source.wrapperKey] : values
  let tree: unknown = isPlainObject(inner) || Array.isArray(inner) ? inner : {}
  for (let i = source.prefix.length - 1; i >= 0; i--) tree = { [source.prefix[i]]: tree }
  return tree as Tree
}

/**
 * The path inside the file for a path in its global tree, or null when the path is outside
 * the file's category. A whole unwrapped category maps to `[]`.
 */
export function toFilePath(source: LoadedSource, globalPath: KeyPath): KeyPath | null {
  if (source.kind === 'root') return globalPath
  const { prefix } = source
  if (globalPath.length < prefix.length || !prefix.every((k, i) => sameKey(k, globalPath[i]))) return null
  const rest = globalPath.slice(prefix.length)
  return source.wrapperKey ? [source.wrapperKey, ...rest] : rest
}

/** The merged-config path of a path inside the file (inverse of `toFilePath`). */
export function toGlobalPath(source: ConfigSource & { wrapperKey: string | null }, filePath: KeyPath): KeyPath {
  if (source.kind === 'root') return filePath
  const inner = source.wrapperKey && filePath.length > 0 && sameKey(filePath[0], source.wrapperKey) ? filePath.slice(1) : filePath
  return [...prefixOf(source), ...inner]
}

/** Whether a key path can live in this file at all. */
export function canHold(source: ConfigSource, path: KeyPath): boolean {
  if (source.kind === 'root') return true
  const prefix = prefixOf(source)
  return path.length >= prefix.length && prefix.every((k, i) => sameKey(k, path[i]))
}

/** Sources Hugo merges for `env` (null: no environment folder), lowest precedence first. */
export function stackFor<T extends ConfigSource>(sources: readonly T[], env: string | null): T[] {
  return sources.filter((s) => s.active && (s.layer !== 'env' || s.env === env))
}

/** The files edits go to: root + `_default` for all environments, else that environment's folder. */
export function layerFor<T extends ConfigSource>(sources: readonly T[], env: string | null): T[] {
  return sources.filter((s) => s.active && (env === null ? s.layer !== 'env' : s.layer === 'env' && s.env === env))
}

/** A short label for badges: `hugo.toml`, `_default/markup.toml`, `production/hugo.toml`. */
export function shortName(path: string): string {
  return path.startsWith('config/') ? path.slice('config/'.length) : path
}
