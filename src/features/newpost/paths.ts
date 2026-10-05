// Sections, paths and titles for the new-post wizard.

import type { ContentFile } from '../../lib/api'
import { ensureYamlFrontMatter, fileLineSeparator, joinFrontMatter, setField, splitFrontMatter } from '../../lib/frontmatter'
import { slugify } from '../../lib/slug'

export interface SectionInfo {
  /** Folder inside the content folder, e.g. `posts` or `blog/2026`; `''` is the top level. */
  path: string
  /** Posts directly in it (single files and bundles). */
  posts: number
  /** How many of those are page bundles (`<name>/index.md`). */
  bundles: number
}

/**
 * Content folders that hold posts, most used first. Bundle folders (`x/index.md`) are posts, not
 * sections; a folder with an `_index.md` is a section even when empty.
 */
export function contentSections(files: ContentFile[], contentDir = 'content'): SectionInfo[] {
  const sections = new Map<string, SectionInfo>()
  const section = (path: string) => {
    let info = sections.get(path)
    if (!info) {
      info = { path, posts: 0, bundles: 0 }
      sections.set(path, info)
    }
    return info
  }
  for (const file of files) {
    if (!file.path.startsWith(`${contentDir}/`)) continue
    const segments = file.path.slice(contentDir.length + 1).split('/')
    const name = segments.pop() ?? ''
    if (/^_index\./.test(name)) {
      section(segments.join('/'))
    } else if (/^index\./.test(name) && segments.length > 0) {
      segments.pop()
      const info = section(segments.join('/'))
      info.posts++
      info.bundles++
    } else {
      section(segments.join('/')).posts++
    }
  }
  return [...sections.values()].toSorted((a, b) => {
    // The top level holds pages (about, contact) rather than posts: list it last.
    if ((a.path === '') !== (b.path === '')) return a.path === '' ? 1 : -1
    return b.posts - a.posts || a.path.localeCompare(b.path)
  })
}

/** A section name typed by the user, as a folder path: each part slugified. */
export function normalizeSection(input: string): string {
  return input
    .split(/[\\/]+/)
    .map((part) => slugify(part))
    .filter((part) => part !== '')
    .join('/')
}

export function buildPostPath({
  contentDir = 'content',
  section,
  slug,
  bundle,
}: {
  contentDir?: string
  section: string
  slug: string
  bundle: boolean
}): string {
  const folder = section ? `${contentDir}/${section}` : contentDir
  return bundle ? `${folder}/${slug}/index.md` : `${folder}/${slug}.md`
}

/** `x.md`, `x/index.md` and `x/_index.md` all give the page the same address. */
function pageKey(path: string): string {
  return path
    .toLowerCase()
    .replace(/\.(md|markdown|mdown|html?)$/, '')
    .replace(/\/_?index$/, '')
}

/** An existing content file at the same address as `path` (ignoring case, as Windows and macOS do). */
export function findDuplicate(path: string, files: ContentFile[]): string | null {
  const key = pageKey(path)
  return files.find((f) => pageKey(f.path) === key)?.path ?? null
}

/** The archetype name Hugo picks without `--kind`: the section's, else `default`. */
export function automaticArchetype(section: string, names: string[]): string | null {
  const first = section.split('/')[0]
  if (first && names.includes(first)) return first
  return names.includes('default') ? 'default' : null
}

/**
 * Sets the front matter title. YAML is edited in place (other lines untouched); TOML and JSON get
 * their `title` line replaced or added; a file without front matter gets a YAML block.
 */
export function setTitle(text: string, title: string): string {
  const parts = splitFrontMatter(text)
  if (parts.format === 'toml') {
    return joinFrontMatter({ ...parts, frontMatterText: setTomlTitle(parts.frontMatterText, title, fileLineSeparator(parts)) })
  }
  if (parts.format === 'json') {
    return joinFrontMatter({ ...parts, frontMatterText: setJsonTitle(parts.frontMatterText, title) })
  }
  return joinFrontMatter(setField(ensureYamlFrontMatter(parts), 'title', title))
}

/** Replaces the top-level `title = …` line (keeping its quote style when possible) or adds one. */
export function setTomlTitle(frontMatter: string, title: string, eol: string): string {
  const lines = frontMatter.split(/(?<=\n)/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*\[/.test(line)) break
    const match = /^(\s*)(title|"title"|'title')(\s*=\s*)(['"]?)/.exec(line)
    if (!match) continue
    const ending = /\r?\n$/.exec(line)?.[0] ?? ''
    lines[i] = `${match[1]}${match[2]}${match[3]}${tomlString(title, match[4] === "'")}${ending}`
    return lines.join('')
  }
  return `title = ${tomlString(title, false)}${eol}${frontMatter}`
}

function tomlString(value: string, preferLiteral: boolean): string {
  // eslint-disable-next-line no-control-regex
  const literalOk = !/['\u0000-\u001f\u007f]/.test(value)
  if (preferLiteral && literalOk) return `'${value}'`
  // JSON string escapes are valid TOML basic-string escapes.
  return JSON.stringify(value)
}

function setJsonTitle(frontMatter: string, title: string): string {
  const existing = /("title"\s*:\s*)"(?:[^"\\]|\\.)*"/
  if (existing.test(frontMatter)) return frontMatter.replace(existing, (_, key: string) => `${key}${JSON.stringify(title)}`)
  if (/^\s*\{\s*\}\s*$/.test(frontMatter)) return `{ "title": ${JSON.stringify(title)} }`
  return frontMatter.replace(/^(\s*\{)(\s*)/, (_, open: string, space: string) => {
    const indent = space.includes('\n') ? space : ' '
    return `${open}${indent}"title": ${JSON.stringify(title)},${indent}`
  })
}
