// Site-wide data for the document pane, each loaded once and cached per site.

import { useCallback, useEffect, useRef, useState } from 'react'

import { discoverShortcodes, type ShortcodeDef } from '../editor'
import { useSite } from '../site/SiteContext'
import { addDictionaryWord, readDictionary, type DictionaryFile } from './dictionary'
import { loadSiteSettings, type SiteSettings } from './siteSettings'
import { collectTerms, indexFrontMatter, type TermCount } from './termIndex'
import { loadThemeImageParams, type ThemeImageParam } from './themeImages'

/** Taxonomies, language and base URL from the effective config (null while loading). */
export function useSiteSettings(): SiteSettings | null {
  const { site, configVersion } = useSite()
  const [settings, setSettings] = useState<{ key: string; value: SiteSettings } | null>(null)
  const key = `${site.root}\n${configVersion}`
  useEffect(() => {
    let cancelled = false
    void loadSiteSettings(site.root, configVersion).then((value) => {
      if (!cancelled) setSettings({ key, value })
    })
    return () => {
      cancelled = true
    }
  }, [configVersion, key, site.root])
  return settings?.key === key ? settings.value : null
}

/** Terms used across the site per taxonomy, most used first (empty while indexing). */
export function useSiteTerms(taxonomies: readonly string[] | null): Record<string, TermCount[]> {
  const { site, files } = useSite()
  const [terms, setTerms] = useState<Record<string, TermCount[]>>({})
  const taxonomyKey = taxonomies?.join('\n') ?? null
  useEffect(() => {
    if (taxonomyKey === null) return
    let cancelled = false
    void indexFrontMatter(site.root, files).then((index) => {
      if (!cancelled) setTerms(collectTerms(index.values(), taxonomyKey ? taxonomyKey.split('\n') : []))
    })
    return () => {
      cancelled = true
    }
  }, [files, site.root, taxonomyKey])
  return terms
}

/** Image params the templates read from pages (`cover.image`, `images`, …). */
export function useThemeImageParams(settings: SiteSettings | null): ThemeImageParam[] {
  const { site, configVersion } = useSite()
  const [params, setParams] = useState<ThemeImageParam[]>([])
  const themes = settings?.themes.join('\n') ?? null
  useEffect(() => {
    if (themes === null) return
    let cancelled = false
    void loadThemeImageParams(site.root, configVersion, themes ? themes.split('\n') : []).then((value) => {
      if (!cancelled) setParams(value)
    })
    return () => {
      cancelled = true
    }
  }, [configVersion, site.root, themes])
  return params
}

const shortcodeCache = new Map<string, Promise<ShortcodeDef[]>>()

/** Site and theme shortcodes, discovered once per site and config version. */
export function useShortcodes(): ShortcodeDef[] | undefined {
  const { site, configVersion } = useSite()
  const [shortcodes, setShortcodes] = useState<ShortcodeDef[] | undefined>(undefined)
  useEffect(() => {
    const key = `${site.root}\n${configVersion}`
    let promise = shortcodeCache.get(key)
    if (!promise) {
      promise = discoverShortcodes({ configFiles: site.configFiles }).catch(() => [])
      shortcodeCache.set(key, promise)
    }
    let cancelled = false
    void promise.then((value) => {
      if (!cancelled) setShortcodes(value)
    })
    return () => {
      cancelled = true
    }
  }, [configVersion, site.configFiles, site.root])
  return shortcodes
}

const dictionaryCache = new Map<string, DictionaryFile>()

/** The site's personal dictionary and a way to add words to it. */
export function usePersonalDictionary(): { words: readonly string[]; addWord(word: string): void; error: unknown } {
  const { site } = useSite()
  const [file, setFile] = useState<DictionaryFile | null>(() => dictionaryCache.get(site.root) ?? null)
  const [error, setError] = useState<unknown>(null)
  const fileRef = useRef(file)
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    void readDictionary().then((value) => {
      if (cancelled) return
      dictionaryCache.set(site.root, value)
      fileRef.current = value
      setFile(value)
    })
    return () => {
      cancelled = true
    }
  }, [site.root])

  const addWord = useCallback(
    (word: string) => {
      // Words are written one after another, each on top of the previous write.
      queue.current = queue.current.then(async () => {
        const base = fileRef.current ?? (await readDictionary())
        try {
          const next = await addDictionaryWord(base, word)
          fileRef.current = next
          dictionaryCache.set(site.root, next)
          setFile(next)
          setError(null)
        } catch (e) {
          setError(e)
        }
      })
    },
    [site.root],
  )

  return { words: file?.words ?? EMPTY, addWord, error }
}

const EMPTY: readonly string[] = []
