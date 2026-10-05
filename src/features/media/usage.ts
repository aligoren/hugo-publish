// Which images the site refers to: a conservative scan of content, config and template files.
import { useEffect, useState } from 'react'

import { api, type ContentFile, type SiteInfo } from '../../lib/api'
import { fileNameOf } from './reference'

/** Splits text into path-like tokens; `/` and `\` split too, so the last part is the file name. */
const SEPARATORS = /[\s"'`()<>[\]{}|,;=*\\/]+/u

/**
 * File names a theme may use without any reference (favicons, `feature*` page resources…).
 * Such images are never reported as unused.
 */
const CONVENTIONAL_NAME =
  /^(favicon|apple-touch-icon|android-chrome|mstile|safari-pinned-tab|logo|avatar|og[-_]?image|social|feature|cover|thumbnail|thumb|banner|hero|background)/i

/** Lower-case file names (and URL-decoded variants) mentioned anywhere in `texts`. */
export function mentionedNames(texts: string[]): Set<string> {
  const names = new Set<string>()
  for (const text of texts) {
    for (const raw of text.split(SEPARATORS)) {
      if (!raw.includes('.')) continue
      const token = raw.replace(/[?#].*$/, '').replace(/[.:!]+$/, '')
      if (!token) continue
      names.add(token.toLowerCase())
      if (token.includes('%')) {
        try {
          names.add(decodeURIComponent(token).toLowerCase())
        } catch {
          // Not valid percent-encoding; the raw token is enough.
        }
      }
    }
  }
  return names
}

/**
 * Images that nothing mentions by file name (and therefore not by path either). Errs on the side
 * of "used": a name mentioned anywhere counts, and conventional names always count.
 */
export function findUnusedImages(images: string[], texts: string[]): Set<string> {
  const names = mentionedNames(texts)
  const unused = new Set<string>()
  for (const image of images) {
    const name = fileNameOf(image)
    if (CONVENTIONAL_NAME.test(name)) continue
    const lower = name.toLowerCase()
    if (names.has(lower)) continue
    // Names with spaces are split by the tokenizer; look for them verbatim.
    if (/\s/.test(name) && texts.some((t) => t.toLowerCase().includes(lower))) continue
    unused.add(image)
  }
  return unused
}

interface Source {
  path: string
  /** Changes when the file changes, so cached text is re-read. */
  version: string
}

/** Text files that can reference images, besides the Markdown content. */
const EXTRA_SOURCES: [string, string[]][] = [
  ['content', ['html', 'htm']],
  ['layouts', ['html', 'xml', 'json', 'js', 'css', 'toml', 'yaml', 'yml']],
  ['themes', ['html']],
  ['assets', ['css', 'scss', 'sass', 'js', 'ts', 'jsx', 'tsx', 'json', 'toml', 'yaml', 'yml']],
  ['data', ['toml', 'yaml', 'yml', 'json']],
  ['config', ['toml', 'yaml', 'yml', 'json']],
  ['i18n', ['toml', 'yaml', 'yml', 'json']],
  ['static', ['css', 'js', 'html', 'webmanifest', 'json', 'xml']],
]
const MAX_SCANNED_FILES = 4000
const MAX_TEXT_BYTES = 2 * 1024 * 1024

const textCache = new Map<string, { version: string; text: string }>()

async function readCached(source: Source): Promise<string> {
  const cached = textCache.get(source.path)
  if (cached && cached.version === source.version) return cached.text
  let text = ''
  try {
    text = (await api.readText(source.path)).text
  } catch {
    // Unreadable (binary, not UTF-8, deleted meanwhile): it cannot reference anything we can see.
  }
  textCache.set(source.path, { version: source.version, text })
  return text
}

async function collectSources(site: SiteInfo, files: ContentFile[], configVersion: number): Promise<Source[]> {
  const sources: Source[] = files.map((f) => ({ path: f.path, version: `m${f.modifiedMs}` }))
  for (const config of site.configFiles) sources.push({ path: config, version: `c${configVersion}` })
  const extra = await Promise.all(
    EXTRA_SOURCES.map(([dir, extensions]) => api.listFiles(dir, extensions).catch(() => [])),
  )
  const seen = new Set(sources.map((s) => s.path))
  for (const list of extra) {
    for (const file of list) {
      if (seen.has(file.path) || file.size > MAX_TEXT_BYTES) continue
      seen.add(file.path)
      sources.push({ path: file.path, version: `s${file.size}` })
    }
  }
  return sources.slice(0, MAX_SCANNED_FILES)
}

/** Reads every source (cached by version), a few at a time. */
async function readAll(sources: Source[]): Promise<string[]> {
  const texts: string[] = new Array(sources.length)
  let next = 0
  async function worker() {
    while (next < sources.length) {
      const index = next++
      texts[index] = await readCached(sources[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, sources.length) }, worker))
  return texts
}

export interface UsageState {
  /** Unused image paths; null while scanning (or before the image list is known). */
  unused: Set<string> | null
  error: unknown
}

/** Scans the site for references to `images` whenever the images or the site's files change. */
export function useUnusedImages(
  images: string[] | null,
  site: SiteInfo,
  files: ContentFile[],
  configVersion: number,
): UsageState {
  const [state, setState] = useState<UsageState>({ unused: null, error: null })
  const key = images?.join('\n') ?? null

  useEffect(() => {
    if (key === null) return
    let cancelled = false
    // The previous result stays visible until this scan finishes.
    void (async () => {
      try {
        const sources = await collectSources(site, files, configVersion)
        const texts = await readAll(sources)
        if (!cancelled) setState({ unused: findUnusedImages(key ? key.split('\n') : [], texts), error: null })
      } catch (error) {
        if (!cancelled) setState({ unused: null, error })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [key, site, files, configVersion])

  return state
}

/** Forgets cached file texts (tests, or after a site switch). */
export function clearUsageCache() {
  textCache.clear()
}
