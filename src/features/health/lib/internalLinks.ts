// Resolving internal links of content files against a build of the site.

import type { PageEntry } from '../../../lib/api'
import { classifyLink, type ContentLink, type LinkTarget } from './content'

export interface SiteIndex {
  /** Paths of the files in the build output. */
  outputFiles: Set<string>
  /** Path part of `baseURL`, with slashes on both ends (`/`, `/blog/`). */
  basePath: string
  /** Host of `baseURL`, if any. */
  siteHost: string | null
  /** Site-relative content folder, e.g. `content`. */
  contentDir: string
  /** Site-relative content file paths. */
  contentFiles: string[]
  /** Pages by content file path. */
  pagesByFile: Map<string, PageEntry>
  /** Pages by decoded permalink path. */
  pagesByUrlPath: Map<string, PageEntry>
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text)
  } catch {
    return text
  }
}

/** The decoded path of a URL (`https://x.org/a%20b/` → `/a b/`); `/` when it cannot be parsed. */
export function urlPath(url: string): string {
  try {
    return safeDecode(new URL(url).pathname)
  } catch {
    return '/'
  }
}

/** `baseURL` split into host and a path that starts and ends with `/`. */
export function parseBaseUrl(baseUrl: string | null | undefined): { host: string | null; basePath: string } {
  if (!baseUrl) return { host: null, basePath: '/' }
  try {
    const parsed = new URL(baseUrl)
    const path = safeDecode(parsed.pathname)
    return { host: parsed.hostname || null, basePath: path.endsWith('/') ? path : `${path}/` }
  } catch {
    return { host: null, basePath: '/' }
  }
}

/** A baseURL that cannot be the published site. */
export function isPlaceholderBaseUrl(url: string | null): boolean {
  if (!url) return true
  try {
    const host = new URL(url).hostname.toLowerCase()
    return (
      host === '' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(^|\.)example\.(org|com|net)$/.test(host) ||
      host.endsWith('.invalid') ||
      host.endsWith('.test')
    )
  } catch {
    return true
  }
}

export function makeSiteIndex(input: {
  outputFiles: Iterable<string>
  baseUrl: string | null | undefined
  contentDir: string
  contentFiles: string[]
  pages: PageEntry[]
}): SiteIndex {
  const { host, basePath } = parseBaseUrl(input.baseUrl)
  const pagesByFile = new Map<string, PageEntry>()
  const pagesByUrlPath = new Map<string, PageEntry>()
  for (const page of input.pages) {
    if (!pagesByFile.has(page.path)) pagesByFile.set(page.path, page)
    const path = urlPath(page.permalink)
    if (!pagesByUrlPath.has(path)) pagesByUrlPath.set(path, page)
  }
  return {
    outputFiles: new Set(input.outputFiles),
    basePath,
    siteHost: host,
    contentDir: input.contentDir.replace(/\/+$/, '') || 'content',
    contentFiles: input.contentFiles,
    pagesByFile,
    pagesByUrlPath,
  }
}

/** Output files a URL path can be served from, most likely first. */
export function outputCandidates(path: string, basePath: string): string[] {
  let p = path
  if (basePath !== '/' && p.startsWith(basePath)) p = `/${p.slice(basePath.length)}`
  p = p.replace(/^\/+/, '')
  if (p === '' || p.endsWith('/')) return [`${p}index.html`]
  return [p, `${p}/index.html`, `${p}.html`]
}

/** The output file for a URL path, or null when the build has none. */
export function findOutput(path: string, index: SiteIndex): string | null {
  return outputCandidates(path, index.basePath).find((c) => index.outputFiles.has(c)) ?? null
}

/** The output file of a page, or null when the page is not in the build (draft, future…). */
export function pageOutput(page: PageEntry, index: SiteIndex): string | null {
  return findOutput(urlPath(page.permalink), index)
}

