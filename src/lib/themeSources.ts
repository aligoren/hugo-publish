// The theme components a site uses, in Hugo's order (the first one wins on conflicts), with a
// way to list, read and hash their files wherever they live: a folder inside the site
// (`themes/x`, a custom `themesDir`, `_vendor/…`) or a Hugo Module folder outside it (the module
// cache, a local replacement). The site itself is not a component.
//
// Fast path: when every configured theme is a folder under the themes folder (and none of them
// imports further components), nothing but the site API is used. Otherwise `hugo config mounts`
// (via `moduleApi.moduleList`) says which folders Hugo really uses. Paths inside a component are
// the ones Hugo sees: a module that mounts `dist/` at `assets/x/` shows its files as `assets/x/…`.
import { api, moduleApi, type FileHash, type HugoModule, type ModuleMount, type SiteFile, type TextFile } from './api'

export interface ThemeSourcesIo {
  /** Site-relative listing (recursive). */
  listFiles(dir: string, extensions?: string[]): Promise<SiteFile[]>
  readText(path: string): Promise<TextFile>
  siteHashFiles(paths: string[]): Promise<FileHash[]>
  moduleList(): Promise<HugoModule[]>
  moduleListFiles(dir: string, sub: string, extensions: string[]): Promise<SiteFile[]>
  moduleReadText(dir: string, path: string): Promise<TextFile>
  moduleHashFiles(dir: string, paths: string[]): Promise<FileHash[]>
}

/** The app's Tauri commands (looked up on each call, so tests can mock the api module). */
export const defaultSourcesIo: ThemeSourcesIo = {
  listFiles: (dir, extensions = []) => api.listFiles(dir, extensions),
  readText: (path) => api.readText(path),
  siteHashFiles: (paths) => moduleApi.siteHashFiles(paths),
  moduleList: () => moduleApi.moduleList(),
  moduleListFiles: (dir, sub, extensions) => moduleApi.moduleListFiles(dir, sub, extensions),
  moduleReadText: (dir, path) => moduleApi.moduleReadText(dir, path),
  moduleHashFiles: (dir, paths) => moduleApi.moduleHashFiles(dir, paths),
}

const noModules = () => Promise.reject(new Error('Hugo Modules are not available here'))

/** IO from plain site file access only (tests, hosts without the module commands). */
export function siteOnlyIo(io: { listFiles(dir: string, extensions: string[]): Promise<{ path: string; size?: number }[]>; readText(path: string): Promise<{ text: string; version?: string }> }): ThemeSourcesIo {
  return {
    listFiles: async (dir, extensions = []) => (await io.listFiles(dir, extensions)).map((f) => ({ path: f.path, size: f.size ?? 0 })),
    readText: async (path) => {
      const file = await io.readText(path)
      return { text: file.text, version: file.version ?? '' }
    },
    siteHashFiles: noModules,
    moduleList: noModules,
    moduleListFiles: noModules,
    moduleReadText: noModules,
    moduleHashFiles: noModules,
  }
}

export interface ThemeComponent {
  /** The configured name (`theme` value or module path). */
  name: string
  /** `site`: a folder inside the site; `module`: a folder outside it (module cache, replacement). */
  location: 'site' | 'module'
  /** Site-relative folder (`site`) or absolute folder (`module`). */
  root: string
  /** Short text for the UI: the site folder, or `module@version`. */
  label: string
  /** What `hugo config mounts` said about it (null on the fast path). */
  module: HugoModule | null
  /** Files under `sub` (a component-relative folder, `.` for all); paths relative to the component. */
  list(sub?: string, extensions?: string[]): Promise<SiteFile[]>
  read(path: string): Promise<TextFile>
  /** Content hashes; paths relative to the component, missing files left out. */
  hash(paths: string[]): Promise<FileHash[]>
}

/** Forward slashes, no `./` or surrounding slashes; `.` (the whole folder) becomes ''. */
const trim = (p: string) => {
  const clean = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  return clean === '.' ? '' : clean
}

