// Hugo's page addresses, computed locally: permalink patterns (`permalinks.page.posts =
// '/:year/:slug/'`, the older `permalinks.posts`, and the array form with `target` matchers from
// Hugo 0.161), the language prefix, the base URL path and which language a content file belongs
// to. Used to try a pattern before saving it and to predict a page's address after a rename.
// Mirrors resources/page/permalinks.go and Hugo's language/URL rules.
import type { PageEntry } from './api'
import { goFormat, HUGO_REFERENCE, inTimeZone, MONTH_NAMES, parseWallTime, WEEKDAY_NAMES, weekday, yearDay, type WallTime } from './goDate'

type Tree = Record<string, unknown>

function isPlainObject(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The key of `tree` for `key` in any casing (Hugo's keys are case-insensitive). */
function keyOf(tree: unknown, key: string): string | undefined {
  if (!isPlainObject(tree)) return undefined
  if (Object.prototype.hasOwnProperty.call(tree, key)) return key
  const lower = key.toLowerCase()
  return Object.keys(tree).find((k) => k.toLowerCase() === lower)
}

function valueAt(tree: unknown, path: readonly string[]): unknown {
  let current: unknown = tree
  for (const key of path) {
    const found = keyOf(current, key)
    if (found === undefined) return undefined
    current = (current as Tree)[found]
  }
  return current
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export interface UrlOptions {
  /** `removePathAccents`: `Gündem` → `gundem` (the dotless ı stays). */
  removePathAccents?: boolean
  /** `disablePathToLower`: keep upper-case letters in paths. */
  disablePathToLower?: boolean
  /** `uglyURLs`: `/posts/hello.html` instead of `/posts/hello/`. */
  uglyURLs?: boolean
  /** `timeZone` (IANA name) for dates written without an offset. */
  timeZone?: string | null
  /** Hugo 0.167+: a section's `slug` replaces its folder name in default paths below it. */
  sectionSlugs?: boolean
}

/** What a pattern can read from a page. */
export interface PermalinkPage {
  title: string
  /** Front matter `slug`; empty when not set. */
  slug: string
  /** Date as written (`2026-01-31T10:00:00+03:00`). */
  date: string
  /** First-level section; empty for pages at the content root. */
  section: string
  /** Sections from the top down to the page's own section. */
  sections: string[]
  /** Slug of each of those sections (front matter of its `_index`), else its folder name. */
  sectionSlugs: string[]
  /** File name without extension and language; the folder name for a bundle; empty for `_index`. */
  contentBaseName: string
  /** Folders between the content folder and the page (the bundle folder excluded). */
  dirs: string[]
  /** Front matter `url`: replaces the whole path, patterns do not apply. */
  url?: string
  /** `page`, `section`, `term`, `taxonomy`, `home`. */
  kind?: string
  /** Language code (lower case); undefined when not known. */
  lang?: string
  /** Hugo's logical path (`/posts/hello`, `/posts`), matched by `target.path` globs. */
  logicalPath?: string
}

// ---- Hugo's URLize ----------------------------------------------------------------------------

function removeAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC')
}

/** helpers.PathSpec.UnicodeSanitize: keeps letters, digits and a few signs; spaces become `-`. */
export function unicodeSanitize(value: string, options: UrlOptions = {}): string {
  const source = [...(options.removePathAccents ? removeAccents(value) : value)]
  let out = ''
  let prependHyphen = false
  let wasHyphen = false
  source.forEach((ch, i) => {
    const allowed =
      './\\_#+~-@'.includes(ch) ||
      /[\p{L}\p{N}\p{M}]/u.test(ch) ||
      (ch === '%' && i + 2 < source.length && /[0-9a-fA-F]/.test(source[i + 1]) && /[0-9a-fA-F]/.test(source[i + 2]))
    if (allowed) {
      wasHyphen = ch === '-'
      if (prependHyphen) {
        if (!wasHyphen) out += '-'
        prependHyphen = false
      }
      out += ch
    } else if (out.length > 0 && !wasHyphen && /\s/u.test(ch)) {
      prependHyphen = true
    }
  })
  return out
}

/** Hugo's `urlize` without the final percent-encoding (addresses are shown readable). */
export function urlize(value: string, options: UrlOptions = {}): string {
  const sanitized = unicodeSanitize(value, options)
  return options.disablePathToLower ? sanitized : sanitized.toLowerCase()
}

// ---- Tokens -----------------------------------------------------------------------------------

/** `:token` or `:token[slice]`, as Hugo's attributeRegexp. */
const ATTRIBUTE = /:\w+(\[.+?\])?/g

export const PERMALINK_TOKENS = [
  'year',
  'month',
  'monthname',
  'day',
  'weekday',
  'weekdayname',
  'yearday',
  'section',
  'sections',
  'sectionslug',
  'sectionslugs',
  'title',
  'slug',
  'slugorcontentbasename',
  'contentbasename',
  'slugorfilename',
  'filename',
] as const

/** Hugo's slice syntax for `:sections[1:]`, `:sections[:last]`, `:sections[last]`, `:sections[0]`. */
export function sliceSections(items: readonly string[], cut: string): string[] {
  const spec = cut.trim().toLowerCase()
  if (spec === '') return []
  const parts = spec.split(':')
  const index = (s: string, low: boolean): number => {
    if (s === '') return low ? 0 : items.length
    if (s === 'last') return items.length - 1
    const n = Math.max(0, Number.parseInt(s, 10) || 0)
    if (n >= items.length) return low ? -1 : items.length
    return n
  }
  const low = index(parts[0], true)
  if (parts.length === 1) return low < 0 || low >= items.length ? [] : [items[low]]
  const high = index(parts[1], false)
  if (low < 0 || high < 0 || high < low) return []
  return items.slice(low, high)
}

export class PermalinkError extends Error {
  readonly token: string
  constructor(token: string) {
    super(`Unknown permalink token ${token}`)
    this.name = 'PermalinkError'
    this.token = token
  }
}

/** Tokens in a pattern that Hugo would reject (neither a known token nor a Go date layout). */
export function unknownTokens(pattern: string): string[] {
  const out: string[] = []
  for (const match of pattern.matchAll(ATTRIBUTE)) {
    if (!isKnown(match[0].slice(1))) out.push(match[0])
  }
  return out
}

function isKnown(attr: string): boolean {
  const bracket = attr.indexOf('[')
  const name = bracket >= 0 ? attr.slice(0, bracket) : attr
  if (bracket >= 0) return name === 'sections' || name === 'sectionslugs'
  if ((PERMALINK_TOKENS as readonly string[]).includes(attr)) return true
  return goFormat(HUGO_REFERENCE, attr) !== attr
}

function tokenValue(attr: string, page: PermalinkPage, time: WallTime, options: UrlOptions): string {
  const bracket = attr.indexOf('[')
  if (bracket >= 0) {
    const name = attr.slice(0, bracket)
    const cut = attr.slice(bracket + 1, -1)
    if (name === 'sections') return sliceSections(page.sections, cut).join('/')
    if (name === 'sectionslugs') return sliceSections(page.sectionSlugs, cut).join('/')
    throw new PermalinkError(`:${attr}`)
  }
  const slugOr = (fallback: string) => (page.slug !== '' ? urlize(page.slug, options) : fallback)
  switch (attr) {
    case 'year':
      return goFormat(time, '2006')
    case 'month':
      return goFormat(time, '01')
    case 'monthname':
      return MONTH_NAMES[time.month - 1] ?? ''
    case 'day':
      return goFormat(time, '02')
    case 'weekday':
      return String(weekday(time))
    case 'weekdayname':
      return WEEKDAY_NAMES[weekday(time)]
    case 'yearday':
      return String(yearDay(time))
    case 'section':
      return page.section
    case 'sections':
      return page.sections.join('/')
    case 'sectionslug':
      return page.sectionSlugs[0] ?? ''
    case 'sectionslugs':
      return page.sectionSlugs.join('/')
    case 'title':
      return urlize(page.title, options)
    case 'slug':
      return slugOr(urlize(page.title, options))
    case 'contentbasename':
    case 'filename':
      return urlize(page.contentBaseName, options)
    case 'slugorcontentbasename':
    case 'slugorfilename':
      return slugOr(urlize(page.contentBaseName, options))
    default:
      if (goFormat(HUGO_REFERENCE, attr) !== attr) return goFormat(time, attr)
      throw new PermalinkError(`:${attr}`)
  }
}

const ZERO_TIME: WallTime = { year: 1, month: 1, day: 1, hour: 0, minute: 0, second: 0, offset: 0 }

/** Expands the tokens of a pattern for one page, exactly as written (no clean-up). Throws PermalinkError. */
export function expandTokens(pattern: string, page: PermalinkPage, options: UrlOptions = {}): string {
  const parsed = parseWallTime(page.date)
  const time = parsed ? inTimeZone(parsed, options.timeZone) : ZERO_TIME
  // Like Hugo: each match replaces its first remaining occurrence, in order.
  let out = pattern
  let from = 0
  for (const match of pattern.matchAll(ATTRIBUTE)) {
    const value = tokenValue(match[0].slice(1), page, time, options)
    const at = out.indexOf(match[0], from)
    out = out.slice(0, at) + value + out.slice(at + match[0].length)
    from = at + value.length
  }
  return out
}

/** The page path a pattern produces: tokens expanded, slashes cleaned, lower-cased like Hugo. */
export function expandPermalink(pattern: string, page: PermalinkPage, options: UrlOptions = {}): string {
  return finishPath(expandTokens(pattern, page, options), options)
}

function finishPath(raw: string, options: UrlOptions): string {
  let path = ('/' + raw).replace(/\/{2,}/g, '/')
  if (!options.disablePathToLower) path = path.toLowerCase()
  const last = path.slice(path.lastIndexOf('/') + 1)
  // A last segment with an extension names a file; anything else is a folder with index.html.
  if (last.includes('.')) return path
  if (options.uglyURLs && path !== '/') return path.replace(/\/$/, '') + '.html'
  return path.endsWith('/') ? path : path + '/'
}

/** The path Hugo gives a page when no pattern applies: its folders, then slug or file name. */
export function defaultPath(page: PermalinkPage, options: UrlOptions = {}): string {
  const base = page.slug !== '' && page.contentBaseName !== '' ? page.slug : page.contentBaseName
  const dirs = options.sectionSlugs ? [...page.sectionSlugs, ...page.dirs.slice(page.sections.length)] : page.dirs
  return finishPath([...dirs, base].map((p) => urlize(p, options)).join('/'), options)
}

/** The path of a page with this pattern (null = Hugo's default), front matter `url` first. */
export function pagePath(pattern: string | null, page: PermalinkPage, options: UrlOptions = {}): string {
  if (page.url) return finishPath(page.url, { ...options, disablePathToLower: true, uglyURLs: false })
  return pattern === null ? defaultPath(page, options) : expandPermalink(pattern, page, options)
}

// ---- Site config: languages, base URL, content folders -----------------------------------------

export interface LanguageSettings {
  /** Language key, lower case (Hugo lower-cases them, also in addresses). */
  code: string
  weight: number
  /** Own `baseURL` (multihost sites). */
  baseURL: string | null
  /** Own content folder (`languages.<lang>.contentDir`), site-relative. */
  contentDir: string | null
  timeZone: string | null
  /** `languages.<lang>.permalinks`, when set. */
  permalinks: unknown
}

/** A folder Hugo reads content from. */
export interface ContentRoot {
  /** Site-relative folder. */
  dir: string
  /** Where it lands in the content tree: '' for the top, `blog` for a mount with target `content/blog`. */
  target: string
  /** Language of every file inside; null = from the file name, else the default language. */
  lang: string | null
}

export interface SiteUrlConfig {
  baseURL: string
  defaultLanguage: string
  defaultInSubdir: boolean
  /** Enabled languages, by weight. */
  languages: LanguageSettings[]
  /** Every language has its own `baseURL`: no language prefix in paths. */
  multihost: boolean
  timeZone: string | null
  contentDir: string
  /** Content folders, most specific first. */
  roots: ContentRoot[]
  /** The root `permalinks` value. */
  permalinks: unknown
  /** Which of the trees given to `siteUrlConfig` the root `permalinks` came from (-1: none). */
  permalinksSource: number
  /** `removePathAccents`, `disablePathToLower`, `uglyURLs`: a bool or a map by section. */
  flags: { removePathAccents: unknown; disablePathToLower: unknown; uglyURLs: unknown }
  /** Hugo 0.167+: section slugs carry over to the default paths below them (see `forHugo`). */
  sectionSlugs: boolean
}

function languageCodesOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return list.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim().toLowerCase())
}

