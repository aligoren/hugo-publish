// Where the theme lives and where the site keeps its params. Pure functions over parsed config
// files, so they are easy to test; the loader feeds them `readConfigFile` results.
import type { ConfigFileData } from '../config-edit'

/** Hugo's precedence, low to high: root file, then config/_default/hugo.*, then params.*. */
export function configRank(path: string): number {
  const lower = path.toLowerCase()
  if (!lower.includes('/')) return 0
  if (/^config\/_default\/(hugo|config)\.[a-z]+$/.test(lower)) return 1
  if (/^config\/_default\/params\.[a-z]+$/.test(lower)) return 2
  return 3
}

/** Root-level config files that hold site settings (not menus/languages/params splits). */
export function isMainConfig(path: string): boolean {
  const lower = path.toLowerCase()
  return !lower.includes('/') || /^config\/_default\/(hugo|config)\.[a-z]+$/.test(lower)
}

export function isParamsFile(path: string): boolean {
  return /^config\/_default\/params\.[a-z]+$/i.test(path)
}

function getCi(values: unknown, key: string): unknown {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return undefined
  const record = values as Record<string, unknown>
  if (key in record) return record[key]
  const found = Object.keys(record).find((k) => k.toLowerCase() === key.toLowerCase())
  return found === undefined ? undefined : record[found]
}

/** Theme names in Hugo's order (the first one wins on conflicts). */
export function themeNamesFromConfig(configs: ConfigFileData[]): string[] {
  const sorted = [...configs].filter((c) => isMainConfig(c.path)).sort((a, b) => configRank(b.path) - configRank(a.path))
  for (const config of sorted) {
    const theme = getCi(config.values, 'theme')
    if (typeof theme === 'string' && theme.trim()) return [theme.trim()]
    if (Array.isArray(theme)) {
      const names = theme.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
      if (names.length > 0) return names
    }
  }
  return []
}

/** Module imports (`module.imports[].path`), used when `theme` is not set. */
export function moduleImports(configs: ConfigFileData[]): string[] {
  const out: string[] = []
  for (const config of configs) {
    const module = getCi(config.values, 'module')
    const imports = getCi(module, 'imports')
    if (Array.isArray(imports)) {
      for (const entry of imports) {
        const path = getCi(entry, 'path')
        if (typeof path === 'string' && !out.includes(path)) out.push(path)
      }
    }
    if (/^config\/_default\/module\.[a-z]+$/i.test(config.path)) {
      const direct = getCi(config.values, 'imports')
      if (Array.isArray(direct)) {
        for (const entry of direct) {
          const path = getCi(entry, 'path')
          if (typeof path === 'string' && !out.includes(path)) out.push(path)
        }
      }
    }
  }
  return out
}

export function themesDirFromConfig(configs: ConfigFileData[]): string {
  const sorted = [...configs].filter((c) => isMainConfig(c.path)).sort((a, b) => configRank(b.path) - configRank(a.path))
  for (const config of sorted) {
    const dir = getCi(config.values, 'themesDir')
    if (typeof dir === 'string' && dir.trim()) return dir.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  }
  return 'themes'
}

/** A themesDir outside the site folder (`../..`, absolute) cannot be read through the site API. */
export function isOutsideSite(dir: string): boolean {
  return dir.startsWith('..') || dir.startsWith('/') || /^[a-zA-Z]:/.test(dir)
}

export type ThemeSource = 'themesDir' | 'vendor'

export interface ThemeLocation {
  name: string
  /** Site-relative folder, or null when the theme is not inside the site. */
  root: string | null
  source: ThemeSource | null
  /** Module path (contains a slash and a dot), e.g. github.com/user/theme. */
  isModulePath: boolean
}

/** Candidate folders for a theme name, in the order Hugo would look. */
export function themeFolderCandidates(name: string, themesDir: string): { root: string; source: ThemeSource }[] {
  const out: { root: string; source: ThemeSource }[] = []
  if (!isOutsideSite(themesDir)) out.push({ root: `${themesDir}/${name}`, source: 'themesDir' })
  if (name.includes('/')) {
    out.push({ root: `_vendor/${name}`, source: 'vendor' })
    const last = name.split('/').filter(Boolean).pop()
    if (last && !isOutsideSite(themesDir)) out.push({ root: `${themesDir}/${last}`, source: 'themesDir' })
  }
  return out
}

export function isModulePath(name: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(name)
}

// --- Params ----------------------------------------------------------------------------------

export interface ParamsSource {
  file: string
  /** Key path of the params table inside the file: ['params'], or [] for params.toml, or ['params'] when wrapped. */
  prefix: string[]
  values: Record<string, unknown>
  rank: number
  editable: boolean
}

/** The files that define site params, low to high precedence. */
export function paramsSources(configs: ConfigFileData[]): ParamsSource[] {
  const out: ParamsSource[] = []
  for (const config of configs) {
    const editable = config.format === 'toml' || config.format === 'yaml'
    if (isParamsFile(config.path)) {
      const keys = Object.keys(config.values)
      const wrapped = keys.length === 1 && keys[0].toLowerCase() === 'params' && isRecord(config.values[keys[0]])
      out.push({
        file: config.path,
        prefix: wrapped ? [keys[0]] : [],
        values: (wrapped ? config.values[keys[0]] : config.values) as Record<string, unknown>,
        rank: configRank(config.path),
        editable,
      })
    } else if (isMainConfig(config.path)) {
      const key = Object.keys(config.values).find((k) => k.toLowerCase() === 'params')
      out.push({
        file: config.path,
        prefix: [key ?? 'params'],
        values: key && isRecord(config.values[key]) ? (config.values[key] as Record<string, unknown>) : {},
        rank: configRank(config.path),
        editable,
      })
    }
  }
  return out.sort((a, b) => a.rank - b.rank)
}

