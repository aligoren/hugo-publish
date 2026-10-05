// Renaming / moving the open document, with the old address added to `aliases` when asked.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../lib/api'
import { joinFrontMatter } from '../../lib/frontmatter'
import { forHugo, relativeToSite, siteUrlConfig, type SiteUrlConfig } from '../../lib/permalinks'
import { useSite } from '../site/SiteContext'
import { applyFrontMatterOps, findKey, type FrontMatterOp } from './frontMatterOps'
import type { RenameRequest } from './RenameDialog'
import type { UrlModel } from './rename'
import type { DocumentController } from './useDocument'
import type { FrontMatterController } from './useFrontMatter'

export type RenameResult = 'done' | 'saveFailed' | 'failed'

export interface RenameController {
  busy: boolean
  error: unknown
  /**
   * `done`: moved and the new path opened; `saveFailed`: unsaved changes could not be saved (the
   * pane shows why); `failed`: see `error`.
   */
  rename(request: RenameRequest): Promise<RenameResult>
  clearError(): void
}

/** The front matter edits a rename asks for (new slug, old address in `aliases`). */
export function renameOps(values: Record<string, unknown> | null, request: RenameRequest): FrontMatterOp[] {
  const ops: FrontMatterOp[] = []
  if (request.slug !== null) ops.push({ op: 'set', path: [findKey(values, 'slug') ?? 'slug'], value: request.slug })
  if (request.alias) {
    const key = findKey(values, 'aliases')
    const current = key ? values?.[key] : undefined
    const list = Array.isArray(current) ? current.map(String) : typeof current === 'string' && current ? [current] : []
    if (!list.includes(request.alias)) ops.push({ op: 'set', path: [key ?? 'aliases'], value: [...list, request.alias] })
  }
  return ops
}

export function useRename(path: string, doc: DocumentController, fm: FrontMatterController): RenameController {
  const site = useSite()
  const latest = useRef({ site, doc, fm })
  useEffect(() => {
    latest.current = { site, doc, fm }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const rename = useCallback(
    async (request: RenameRequest): Promise<RenameResult> => {
      setBusy(true)
      setError(null)
      const { plan } = request
      try {
        // Unsaved changes are saved first; a failed save (e.g. a conflict) is shown by the pane.
        await latest.current.fm.flush()
        const before = latest.current.doc.getParts()
        const base = latest.current.doc.getLoaded()
        if (before && base && joinFrontMatter(before) !== base.original && !(await latest.current.doc.save())) {
          return 'saveFailed'
        }
        const parts = latest.current.doc.getParts()
        const loaded = latest.current.doc.getLoaded()
        if (!parts || !loaded) return 'failed'

        const ops = renameOps(latest.current.fm.values, request)
        let written: string | null = null
        let version = loaded.version
        if (ops.length > 0) {
          // Written before the move, so a failed edit leaves the file where it was.
          written = joinFrontMatter(await applyFrontMatterOps(parts, ops))
          version = await api.writeText(path, written, loaded.version)
        }
        try {
          await api.renameFile(plan.from, plan.to)
        } catch (e) {
          // Put the old text back, so the page does not end up with its own address as an alias.
          if (written !== null) await api.writeText(path, loaded.original, version).catch(() => undefined)
          throw e
        }
        if (written !== null) void api.historySave(plan.newPath, written, 'save').catch(() => undefined)

        const { site: current } = latest.current
        await current.reloadFiles()
        void current.reloadPages()
        current.openFile(plan.newPath)
        return 'done'
      } catch (e) {
        setError(e)
        return 'failed'
      } finally {
        setBusy(false)
      }
    },
    [path],
  )

  const clearError = useCallback(() => setError(null), [])
  return { busy, error, rename, clearError }
}

const urlConfigs = new Map<string, Promise<SiteUrlConfig | null>>()

/** The site's URL settings from `hugo config`, read once per site and config version; null without Hugo. */
function loadUrlConfig(siteRoot: string, configVersion: number): Promise<SiteUrlConfig | null> {
  const key = `${siteRoot}\n${configVersion}`
  let promise = urlConfigs.get(key)
  if (!promise) {
    promise = Promise.resolve()
      .then(() => api.configEffective())
      .then((config) => relativeToSite(siteUrlConfig(config.values), siteRoot))
      .catch(() => null)
    urlConfigs.set(key, promise)
  }
  return promise
}

/** For tests. */
export function clearUrlConfigCache() {
  urlConfigs.clear()
}

/**
 * What predicting a page's address needs (settings, page list, Hugo version); null while it
 * loads or without Hugo, then the old address is only adjusted where it ends with the name.
 */
export function useUrlModel(): UrlModel | null {
  const { site, hugo, pages, configVersion } = useSite()
  const [loaded, setLoaded] = useState<{ key: string; config: SiteUrlConfig | null } | null>(null)
  const key = `${site.root}\n${configVersion}`
  useEffect(() => {
    let cancelled = false
    void loadUrlConfig(site.root, configVersion).then((config) => {
      if (!cancelled) setLoaded({ key, config })
    })
    return () => {
      cancelled = true
    }
  }, [configVersion, key, site.root])
  const version = hugo?.version ?? null
  const config = loaded?.key === key ? loaded.config : null
  return useMemo(() => (config ? { config: forHugo(config, version), pages, hugo: version } : null), [config, pages, version])
}