const GLOB_CHARS = /[*?[\]{}!]/

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * The URL-related settings of a site from config trees, first tree first for every key: e.g. the
 * files with pending changes, then `hugo config` output (lower-cased keys, permalinks in the
 * array form). Keys are read in any casing.
 */
export function siteUrlConfig(...trees: unknown[]): SiteUrlConfig {
  const pick = (path: string[]): { value: unknown; index: number } => {
    for (let i = 0; i < trees.length; i++) {
      const value = valueAt(trees[i], path)
      if (value !== undefined && value !== null) return { value, index: i }
    }
    return { value: undefined, index: -1 }
  }
  const get = (path: string[]) => pick(path).value
  const defaultLanguage = (text(get(['defaultContentLanguage'])) ?? 'en').toLowerCase()
  const disabled = new Set(languageCodesOf(get(['disableLanguages'])))
  const rawLanguages = get(['languages'])
  const languages: LanguageSettings[] = []
  if (isPlainObject(rawLanguages)) {
    for (const [key, settings] of Object.entries(rawLanguages)) {
      const code = key.toLowerCase()
      const s = isPlainObject(settings) ? settings : {}
      if (valueAt(s, ['disabled']) === true || disabled.has(code)) continue
      languages.push({
        code,
        weight: Number(valueAt(s, ['weight'])) || 0,
        baseURL: text(valueAt(s, ['baseURL'])),
        contentDir: text(valueAt(s, ['contentDir'])) ? normalizeDir(text(valueAt(s, ['contentDir']))!) : null,
        timeZone: text(valueAt(s, ['timeZone'])),
        permalinks: valueAt(s, ['permalinks']),
      })
    }
  }
  if (!languages.some((l) => l.code === defaultLanguage)) {
    languages.push({ code: defaultLanguage, weight: 0, baseURL: null, contentDir: null, timeZone: null, permalinks: undefined })
  }
  languages.sort((a, b) => (a.weight || Infinity) - (b.weight || Infinity) || a.code.localeCompare(b.code))
  const contentDir = normalizeDir(text(get(['contentDir'])) ?? 'content')

  const roots: ContentRoot[] = []
  const mounts = get(['module', 'mounts'])
  let mountedContent = false
  if (Array.isArray(mounts)) {
    for (const mount of mounts) {
      const source = text(valueAt(mount, ['source']))
      const target = text(valueAt(mount, ['target']))?.replace(/\\/g, '/')
      if (!source || !target || !/^content(\/|$)/.test(target)) continue
      mountedContent = true
      const matrix = languageCodesOf(valueAt(mount, ['sites', 'matrix', 'languages']))
      const legacy = languageCodesOf(valueAt(mount, ['lang']))
      const codes = matrix.length > 0 ? matrix : legacy
      const lang = codes.length === 1 && !GLOB_CHARS.test(codes[0]) ? codes[0] : null
      roots.push({ dir: normalizeDir(source), target: normalizeDir(target.slice('content'.length).replace(/^\//, '')), lang })
    }
  }
  for (const language of languages) {
    if (language.contentDir) roots.push({ dir: language.contentDir, target: '', lang: language.code })
  }
  if (!mountedContent) roots.push({ dir: contentDir, target: '', lang: null })
  roots.sort((a, b) => b.dir.length - a.dir.length)

  const permalinks = pick(['permalinks'])
  return {
    baseURL: text(get(['baseURL'])) ?? '',
    defaultLanguage,
    defaultInSubdir: get(['defaultContentLanguageInSubdir']) === true,
    languages,
    multihost: languages.length > 0 && languages.some((l) => l.baseURL !== null),
    timeZone: text(get(['timeZone'])),
    contentDir,
    roots,
    permalinks: permalinks.value,
    permalinksSource: permalinks.index,
    flags: {
      removePathAccents: get(['removePathAccents']),
      disablePathToLower: get(['disablePathToLower']),
      uglyURLs: get(['uglyURLs']),
    },
    sectionSlugs: false,
  }
}

/**
 * Content folders as site-relative paths: `hugo config` may print absolute ones. Folders outside
 * the site (absolute mounts elsewhere) stay as they are and match no site file.
 */
export function relativeToSite(config: SiteUrlConfig, siteRoot: string): SiteUrlConfig {
  const root = normalizeDir(siteRoot)
  const rel = (dir: string) => {
    const d = normalizeDir(dir)
    return d.toLowerCase().startsWith(root.toLowerCase() + '/') ? d.slice(root.length + 1) : d
  }
  const roots = config.roots.map((r) => ({ ...r, dir: rel(r.dir) })).sort((a, b) => b.dir.length - a.dir.length)
  return {
    ...config,
    contentDir: rel(config.contentDir),
    roots,
    languages: config.languages.map((l) => ({ ...l, contentDir: l.contentDir === null ? null : rel(l.contentDir) })),
  }
}

/** The config with the behaviour of a Hugo version (unknown: the newest). */
export function forHugo(config: SiteUrlConfig, hugo: { major: number; minor: number } | null | undefined): SiteUrlConfig {
  return { ...config, sectionSlugs: !hugo || hugo.major > 0 || hugo.minor >= 167 }
}

function language(config: SiteUrlConfig, lang: string | null | undefined): LanguageSettings | undefined {
  const code = (lang ?? config.defaultLanguage).toLowerCase()
  return config.languages.find((l) => l.code === code)
}

/** Whether Hugo builds more than one site, or the default language in its own folder. */
export function isMultilingual(config: SiteUrlConfig): boolean {
  return config.languages.length > 1 || config.defaultInSubdir
}

/** `/tr` for a language published in its own folder, '' otherwise (default language, multihost). */
export function languagePrefix(config: SiteUrlConfig, lang: string | null | undefined): string {
  if (config.multihost || !isMultilingual(config)) return ''
  const code = (lang ?? config.defaultLanguage).toLowerCase()
  if (code === config.defaultLanguage && !config.defaultInSubdir) return ''
  return `/${code}`
}

/** The base URL a language is published under (its own on multihost sites). */
export function languageBaseURL(config: SiteUrlConfig, lang: string | null | undefined): string {
  return (config.multihost ? language(config, lang)?.baseURL : null) ?? config.baseURL
}

/** Path part of a base URL without the trailing slash: `/blog`, or '' at the domain root. */
export function basePath(baseURL: string): string {
  if (!baseURL) return ''
  let path: string
  try {
    path = new URL(baseURL, 'http://localhost').pathname
  } catch {
    return ''
  }
  try {
    path = decodeURI(path)
  } catch {
    // Keep it encoded.
  }
  return path.replace(/\/+$/, '')
}

/** URL options for a page of `section` in `lang` (per-section flags, the language's time zone). */
export function urlOptionsFor(config: SiteUrlConfig, section: string, lang?: string | null): UrlOptions {
  const flag = (value: unknown) => {
    if (isPlainObject(value)) {
      const key = keyOf(value, section)
      return key !== undefined && value[key] === true
    }
    return value === true
  }
  return {
    removePathAccents: flag(config.flags.removePathAccents),
    disablePathToLower: flag(config.flags.disablePathToLower),
    uglyURLs: flag(config.flags.uglyURLs),
    timeZone: language(config, lang)?.timeZone ?? config.timeZone,
    sectionSlugs: config.sectionSlugs,
  }
}

// ---- Content files and languages --------------------------------------------------------------

/** `about.tr.md` or `about._language_tr_.md` (Hugo 0.161); also drops role and version identifiers. */
function fileStem(file: string, codes: readonly string[]): { stem: string; lang: string | null } {
  const dot = file.lastIndexOf('.')
  let stem = dot > 0 ? file.slice(0, dot) : file
  let lang: string | null = null
  stem = stem.replace(/\._(language|role|version)_([^._]+)_(?=\.|$)/gi, (_, kind: string, value: string) => {
    if (kind.toLowerCase() === 'language' && codes.includes(value.toLowerCase())) lang = value.toLowerCase()
    return ''
  })
  const last = stem.lastIndexOf('.')
  if (last > 0 && codes.includes(stem.slice(last + 1).toLowerCase())) {
    lang ??= stem.slice(last + 1).toLowerCase()
    stem = stem.slice(0, last)
  }
  return { stem, lang }
}

export interface ContentLocation {
  /** Language code (lower case). */
  lang: string
  /** Path in the content tree (`posts/hello.tr.md`), the root's mount target included. */
  rel: string
  root: ContentRoot
}

/**
 * Where a site-relative content file sits: its language (file name first, then the content folder
 * of a language, then the default language) and its path in the content tree. Null when the file
 * is outside every content folder.
 */
export function contentLocation(path: string, config: SiteUrlConfig): ContentLocation | null {
  const normalized = path.replace(/\\/g, '/')
  const root = config.roots.find((r) => normalized === r.dir || normalized.startsWith(`${r.dir}/`))
  if (!root) return null
  const inside = normalized.slice(root.dir.length + 1)
  const rel = root.target ? `${root.target}/${inside}` : inside
  const codes = config.languages.map((l) => l.code)
  const file = rel.slice(rel.lastIndexOf('/') + 1)
  const named = fileStem(file, codes).lang
  return { lang: named ?? root.lang ?? config.defaultLanguage, rel, root }
}

/** The language of a content file, or null for the default language (or a file outside the content folders). */
export function contentLanguage(path: string, config: SiteUrlConfig): string | null {
  const location = contentLocation(path, config)
  return location && location.lang !== config.defaultLanguage ? location.lang : null
}

// ---- Pages ------------------------------------------------------------------------------------

export interface PageContext {
  contentDir?: string
  /** Language codes, so `about.tr.md` reads as `about`. */
  languages?: readonly string[]
  /** Content folders and languages; replaces `contentDir` and `languages` when given. */
  config?: SiteUrlConfig
  /** All pages, to tell nested sections (folders with an `_index`) apart and read section slugs. */
  pages?: readonly PageEntry[]
  /** Front matter `url` by page path. */
  urls?: ReadonlyMap<string, string>
}

interface Located {
  rel: string
  lang: string | undefined
}

function locate(path: string, context: PageContext): Located {
  if (context.config) {
    const location = contentLocation(path, context.config)
    if (location) return { rel: location.rel, lang: location.lang }
  }
  const prefix = (context.contentDir ?? context.config?.contentDir ?? 'content').replace(/\/+$/, '') + '/'
  const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path
  const codes = (context.languages ?? []).map((l) => l.toLowerCase())
  return { rel, lang: fileStem(rel.slice(rel.lastIndexOf('/') + 1), codes).lang ?? undefined }
}

function codesOf(context: PageContext): string[] {
  return context.config ? context.config.languages.map((l) => l.code) : (context.languages ?? []).map((l) => l.toLowerCase())
}

interface SlugMaps {
  /** `<lang>|<folder>` → slug of that section's `_index` page. */
  byLanguage: Map<string, string>
  /** `<folder>` → a slug of that section in any language. */
  anyLanguage: Map<string, string>
}

const slugCache = new WeakMap<readonly PageEntry[], Map<string, SlugMaps>>()

/** Section slugs from the `_index` files of every page, built once per page list and content layout. */
function sectionSlugMaps(context: PageContext, codes: readonly string[]): SlugMaps {
  const pages = context.pages ?? []
  const layout = context.config ? context.config.roots.map((r) => `${r.dir}:${r.target}:${r.lang ?? ''}`).join(';') : (context.contentDir ?? 'content')
  const key = `${layout}|${codes.join(',')}`
  let perPages = slugCache.get(pages)
  if (!perPages) {
    perPages = new Map()
    slugCache.set(pages, perPages)
  }
  const cached = perPages.get(key)
  if (cached) return cached
  const maps: SlugMaps = { byLanguage: new Map(), anyLanguage: new Map() }
  for (const p of pages) {
    const other = locate(p.path, context)
    const otherParts = other.rel.split('/')
    if (fileStem(otherParts[otherParts.length - 1], codes).stem !== '_index') continue
    const dir = otherParts.slice(0, -1).join('/')
    if (dir === '') continue
    maps.byLanguage.set(`${other.lang ?? ''}|${dir}`, p.slug)
    if (!maps.anyLanguage.has(dir) || p.slug) maps.anyLanguage.set(dir, p.slug)
  }
  perPages.set(key, maps)
  return maps
}

/** What a pattern sees of a `hugo list all` entry. */
export function permalinkPage(entry: PageEntry, context: PageContext = {}): PermalinkPage {
  const codes = codesOf(context)
  const { rel, lang } = locate(entry.path, context)
  const parts = rel.split('/')
  const { stem } = fileStem(parts[parts.length - 1], codes)
  const dirs = parts.slice(0, -1)
  let contentBaseName = stem
  if (stem === 'index' && dirs.length > 0) contentBaseName = dirs.pop()!
  else if (stem === '_index') contentBaseName = ''

  const { byLanguage: sectionSlugByDir, anyLanguage } = sectionSlugMaps(context, codes)
  const sectionSlug = (dir: string): string | undefined => sectionSlugByDir.get(`${lang ?? ''}|${dir}`) ?? anyLanguage.get(dir)
  // The page's section is the deepest folder that is a section: top-level folders always are,
  // deeper ones only with an `_index` file.
  let depth = dirs.length > 0 ? 1 : 0
  for (let k = dirs.length; k > 1; k--) {
    if (sectionSlug(dirs.slice(0, k).join('/')) !== undefined || (stem === '_index' && k === dirs.length)) {
      depth = k
      break
    }
  }
  const sections = dirs.slice(0, depth)
  const sectionSlugs = sections.map((name, i) => {
    const slug = sectionSlug(sections.slice(0, i + 1).join('/'))
    return slug ? urlize(slug) : name
  })
  const logical = [...dirs, contentBaseName].filter((p) => p !== '').join('/')
  return {
    title: entry.title,
    slug: entry.slug,
    date: entry.date,
    section: entry.section || (dirs[0] ?? ''),
    sections,
    sectionSlugs,
    contentBaseName,
    dirs,
    url: context.urls?.get(entry.path),
    kind: entry.kind,
    lang,
    logicalPath: `/${logical}`.toLowerCase().replace(/\s+/g, '-'),
  }
}

// ---- Permalink rules --------------------------------------------------------------------------

export type PermalinkRuleForm = 'kind' | 'legacy' | 'array'

/** One pattern of a `permalinks` value, with what it applies to. */
export interface PermalinkRule {
  pattern: string
  /** `kind`: `permalinks.page.posts`; `legacy`: `permalinks.posts`; `array`: `[[permalinks]]` entry. */
  form: PermalinkRuleForm
  /** Path of the `permalinks` value in the config (`['permalinks']`, `['languages', 'tr', 'permalinks']`). */
  base: (string | number)[]
  /** Path of the pattern below `base`: `['page', 'posts']`, `['posts']`, `[2, 'pattern']`. */
  keyPath: (string | number)[]
  /** Page kinds; null for any. */
  kinds: string[] | null
  /** Map forms: the section (or taxonomy) the rule is written for. */
  section: string | null
  /** Array form: `target.path`, `target.environment` and `target.sites.matrix.languages` globs. */
  path: string | null
  environment: string | null
  languages: string[] | null
}

const KIND_KEYS = ['home', 'page', 'section', 'taxonomy', 'term']

/** The rules of a `permalinks` value in any of its forms, in the order Hugo tries them. */
export function permalinkRules(permalinks: unknown, base: (string | number)[] = ['permalinks']): PermalinkRule[] {
  const rules: PermalinkRule[] = []
  if (Array.isArray(permalinks)) {
    permalinks.forEach((entry, index) => {
      const patternKey = keyOf(entry, 'pattern')
      const pattern = patternKey === undefined ? undefined : (entry as Tree)[patternKey]
      if (typeof pattern !== 'string') return
      const target = valueAt(entry, ['target'])
      const kind = valueAt(target, ['kind'])
      const kinds = languageCodesOf(kind)
      const languages = languageCodesOf(valueAt(target, ['sites', 'matrix', 'languages']))
      rules.push({
        pattern,
        form: 'array',
        base,
        keyPath: [index, patternKey!],
        kinds: kinds.length > 0 ? kinds : null,
        section: null,
        path: text(valueAt(target, ['path'])),
        environment: text(valueAt(target, ['environment'])),
        languages: languages.length > 0 ? languages : null,
      })
    })
    return rules
  }
  if (!isPlainObject(permalinks)) return rules
  const map = { form: 'kind' as const, base, path: null, environment: null, languages: null }
  for (const [key, value] of Object.entries(permalinks)) {
    const kind = key.toLowerCase()
    if (!KIND_KEYS.includes(kind) || !isPlainObject(value)) continue
    for (const [section, pattern] of Object.entries(value)) {
      if (typeof pattern === 'string') rules.push({ ...map, pattern, keyPath: [key, section], kinds: [kind], section })
    }
  }
  // The older form `permalinks.posts` applies to regular pages and to terms of a taxonomy.
  for (const [section, pattern] of Object.entries(permalinks)) {
    if (typeof pattern === 'string') {
      rules.push({ ...map, form: 'legacy', pattern, keyPath: [section], kinds: ['page', 'term'], section })
    }
  }
  return rules
}

const globCache = new Map<string, RegExp | null>()

/** Hugo's glob syntax (`**`, `*`, `?`, `{a,b}`, `[abc]`), case-insensitive, `/` as separator. */
export function globToRegExp(glob: string): RegExp | null {
  const cached = globCache.get(glob)
  if (cached !== undefined) return cached
  let out = ''
  let depth = 0
  let ok = true
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
      } else out += '[^/]*'
    } else if (ch === '?') out += '[^/]'
    else if (ch === '{') {
      out += '(?:'
      depth++
    } else if (ch === '}' && depth > 0) {
      out += ')'
      depth--
    } else if (ch === ',' && depth > 0) out += '|'
    else if (ch === '[') {
      const end = glob.indexOf(']', i + 1)
      if (end < 0) {
        ok = false
        break
      }
      const body = glob.slice(i + 1, end)
      out += `[${body.startsWith('!') ? '^' + body.slice(1) : body}]`
      i = end
    } else out += ch.replace(/[.+^$()|\\/]/g, '\\$&')
  }
  let result: RegExp | null = null
  if (ok && depth === 0) {
    try {
      result = new RegExp(`^${out}$`, 'i')
    } catch {
      result = null
    }
  }
  globCache.set(glob, result)
  return result
}

function globMatches(glob: string, value: string): boolean {
  return globToRegExp(glob)?.test(value) ?? false
}

/** What a rule is matched against. */
export interface RuleTarget {
  kind: string
  /** First-level section (the taxonomy for `taxonomy` and `term` pages). */
  section: string
  /** Logical path (`/posts/hello`). */
  path: string
  lang?: string | null
  /** Build environment; Hugo builds `production` by default. */
  env?: string | null
}

/** Whether a rule applies to a page. */
export function ruleMatches(rule: PermalinkRule, target: RuleTarget): boolean {
  const kind = target.kind.toLowerCase()
  if (rule.kinds && !rule.kinds.includes(kind)) return false
  if (rule.form !== 'array') return rule.section !== null && rule.section.toLowerCase() === target.section.toLowerCase()
  if (rule.path && !globMatches(rule.path, target.path.toLowerCase())) return false
  if (rule.environment && !globMatches(rule.environment, target.env ?? 'production')) return false
  if (rule.languages && !rule.languages.some((l) => globMatches(l, (target.lang ?? '').toLowerCase()))) return false
  return true
}

/** The first rule that applies (kind tables before the older form; array entries in order). */
export function matchRule(rules: readonly PermalinkRule[], target: RuleTarget): PermalinkRule | null {
  return rules.find((r) => ruleMatches(r, target)) ?? null
}

/** The rules Hugo uses for a language: its own `permalinks` when it sets them, else the site's. */
export function rulesFor(config: SiteUrlConfig, lang: string | null | undefined): PermalinkRule[] {
  const own = language(config, lang)
  if (own && own.permalinks !== undefined && own.permalinks !== null) return permalinkRules(own.permalinks, ['languages', own.code, 'permalinks'])
  return permalinkRules(config.permalinks)
}

/** The rule target of a page. */
export function targetOf(page: PermalinkPage, env?: string | null): RuleTarget {
  return { kind: page.kind ?? 'page', section: page.section, path: page.logicalPath ?? `/${[...page.dirs, page.contentBaseName].filter(Boolean).join('/')}`, lang: page.lang, env }
}

/** Same rule (same place in the config). */
export function sameRule(a: PermalinkRule | null, b: PermalinkRule | null): boolean {
  if (a === null || b === null) return a === b
  const key = (r: PermalinkRule) => [...r.base, ...r.keyPath].map((k) => String(k).toLowerCase()).join('\u0000')
  return key(a) === key(b)
}

export interface SectionPattern {
  pattern: string
  /** `permalinks.page.<section>` or the older `permalinks.<section>`. */
  origin: 'page' | 'legacy'
  /** The key as written, for editing it in place. */
  key: string
}

/** The pattern Hugo uses for regular pages of a section, from a map-form `permalinks` value. */
export function patternForSection(permalinks: unknown, section: string): SectionPattern | null {
  if (section === '') return null
  const rule = matchRule(permalinkRules(permalinks), { kind: 'page', section, path: `/${section.toLowerCase()}/x` })
  if (!rule || rule.form === 'array') return null
  return { pattern: rule.pattern, origin: rule.form === 'legacy' ? 'legacy' : 'page', key: rule.section ?? section }
}

// ---- Addresses --------------------------------------------------------------------------------

export interface PageAddress {
  /** Site path, decoded: base URL path, language prefix and the pattern's path (`/blog/tr/posts/x/`). */
  path: string
  /** Absolute address, like Hugo's `.Permalink`. */
  url: string
  rule: PermalinkRule | null
}

export interface AddressOptions {
  env?: string | null
  /** Use this pattern instead of the configured one (null = Hugo's default path). */
  pattern?: string | null
}

/** The full address of a page from the site config. Throws PermalinkError for an unknown token. */
export function pageAddress(page: PermalinkPage, config: SiteUrlConfig, options: AddressOptions = {}): PageAddress {
  const lang = page.lang ?? config.defaultLanguage
  const rule = options.pattern !== undefined ? null : matchRule(rulesFor(config, lang), targetOf(page, options.env))
  const pattern = options.pattern !== undefined ? options.pattern : (rule?.pattern ?? null)
  const site = languageBaseURL(config, lang)
  const path = basePath(site) + languagePrefix(config, lang) + pagePath(pattern, page, urlOptionsFor(config, page.section, lang))
  let origin = ''
  try {
    origin = site ? new URL(site).origin : ''
  } catch {
    origin = ''
  }
  return { path, url: origin + encodeURI(path), rule }
}

/** The path part of a permalink, decoded for display. */
export function permalinkPath(permalink: string): string | null {
  if (!permalink) return null
  let path: string
  try {
    path = new URL(permalink).pathname
  } catch {
    path = permalink.startsWith('/') ? permalink : `/${permalink}`
  }
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/** Two site paths name the same address (case and a trailing slash aside). */
export function samePath(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  const norm = (p: string) => p.replace(/\/+$/, '').toLowerCase() || '/'
  return norm(a) === norm(b)
}

// ---- Preview ----------------------------------------------------------------------------------

export interface UrlChange {
  entry: PageEntry
  /** Path from `hugo list` (decoded), or null when the page has no permalink (headless, draft…). */
  current: string | null
  /** Path with the new pattern, or null when the pattern cannot be expanded. */
  next: string | null
  changed: boolean
  /** Other pages that would get the same address. */
  collidesWith: string[]
  /**
   * The address computed here for the current settings differs from Hugo's, so `next` may be
   * off too (e.g. a setting this app does not model).
   */
  mismatch: boolean
}

/** A pattern for every page (null = Hugo's default), or one pattern for all. */
export type PatternChoice = string | null | ((page: PermalinkPage, entry: PageEntry) => string | null)

export interface PreviewInput {
  /** Pages being tested. */
  pages: readonly PageEntry[]
  /** Every page of the site, for collisions and section lookups. */
  allPages: readonly PageEntry[]
  currentPattern: PatternChoice
  nextPattern: PatternChoice
  context?: PageContext
  /** Used without `config`; with it, options come from the config for each page. */
  options?: UrlOptions
  /**
   * Site settings for the base URL path and language prefix. Without them, the part of the
   * current address before the pattern's output is kept for the new one.
   */
  config?: SiteUrlConfig
  /** Settings Hugo uses now (without pending changes), for checking the current addresses; defaults to `config`. */
  currentConfig?: SiteUrlConfig
}

/** Current and new address of each page, with the pages that would share an address. */
export function previewUrls({ pages, allPages, currentPattern, nextPattern, context = {}, options = {}, config, currentConfig = config }: PreviewInput): UrlChange[] {
  const ctx: PageContext = { ...context, config: context.config ?? config, pages: context.pages ?? allPages }
  const tested = new Set(pages.map((p) => p.path))
  const choose = (choice: PatternChoice, page: PermalinkPage, entry: PageEntry) => (typeof choice === 'function' ? choice(page, entry) : choice)
  const changes = pages.map((entry): UrlChange => {
    const page = permalinkPage(entry, ctx)
    const current = permalinkPath(entry.permalink)
    // Front matter `url` wins over every pattern.
    if (page.url) return { entry, current, next: current, changed: false, collidesWith: [], mismatch: false }
    let next: string | null = null
    let mismatch = false
    try {
      if (config) {
        const before = pageAddress(page, currentConfig ?? config, { pattern: choose(currentPattern, page, entry) }).path
        next = pageAddress(page, config, { pattern: choose(nextPattern, page, entry) }).path
        mismatch = current !== null && !samePath(before, current)
      } else {
        const before = pagePath(choose(currentPattern, page, entry), page, options)
        const after = pagePath(choose(nextPattern, page, entry), page, options)
        const prefix = current !== null && current.toLowerCase().endsWith(before.toLowerCase()) ? current.slice(0, current.length - before.length) : ''
        next = prefix + after
      }
    } catch {
      next = null
    }
    return { entry, current, next, changed: next !== null && next !== current, collidesWith: [], mismatch }
  })
  const owners = new Map<string, string[]>()
  const add = (url: string | null, path: string) => {
    if (url === null) return
    const key = url.toLowerCase()
    owners.set(key, [...(owners.get(key) ?? []), path])
  }
  for (const change of changes) add(change.next, change.entry.path)
  for (const other of allPages) if (!tested.has(other.path)) add(permalinkPath(other.permalink), other.path)
  for (const change of changes) {
    if (change.next === null) continue
    change.collidesWith = (owners.get(change.next.toLowerCase()) ?? []).filter((p) => p !== change.entry.path)
  }
  return changes
}

// ---- Aliases ----------------------------------------------------------------------------------

/**
 * The `aliases` entry that keeps a page's old address working. Since Hugo 0.155 an alias is
 * relative to its language's site (`/posts/old/` on a `tr` page is served at `/tr/posts/old/`);
 * before that it was relative to the base URL. Pass the Hugo version when it is known.
 */
export function aliasFor(
  permalink: string,
  config: SiteUrlConfig,
  lang: string | null | undefined,
  hugo?: { major: number; minor: number } | null,
): string | null {
  let pathname: string
  try {
    pathname = new URL(permalink, 'http://localhost').pathname
  } catch {
    return null
  }
  try {
    pathname = decodeURI(pathname)
  } catch {
    // Keep it encoded.
  }
  const strip = (prefix: string) => {
    if (prefix && (pathname.toLowerCase() === prefix.toLowerCase() || pathname.toLowerCase().startsWith(prefix.toLowerCase() + '/'))) {
      pathname = pathname.slice(prefix.length) || '/'
    }
  }
  strip(basePath(languageBaseURL(config, lang)))
  const siteRelative = !hugo || hugo.major > 0 || hugo.minor >= 155
  if (siteRelative) strip(languagePrefix(config, lang))
  return pathname.startsWith('/') ? pathname : '/' + pathname
}
