// Standalone pages: what a site has besides the posts of its sections. Content files at the content
// root (about.md, a root bundle such as contact/index.md), section and home pages (_index.md), and
// pages that pick their own type or layout in front matter. With several languages, the content
// folder of each language (`languages.<lang>.contentDir`, content mounts) counts as a content root.
import type { ContentFile, PageEntry } from '../../lib/api'
import { contentLocation, permalinkPath, type SiteUrlConfig } from '../../lib/permalinks'
import { pageMenuEntries } from '../settings/model/pageMenus'
import { pageRefMatches } from '../settings/model/pageRefs'
import type { Tree } from '../settings/model/values'

export type StandaloneReason = 'home' | 'section' | 'root' | 'type'

export interface MenuMembership {
  menu: string
  lang: string | null
  /** In the page's front matter, or a config entry that links to the page. */
  from: 'page' | 'config'
}

export interface StandalonePage {
  path: string
  title: string
  reason: StandaloneReason
  draft: boolean
  /** Front matter `type` / `layout`, when set. */
  type: string | null
  layout: string | null
  /** Address from Hugo's page list (path only, decoded); null when Hugo does not list the page. */
  url: string | null
  /** Language when the site has several and this is not the default one. */
  lang: string | null
  menus: MenuMembership[]
}

/** A file's language from its name or content folder; null for the default language or without settings. */
function language(path: string, config: SiteUrlConfig | undefined): string | null {
  if (!config || config.languages.length < 2) return null
  const located = contentLocation(path, config)
  return located && located.lang !== config.defaultLanguage ? located.lang : null
}

export interface ConfigMenu {
  name: string
  lang: string | null
  entries: readonly Tree[]
}

function field(values: Tree | null | undefined, name: string): unknown {
  if (!values) return undefined
  const key = Object.keys(values).find((k) => k.toLowerCase() === name)
  return key === undefined ? undefined : values[key]
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function stem(file: string, languages: readonly string[]): string {
  const parts = file.replace(/\._(language|role|version)_[^._]+_(?=\.[^.]+$)/gi, '').split('.')
  if (parts.length > 1) parts.pop()
  if (parts.length > 1 && languages.some((l) => l.toLowerCase() === parts[parts.length - 1].toLowerCase())) parts.pop()
  return parts.join('.')
}

/** A file's path in the content tree: below its language's content folder when `config` is given. */
function contentRel(path: string, contentDir: string, config?: SiteUrlConfig): string {
  const located = config ? contentLocation(path, config) : null
  if (located) return located.rel
  const prefix = `${contentDir}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/** Why a content file counts as a standalone page, or null for a regular post in a section. */
export function standaloneReason(
  path: string,
  allPaths: ReadonlySet<string>,
  frontMatter: Tree | null,
  contentDir = 'content',
  languages: readonly string[] = [],
  config?: SiteUrlConfig,
): StandaloneReason | null {
  const codes = config ? config.languages.map((l) => l.code) : languages
  const rel = contentRel(path, contentDir, config)
  const parts = rel.split('/')
  const name = stem(parts[parts.length - 1], codes)
  if (name === '_index') return parts.length === 1 ? 'home' : 'section'
  if (parts.length === 1) return 'root'
  // A leaf bundle right under the content folder (contact/index.md) is a page of the home section.
  if (parts.length === 2 && name === 'index') {
    const dir = `${parts[0]}/`
    const isSection = [...allPaths].some((p) => {
      const other = contentRel(p, contentDir, config)
      return other.startsWith(dir) && stem(other.slice(dir.length), codes) === '_index'
    })
    if (!isSection) return 'root'
  }
  if (text(field(frontMatter, 'type')) || text(field(frontMatter, 'layout'))) return 'type'
  return null
}

function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => {
    let path = u.trim()
    try {
      path = new URL(path).pathname
    } catch {
      // A site-relative address.
    }
    return path.replace(/\/+$/, '').toLowerCase() || '/'
  }
  return norm(a) === norm(b)
}

/**
 * Menus that config entries put this page in (by pageRef, or by url matching its address). With
 * `config`, pageRef is read below the page's own content folder and a language's menus only link
 * pages of that language.
 */
export function configMenusOf(path: string, url: string | null, menus: readonly ConfigMenu[], contentDir = 'content', config?: SiteUrlConfig): MenuMembership[] {
  const out: MenuMembership[] = []
  const located = config ? contentLocation(path, config) : null
  // pageRef is relative to the content tree; a stand-in path puts the file there.
  const refPath = located ? `content/${located.rel}` : path
  const refRoot = located ? 'content' : contentDir
  for (const menu of menus) {
    if (located && menu.lang !== null && menu.lang.toLowerCase() !== located.lang) continue
    const linked = menu.entries.some((entry) => {
      const ref = text(field(entry, 'pageref'))
      if (ref && pageRefMatches(ref, refPath, refRoot)) return true
      const target = text(field(entry, 'url'))
      return !!target && url !== null && sameUrl(target, url)
    })
    if (linked) out.push({ menu: menu.name, lang: menu.lang, from: 'config' })
  }
  return out
}

export interface StandaloneInput {
  files: readonly ContentFile[]
  pages: readonly PageEntry[]
  frontMatter: ReadonlyMap<string, Tree | null>
  configMenus: readonly ConfigMenu[]
  contentDir?: string
  languages?: readonly string[]
  /** Languages and their content folders; a page's language also comes from its folder. */
  config?: SiteUrlConfig
}

/** The standalone pages of a site, home first, then by path. */
export function standalonePages({ files, pages, frontMatter, configMenus, contentDir = 'content', languages = [], config }: StandaloneInput): StandalonePage[] {
  const all = new Set(files.map((f) => f.path))
  const byPath = new Map(pages.map((p) => [p.path, p]))
  const out: StandalonePage[] = []
  for (const file of files) {
    const values = frontMatter.get(file.path) ?? null
    const reason = standaloneReason(file.path, all, values, contentDir, languages, config)
    if (!reason) continue
    const entry = byPath.get(file.path)
    const url = entry ? permalinkPath(entry.permalink) : null
    const lang = language(file.path, config)
    const pageMenus = pageMenuEntries(file.path, values).map((e): MenuMembership => ({ menu: e.menu, lang, from: 'page' }))
    const draftValue = field(values, 'draft')
    out.push({
      path: file.path,
      title: text(field(values, 'title')) ?? entry?.title ?? file.title ?? file.path.split('/').pop() ?? file.path,
      reason,
      draft: entry?.draft ?? (draftValue === true || draftValue === 'true'),
      type: text(field(values, 'type')),
      layout: text(field(values, 'layout')),
      url,
      lang,
      menus: [...pageMenus, ...configMenusOf(file.path, url, configMenus, contentDir, config)],
    })
  }
  const order: Record<StandaloneReason, number> = { home: 0, root: 1, section: 2, type: 3 }
  return out.sort((a, b) => order[a.reason] - order[b.reason] || a.path.localeCompare(b.path))
}

/** The next weight for a new entry at the end of a menu. */
export function nextMenuWeight(menu: string, configMenus: readonly ConfigMenu[], pageWeights: readonly number[]): number {
  const weights = [
    ...configMenus.filter((m) => m.name.toLowerCase() === menu.toLowerCase()).flatMap((m) => m.entries.map((e) => Number(field(e, 'weight')))),
    ...pageWeights,
  ].filter((w) => Number.isFinite(w))
  const max = weights.reduce((m, w) => Math.max(m, w), 0)
  return Math.ceil((max + 1) / 10) * 10
}
