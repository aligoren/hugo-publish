// Small, tolerant HTML scanning for site health: tags and attributes, ids, meta tags and the
// resources a page loads. Regex based (no DOM), so it runs anywhere and is fast on many pages.

export interface HtmlTag {
  /** Lower-case tag name. */
  name: string
  /** Attributes with lower-case names and decoded values; a bare attribute has the value ''. */
  attrs: Record<string, string>
}

// The named references that show up in titles and descriptions (Hugo's typographer writes the
// quote and dash ones).
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  euro: '€',
  shy: '­',
}

/** Decodes the character references that matter in attribute values and titles. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole
  })
}

const COMMENT_RE = /<!--[\s\S]*?-->/g
const RAW_TEXT_RE = /(<(script|style|template|textarea)\b(?:"[^"]*"|'[^']*'|[^'">])*>)([\s\S]*?)(<\/\2\s*>)/gi
const TAG_RE = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

/** The HTML without comments and with script/style contents emptied (their tags stay). */
function markupOnly(html: string): string {
  return html.replace(COMMENT_RE, '').replace(RAW_TEXT_RE, (_m, open: string, _name, _body, close: string) => open + close)
}

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of text.matchAll(ATTR_RE)) {
    const name = match[1].toLowerCase()
    if (name in attrs) continue
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

/** Every start tag, in document order. Comments and script/style contents are skipped. */
export function parseTags(html: string): HtmlTag[] {
  const tags: HtmlTag[] = []
  for (const match of markupOnly(html).matchAll(TAG_RE)) {
    tags.push({ name: match[1].toLowerCase(), attrs: parseAttrs(match[2]) })
  }
  return tags
}

/** Element ids (and `<a name>` targets) a fragment link can point at. */
export function extractIds(html: string): Set<string> {
  const ids = new Set<string>()
  for (const tag of parseTags(html)) {
    if (tag.attrs.id) ids.add(tag.attrs.id)
    if (tag.name === 'a' && tag.attrs.name) ids.add(tag.attrs.name)
  }
  return ids
}

/** True when `fragment` (as written after `#`) exists in the page. `#` and `#top` always do. */
export function hasFragment(ids: Set<string>, fragment: string): boolean {
  if (fragment === '' || fragment.toLowerCase() === 'top') return true
  if (ids.has(fragment)) return true
  try {
    return ids.has(decodeURIComponent(fragment))
  } catch {
    return false
  }
}

export interface PageMeta {
  title: string | null
  description: string | null
  canonical: string | null
  robots: string | null
  lang: string | null
  /** `og:*` properties without the prefix, first value of each. */
  og: Record<string, string>
  /** `twitter:*` names without the prefix, first value of each. */
  twitter: Record<string, string>
}

function collapse(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim()
}

/** The `<head>` part of a page (the whole text when there is no `</head>`). */
function headOf(html: string): string {
  const end = html.search(/<\/head\s*>/i)
  return end === -1 ? html : html.slice(0, end)
}

/** Title, description, canonical, robots and Open Graph / X (Twitter) tags of a page. */
export function extractMeta(html: string): PageMeta {
  const head = headOf(html.replace(COMMENT_RE, ''))
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)
  const meta: PageMeta = {
    title: titleMatch ? collapse(titleMatch[1]) : null,
    description: null,
    canonical: null,
    robots: null,
    lang: null,
    og: {},
    twitter: {},
  }
  for (const tag of parseTags(html)) {
    if (tag.name === 'html' && tag.attrs.lang && meta.lang === null) meta.lang = tag.attrs.lang
    if (tag.name === 'link' && meta.canonical === null && relTokens(tag).includes('canonical') && tag.attrs.href) {
      meta.canonical = tag.attrs.href
    }
    if (tag.name !== 'meta' || !('content' in tag.attrs)) continue
    const key = (tag.attrs.property ?? tag.attrs.name ?? '').trim().toLowerCase()
    const content = collapse(tag.attrs.content)
    if (key === 'description' && meta.description === null) meta.description = content
    else if (key === 'robots' && meta.robots === null) meta.robots = content
    else if (key.startsWith('og:')) {
      const name = key.slice(3)
      if (!(name in meta.og)) meta.og[name] = content
    } else if (key.startsWith('twitter:')) {
      const name = key.slice(8)
      if (!(name in meta.twitter)) meta.twitter[name] = content
    }
  }
  return meta
}

export type ResourceKind =
  | 'script'
  | 'stylesheet'
  | 'font'
  | 'icon'
  | 'preload'
  | 'preconnect'
  | 'image'
  | 'media'
  | 'iframe'
  | 'embed'
  | 'css'

