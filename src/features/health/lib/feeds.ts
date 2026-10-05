// What crawlers and feed readers get from a build: robots.txt, sitemaps, RSS/Atom feeds,
// llms.txt, noindex pages and pages left out of lists.
//
// Sitemaps and feeds are read with the XML parser (DOMParser) and pages with the HTML one, so
// CDATA, entities and namespaces work as they do for crawlers; XML that is not well-formed is
// reported, since feed readers and search engines reject it too.

import { readFrontMatter, splitFrontMatter } from '../../../lib/frontmatter'

export interface RobotsInfo {
  /** A `User-agent: *` group has `Disallow: /`. */
  disallowAll: boolean
  /** `Sitemap:` lines. */
  sitemaps: string[]
  /** Number of `Disallow` rules with a path. */
  disallowRules: number
}

export function analyzeRobots(text: string): RobotsInfo {
  const info: RobotsInfo = { disallowAll: false, sitemaps: [], disallowRules: 0 }
  let agents: string[] = []
  let inRules = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const field = match[1].toLowerCase()
    const value = match[2].trim()
    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group.
      if (inRules) agents = []
      inRules = false
      agents.push(value.toLowerCase())
    } else if (field === 'disallow' || field === 'allow') {
      inRules = true
      if (field === 'disallow' && value !== '') {
        info.disallowRules++
        if (value === '/' && agents.includes('*')) info.disallowAll = true
      }
    } else if (field === 'sitemap' && value) {
      info.sitemaps.push(value)
    }
  }
  return info
}

// ---------------------------------------------------------------------------
// XML and HTML

/** The parsed document, or null when the XML is not well-formed. */
export function parseXml(text: string): XMLDocument | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return doc.getElementsByTagNameNS('*', 'parsererror').length > 0 ? null : doc
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

/** Child elements by local name (namespace prefixes do not matter). */
function children(parent: Element, name: string): Element[] {
  return [...parent.children].filter((child) => child.localName === name)
}

function child(parent: Element, name: string, namespace?: string): Element | null {
  return children(parent, name).find((c) => namespace === undefined || c.namespaceURI === namespace) ?? null
}

function textOf(element: Element | null): string {
  return element?.textContent?.trim() ?? ''
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

const BLOCKS = 'p, div, li, dd, dt, h1, h2, h3, h4, h5, h6, pre, blockquote, figure, figcaption, td, th, br, section, article'

/** Text of an element with blocks kept apart (`<p>a</p><p>b</p>` is "a b", not "ab"). */
function blockText(root: Element | null): string {
  if (!root) return ''
  for (const block of root.querySelectorAll(BLOCKS)) block.after(' ')
  return collapse(root.textContent ?? '')
}

/** The visible text of an HTML fragment. */
export function htmlText(html: string): string {
  return blockText(parseHtml(html).body)
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

// ---------------------------------------------------------------------------
// Sitemaps

export interface SitemapInfo {
  /** Well-formed XML with a `urlset` or `sitemapindex` root. */
  valid: boolean
  /** A sitemap index (multilingual sites) lists other sitemaps instead of pages. */
  isIndex: boolean
  urls: string[]
  /** Child sitemaps of an index. */
  sitemaps: string[]
  withLastmod: number
}

export function analyzeSitemap(xml: string): SitemapInfo {
  const root = parseXml(xml)?.documentElement
  if (!root || (root.localName !== 'urlset' && root.localName !== 'sitemapindex')) {
    return { valid: false, isIndex: false, urls: [], sitemaps: [], withLastmod: 0 }
  }
  const isIndex = root.localName === 'sitemapindex'
  const blocks = children(root, isIndex ? 'sitemap' : 'url')
  const locs = blocks.map((b) => textOf(child(b, 'loc'))).filter(Boolean)
  return {
    valid: true,
    isIndex,
    urls: isIndex ? [] : locs,
    sitemaps: isIndex ? locs : [],
    withLastmod: blocks.filter((b) => textOf(child(b, 'lastmod')) !== '').length,
  }
}

/** Sitemap URLs that look wrong for a public site: drafts, local or placeholder hosts, test paths. */
export function suspiciousUrls(urls: string[], draftPaths: Set<string>): string[] {
  return urls.filter((url) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return true
    }
    let path = parsed.pathname
    try {
      path = decodeURI(path)
    } catch {
      // Keep it encoded.
    }
    return (
      draftPaths.has(path) ||
      /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname) ||
      /(^|\.)example\.(org|com|net)$/.test(parsed.hostname) ||
      /\/(drafts?|test|tests|tmp|wip)\//i.test(path)
    )
  })
}

