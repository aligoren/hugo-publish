// Renaming and moving a document: a single file (`posts/x.md`) or a page bundle folder
// (`posts/x/index.md`), and the alias that keeps the old address working.

import type { ContentFile, PageEntry } from '../../lib/api'
import { aliasFor, pageAddress, permalinkPage, permalinkPath, samePath, type SiteUrlConfig } from '../../lib/permalinks'
import { slugify } from '../../lib/slug'

export interface DocLocation {
  /** `file`: `x.md`; `bundle`: `x/index.md` (the folder moves); `section`: `_index.md`. */
  kind: 'file' | 'bundle' | 'section'
  /** Folder that holds the file or the bundle folder. */
  parent: string
  /** File name without extension, or the bundle folder's name. */
  name: string
  /** `.md` for files; the index file name (`index.md`) for bundles. */
  fileName: string
}

export function docLocation(path: string): DocLocation {
  const slash = path.lastIndexOf('/')
  const dir = slash === -1 ? '' : path.slice(0, slash)
  const file = path.slice(slash + 1)
  if (/^_index\./i.test(file)) {
    const up = dir.lastIndexOf('/')
    return { kind: 'section', parent: up === -1 ? '' : dir.slice(0, up), name: dir.slice(up + 1), fileName: file }
  }
  if (/^index\./i.test(file)) {
    const up = dir.lastIndexOf('/')
    return { kind: 'bundle', parent: up === -1 ? '' : dir.slice(0, up), name: dir.slice(up + 1), fileName: file }
  }
  const dot = file.lastIndexOf('.')
  return { kind: 'file', parent: dir, name: dot > 0 ? file.slice(0, dot) : file, fileName: dot > 0 ? file.slice(dot) : '' }
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

export interface RenamePlan {
  /** What `api.renameFile` moves: the file, or the bundle folder. */
  from: string
  to: string
  /** The document's new path. */
  newPath: string
}

/** The move for a new name (slugified) and parent folder. Null when nothing changes. */
export function renamePlan(path: string, newName: string, newParent?: string): RenamePlan | null {
  const loc = docLocation(path)
  if (loc.kind === 'section') return null
  const name = slugify(newName)
  const parent = newParent ?? loc.parent
  if (!name || (name === loc.name && parent === loc.parent)) return null
  if (loc.kind === 'bundle') {
    const to = join(parent, name)
    return { from: join(loc.parent, loc.name), to, newPath: join(to, loc.fileName) }
  }
  const to = join(parent, name + loc.fileName)
  return { from: path, to, newPath: to }
}

/**
 * The address to put in `aliases` for a permalink: its path below the site's base URL, with a
 * leading slash (`https://x.org/blog/posts/a/` with base `https://x.org/blog/` → `/posts/a/`).
 */
export function aliasPath(permalink: string, baseURL?: string | null): string | null {
  let pathname: string
  try {
    pathname = new URL(permalink, 'http://localhost').pathname
  } catch {
    return null
  }
  if (baseURL) {
    try {
      const basePath = new URL(baseURL, 'http://localhost').pathname.replace(/\/+$/, '')
      if (basePath && (pathname === basePath || pathname.startsWith(basePath + '/'))) pathname = pathname.slice(basePath.length) || '/'
    } catch {
      // Keep the full path.
    }
  }
  try {
    pathname = decodeURI(pathname)
  } catch {
    // Keep it encoded.
  }
  return pathname.startsWith('/') ? pathname : '/' + pathname
}

function lastSegment(pathname: string): { segment: string; index: number } | null {
  const trimmed = pathname.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  const segment = trimmed.slice(i + 1)
  return segment ? { segment, index: i + 1 } : null
}

/**
 * The permalink after the page's name changes, when the last part of its address is that name
 * (`/posts/old-name/` → `/posts/new-name/`). Null when the permalink pattern does not end with
 * the name (then the new address cannot be predicted here).
 */
export function predictPermalink(permalink: string, oldNames: readonly string[], newName: string): string | null {
  let url: URL
  try {
    url = new URL(permalink)
  } catch {
    return null
  }
  const last = lastSegment(url.pathname)
  if (!last || !newName) return null
  let current = last.segment
  try {
    current = decodeURIComponent(current)
  } catch {
    // Compare as written.
  }
  const matches = oldNames.some((name) => name && (name.toLowerCase() === current.toLowerCase() || slugify(name) === current.toLowerCase()))
  if (!matches) return null
  const trailing = url.pathname.slice(last.index + last.segment.length)
  url.pathname = url.pathname.slice(0, last.index) + encodeURIComponent(newName) + trailing
  return url.toString()
}

/** Content folders (sections) a document can be moved to, from the content file list. */
export function contentFolders(files: readonly ContentFile[], contentDir: string, current: string): string[] {
  const root = contentDir.replace(/\/+$/, '') || 'content'
  const folders = new Set<string>([root, current])
  for (const file of files) {
    const loc = docLocation(file.path)
    let dir = loc.parent
    while (dir && dir.startsWith(root)) {
      folders.add(dir)
      const up = dir.lastIndexOf('/')
      dir = up === -1 ? '' : dir.slice(0, up)
    }
  }
  return [...folders].filter((f) => f === root || f.startsWith(root + '/')).sort((a, b) => a.localeCompare(b))
}

// ---- Addresses from the site settings ----------------------------------------------------------

/** What the address prediction needs: the URL settings (`hugo config`) and Hugo's page list. */
export interface UrlModel {
  config: SiteUrlConfig
  /** Every page, for nested sections and section slugs. */
  pages: readonly PageEntry[]
  /** The Hugo version, for how aliases are read (site-relative since 0.155). */
  hugo?: { major: number; minor: number } | null
}

export interface PageChange {
  /** The document's path after a move; the current path when it stays. */
  path?: string
  /** `slug` after the change ('' = none). */
  slug: string
  title: string
}

/**
 * The page's permalink after a rename, move or slug change, from the permalink pattern of its
 * section, the language prefix and the base URL. Null when this cannot be predicted: the
 * settings do not reproduce Hugo's current address for the page (front matter `url`, a setting
 * this app does not model…), or the pattern cannot be expanded.
 */
export function predictPagePermalink(entry: PageEntry, change: PageChange, model: UrlModel): string | null {
  const context = { config: model.config, pages: model.pages }
  try {
    const now = pageAddress(permalinkPage(entry, context), model.config)
    if (!samePath(now.path, permalinkPath(entry.permalink))) return null
    const moved = change.path !== undefined && change.path !== entry.path
    const next = pageAddress(
      permalinkPage({ ...entry, path: change.path ?? entry.path, slug: change.slug, title: change.title, section: moved ? '' : entry.section }, context),
      model.config,
    )
    try {
      const url = new URL(entry.permalink)
      url.pathname = encodeURI(next.path)
      return url.toString()
    } catch {
      return next.url || next.path
    }
  } catch {
    return null
  }
}

/** The `aliases` entry for the page's current address (language-aware with the settings). */
export function pageAlias(entry: PageEntry, model: UrlModel | null, baseURL: string | null): string | null {
  if (!entry.permalink) return null
  if (!model) return aliasPath(entry.permalink, baseURL)
  const lang = permalinkPage(entry, { config: model.config }).lang
  return aliasFor(entry.permalink, model.config, lang, model.hugo)
}