export interface PageResource {
  kind: ResourceKind
  /** As written in the page (decoded), possibly relative. */
  url: string
}

function relTokens(tag: HtmlTag): string[] {
  return (tag.attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

/** URLs of a `srcset` value (the HTML spec's splitting: a URL runs until whitespace). */
export function parseSrcset(value: string): string[] {
  const urls: string[] = []
  let i = 0
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i++
    const start = i
    while (i < value.length && !/\s/.test(value[i])) i++
    let url = value.slice(start, i)
    if (url.endsWith(',')) {
      // No descriptor: the commas end the candidate.
      url = url.replace(/,+$/, '')
    } else {
      while (i < value.length && value[i] !== ',') i++
    }
    if (url) urls.push(url)
  }
  return urls
}

/** `@import` and `url()` references of a stylesheet (data: URLs left out). */
export function extractCssUrls(css: string): PageResource[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found: PageResource[] = []
  const imported = new Set<number>()
  for (const match of text.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))/gi)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (url) found.push({ kind: 'stylesheet', url })
    imported.add(match.index ?? -1)
  }
  for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    // `@import url(x)` was counted above.
    const before = text.slice(Math.max(0, (match.index ?? 0) - 12), match.index).toLowerCase()
    if (!url || /^data:/i.test(url) || /@import\s*$/.test(before)) continue
    found.push({ kind: 'css', url })
  }
  return found
}

const KNOWN_SCRIPT_URL_RE = /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\/[^\s"'`)<>\\]*/gi

/**
 * Everything a page makes the browser fetch: scripts, stylesheets, fonts, icons, images,
 * media, frames, plus `url()`/`@import` in `<style>` and `style=""`. URLs found as strings in
 * inline scripts are included when `inlineScriptHosts` says their host matters (trackers).
 */
export function extractResources(html: string, inlineScriptHosts?: (host: string) => boolean): PageResource[] {
  const found: PageResource[] = []
  const add = (kind: ResourceKind, url: string | undefined) => {
    const value = url?.trim()
    if (value && !/^(data|blob|about|javascript):/i.test(value)) found.push({ kind, url: value })
  }
  const withoutComments = html.replace(COMMENT_RE, '')
  for (const match of withoutComments.matchAll(RAW_TEXT_RE)) {
    const name = match[2].toLowerCase()
    if (name === 'style') found.push(...extractCssUrls(match[3]))
    if (name === 'script' && inlineScriptHosts && !/\bsrc\s*=/.test(match[1])) {
      for (const url of match[3].matchAll(KNOWN_SCRIPT_URL_RE)) {
        const host = /\/\/([^/:]+)/.exec(url[0])?.[1]?.toLowerCase()
        if (host && inlineScriptHosts(host)) add('script', url[0])
      }
    }
  }
  for (const tag of parseTags(html)) {
    const a = tag.attrs
    switch (tag.name) {
      case 'script':
        add('script', a.src)
        break
      case 'link': {
        const rel = relTokens(tag)
        const as = (a.as ?? '').toLowerCase()
        if (rel.includes('stylesheet')) add('stylesheet', a.href)
        else if (rel.some((r) => r === 'icon' || r === 'apple-touch-icon' || r === 'mask-icon')) add('icon', a.href)
        else if (rel.some((r) => r === 'preload' || r === 'modulepreload' || r === 'prefetch')) {
          add(as === 'font' ? 'font' : as === 'style' ? 'stylesheet' : as === 'script' ? 'script' : 'preload', a.href)
        } else if (rel.some((r) => r === 'preconnect' || r === 'dns-prefetch')) add('preconnect', a.href)
        break
      }
      case 'img':
        add('image', a.src)
        if (a.srcset) for (const url of parseSrcset(a.srcset)) add('image', url)
        break
      case 'source':
        add('media', a.src)
        if (a.srcset) for (const url of parseSrcset(a.srcset)) add('image', url)
        break
      case 'video':
      case 'audio':
      case 'track':
        add('media', a.src)
        if (a.poster) add('image', a.poster)
        break
      case 'iframe':
      case 'frame':
        add('iframe', a.src)
        break
      case 'embed':
        add('embed', a.src)
        break
      case 'object':
        add('embed', a.data)
        break
      case 'input':
        if ((a.type ?? '').toLowerCase() === 'image') add('image', a.src)
        break
    }
    if (a.style && /url\(/i.test(a.style)) found.push(...extractCssUrls(a.style))
  }
  return found
}
