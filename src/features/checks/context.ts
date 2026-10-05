// What the checks need to know about the site, loaded once per site and cached.

import { api, type Archetype, type ContentFile } from '../../lib/api'
import { parseDocument } from './fields'

export interface ArchetypeText extends Archetype {
  /** The archetype's text (for a bundle archetype, its index.md). */
  text: string
}

export interface CheckContext {
  archetypes: ArchetypeText[]
  /** Most of the sampled posts have a non-empty description. */
  siteUsesDescription: boolean
  /** `markup.goldmark.renderer.unsafe` from Hugo's effective config; undefined when unknown. */
  rawHtmlAllowed?: boolean
}

/** How many recent posts are read to see whether the site uses descriptions. */
const SAMPLE_SIZE = 12

const cache = new Map<string, Promise<CheckContext>>()

/** Loads (once per site root) the archetype texts and the description habit of the site. */
export function loadCheckContext(siteRoot: string, files: ContentFile[]): Promise<CheckContext> {
  let pending = cache.get(siteRoot)
  if (!pending) {
    pending = Promise.all([loadArchetypes(), usesDescription(files), rawHtmlAllowed()]).then(
      ([archetypes, siteUsesDescription, rawHtml]) => ({ archetypes, siteUsesDescription, rawHtmlAllowed: rawHtml }),
    )
    cache.set(siteRoot, pending)
  }
  return pending
}

/** Forgets cached contexts (after archetypes change, and between tests). */
export function clearCheckContextCache(): void {
  cache.clear()
}

async function loadArchetypes(): Promise<ArchetypeText[]> {
  const list = await api.listArchetypes().catch(() => [] as Archetype[])
  const loaded = await Promise.all(
    list.map(async (archetype) => {
      const candidates = /\.[^/]+$/.test(archetype.path)
        ? [archetype.path]
        : [`${archetype.path}/index.md`, `${archetype.path}/_index.md`]
      for (const path of candidates) {
        try {
          const file = await api.readText(path)
          return { ...archetype, text: file.text }
        } catch {
          // Try the next candidate.
        }
      }
      return null
    }),
  )
  return loaded.filter((a): a is ArchetypeText => a !== null)
}

async function rawHtmlAllowed(): Promise<boolean | undefined> {
  try {
    // Hugo prints keys in lower case.
    const { values } = await api.configEffective()
    const unsafe = (values as { markup?: { goldmark?: { renderer?: { unsafe?: unknown } } } }).markup?.goldmark?.renderer?.unsafe
    return typeof unsafe === 'boolean' ? unsafe : undefined
  } catch {
    return undefined
  }
}

async function usesDescription(files: ContentFile[]): Promise<boolean> {
  const sample = files
    .filter((f) => !/(^|\/)_index\.[^/]+$/.test(f.path))
    .toSorted((a, b) => b.modifiedMs - a.modifiedMs)
    .slice(0, SAMPLE_SIZE)
  if (sample.length < 2) return false
  const texts = await Promise.all(sample.map((f) => api.readText(f.path).then((t) => t.text).catch(() => null)))
  const read = texts.filter((t): t is string => t !== null)
  const withDescription = read.filter((text) => {
    const description = parseDocument(text).fields?.description
    return typeof description === 'string' && description.trim() !== ''
  }).length
  return read.length >= 2 && withDescription * 2 >= read.length
}