function isIdentity(mounts: ModuleMount[]): boolean {
  return mounts.every((m) => trim(m.source) === trim(m.target))
}

function under(path: string, folder: string): string | null {
  if (folder === '') return path
  if (path === folder) return ''
  return path.startsWith(folder + '/') ? path.slice(folder.length + 1) : null
}

/** Where a module file shows up for Hugo (longest mount source wins); unmounted files keep their path. */
export function virtualPath(real: string, mounts: ModuleMount[]): string {
  let best: { rest: string; mount: ModuleMount; length: number } | null = null
  for (const mount of mounts) {
    const source = trim(mount.source)
    const rest = under(real, source)
    if (rest !== null && (!best || source.length > best.length)) best = { rest, mount, length: source.length }
  }
  if (!best) return real
  const target = trim(best.mount.target)
  return best.rest ? (target ? `${target}/${best.rest}` : best.rest) : target
}

/** The module file behind a path Hugo sees (longest mount target wins). */
export function realPath(virtual: string, mounts: ModuleMount[]): string {
  let best: { rest: string; mount: ModuleMount; length: number } | null = null
  for (const mount of mounts) {
    const target = trim(mount.target)
    const rest = under(virtual, target)
    if (rest !== null && (!best || target.length > best.length)) best = { rest, mount, length: target.length }
  }
  if (!best) return virtual
  const source = trim(best.mount.source)
  return best.rest ? (source ? `${source}/${best.rest}` : best.rest) : source
}

interface RawFiles {
  list(sub: string, extensions: string[]): Promise<SiteFile[]>
  read(path: string): Promise<TextFile>
  hash(paths: string[]): Promise<FileHash[]>
}

function siteFiles(root: string, io: ThemeSourcesIo): RawFiles {
  const prefix = root + '/'
  const strip = (path: string) => (path.startsWith(prefix) ? path.slice(prefix.length) : path)
  return {
    list: async (sub, extensions) => (await io.listFiles(sub === '.' || sub === '' ? root : `${root}/${sub}`, extensions)).map((f) => ({ ...f, path: strip(f.path) })),
    read: (path) => io.readText(`${root}/${path}`),
    hash: async (paths) => (paths.length === 0 ? [] : (await io.siteHashFiles(paths.map((p) => `${root}/${p}`))).map((h) => ({ ...h, path: strip(h.path) }))),
  }
}

function moduleFiles(dir: string, io: ThemeSourcesIo): RawFiles {
  return {
    list: (sub, extensions) => io.moduleListFiles(dir, sub || '.', extensions),
    read: (path) => io.moduleReadText(dir, path),
    hash: async (paths) => (paths.length === 0 ? [] : io.moduleHashFiles(dir, paths)),
  }
}

function makeComponent(base: Omit<ThemeComponent, 'list' | 'read' | 'hash'>, raw: RawFiles, mounts: ModuleMount[]): ThemeComponent {
  if (isIdentity(mounts)) {
    return {
      ...base,
      list: (sub = '.', extensions = []) => raw.list(trim(sub) || '.', extensions),
      read: (path) => raw.read(path),
      hash: (paths) => raw.hash(paths),
    }
  }
  // Mounts move folders: list everything once per call and translate the paths.
  const known = new Map<string, string>()
  const real = (path: string) => known.get(path) ?? realPath(path, mounts)
  return {
    ...base,
    list: async (sub = '.', extensions = []) => {
      const folder = trim(sub)
      const all = await raw.list('.', extensions)
      const out: SiteFile[] = []
      for (const file of all) {
        const path = virtualPath(file.path, mounts)
        known.set(path, file.path)
        if (folder === '' || under(path, folder) !== null) out.push({ ...file, path })
      }
      return out.sort((a, b) => a.path.localeCompare(b.path))
    },
    read: (path) => raw.read(real(path)),
    hash: async (paths) => {
      const back = new Map(paths.map((p) => [real(p), p]))
      return (await raw.hash([...back.keys()])).map((h) => ({ ...h, path: back.get(h.path) ?? h.path }))
    },
  }
}

