// Site data and file operations the Markdown editor needs (see src/features/editor/contract.ts):
// link targets, shortcodes, image import and previews, spellchecking.

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { api, type PageEntry } from '../../lib/api'
import type { EditorIntegrationProps, InsertedImage, LinkTarget } from '../editor'
import { useSite } from '../site/SiteContext'
import { fileToBase64, humanizeFileName, imageTargetDir, importFileName, isGenericImageName, postSlug, siteImagePaths } from './imagePaths'
import { imageReference } from './mediaBridge'
import { spellLanguage, type SiteSettings } from './siteSettings'
import { usePersonalDictionary, useShortcodes } from './useSiteData'

/** Pages with a content file, for `[[` link completion (the document itself left out). */
export function linkTargets(pages: readonly PageEntry[], contentDir: string, docPath: string): LinkTarget[] {
  const prefix = (contentDir.replace(/\/+$/, '') || 'content') + '/'
  return pages
    .filter((page) => page.path.startsWith(prefix) && page.path !== docPath)
    .map((page) => ({ title: page.title || page.path, path: page.path, permalink: page.permalink }))
}

/** What to insert for an image file in the site. */
export function insertedImage(imagePath: string, docPath: string): InsertedImage {
  return { src: imageReference(imagePath, docPath), alt: humanizeFileName(imagePath) }
}

interface Options {
  path: string
  /** The document's `slug` front matter value, for `static/images/<slug>/`. */
  slug: unknown
  settings: SiteSettings | null
  /** Opens the media picker; resolves with the chosen file, or null when it is closed. */
  pickImage(defaultDir: string): Promise<string | null>
  onError(error: unknown): void
}

export type EditorIntegration = Required<
  Pick<EditorIntegrationProps, 'docPath' | 'pages' | 'onImageFiles' | 'onRequestImage' | 'resolveImage' | 'spellcheck' | 'pasteHtmlAsMarkdown'>
> &
  Pick<EditorIntegrationProps, 'shortcodes'>

export function useEditorIntegration({ path, slug, settings, pickImage, onError }: Options): EditorIntegration {
  const { site, pages } = useSite()
  const shortcodes = useShortcodes()
  const dictionary = usePersonalDictionary()

  const latest = useRef({ slug, pickImage, onError })
  useEffect(() => {
    latest.current = { slug, pickImage, onError }
  })

  const linkPages = useMemo(() => linkTargets(pages, site.contentDir, path), [pages, path, site.contentDir])

  const onImageFiles = useCallback(
    async (files: File[]): Promise<InsertedImage[]> => {
      const targetDir = imageTargetDir(path, latest.current.slug)
      const base = postSlug(path, latest.current.slug)
      const inserted: InsertedImage[] = []
      for (const file of files) {
        try {
          const name = importFileName(file, base)
          const data = await fileToBase64(file)
          const imported = await api.mediaImportBytes(name, data, { targetDir, stripMetadata: true })
          inserted.push({ src: imageReference(imported, path), alt: humanizeFileName(isGenericImageName(file.name) ? '' : file.name) })
        } catch (error) {
          latest.current.onError(error)
        }
      }
      return inserted
    },
    [path],
  )

  const onRequestImage = useCallback(async (): Promise<InsertedImage | null> => {
    const picked = await latest.current.pickImage(imageTargetDir(path, latest.current.slug))
    return picked ? insertedImage(picked, path) : null
  }, [path])

  const thumbnails = useRef(new Map<string, Promise<string | null>>())
  const resolveImage = useCallback(
    (src: string): Promise<string | null> => {
      if (src.startsWith('data:')) return Promise.resolve(src)
      const candidates = siteImagePaths(src, path)
      if (candidates.length === 0) return Promise.resolve(null)
      const key = candidates.join('\n')
      const cached = thumbnails.current.get(key)
      if (cached) return cached
      const promise = (async () => {
        for (const file of candidates) {
          try {
            return await api.mediaThumbnail(file)
          } catch {
            // Try the next place the image could be.
          }
        }
        // Not cached: the image may be added later.
        thumbnails.current.delete(key)
        return null
      })()
      thumbnails.current.set(key, promise)
      return promise
    },
    [path],
  )

  const language = spellLanguage(settings)
  const { words, addWord } = dictionary
  const spellcheck = useMemo(() => ({ language, personalWords: words, onAddWord: addWord }), [addWord, language, words])

  return {
    docPath: path,
    pages: linkPages,
    shortcodes,
    onImageFiles,
    onRequestImage,
    resolveImage,
    spellcheck,
    pasteHtmlAsMarkdown: true,
  }
}
