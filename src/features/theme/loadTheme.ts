// Reads everything the Theme screen needs through the site API: the site's config files, the
// theme folder (theme.toml, templates, defaults, i18n, CSS) and the site's own overrides.
import { isMap, isPair, isScalar, isSeq, parseDocument, parse as parseYaml, type Node } from 'yaml'

import { api, type TomlReadResult } from '../../lib/api'
import { readConfigFile, type ConfigFileData } from '../config-edit'
import { buildDefaultsLayer, paramsPrefix, type DefaultsLayer, type ThemeConfigSource } from './defaults'
import { defaultSourcesIo, listThemeComponents, siteComponent, type ThemeComponent, type ThemeSourcesIo } from '../../lib/themeSources'
import { isModulePath, isOutsideSite, moduleImports, themeNamesFromConfig, themesDirFromConfig } from './discovery'
import { scanJs, scanTemplates, type ScanResult, type TemplateFile } from './scan/scanner'
import { matchSchema, type SchemaMatch } from './schema'
import { curatedSchemas } from './schemas'
import { i18nFormat, normalizeI18n, type I18nData, type I18nFormat } from './textOverrides'

/** Runs `fn` over `items` with at most `limit` calls in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export interface SiteConfigs {
  configs: ConfigFileData[]
  errors: { path: string; error: unknown }[]
}

export async function loadSiteConfigs(paths: string[]): Promise<SiteConfigs> {
  const configs: ConfigFileData[] = []
  const errors: SiteConfigs['errors'] = []
  await mapLimit(paths, 4, async (path) => {
    try {
      configs.push(await readConfigFile(path))
    } catch (error) {
      errors.push({ path, error })
    }
  })
  configs.sort((a, b) => paths.indexOf(a.path) - paths.indexOf(b.path))
  return { configs, errors }
}

export interface ThemeCandidate {
  name: string
  /** Where the theme's files are read from; null when no folder was found. */
  component: ThemeComponent | null
  /** Site-relative folder, or the module folder (`component.root`); null when not found. */
  root: string | null
  /** A Hugo module path that could not be resolved (Hugo or Go missing, not downloaded). */
  module: boolean
  /** themesDir points outside the site folder and Hugo could not be asked. */
  outside: boolean
  /** Why `hugo config mounts` failed, when it was needed. */
  error: unknown
}

/** The site's theme components in Hugo's order (Hugo Modules and custom themesDir included). */
export async function locateThemes(configs: ConfigFileData[], io: ThemeSourcesIo = defaultSourcesIo): Promise<ThemeCandidate[]> {
  const themesDir = themesDirFromConfig(configs)
  const settings = { themes: themeNamesFromConfig(configs), themesDir, imports: moduleImports(configs) }
  const result = await listThemeComponents(settings, io)
  const out: ThemeCandidate[] = result.components.map((component) => ({
    name: component.name,
    component,
    root: component.root,
    module: false,
    outside: false,
    error: null,
  }))
  for (const name of result.missing) {
    out.push({ name, component: null, root: null, module: isModulePath(name), outside: isOutsideSite(themesDir), error: result.error })
  }
  return out
}

export interface ThemeToml {
  values: Record<string, unknown>
}

export interface ThemeData {
  name: string
  /** Site-relative theme folder, or the module folder outside the site (see `component`). */
  root: string
  /** Where the theme files are read from (site folder or Hugo module). */
  component: ThemeComponent
  /** Short text for the UI: the folder, or `module@version`. */
  label: string
  /** Theme-relative paths of every file in the theme. */
  files: string[]
  /** File sizes by theme-relative path. */
  sizes: Record<string, number>
  themeToml: ThemeToml | null
  modulePath: string | null
  /** `min_version` of theme.toml, or module.hugoVersion.min. */
  minVersion: string | null
  match: SchemaMatch | null
  scan: ScanResult
  defaults: DefaultsLayer
  /** hugo.toml / params.toml / exampleSite files read for defaults. */
  configSources: string[]
  /** Theme files that could not be read (shown as a note). */
  unreadable: string[]
}

const TEMPLATE_EXT = /\.(html|xml|json|txt|rss|ics|csv)$/i
const CONFIG_FILE = /^(hugo|config)\.(toml|ya?ml|json)$|^config\/_default\/(hugo|config|params)\.(toml|ya?ml|json)$/i
const EXAMPLE_FILE = /^exampleSite\/((hugo|config)\.(toml|ya?ml|json)|config\/_default\/(hugo|config|params)\.(toml|ya?ml|json))$/i
const MODULE_FILE = /^(config\/_default\/)?module\.(toml|ya?ml|json)$/i