/** A theme folder inside the site (the fast path, and what tests use). */
export function siteComponent(name: string, root: string, io: ThemeSourcesIo = defaultSourcesIo): ThemeComponent {
  const clean = trim(root)
  return makeComponent({ name, location: 'site', root: clean, label: clean, module: null }, siteFiles(clean, io), [])
}

function looksLikeFolder(path: string): boolean {
  return path.startsWith('.') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)
}

/** A component from `hugo config mounts`. */
export function moduleComponent(module: HugoModule, io: ThemeSourcesIo = defaultSourcesIo): ThemeComponent {
  const name = looksLikeFolder(module.path) ? (module.modulePath ?? module.path) : module.path
  const inSite = module.siteDir !== null && module.siteDir !== ''
  const label = module.version ? `${module.modulePath ?? module.path}@${module.version}` : inSite ? module.siteDir! : (module.modulePath ?? module.dir)
  return makeComponent(
    { name, location: inSite ? 'site' : 'module', root: inSite ? module.siteDir! : module.dir, label, module },
    inSite ? siteFiles(module.siteDir!, io) : moduleFiles(module.dir, io),
    module.mounts,
  )
}

// ---- Which components ---------------------------------------------------------------------

export interface ThemeSettings {
  /** `theme` names in order (first wins). */
  themes: string[]
  /** Site-relative themes folder (or a path outside the site). */
  themesDir: string
  /** `module.imports[].path`. */
  imports: string[]
}

function getCi(values: unknown, key: string): unknown {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return undefined
  const record = values as Record<string, unknown>
  if (key in record) return record[key]
  const found = Object.keys(record).find((k) => k.toLowerCase() === key.toLowerCase())
  return found === undefined ? undefined : record[found]
}

function rank(path: string): number {
  const lower = path.toLowerCase()
  if (!lower.includes('/')) return 0
  if (/^config\/_default\/(hugo|config)\.[a-z]+$/.test(lower)) return 1
  return 2
}

/**
 * Theme names, themes folder and module imports from parsed config files (root `hugo.*` /
 * `config.*`, `config/_default/hugo.*` / `config.*` / `module.*`); later files win, as in Hugo.
 */
export function themeSettingsFromConfigs(configs: { path: string; values: Record<string, unknown> }[]): ThemeSettings {
  const main = configs
    .filter((c) => /^(config\/_default\/)?(hugo|config)\.(toml|ya?ml|json)$/i.test(c.path.replace(/\\/g, '/')))
    .sort((a, b) => rank(b.path) - rank(a.path))
  let themes: string[] = []
  let themesDir = 'themes'
  for (const config of main) {
    const theme = getCi(config.values, 'theme')
    const names = (Array.isArray(theme) ? theme : [theme]).filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
    if (names.length > 0) {
      themes = names
      break
    }
  }
  for (const config of main) {
    const dir = getCi(config.values, 'themesDir')
    if (typeof dir === 'string' && dir.trim()) {
      themesDir = trim(dir.trim()) || 'themes'
      break
    }
  }
  const imports: string[] = []
  for (const config of configs) {
    const path = config.path.replace(/\\/g, '/')
    let list: unknown
    if (/^config\/_default\/module\.[a-z]+$/i.test(path)) list = getCi(config.values, 'imports')
    else if (/^(config\/_default\/)?(hugo|config)\.[a-z]+$/i.test(path)) list = getCi(getCi(config.values, 'module'), 'imports')
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      const p = typeof entry === 'string' ? entry : getCi(entry, 'path')
      if (typeof p === 'string' && p && !imports.includes(p)) imports.push(p)
    }
  }
  return { themes: [...new Set(themes)], themesDir, imports }
}

