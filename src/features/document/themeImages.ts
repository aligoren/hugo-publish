// Image fields the site's templates read from page front matter (`.Params.cover.image`,
// `.Params.images`, …), found with the theme template scanner. The form offers to add them.

import { api } from '../../lib/api'
import { defaultSourcesIo, listThemeComponents, siteOnlyIo, themeSettingsFromConfigs, type ThemeComponent, type ThemeSourcesIo } from '../../lib/themeSources'
import { readConfigFile } from '../config-edit'
import { mapLimited } from './asyncPool'
import { scanTemplates, type TemplateFile } from '../theme/scan/scanner'
import { isImageKey } from './fieldKinds'

export interface ThemeImageParam {
  /** Path in front matter, e.g. `["cover", "image"]`. */
  path: string[]
  /** The template reads a list (`range .Params.images`). */
  list: boolean
}

export interface ThemeScanDeps {
  listFiles(dir: string, extensions: string[]): Promise<{ path: string }[]>
  readText(path: string): Promise<{ text: string }>
  /**
   * The site's theme components (themes folder, `_vendor/`, Hugo's module cache). Without it,
   * the named themes are looked up under `themes/`.
   */
  components?(themes: readonly string[]): Promise<ThemeComponent[]>
}

const MAX_TEMPLATES = 600

interface TemplateSource {
  list(dir: string, extensions: string[]): Promise<{ path: string }[]>
  read(path: string): Promise<{ text: string }>
}

/** Templates under `layouts/` of the site or a component, by layouts-relative path from the root. */
async function templatesUnder(source: TemplateSource): Promise<TemplateFile[]> {
  const files = await source.list('layouts', ['html']).catch(() => [])
  const read = await mapLimited(files.slice(0, MAX_TEMPLATES), 8, async (file): Promise<TemplateFile | null> => {
    try {
      const { text } = await source.read(file.path)
      return { path: file.path, text }
    } catch {
      // Unreadable templates are skipped.
      return null
    }
  })
  return read.filter((file): file is TemplateFile => file !== null)
}

const CONFIG_FILES = ['hugo', 'config']
  .flatMap((base) => ['toml', 'yaml', 'yml', 'json'].map((ext) => `${base}.${ext}`))
  .flatMap((name) => [name, `config/_default/${name}`])
  .concat(['toml', 'yaml', 'yml', 'json'].map((ext) => `config/_default/module.${ext}`))

/** The open site's theme components, from its config (themesDir and module imports included). */
async function siteComponents(themes: readonly string[], io: ThemeSourcesIo = defaultSourcesIo): Promise<ThemeComponent[]> {
  const configs: { path: string; values: Record<string, unknown> }[] = []
  for (const path of CONFIG_FILES) {
    try {
      configs.push({ path, values: (await readConfigFile(path)).values })
    } catch {
      // Missing or unreadable: the next one.
    }
  }
  const settings = themeSettingsFromConfigs(configs)
  // The names from the caller win when the config could not be read.
  if (settings.themes.length === 0 && settings.imports.length === 0) settings.themes = [...themes]
  return (await listThemeComponents(settings, io)).components
}

const defaultDeps: ThemeScanDeps = {
  listFiles: (dir, extensions) => api.listFiles(dir, extensions),
  readText: (path) => api.readText(path),
  components: (themes) => siteComponents(themes),
}

/** Scans the site's and its themes' templates for page params that hold images. */
export async function scanThemeImageParams(themes: readonly string[], deps: ThemeScanDeps = defaultDeps): Promise<ThemeImageParam[]> {
  const components = deps.components
    ? await deps.components(themes)
    : (await listThemeComponents({ themes: [...themes], themesDir: 'themes', imports: [] }, siteOnlyIo(deps))).components
  const files = new Map<string, TemplateFile>()
  // Site templates override theme templates with the same path; earlier components win.
  for (const component of [...components].reverse()) {
    for (const file of await templatesUnder({ list: (dir, ext) => component.list(dir, ext), read: (path) => component.read(path) })) files.set(file.path, file)
  }
  for (const file of await templatesUnder({ list: (dir, ext) => deps.listFiles(dir, ext), read: (path) => deps.readText(path) })) files.set(file.path, file)
  if (files.size === 0) return []
  const { params } = scanTemplates([...files.values()])
  const out: ThemeImageParam[] = []
  for (const param of params.values()) {
    if (!param.scopes.includes('page') && !param.scopes.includes('both')) continue
    if (param.path.length === 0 || param.path.length > 2 || param.path.includes('[]')) continue
    const last = param.path[param.path.length - 1]
    if (!isImageKey(last)) continue
    out.push({ path: [...param.path], list: (param.hints.list ?? 0) > 0 })
  }
  return out.sort((a, b) => a.path.join('.').localeCompare(b.path.join('.')))
}

const cache = new Map<string, Promise<ThemeImageParam[]>>()

/** Cached per site and config version; failures give an empty list. */
export function loadThemeImageParams(siteRoot: string, configVersion: number, themes: readonly string[]): Promise<ThemeImageParam[]> {
  const key = `${siteRoot}\n${configVersion}\n${themes.join(',')}`
  let promise = cache.get(key)
  if (!promise) {
    promise = scanThemeImageParams(themes).catch(() => [])
    cache.set(key, promise)
  }
  return promise
}
