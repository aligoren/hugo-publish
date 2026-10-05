import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../lib/api'
import { readConfigFile } from '../config-edit/configFile'
import { useSite } from '../site/SiteContext'
import { loadTaxonomySettings, type TaxonomySettings } from './config'
import { loadRecords, type FileRecord } from './indexer'

export interface IndexProgress {
  done: number
  total: number
}

export interface TaxonomyIndex {
  settings: TaxonomySettings | null
  /** Why `hugo config` could not be used (settings then come from the config files). */
  hugoError: unknown
  settingsError: unknown
  /** Front matter of every content file; `null` until the first pass finishes. */
  records: ReadonlyMap<string, FileRecord> | null
  /** Set while files are being read. */
  progress: IndexProgress | null
  /** Forgets cached files so they are read again on the next pass. */
  invalidate(paths: readonly string[]): void
}

const tomlParse = async (text: string) => (await api.tomlParseText(text)).values

/** Taxonomy settings and the front matter of every content file, kept up to date. */
export function useTaxonomyIndex(): TaxonomyIndex {
  const { site, files, configVersion } = useSite()
  const [loaded, setLoaded] = useState<{ settings: TaxonomySettings; hugoError: unknown } | null>(null)
  const [settingsError, setSettingsError] = useState<unknown>(null)
  const [records, setRecords] = useState<ReadonlyMap<string, FileRecord> | null>(null)
  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const cache = useRef<Map<string, FileRecord>>(new Map())

  useEffect(() => {
    let cancelled = false
    loadTaxonomySettings(site.configFiles, { configEffective: () => api.configEffective(), readConfigFile }).then(
      (result) => {
        if (cancelled) return
        setLoaded(result)
        setSettingsError(null)
      },
      (error: unknown) => {
        if (!cancelled) setSettingsError(error)
      },
    )
    return () => {
      cancelled = true
    }
  }, [site.root, site.configFiles, configVersion])

  useEffect(() => {
    const signal = { cancelled: false }
    let lastReport = 0
    void loadRecords(files, cache.current, { readText: api.readText, tomlParse }, {
      signal,
      onProgress(done, total) {
        const now = Date.now()
        if (signal.cancelled || (done < total && now - lastReport < 80)) return
        lastReport = now
        setProgress(done < total ? { done, total } : null)
      },
    }).then((result) => {
      if (signal.cancelled) return
      cache.current = result
      setRecords(result)
      setProgress(null)
    })
    return () => {
      signal.cancelled = true
    }
  }, [files])

  const invalidate = useCallback((paths: readonly string[]) => {
    for (const path of paths) cache.current.delete(path)
  }, [])

  return {
    settings: loaded?.settings ?? null,
    hugoError: loaded?.hugoError ?? null,
    settingsError,
    records,
    progress,
    invalidate,
  }
}
