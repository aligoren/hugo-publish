// Paths for referencing site images from Markdown.

/** File extensions the media library handles (without dots). */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif']

export function isImagePath(path: string): boolean {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return path.includes('.') && IMAGE_EXTENSIONS.includes(extension)
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '')
}

const BUNDLE_INDEX = /^_?index\.[^/]+$/

/**
 * The `src` to write in a Markdown document (site-relative `docPath`) for a site image:
 * - `static/a/b.png` → `/a/b.png` (published at the site root)
 * - an image in the document's page bundle (`content/x/index.md` + `content/x/img.jpg`) → `img.jpg`,
 *   and `images/img.jpg` for a subfolder of the bundle
 * - `assets/a/b.png` → `a/b.png` (for render hooks and `resources.Get`)
 * - anything else → its site-relative path
 */
export function imageReference(imagePath: string, docPath: string): string {
  const image = normalize(imagePath)
  if (image.startsWith('static/')) return `/${image.slice('static/'.length)}`
  if (image.startsWith('assets/')) return image.slice('assets/'.length)
  const doc = normalize(docPath)
  const docName = doc.split('/').pop() ?? ''
  if (BUNDLE_INDEX.test(docName)) {
    const bundleDir = doc.slice(0, doc.length - docName.length)
    if (bundleDir && image.startsWith(bundleDir)) return image.slice(bundleDir.length)
  }
  return image
}

/** The folder part of a site-relative path (`content/x/img.jpg` → `content/x`). */
export function folderOf(path: string): string {
  const normalized = normalize(path)
  const at = normalized.lastIndexOf('/')
  return at < 0 ? '' : normalized.slice(0, at)
}

export function fileNameOf(path: string): string {
  return normalize(path).split('/').pop() ?? path
}