// ---------------------------------------------------------------------------
// Feeds

const CONTENT_NS = 'http://purl.org/rss/1.0/modules/content/'

export interface FeedItem {
  title: string
  /** The page the item is about. */
  link: string | null
  /** The item's body as HTML (escaped HTML and CDATA already unwrapped). */
  body: string
  /** The body comes from a field meant for the whole post (`content:encoded`). */
  fullField: boolean
}

export interface ParsedFeed {
  format: 'rss' | 'atom'
  title: string | null
  items: FeedItem[]
  /** It looks like a feed, but is not well-formed XML: feed readers reject it. */
  invalid: boolean
}

/** The visible markup of an Atom text construct (`type="xhtml"` keeps its elements). */
function atomText(element: Element | null): string {
  if (!element) return ''
  if (element.getAttribute('type') === 'xhtml') {
    const serializer = new XMLSerializer()
    return [...element.childNodes].map((node) => serializer.serializeToString(node)).join('').trim()
  }
  return element.textContent?.trim() ?? ''
}

function atomLink(entry: Element): string | null {
  const links = children(entry, 'link')
  const link = links.find((l) => (l.getAttribute('rel') ?? 'alternate') === 'alternate') ?? null
  return link?.getAttribute('href')?.trim() || null
}

function rssLink(item: Element): string | null {
  const link = textOf(child(item, 'link'))
  if (link) return link
  const guid = child(item, 'guid')
  const value = textOf(guid)
  return guid && guid.getAttribute('isPermaLink') !== 'false' && /^https?:\/\//i.test(value) ? value : null
}

/** RSS 2.0, RSS 1.0 (RDF) or Atom; null when the text is not a feed. */
export function parseFeed(xml: string): ParsedFeed | null {
  const doc = parseXml(xml)
  if (!doc) {
    // Only report it when it was meant to be a feed.
    const kind = /<(rss|feed|rdf:RDF)[\s>]/i.exec(xml)?.[1].toLowerCase()
    if (!kind) return null
    return { format: kind === 'feed' ? 'atom' : 'rss', title: null, items: [], invalid: true }
  }
  const root = doc.documentElement
  if (root.localName === 'feed') {
    return {
      format: 'atom',
      title: textOf(child(root, 'title')) || null,
      invalid: false,
      items: children(root, 'entry').map((entry) => {
        const content = child(entry, 'content')
        const body = content && !content.hasAttribute('src') ? atomText(content) : ''
        return {
          title: atomText(child(entry, 'title')),
          link: atomLink(entry),
          body: body || atomText(child(entry, 'summary')),
          fullField: false,
        }
      }),
    }
  }
  if (root.localName !== 'rss' && root.localName !== 'RDF') return null
  const channel = child(root, 'channel')
  // RSS 2.0 puts items in the channel; RSS 1.0 next to it.
  const items = root.localName === 'rss' ? (channel ? children(channel, 'item') : []) : children(root, 'item')
  return {
    format: 'rss',
    title: (channel && textOf(child(channel, 'title'))) || null,
    invalid: false,
    items: items.map((item) => {
      const encoded = textOf(child(item, 'encoded', CONTENT_NS))
      return {
        title: textOf(child(item, 'title')),
        link: rssLink(item),
        body: encoded || textOf(child(item, 'description')),
        fullField: encoded !== '',
      }
    }),
  }
}