function formatOf(path: string): 'toml' | 'yaml' | 'json' {
  return /\.toml$/i.test(path) ? 'toml' : /\.json$/i.test(path) ? 'json' : 'yaml'
}

async function readTheme(component: ThemeComponent, path: string): Promise<string | null> {
  try {
    return (await component.read(path)).text
  } catch {
    return null
  }
}

/** Values and comments of a YAML text, comments by dotted path like `TomlReadResult.comments`. */
function readYamlText(text: string): { values: Record<string, unknown>; comments: Record<string, string> } {
  const doc = parseDocument(text.replace(/^\uFEFF/, ''))
  const values = (doc.toJS() ?? {}) as Record<string, unknown>
  const comments: Record<string, string> = {}
  const visit = (node: unknown, path: (string | number)[]) => {
    if (isMap(node)) {
      for (const item of node.items) {
        if (!isPair(item)) continue
        const key = isScalar(item.key) ? String(item.key.value) : String(item.key)
        const keyPath = [...path, key]
        const keyNode = item.key as Node | null
        const valueNode = item.value as Node | null
        const parts = [keyNode?.commentBefore, valueNode?.comment ?? keyNode?.comment].filter((c): c is string => !!c).map((c) => c.trim())
        if (parts.length > 0) comments[keyPath.join('.')] = parts.join('\n')
        visit(item.value, keyPath)
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => visit(item, [...path, index]))
    }
  }
  visit(doc.contents, [])
  return { values, comments }
}

/** A config file of a theme component, parsed (TOML through the Rust side, which keeps casing and comments). */
export async function readComponentConfig(component: ThemeComponent, path: string): Promise<ConfigFileData> {
  if (component.location === 'site' && !component.module) return readConfigFile(`${component.root}/${path}`)
  const file = await component.read(path)
  const format = formatOf(path)
  if (format === 'toml') {
    const { values, comments } = await api.tomlParseText(file.text)
    return { path, format, text: file.text, version: file.version, values, comments }
  }
  if (format === 'yaml') return { path, format, text: file.text, version: file.version, ...readYamlText(file.text) }
  const values = file.text.trim() ? (JSON.parse(file.text.replace(/^\uFEFF/, '')) as Record<string, unknown>) : {}
  return { path, format, text: file.text, version: file.version, values, comments: {} }
}

async function tomlOf(component: ThemeComponent, path: string): Promise<TomlReadResult | null> {
  try {
    if (component.location === 'site' && !component.module) return await api.tomlRead(`${component.root}/${path}`)
    return await api.tomlParseText((await component.read(path)).text)
  } catch {
    return null
  }
}