/** Where new params are written: params.* if present, else the root config, else config/_default/hugo.*. */
export function defaultParamsTarget(sources: ParamsSource[]): ParamsSource | null {
  const params = sources.find((s) => isParamsFile(s.file))
  if (params) return params
  return sources.find((s) => !s.file.includes('/')) ?? sources[0] ?? null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Deep merge of params in precedence order (later wins), like Hugo's `_merge = deep` for params. */
export function mergeParams(sources: ParamsSource[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const source of sources) deepMergeCi(out, source.values)
  return out
}

function deepMergeCi(target: Record<string, unknown>, from: Record<string, unknown>) {
  for (const [key, value] of Object.entries(from)) {
    const existing = Object.keys(target).find((k) => k.toLowerCase() === key.toLowerCase())
    if (existing !== undefined && isRecord(target[existing]) && isRecord(value)) {
      deepMergeCi(target[existing] as Record<string, unknown>, value)
    } else {
      if (existing !== undefined && existing !== key) delete target[existing]
      target[key] = isRecord(value) ? deepMergeCi({}, value) : value
    }
  }
  return target
}

/** Case-insensitive lookup of a dotted path; returns the value and the casing found in the data. */
export function lookupCi(values: unknown, path: string[]): { value: unknown; path: string[] } | null {
  let current: unknown = values
  const found: string[] = []
  for (const segment of path) {
    if (!isRecord(current)) return null
    const key = Object.keys(current).find((k) => k.toLowerCase() === segment.toLowerCase())
    if (key === undefined) return null
    found.push(key)
    current = current[key]
  }
  return { value: current, path: found }
}

/** The highest-precedence source holding `path` (case-insensitive). */
export function ownerOf(sources: ParamsSource[], path: string[]): { source: ParamsSource; path: string[] } | null {
  for (const source of [...sources].reverse()) {
    const hit = lookupCi(source.values, path)
    if (hit) return { source, path: hit.path }
  }
  return null
}

/**
 * Key path to write in `source` for a param: existing segments keep the file's casing,
 * missing ones use the documented casing.
 */
export function writePath(source: ParamsSource, path: string[]): string[] {
  const out: string[] = []
  let current: unknown = source.values
  for (const segment of path) {
    const key = isRecord(current) ? Object.keys(current).find((k) => k.toLowerCase() === segment.toLowerCase()) : undefined
    out.push(key ?? segment)
    current = key !== undefined && isRecord(current) ? current[key] : undefined
  }
  return [...source.prefix, ...out]
}

/** Keys in the same object that differ only by case (Hugo keeps one of them). */
export function caseDuplicates(values: unknown, prefix: string[] = []): string[][] {
  if (!isRecord(values)) return []
  const out: string[][] = []
  const groups = new Map<string, string[]>()
  for (const key of Object.keys(values)) {
    const list = groups.get(key.toLowerCase()) ?? []
    list.push(key)
    groups.set(key.toLowerCase(), list)
  }
  for (const list of groups.values()) if (list.length > 1) out.push(list.map((k) => [...prefix, k].join('.')))
  for (const [key, value] of Object.entries(values)) out.push(...caseDuplicates(value, [...prefix, key]))
  return out
}

/** Site languages: keys of `languages`, else defaultContentLanguage, else the locale's language, else en. */
export function siteLanguages(configs: ConfigFileData[]): string[] {
  const out: string[] = []
  const sorted = [...configs].sort((a, b) => configRank(a.path) - configRank(b.path))
  let defaultLang: string | null = null
  for (const config of sorted) {
    const dcl = getCi(config.values, 'defaultContentLanguage')
    if (typeof dcl === 'string' && dcl) defaultLang = dcl.toLowerCase()
    const languages = /^config\/_default\/languages\.[a-z]+$/i.test(config.path) ? config.values : getCi(config.values, 'languages')
    if (isRecord(languages)) for (const key of Object.keys(languages)) if (!out.includes(key.toLowerCase())) out.push(key.toLowerCase())
  }
  if (defaultLang && !out.includes(defaultLang)) out.unshift(defaultLang)
  if (defaultLang) {
    out.splice(out.indexOf(defaultLang), 1)
    out.unshift(defaultLang)
  }
  if (out.length === 0) {
    for (const config of sorted) {
      const locale = getCi(config.values, 'locale') ?? getCi(config.values, 'languageCode')
      if (typeof locale === 'string' && locale) defaultLang = locale.toLowerCase().split(/[-_]/)[0]
    }
    out.push(defaultLang ?? 'en')
  }
  return out
}

/** Compares "0.146.0" with the running Hugo; null when either is unknown. */
export function versionAtLeast(
  have: { major: number; minor: number; patch: number } | null | undefined,
  want: string | undefined,
): boolean | null {
  if (!have || !want) return null
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(want.trim())
  if (!m) return null
  const need = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
  const got = [have.major, have.minor, have.patch]
  for (let i = 0; i < 3; i++) {
    if (got[i] !== need[i]) return got[i] > need[i]
  }
  return true
}