/** Whether a feed item's body looks like the whole post rather than a summary (no page to compare with). */
export function looksFull(html: string): boolean {
  const body = parseHtml(html).body
  if (!body) return false
  const blocks = body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, pre, ul, ol, blockquote, figure, img, table').length
  return blocks >= 4 || collapse(body.textContent ?? '').length > 1500
}

/** The main text of a built page, for comparing with a feed item. */
export interface PageArticle {
  text: string
  words: number
  /** Text of the last paragraph of the post, which only a full feed item repeats. */
  lastParagraph: string
}

/**
 * The text of a page's post: its single `<article>` (or `<main>`, or the body), without
 * navigation, headers, footers, forms and scripts. Hugo's own table of contents is a `<nav>`.
 */
export function pageArticle(html: string): PageArticle {
  const doc = parseHtml(html)
  for (const element of doc.querySelectorAll('script, style, noscript, template, nav, aside, form, header, footer, [role="navigation"]')) {
    element.remove()
  }
  const articles = doc.querySelectorAll('article')
  const root = articles.length === 1 ? articles[0] : (doc.querySelector('main') ?? doc.body)
  const text = blockText(root)
  const paragraphs = root ? [...root.querySelectorAll('p')].map((p) => collapse(p.textContent ?? '')) : []
  const lastParagraph = paragraphs.toReversed().find((p) => wordCount(p) >= 5) ?? ''
  return { text, words: wordCount(text), lastParagraph }
}

/** Below this many words a page says too little to tell a summary from the whole post. */
const MIN_COMPARE_WORDS = 40

/**
 * Whether a feed item carries the whole post, judged against its built page: it repeats the
 * post's last paragraph, or nearly all of its words. Null when the page is too short to tell.
 */
export function compareWithPage(itemBody: string, page: PageArticle): 'full' | 'summary' | null {
  if (page.words < MIN_COMPARE_WORDS) return null
  const itemText = htmlText(itemBody)
  if (page.lastParagraph && itemText.includes(page.lastParagraph)) return 'full'
  return wordCount(itemText) >= page.words * 0.85 ? 'full' : 'summary'
}

export type FeedContent = 'full' | 'summary' | 'mixed' | 'empty'

export interface FeedInfo {
  format: 'rss' | 'atom'
  title: string | null
  items: number
  missingTitles: number
  missingDescriptions: number
  content: FeedContent
  /** Items judged against their built page (the others by their length). */
  compared: number
  /** Not well-formed XML. */
  invalid: boolean
}

/**
 * Counts and the full-post verdict of a feed. `pageFor` gives the built page of an item's link
 * when it is in the build; items without one are judged by their length and markup.
 */
export function summarizeFeed(feed: ParsedFeed, pageFor: (link: string) => PageArticle | null = () => null): FeedInfo {
  let missingTitles = 0
  let missingDescriptions = 0
  let full = 0
  let compared = 0
  for (const item of feed.items) {
    if (!item.title.trim()) missingTitles++
    if (!item.body.trim()) {
      missingDescriptions++
      continue
    }
    const page = item.link ? pageFor(item.link) : null
    const verdict = page ? compareWithPage(item.body, page) : null
    if (verdict) compared++
    if (verdict ? verdict === 'full' : item.fullField || looksFull(item.body)) full++
  }
  const described = feed.items.length - missingDescriptions
  return {
    format: feed.format,
    title: feed.title,
    items: feed.items.length,
    missingTitles,
    missingDescriptions,
    content: described === 0 ? 'empty' : full === described ? 'full' : full === 0 ? 'summary' : 'mixed',
    compared,
    invalid: feed.invalid,
  }
}

