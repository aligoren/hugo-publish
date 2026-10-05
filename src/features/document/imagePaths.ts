// Where images of a document go, how they are referenced, and how a reference maps back to a
// file in the site.

import { slugify } from '../../lib/slug'

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** `index.md` (leaf bundle) or `_index.md` (branch bundle), also per language (`index.tr.md`). */
export function isBundleIndex(docPath: string): boolean {
  return /^_?index\.[^/]+$/i.test(basename(docPath))
}

/** The folder of a document. */
export function docFolder(docPath: string): string {
  return dirname(docPath)
}

/**
 * The name the post goes by: its `slug`, else the bundle folder name or file name. Used for
 * `static/images/<slug>/`.
 */
export function postSlug(docPath: string, slug?: unknown): string {
  if (typeof slug === 'string' && slugify(slug)) return slugify(slug)
  const name = isBundleIndex(docPath) ? basename(dirname(docPath)) : stripExtension(basename(docPath))
  return slugify(name) || 'images'
}

/** Folder for new images: the page bundle, else `static/images/<slug-of-post>`. */
export function imageTargetDir(docPath: string, slug?: unknown): string {
  return isBundleIndex(docPath) ? docFolder(docPath) : `static/images/${postSlug(docPath, slug)}`
}

/** Joins and normalises a relative path (`a/b` + `../c.png` → `a/c.png`); null when it escapes. */
function joinRelative(base: string, relative: string): string | null {
  const parts = base === '' ? [] : base.split('/')
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.join('/')
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text)
  } catch {
    return text
  }
}

/**
 * The site files an image `src` may refer to, most likely first: `/x.png` -> `static/x.png`
 * (then `assets/x.png`, which image render hooks also look in); a relative path -> the page
 * bundle, then `assets/`. Empty for remote images.
 */
export function siteImagePaths(src: string, docPath: string): string[] {
  const clean = safeDecode(src.trim().replace(/[?#].*$/, ''))
  if (clean === '' || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//')) return []
  const candidates = clean.startsWith('/')
    ? [joinRelative('static', clean.slice(1)), joinRelative('assets', clean.slice(1))]
    : [isBundleIndex(docPath) ? joinRelative(docFolder(docPath), clean) : null, joinRelative('assets', clean)]
  return candidates.filter((path): path is string => path !== null && path !== 'static' && path !== 'assets')
}

/** The most likely site file for an image `src` (see {@link siteImagePaths}). */
export function siteImagePath(src: string, docPath: string): string | null {
  return siteImagePaths(src, docPath)[0] ?? null
}

/** `IMG_kitap-kapağı.jpg` → `IMG kitap kapağı`, used as the starting alt text. */
export function humanizeFileName(name: string): string {
  const words = stripExtension(basename(name))
    .replace(/[-_.+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words ? words[0].toLocaleUpperCase() + words.slice(1) : ''
}

/** Base64 of a pasted or dropped file, for `api.mediaImportBytes`. */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await readBytes(file))
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

/** Clipboard images come with a generic name (`image.png`, `image.jpeg`…) that says nothing. */
export function isGenericImageName(name: string): boolean {
  return !name || /^image\.\w+$/i.test(name)
}

/**
 * A file name for a pasted image that has none (clipboard images are all called `image.png`):
 * the post's slug and a short random part. No date or time, which would tell when it was made.
 */
export function importFileName(file: File, base: string, random: () => number = Math.random): string {
  if (!isGenericImageName(file.name)) return file.name
  const ext = EXTENSIONS[file.type] ?? 'png'
  const suffix = Math.floor(random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')
  return `${base}-${suffix}.${ext}`
}