/** Resolves `.`/`..` segments of a slash-separated path. */
export function normalizePath(path: string): string {
  const leading = path.startsWith('/') ? '/' : ''
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return leading + out.join('/')
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** The content file a `ref`/`relref` or `.md` link points at, the way Hugo looks it up. */
export function resolveContentFile(sourcePath: string, target: string, index: SiteIndex): string | null {
  const files = new Set(index.contentFiles)
  const clean = target.replace(/\/+$/, '').replace(/^\.\//, '')
  if (clean === '') return null
  // Hugo looks pages up without the extension, so `b.md` also finds the bundle `b/index.md`.
  const variants = (base: string) => {
    const stem = base.replace(/\.(md|markdown)$/i, '')
    return [base, `${stem}.md`, `${stem}/index.md`, `${stem}/_index.md`]
  }
  const bases = clean.startsWith('/')
    ? [normalizePath(`${index.contentDir}${clean}`)]
    : [normalizePath(`${dirname(sourcePath)}/${clean}`), normalizePath(`${index.contentDir}/${clean}`)]
  for (const base of bases) {
    const found = variants(base.replace(/^\//, '')).find((candidate) => files.has(candidate))
    if (found) return found
  }
  // A bare name (`ref "my-post"`) matches a unique file anywhere in the content.
  const suffixes = variants(clean.replace(/^\//, '')).map((v) => `/${v}`)
  return index.contentFiles.find((file) => suffixes.some((s) => file.endsWith(s))) ?? null
}

export type LinkProblem =
  /** Nothing in the build answers this URL. */
  | 'missing'
  /** The page exists but is not in the build (draft, future date, expired). */
  | 'unpublished'
  /** A `ref`/`relref`/`.md` link to a content file that does not exist. */
  | 'contentMissing'
  /** The page exists, the `#fragment` does not (checked later against the HTML). */
  | 'fragmentMissing'

export interface ResolvedLink {
  link: ContentLink
  target: LinkTarget
  /** The output file the link lands on, when known. */
  outputFile: string | null
  /** Fragment to look for in `outputFile`. */
  fragment: string | null
  problem: LinkProblem | null
  /** The link could not be judged (e.g. a relative link on a page that is not in the build). */
  unknown: boolean
}

/**
 * Where an internal link of `sourcePath` lands in the build. External and ignored links come back
 * as null. Fragments are not checked here: see `outputFile`/`fragment`.
 */
export function resolveInternalLink(sourcePath: string, link: ContentLink, index: SiteIndex): ResolvedLink | null {
  const target = classifyLink(link, index.siteHost)
  const result = (outputFile: string | null, fragment: string | null, problem: LinkProblem | null, unknown = false): ResolvedLink => ({
    link,
    target,
    outputFile,
    fragment: fragment === '' ? null : fragment,
    problem,
    unknown,
  })
  const atUrlPath = (path: string, fragment: string | null) => {
    const output = findOutput(path, index)
    if (output) return result(output, fragment, null)
    const page = index.pagesByUrlPath.get(path) ?? index.pagesByUrlPath.get(path.endsWith('/') ? path : `${path}/`)
    return result(null, null, page ? 'unpublished' : 'missing')
  }
  const ownPage = index.pagesByFile.get(sourcePath)

  switch (target.type) {
    case 'external':
    case 'ignored':
      return null
    case 'site':
      return atUrlPath(target.path, target.fragment)
    case 'relative': {
      if (!ownPage) return result(null, null, null, true)
      let resolved: string
      try {
        resolved = safeDecode(new URL(target.path, `https://site.invalid${encodeURI(urlPath(ownPage.permalink))}`).pathname)
      } catch {
        return result(null, null, null, true)
      }
      return atUrlPath(resolved, target.fragment)
    }
    case 'fragment': {
      const output = ownPage ? pageOutput(ownPage, index) : null
      return output ? result(output, target.fragment, null) : result(null, null, null, true)
    }
    case 'content': {
      if (target.path === '') {
        const output = ownPage ? pageOutput(ownPage, index) : null
        return output ? result(output, target.fragment, null) : result(null, null, null, true)
      }
      const file = resolveContentFile(sourcePath, target.path, index)
      if (!file) return result(null, null, 'contentMissing')
      const page = index.pagesByFile.get(file)
      // Not a page of its own (e.g. a headless bundle): nothing more to check.
      if (!page) return result(null, null, null)
      const output = pageOutput(page, index)
      return output ? result(output, target.fragment, null) : result(null, null, 'unpublished')
    }
  }
}
