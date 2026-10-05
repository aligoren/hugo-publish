// Changed files grouped the way a site owner thinks about them.

import type { ContentFile, GitFile } from '../../lib/api'

export type ChangeGroup = 'content' | 'settings' | 'theme' | 'media' | 'other'

export const GROUP_ORDER: readonly ChangeGroup[] = ['content', 'settings', 'theme', 'media', 'other']

/** What happened to a file, in the words a commit message uses. */
export type ChangeAction = 'added' | 'updated' | 'deleted'

export interface ChangeItem {
  file: GitFile
  group: ChangeGroup
  action: ChangeAction
  /** Title from the front matter, for content files that still exist. */
  title: string | null
  /** A content file that reads as a page (top level or a list page) rather than a post. */
  isPage: boolean
}

const CONTENT_EXTENSIONS = /\.(md|markdown|mdown|html?)$/i
const MEDIA_EXTENSIONS =
  /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|mp4|webm|mov|m4v|mp3|ogg|wav|m4a|pdf|zip)$/i
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic)$/i
const CONFIG_FILE = /^(hugo|config)\.(toml|ya?ml|json)$/i
const THEME_DIRS = ['themes/', 'layouts/', 'assets/', 'i18n/', 'archetypes/']

export function changeGroup(path: string, contentDir = 'content'): ChangeGroup {
  if (path.startsWith('themes/')) return 'theme'
  if (path.startsWith(`${contentDir}/`)) {
    return CONTENT_EXTENSIONS.test(path) || !MEDIA_EXTENSIONS.test(path) ? 'content' : 'media'
  }
  if (path.startsWith('static/') || MEDIA_EXTENSIONS.test(path) && !THEME_DIRS.some((d) => path.startsWith(d))) return 'media'
  if (CONFIG_FILE.test(path) || path.startsWith('config/')) return 'settings'
  if (THEME_DIRS.some((d) => path.startsWith(d))) return 'theme'
  return 'other'
}

export function isImage(path: string): boolean {
  return IMAGE_EXTENSIONS.test(path)
}

/** A Markdown file inside the content folder (what the checks look at). */
export function isContentDocument(path: string, contentDir = 'content'): boolean {
  return path.startsWith(`${contentDir}/`) && /\.(md|markdown|mdown)$/i.test(path)
}

export function changeAction(file: GitFile): ChangeAction {
  if (file.kind === 'untracked' || file.kind === 'added') return 'added'
  if (file.kind === 'deleted') return 'deleted'
  return 'updated'
}

/** Top-level pages (`content/about.md`, `content/about/index.md`) and list pages (`_index.md`). */
export function isPagePath(path: string, contentDir = 'content'): boolean {
  const segments = path.slice(contentDir.length + 1).split('/')
  const last = segments.at(-1) ?? ''
  if (/^_index\./.test(last)) return true
  if (segments.length === 1) return true
  return segments.length === 2 && /^index\./.test(last)
}

/** The file name a title-less item is shown by: the bundle folder for `index.md`. */
export function displayName(path: string): string {
  const segments = path.split('/')
  const last = segments.at(-1) ?? path
  if (/^_?index\.[^.]+$/.test(last) && segments.length > 1) return segments.at(-2)!
  return last.replace(/\.(md|markdown|mdown)$/i, '')
}

export function toChangeItems(files: GitFile[], contentFiles: ContentFile[], contentDir = 'content'): ChangeItem[] {
  const titles = new Map(contentFiles.map((f) => [f.path, f.title]))
  return files.map((file) => {
    const group = changeGroup(file.path, contentDir)
    const title = titles.get(file.path)
    return {
      file,
      group,
      action: changeAction(file),
      title: title && title.trim() !== '' ? title.trim() : null,
      isPage: group === 'content' && isPagePath(file.path, contentDir),
    }
  })
}

export function groupChanges(items: ChangeItem[]): { group: ChangeGroup; items: ChangeItem[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((i) => i.group === group).toSorted((a, b) => a.file.path.localeCompare(b.file.path)),
  })).filter((g) => g.items.length > 0)
}

/** Paths to pass to `git commit`: renames need their old path too. */
export function commitPaths(files: GitFile[]): string[] {
  const paths = new Set<string>()
  for (const file of files) {
    paths.add(file.path)
    if (file.origPath) paths.add(file.origPath)
  }
  return [...paths]
}

/** Commit emails that do not reveal a personal address. */
export function isNoreplyEmail(email: string | null | undefined): boolean {
  return /@(users\.noreply\.github\.com|users\.noreply\.gitlab\.com|noreply\.codeberg\.org)$/i.test(email?.trim() ?? '')
}