export function isOutsideSite(dir: string): boolean {
  return dir.startsWith('..') || dir.startsWith('/') || /^[a-zA-Z]:/.test(dir)
}

const ROOT_CONFIG = /^(hugo|config)\.(toml|ya?ml|json)$|^config\/_default\/(hugo|config|module)\.(toml|ya?ml|json)$/i
const NESTED = /\bimports\b|^\s*["']?theme["']?\s*[=:]/im

/** A theme folder whose own config imports further components (only Hugo knows those). */
async function importsMore(root: string, files: SiteFile[], io: ThemeSourcesIo): Promise<boolean> {
  const configs = files.map((f) => f.path.slice(root.length + 1)).filter((p) => ROOT_CONFIG.test(p))
  for (const path of configs) {
    const text = await io
      .readText(`${root}/${path}`)
      .then((f) => f.text)
      .catch(() => '')
    if (NESTED.test(text)) return true
  }
  return false
}

export interface ThemeComponentsResult {
  components: ThemeComponent[]
  /** Configured names no folder was found for. */
  missing: string[]
  /** Why Hugo could not list the modules (the folders found without it are still returned). */
  error: unknown
  /** The list came from `hugo config mounts`. */
  fromHugo: boolean
}

/** Folders Hugo would try for a name without module support: themesDir, `_vendor/`, the last path segment. */
export function folderCandidates(name: string, themesDir: string): string[] {
  const out: string[] = []
  if (!isOutsideSite(themesDir)) out.push(`${themesDir}/${name}`)
  if (name.includes('/')) {
    out.push(`_vendor/${name}`)
    const last = name.split('/').filter(Boolean).pop()
    if (last && !isOutsideSite(themesDir)) out.push(`${themesDir}/${last}`)
  }
  return out
}

/** The site's theme components in Hugo's order. */
export async function listThemeComponents(settings: ThemeSettings, io: ThemeSourcesIo = defaultSourcesIo): Promise<ThemeComponentsResult> {
  const names = settings.themes.length > 0 ? settings.themes : settings.imports
  if (names.length === 0) return { components: [], missing: [], error: null, fromHugo: false }
  const { themesDir } = settings
  if (settings.imports.length === 0 && !isOutsideSite(themesDir)) {
    const found = await Promise.all(
      settings.themes.map(async (name) => {
        const root = `${themesDir}/${name}`
        const files = await io.listFiles(root).catch(() => [] as SiteFile[])
        return files.length > 0 ? { name, root, files } : null
      }),
    )
    if (found.every((f) => f !== null)) {
      const nested = await Promise.all(found.map((f) => importsMore(f!.root, f!.files, io)))
      if (!nested.some(Boolean)) {
        return { components: found.map((f) => siteComponent(f!.name, f!.root, io)), missing: [], error: null, fromHugo: false }
      }
    }
  }
  try {
    const modules = await io.moduleList()
    return { components: modules.map((m) => moduleComponent(m, io)), missing: [], error: null, fromHugo: true }
  } catch (error) {
    // Without Hugo: the folders that exist inside the site, as before module support.
    const components: ThemeComponent[] = []
    const missing: string[] = []
    for (const name of names) {
      let hit: string | null = null
      for (const root of folderCandidates(name, themesDir)) {
        const files = await io.listFiles(root).catch(() => [] as SiteFile[])
        if (files.length > 0) {
          hit = root
          break
        }
      }
      if (hit) components.push(siteComponent(name, hit, io))
      else missing.push(name)
    }
    return { components, missing, error, fromHugo: false }
  }
}

/** The component a configured name refers to (exact name, module path, or folder name). */
export function componentFor(components: ThemeComponent[], name: string): ThemeComponent | null {
  const lower = name.toLowerCase()
  return (
    components.find((c) => c.name === name) ??
    components.find((c) => c.module?.modulePath === name || c.module?.path === name) ??
    components.find((c) => c.root.toLowerCase().endsWith('/' + lower)) ??
    null
  )
}
