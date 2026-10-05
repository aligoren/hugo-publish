// How pages are addressed from menus and links: `pageRef` is the page's path in the content folder.

/** `pageRef` of a content file: content-relative, without extension or `index` (`/about`, `/docs/guide`, `/`). */
export function pageRefOf(path: string, contentDir = 'content'): string {
  const rel = path.startsWith(`${contentDir}/`) ? path.slice(contentDir.length + 1) : path
  const noExt = rel.replace(/\.[^./]+$/, '')
  return `/${noExt.replace(/(^|\/)_?index$/, '')}`
}

function normalize(ref: string): string {
  const trimmed = ref
    .trim()
    .replace(/\.(md|markdown|html|htm|org|adoc|pdc|rst)$/i, '')
    .replace(/\/(_?index)$/i, '')
    .replace(/^\/+|\/+$/g, '')
  return `/${trimmed.toLowerCase()}`
}

/** Whether a menu's `pageRef` points at this content file (Hugo resolves it without regard to case). */
export function pageRefMatches(ref: string, path: string, contentDir = 'content'): boolean {
  if (ref.trim() === '') return false
  return normalize(ref) === normalize(pageRefOf(path, contentDir))
}