async function configSource(component: ThemeComponent, path: string, role: 'defaults' | 'example'): Promise<ThemeConfigSource | null> {
  const format = formatOf(path)
  try {
    const data = await readComponentConfig(component, path)
    const local = role === 'example' ? path.replace(/^exampleSite\//, '') : path
    return {
      path,
      role,
      prefix: paramsPrefix(local, data.values),
      values: data.values,
      comments: data.comments,
      text: data.text,
      format,
    }
  } catch {
    return null
  }
}

/** Reads a theme: a site-relative folder (`themes/x`) or a theme component (any location). */
export async function loadTheme(name: string, from: string | ThemeComponent): Promise<ThemeData> {
  const component = typeof from === 'string' ? siteComponent(name, from) : from
  const root = component.root
  const listed = await component.list('.')
  const files = listed.map((f) => f.path).filter(Boolean)
  const sizes = new Map(listed.map((f) => [f.path, f.size]))
  const unreadable: string[] = []

  const themeToml = files.includes('theme.toml') ? await tomlOf(component, 'theme.toml') : null
  const goMod = files.includes('go.mod') ? await readTheme(component, 'go.mod') : null
  const fromGoMod = goMod ? /^module\s+(\S+)/m.exec(goMod)?.[1] : undefined
  const modulePath = fromGoMod ?? component.module?.modulePath ?? null

  const templatePaths = files.filter((f) => f.startsWith('layouts/') && TEMPLATE_EXT.test(f) && (sizes.get(f) ?? 0) < 2_000_000)
  const templates = (
    await mapLimit(templatePaths, 8, async (path): Promise<TemplateFile | null> => {
      const text = await readTheme(component, path)
      if (text === null) unreadable.push(path)
      return text === null ? null : { path, text }
    })
  ).filter((t): t is TemplateFile => t !== null)
  const scan = scanTemplates(templates)
  for (const build of scan.jsBuilds) {
    if (!build.asset) continue
    const path = `assets/${build.asset}`
    if (!files.includes(path)) continue
    const text = await readTheme(component, path)
    if (text !== null) scanJs({ path, text }, build, scan.params)
  }

  const defaultPaths = files.filter((f) => CONFIG_FILE.test(f))
  const examplePaths = files.filter((f) => EXAMPLE_FILE.test(f))
  const sources = (
    await mapLimit([...defaultPaths.map((p) => [p, 'defaults'] as const), ...examplePaths.map((p) => [p, 'example'] as const)], 4, ([path, role]) =>
      configSource(component, path, role),
    )
  ).filter((s): s is ThemeConfigSource => s !== null)
  const defaults = buildDefaultsLayer(sources)

  let minVersion = typeof themeToml?.values.min_version === 'string' ? themeToml.values.min_version : null
  if (!minVersion) {
    const moduleFile = files.find((f) => MODULE_FILE.test(f))
    const module = moduleFile ? await configSource(component, moduleFile, 'defaults') : null
    const values = module?.values ?? {}
    const hv = (values.hugoVersion ?? (values.module as Record<string, unknown> | undefined)?.hugoVersion) as Record<string, unknown> | undefined
    if (typeof hv?.min === 'string') minVersion = hv.min
  }

  const tomlName = typeof themeToml?.values.name === 'string' ? themeToml.values.name : undefined
  const urls = [modulePath, themeToml?.values.homepage, themeToml?.values.repo].filter((u): u is string => typeof u === 'string')
  const match = matchSchema(curatedSchemas, { folderName: (component.module ? component.name : root).replace(/\\/g, '/').split('/').pop() ?? name, themeTomlName: tomlName, urls, files: new Set(files) })

  return {
    name,
    root,
    component,
    label: component.label,
    files,
    sizes: Object.fromEntries(sizes),
    themeToml: themeToml ? { values: themeToml.values } : null,
    modulePath,
    minVersion,
    match,
    scan,
    defaults,
    configSources: sources.map((s) => s.path),
    unreadable,
  }
}

/** Lower-cased param keys the site's own templates read (overrides and additions). */
export async function siteTemplateKeys(): Promise<Set<string>> {
  const files = await api.listFiles('layouts', ['html', 'xml', 'json', 'txt']).catch(() => [])
  const templates = (
    await mapLimit(files, 8, async (f) => {
      try {
        return { path: f.path, text: (await api.readText(f.path)).text }
      } catch {
        return null
      }
    })
  ).filter((t): t is TemplateFile => t !== null)
  const scan = scanTemplates(templates)
  return new Set([...scan.params.values()].filter((p) => p.scopes.some((s) => s !== 'page')).map((p) => p.key.toLowerCase()))
}

/** Layouts of content pages that could be special pages (search, archives…), from their front matter. */
export async function contentLayouts(paths: string[], names: string[]): Promise<Set<string>> {
  const wanted = names.map((n) => n.toLowerCase())
  const candidates = paths.filter((p) => wanted.some((n) => p.toLowerCase().includes(n.slice(0, 5))))
  const found = new Set<string>()
  await mapLimit(candidates.slice(0, 40), 4, async (path) => {
    try {
      const text = (await api.readText(path)).text
      const head = text.slice(0, 4000)
      const m = /^\s*["']?layout["']?\s*[:=]\s*["']?([\w-]+)/im.exec(head)
      if (m) found.add(m[1].toLowerCase())
    } catch {
      // Unreadable files are ignored here.
    }
  })
  return found
}

export interface I18nFileData {
  path: string
  format: I18nFormat
  text: string
  version: string
  raw: unknown
  data: I18nData
}

/** Reads an i18n file of any format (TOML through the Rust side, which keeps key casing). */
export async function readI18nFile(path: string): Promise<I18nFileData | null> {
  if (!i18nFormat(path)) return null
  try {
    const file = await api.readText(path)
    return await parseI18n(path, file.text, file.version, () => api.tomlRead(path))
  } catch {
    return null
  }
}

/** An i18n file of a theme component (`path` relative to the component). */
export async function readComponentI18n(component: ThemeComponent, path: string): Promise<I18nFileData | null> {
  if (!i18nFormat(path)) return null
  try {
    const file = await component.read(path)
    return await parseI18n(path, file.text, file.version, () => api.tomlParseText(file.text))
  } catch {
    return null
  }
}

async function parseI18n(path: string, text: string, version: string, toml: () => Promise<TomlReadResult>): Promise<I18nFileData> {
  const format = i18nFormat(path)!
  let raw: unknown
  if (format === 'toml') raw = (await toml()).values
  else if (format === 'json') raw = text.trim() ? JSON.parse(text.replace(/^﻿/, '')) : {}
  else raw = text.trim() ? parseYaml(text.replace(/^﻿/, '')) : {}
  return { path, format, text, version, raw, data: normalizeI18n(raw) }
}
