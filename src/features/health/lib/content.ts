// Links in content files: Markdown links and images, reference definitions, autolinks, bare
// URLs, HTML/shortcode `href`/`src` attributes and `ref`/`relref` shortcodes, with line numbers.

import { splitFrontMatter } from '../../../lib/frontmatter'

export type LinkSource = 'markdown' | 'image' | 'reference' | 'autolink' | 'bare' | 'html' | 'ref'

export interface ContentLink {
  /** The link as written (angle brackets removed). */
  url: string
  /** 1-based line in the whole file. */
  line: number
  source: LinkSource
}

/** Number of the line the body starts on (1-based). */
export function bodyStartLine(text: string): { body: string; firstLine: number } {
  const parts = splitFrontMatter(text)
  const before = parts.open + parts.frontMatterText + parts.close
  return { body: parts.body, firstLine: before.split('\n').length }
}

const INLINE_LINK_RE =
  /(!?)\[((?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*)\]\(\s*(<[^>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g
const REFERENCE_DEF_RE = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:\s*(<[^>\n]*>|\S+)/
const AUTOLINK_RE = /<((?:https?|ftp):\/\/[^\s<>]+|mailto:[^\s<>]+)>/gi
const ATTR_RE = /\b(href|src)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`)/gi
const REF_RE = /\{\{([<%])-?\s*(ref|relref)\s+(?:path\s*=\s*)?(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`|([^\s>%}]+))[^}]*?[>%]\}\}/g
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi

/** Replaces inline code spans with spaces of the same length, so positions stay valid. */
function blankCodeSpans(line: string): string {
  return line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length))
}

/** Removes trailing punctuation a sentence puts after a bare URL. */
export function trimBareUrl(url: string): string {
  let result = url.replace(/[.,;:!?*_~]+$/, '')
  // A closing parenthesis belongs to the URL only when it has an opening one.
  while (result.endsWith(')') && (result.match(/\(/g)?.length ?? 0) < (result.match(/\)/g)?.length ?? 0)) {
    result = result.slice(0, -1).replace(/[.,;:!?*_~]+$/, '')
  }
  return result
}

/** All links of a content file. Code blocks, code spans and HTML comments are skipped. */
export function extractContentLinks(text: string): ContentLink[] {
  const { body, firstLine } = bodyStartLine(text)
  // Comments become blank lines, so line numbers stay right.
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  const links: ContentLink[] = []
  let fence: { char: string; size: number } | null = null
  cleaned.split('\n').forEach((raw, index) => {
    const lineNo = firstLine + index
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(raw)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (fence === null) fence = { char: marker[0], size: marker.length }
      else if (marker[0] === fence.char && marker.length >= fence.size && raw.trim() === marker) fence = null
      return
    }
    if (fence !== null) return
    let line = blankCodeSpans(raw.replace(/\r$/, ''))
    const add = (url: string, source: LinkSource) => {
      const value = url.trim().replace(/^<(.*)>$/, '$1').trim()
      if (value !== '') links.push({ url: value, line: lineNo, source })
    }
    const blank = (m: RegExpMatchArray) => {
      const start = m.index ?? 0
      line = line.slice(0, start) + ' '.repeat(m[0].length) + line.slice(start + m[0].length)
    }

    for (const m of [...line.matchAll(REF_RE)]) {
      add(m[3] ?? m[4] ?? m[5] ?? m[6] ?? '', 'ref')
      blank(m)
    }
    const definition = REFERENCE_DEF_RE.exec(line)
    if (definition) {
      add(definition[2], 'reference')
      line = ' '.repeat(definition[0].length) + line.slice(definition[0].length)
    }
    for (const m of [...line.matchAll(INLINE_LINK_RE)]) {
      add(m[3].replace(/\\(.)/g, '$1'), m[1] === '!' ? 'image' : 'markdown')
      // Keep the link text: it can hold an image, e.g. [![alt](img.png)](page/).
      const at = m.index ?? 0
      const start = at + m[1].length + 1 + m[2].length
      const end = at + m[0].length
      line = line.slice(0, start) + ' '.repeat(end - start) + line.slice(end)
    }
    // Nested images in link texts.
    for (const m of [...line.matchAll(INLINE_LINK_RE)]) {
      add(m[3], m[1] === '!' ? 'image' : 'markdown')
      blank(m)
    }
    for (const m of [...line.matchAll(AUTOLINK_RE)]) {
      add(m[1], 'autolink')
      blank(m)
    }
    for (const m of [...line.matchAll(ATTR_RE)]) {
      add(m[2] ?? m[3] ?? m[4] ?? '', 'html')
      blank(m)
    }
    for (const m of line.matchAll(BARE_URL_RE)) add(trimBareUrl(m[0]), 'bare')
  })
  return links
}

export type LinkTarget =
  /** Another website. */
  | { type: 'external'; url: string }
  /** A path on this site (`/posts/a/`, or a full URL on the site's own host). Decoded. */
  | { type: 'site'; path: string; fragment: string | null }
  /** Relative to the page's own URL (`../b/`, `image.png`). */
  | { type: 'relative'; path: string; fragment: string | null }
  /** Only a fragment: a place on the same page. */
  | { type: 'fragment'; fragment: string }
  /** A content file (`ref`/`relref`, or a link to a `.md` file). */
  | { type: 'content'; path: string; fragment: string | null }
  /** mailto:, tel:, templates and the like. */
  | { type: 'ignored' }

function splitFragment(url: string): { path: string; fragment: string | null } {
  const hash = url.indexOf('#')
  const withoutHash = hash === -1 ? url : url.slice(0, hash)
  const query = withoutHash.indexOf('?')
  return {
    path: query === -1 ? withoutHash : withoutHash.slice(0, query),
    fragment: hash === -1 ? null : url.slice(hash + 1),
  }
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text)
  } catch {
    return text
  }
}

/** Host without a leading `www.`, lower-case. */
export function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/** What a link points at, given the site's host (from `baseURL`). */
export function classifyLink(link: Pick<ContentLink, 'url' | 'source'>, siteHost: string | null): LinkTarget {
  const url = link.url.trim()
  if (url === '' || url.includes('{{')) return { type: 'ignored' }
  if (link.source === 'ref') {
    const { path, fragment } = splitFragment(url)
    return { type: 'content', path, fragment }
  }
  if (url.startsWith('#')) return { type: 'fragment', fragment: url.slice(1) }
  const absolute = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  if (absolute || url.startsWith('//')) {
    const scheme = absolute ? absolute[1].toLowerCase() : 'https'
    if (scheme !== 'http' && scheme !== 'https') return { type: 'ignored' }
    let parsed: URL
    try {
      parsed = new URL(url.startsWith('//') ? `https:${url}` : url)
    } catch {
      return { type: 'ignored' }
    }
    if (siteHost && bareHost(parsed.hostname) === bareHost(siteHost)) {
      return {
        type: 'site',
        path: safeDecode(parsed.pathname),
        fragment: parsed.hash ? parsed.hash.slice(1) : null,
      }
    }
    return { type: 'external', url: url.startsWith('//') ? `https:${url}` : url }
  }
  const { path, fragment } = splitFragment(url)
  if (path === '') return fragment === null ? { type: 'ignored' } : { type: 'fragment', fragment }
  if (/\.(md|markdown)$/i.test(path)) return { type: 'content', path: safeDecode(path), fragment }
  if (path.startsWith('/')) return { type: 'site', path: safeDecode(path), fragment }
  return { type: 'relative', path: safeDecode(path), fragment }
}