/** RSS or Atom feed summary without page comparison, or null when the XML is not a feed. */
export function analyzeFeed(xml: string): FeedInfo | null {
  const feed = parseFeed(xml)
  return feed && summarizeFeed(feed)
}

export interface LlmsInfo {
  title: string | null
  lines: number
  links: number
}

export function analyzeLlms(text: string): LlmsInfo {
  const lines = text.split(/\r?\n/)
  return {
    title: lines.find((l) => /^#\s+\S/.test(l))?.replace(/^#\s+/, '').trim() ?? null,
    lines: lines.filter((l) => l.trim() !== '').length,
    links: (text.match(/\]\([^)]+\)/g) ?? []).length,
  }
}

// ---------------------------------------------------------------------------
// Front matter that hides a page

export interface TomlParser {
  tomlParseText(text: string): Promise<{ values: Record<string, unknown> }>
}

/** Parsed front matter (YAML and JSON here, TOML through `toml_edit`); null without any or when broken. */
export async function frontMatterValues(text: string, toml: TomlParser): Promise<Record<string, unknown> | null> {
  const parts = splitFrontMatter(text)
  try {
    if (parts.format === 'toml') return (await toml.tomlParseText(parts.frontMatterText)).values
    return readFrontMatter(parts)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A key in any case (Hugo's front matter keys are case-insensitive). */
function field(values: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const key = Object.keys(values).find((k) => k.toLowerCase() === name.toLowerCase())
    if (key !== undefined) return values[key]
  }
  return undefined
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || (typeof value === 'string' && /^(true|yes|on|1)$/i.test(value.trim()))
}

/** Page params that themes commonly read to hide a page from search engines, lists or search. */
const HIDING_PARAMS = ['noindex', 'private', 'hidden', 'unlisted', 'searchHidden', 'robotsNoIndex']

/** Build options and sitemap settings of one front matter map (or a cascade entry). */
function buildFlags(values: Record<string, unknown>): string[] {
  const flags: string[] = []
  const build = field(values, 'build', '_build')
  if (isRecord(build)) {
    const list = field(build, 'list')
    if (list === false || (typeof list === 'string' && /^(never|local)$/i.test(list))) {
      flags.push(`build.list = ${list === false ? 'never' : list.toLowerCase()}`)
    }
    const render = field(build, 'render')
    if (render === false || (typeof render === 'string' && /^(never|link)$/i.test(render))) {
      flags.push(`build.render = ${render === false ? 'never' : render.toLowerCase()}`)
    }
  }
  const sitemap = field(values, 'sitemap')
  if (isRecord(sitemap) && truthy(field(sitemap, 'disable'))) flags.push('sitemap.disable = true')
  return flags
}

/**
 * Why a content file keeps out of lists, the sitemap or search engines, read from its front
 * matter: Hugo's `build` options (`list`, `render`), `sitemap.disable`, and page params such as
 * `noindex` or `private` (top level or under `params`). `cascade` settings are reported with a
 * `cascade:` prefix, since they apply to the pages below.
 */
export function hidingFlags(values: Record<string, unknown> | null): string[] {
  if (!values) return []
  const flags = buildFlags(values)
  const params = field(values, 'params')
  for (const source of [values, isRecord(params) ? params : {}]) {
    for (const name of HIDING_PARAMS) {
      const value = field(source, name)
      if (truthy(value) && !flags.includes(`${name} = true`)) flags.push(`${name} = true`)
    }
    const robots = field(source, 'robots')
    if (typeof robots === 'string' && /\b(noindex|none)\b/i.test(robots)) flags.push(`robots = "${robots.trim()}"`)
  }
  const cascade = field(values, 'cascade')
  for (const entry of Array.isArray(cascade) ? cascade : [cascade]) {
    if (isRecord(entry)) for (const flag of buildFlags(entry)) flags.push(`cascade: ${flag}`)
  }
  return [...new Set(flags)]
}
