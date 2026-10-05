// Finds the shortcodes a site and its theme define (layouts/_shortcodes and
// the legacy layouts/shortcodes) and infers their parameters from the
// template source. Inference is a heuristic over Go template text:
//   .Get "name", .Params.name, index .Params "name"  → named parameter
//   .Get 0, index .Params 0                           → positional parameter
//   .Get "id" | default (.Get 0) (in one action)      → `id`, also position 0
//   .Inner / .InnerDeindent                           → paired (has a closing tag)
//   .Inner through RenderString or markdownify        → inner content is Markdown

import { readConfigFile } from '../config-edit'
import { api } from '../../lib/api'
import { defaultSourcesIo, listThemeComponents, siteOnlyIo, themeSettingsFromConfigs, type ThemeSettings, type ThemeSourcesIo } from '../../lib/themeSources'
import type { ShortcodeDef, ShortcodeParam } from './contract'

const COMMENT = /\{\{-?\s*\/\*([\s\S]*?)\*\/\s*-?\}\}/g
const ACTION = /\{\{-?([\s\S]*?)-?\}\}/g
const NAMED_GET = /(?:\.Get|index\s+\$?\.Params)\s+(?:"([^"]+)"|`([^`]+)`)/g
const POSITIONAL_GET = /(?:\.Get|index\s+\$?\.Params)\s+(\d+)\b/g
const PARAMS_FIELD = /\$?\.Params\.([A-Za-z_]\w*)/g
const ASSIGNMENT = /^\s*\$([A-Za-z_]\w*)\s*:?=/
const INNER = /\.Inner(?:Deindent)?\b/
const MARKDOWN = /\bRenderString\b|\bmarkdownify\b/

/** The first line of a leading `{{/* … *\/}}` comment, as a description. */
function leadingDescription(text: string): string | undefined {
  COMMENT.lastIndex = 0
  const match = COMMENT.exec(text)
  if (!match || text.slice(0, match.index).trim() !== '') return undefined
  const line = match[1]
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
  return line ? line.slice(0, 200) : undefined
}

/**
 * Infers a shortcode definition from its template text (pure; exported for
 * tests and for hosts that read templates themselves).
 */
export function parseShortcodeTemplate(name: string, text: string, source: ShortcodeDef['source']): ShortcodeDef {
  const description = leadingDescription(text)
  const code = text.replace(COMMENT, ' ')
  const named = new Map<string, ShortcodeParam>()
  const positional = new Map<number, ShortcodeParam>()

  for (const action of code.matchAll(ACTION)) {
    const body = action[1]
    const names = [...body.matchAll(NAMED_GET)].map((m) => m[1] ?? m[2])
    for (const m of body.matchAll(PARAMS_FIELD)) names.push(m[1])
    const indexes = [...body.matchAll(POSITIONAL_GET)].map((m) => Number(m[1]))
    const uniqueNames = [...new Set(names)]
    const uniqueIndexes = [...new Set(indexes)]
    // `.Get "id" | default (.Get 0)`: one parameter that can be named or positional.
    if (uniqueNames.length === 1 && uniqueIndexes.length === 1) {
      const existing = named.get(uniqueNames[0])
      named.set(uniqueNames[0], { ...existing, name: uniqueNames[0], positional: uniqueIndexes[0] })
      continue
    }
    for (const n of uniqueNames) if (!named.has(n)) named.set(n, { name: n })
    const variable = ASSIGNMENT.exec(body)?.[1]
    for (const index of uniqueIndexes) {
      if (positional.has(index)) continue
      const label = uniqueIndexes.length === 1 && variable ? variable : String(index)
      positional.set(index, { name: label, positional: index, positionalOnly: true })
    }
  }

  // Positions also reachable by name are not listed twice.
  const byName = [...named.values()]
  for (const param of byName) if (param.positional !== undefined) positional.delete(param.positional)
  const params = [...[...positional.values()].sort((a, b) => (a.positional ?? 0) - (b.positional ?? 0)), ...byName]
  const paired = INNER.test(code)
  const def: ShortcodeDef = { name, params, paired, source }
  if (paired && MARKDOWN.test(code)) def.markdown = true
  if (description) def.description = description
  return def
}

/** `layouts/_shortcodes/dir/name.en.html` → `dir/name` (language and output format suffixes removed). */
export function shortcodeNameFromPath(path: string, root: string): string | null {
  const normalized = path.replace(/\\/g, '/')
  const prefix = root.replace(/\/+$/, '') + '/'
  if (!normalized.startsWith(prefix)) return null
  const rest = normalized.slice(prefix.length)
  if (!rest.toLowerCase().endsWith('.html')) return null
  const slash = rest.lastIndexOf('/')
  const dir = rest.slice(0, slash + 1)
  const base = rest.slice(slash + 1, -'.html'.length)
  const name = base.split('.')[0]
  return name ? dir + name : null
}

export interface DiscoverIo {
  listFiles(dir: string, extensions: string[]): Promise<{ path: string }[]>
  readText(path: string): Promise<{ text: string }>
  /** Parsed values of a config file; throws when the file does not exist. */
  readConfig(path: string): Promise<Record<string, unknown>>
  /**
   * Theme components outside the plain themes folder (Hugo Modules, `_vendor/`, a themesDir
   * outside the site). Defaults to `hugo config mounts` with the app's io; hosts with
   * their own `io` and no module support leave it out (only the themes folder is read).
   */
  sources?: ThemeSourcesIo
}

export interface DiscoverOptions {
  /**
   * The site's config files (SiteInfo.configFiles). Root `hugo.*` / `config.*` and
   * `config/_default/hugo.*` / `config.*` / `module.*` are read for the theme. Default: the
   * usual file names, missing ones skipped.
   */
  configFiles?: readonly string[]
  /** File access; defaults to the app's Tauri commands. */
  io?: DiscoverIo
}

const DEFAULT_CONFIG_FILES = ['hugo.toml', 'hugo.yaml', 'hugo.yml', 'hugo.json', 'config.toml', 'config.yaml', 'config.yml', 'config.json']
  .flatMap((name) => [name, `config/_default/${name}`])
  .concat(['config/_default/module.toml', 'config/_default/module.yaml', 'config/_default/module.yml', 'config/_default/module.json'])

const defaultIo: DiscoverIo = {
  listFiles: (dir, extensions) => api.listFiles(dir, extensions),
  readText: (path) => api.readText(path),
  readConfig: async (path) => (await readConfigFile(path)).values,
  sources: defaultSourcesIo,
}

function isThemeConfig(path: string): boolean {
  return /^(?:config\/_default\/)?(?:hugo|config)\.(?:toml|ya?ml|json)$|^config\/_default\/module\.(?:toml|ya?ml|json)$/i.test(path.replace(/\\/g, '/'))
}

/** Theme names, the themes folder and module imports from the site config. */
async function readThemes(io: DiscoverIo, configFiles: readonly string[]): Promise<ThemeSettings> {
  const configs: { path: string; values: Record<string, unknown> }[] = []
  for (const path of configFiles.filter(isThemeConfig)) {
    try {
      configs.push({ path, values: await io.readConfig(path) })
    } catch {
      // Missing or unreadable: try the next candidate.
    }
  }
  return themeSettingsFromConfigs(configs)
}

interface LayoutFiles {
  list(dir: string, extensions: string[]): Promise<{ path: string }[]>
  read(path: string): Promise<{ text: string }>
}

/** Definitions under one `layouts` folder; `_shortcodes` wins over the legacy `shortcodes`. */
async function scanLayouts(files: LayoutFiles, source: ShortcodeDef['source']): Promise<Map<string, ShortcodeDef>> {
  const found = new Map<string, ShortcodeDef>()
  for (const folder of ['shortcodes', '_shortcodes']) {
    const root = `layouts/${folder}`
    let listed: { path: string }[]
    try {
      listed = await files.list(root, ['html'])
    } catch {
      continue
    }
    const texts = new Map<string, string[]>()
    for (const file of listed) {
      const name = shortcodeNameFromPath(file.path, root)
      if (!name) continue
      try {
        const { text } = await files.read(file.path)
        texts.set(name, [...(texts.get(name) ?? []), text])
      } catch {
        // Unreadable template: skip it.
      }
    }
    // Language/output-format variants of one shortcode are read as one template.
    for (const [name, variants] of texts) found.set(name, parseShortcodeTemplate(name, variants.join('\n'), source))
  }
  return found
}

/**
 * Shortcodes defined by the site and its theme components (`layouts/_shortcodes`, legacy
 * `layouts/shortcodes`), with parameters found in their templates. A site template overrides a
 * theme template of the same name. Sorted by name. Theme components are found wherever they
 * live: the themes folder, `_vendor/`, or Hugo's module cache (see lib/themeSources).
 */
export async function discoverShortcodes(options: DiscoverOptions = {}): Promise<ShortcodeDef[]> {
  const io = options.io ?? defaultIo
  const settings = await readThemes(io, options.configFiles ?? DEFAULT_CONFIG_FILES)
  const sources = io.sources ?? siteOnlyIo(io)
  const { components } = await listThemeComponents(settings, sources)
  const all = new Map<string, ShortcodeDef>()
  // Later components have lower precedence in Hugo: apply them first.
  for (const component of [...components].reverse()) {
    for (const [name, def] of await scanLayouts({ list: (dir, ext) => component.list(dir, ext), read: (path) => component.read(path) }, 'theme')) all.set(name, def)
  }
  for (const [name, def] of await scanLayouts({ list: (dir, ext) => io.listFiles(dir, ext), read: (path) => io.readText(path) }, 'site')) all.set(name, def)
  return [...all.values()].sort((a, b) => a.name.localeCompare(b.name))
}
