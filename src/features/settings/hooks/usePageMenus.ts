import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../../lib/api'
import { contentLanguage, type SiteUrlConfig } from '../../../lib/permalinks'
import { joinFrontMatter, readFrontMatter, splitFrontMatter } from '../../../lib/frontmatter'
import { applyFrontMatterOps, applyOpsToValues, type FrontMatterOp } from '../../document/frontMatterOps'
import { indexFrontMatter } from '../../document/termIndex'
import { useSite } from '../../site/SiteContext'
import type { FileChange } from '../model/fileChange'
import { fileLanguage, pageMenuEntries, PAGE_MENU_FIELDS, setPageMenuOps, type PageMenuEntry } from '../model/pageMenus'
import type { Tree } from '../model/values'

export interface PageMenuItem extends PageMenuEntry {
  /** Link title or title of the page: the entry's name when it sets none. */
  title: string
  /** The page's own weight, used when the entry sets none. */
  weight?: number
  /** Language from the file name (`about.tr.md`) or the language's content folder; null for the default language. */
  lang: string | null
}

export interface PageMenuDraft {
  file: string
  menu: string
  /** Desired values of the editable fields. */
  values: Tree
}

function field(values: Tree | null, name: string): unknown {
  if (!values) return undefined
  const key = Object.keys(values).find((k) => k.toLowerCase() === name)
  return key === undefined ? undefined : values[key]
}

/** The editable fields of an entry. */
export function editableValues(values: Tree): Tree {
  return Object.fromEntries(Object.entries(values).filter(([k]) => (PAGE_MENU_FIELDS as readonly string[]).includes(k)))
}

async function parseFrontMatter(text: string): Promise<Tree | null> {
  const parts = splitFrontMatter(text)
  if (parts.format === 'toml') return (await api.tomlParseText(parts.frontMatterText)).values
  return readFrontMatter(parts)
}

/** Writes `ops` into a content file's front matter; the diff is shown before anything is written. */
export async function frontMatterChange(path: string, ops: (frontMatter: Tree | null) => FrontMatterOp[]): Promise<FileChange | null> {
  const file = await api.readText(path)
  const parts = splitFrontMatter(file.text)
  const list = ops(await parseFrontMatter(file.text))
  if (list.length === 0) return null
  const after = joinFrontMatter(await applyFrontMatterOps(parts, list))
  return { path, before: file.text, after, version: file.version }
}

const draftKey = (file: string, menu: string) => `${file}\u0000${menu}`

/** A page's language: from the settings (name or content folder) when known, else from the file name. */
export function pageLanguage(path: string, languages: readonly string[], config: SiteUrlConfig | null): string | null {
  if (config && config.languages.length > 1) return contentLanguage(path, config)
  return fileLanguage(path, languages)
}

/**
 * Menu entries declared in page front matter, and unsaved changes to them. With `config`, a
 * page's language also comes from its content folder (`languages.<lang>.contentDir`, mounts).
 */
export function usePageMenus(languages: readonly string[], config: SiteUrlConfig | null = null) {
  const { site, files } = useSite()
  const [index, setIndex] = useState<Map<string, Tree | null> | null>(null)
  const [drafts, setDrafts] = useState<Record<string, PageMenuDraft>>({})

  useEffect(() => {
    let cancelled = false
    void indexFrontMatter(site.root, files).then((result) => {
      if (!cancelled) setIndex(result)
    })
    return () => {
      cancelled = true
    }
  }, [files, site.root])

  const items = useMemo<PageMenuItem[]>(() => {
    if (!index) return []
    const byPath = new Map(files.map((f) => [f.path, f]))
    const out: PageMenuItem[] = []
    for (const [path, values] of index) {
      const entries = pageMenuEntries(path, values)
      if (entries.length === 0) continue
      const linkTitle = field(values, 'linktitle')
      const title = typeof linkTitle === 'string' && linkTitle !== '' ? linkTitle : String(field(values, 'title') ?? byPath.get(path)?.title ?? path.split('/').pop())
      const weight = Number(field(values, 'weight'))
      for (const entry of entries) {
        out.push({ ...entry, title, weight: Number.isFinite(weight) && weight !== 0 ? weight : undefined, lang: pageLanguage(path, languages, config) })
      }
    }
    return out
  }, [config, files, index, languages])

  const setDraft = useCallback((draft: PageMenuDraft) => {
    setDrafts((current) => ({ ...current, [draftKey(draft.file, draft.menu)]: draft }))
  }, [])
  const dropDraft = useCallback((file: string, menu: string) => {
    setDrafts((current) => {
      const key = draftKey(file, menu)
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])
  const clear = useCallback(() => setDrafts({}), [])
  const draftOf = useCallback((file: string, menu: string): PageMenuDraft | undefined => drafts[draftKey(file, menu)], [drafts])

  const draftFiles = useMemo(() => [...new Set(Object.values(drafts).map((d) => d.file))], [drafts])

  /** Reads each changed page again and turns its drafts into a front matter diff. */
  const prepareChanges = useCallback(async (): Promise<FileChange[]> => {
    const out: FileChange[] = []
    for (const file of draftFiles) {
      const fileDrafts = Object.values(drafts).filter((d) => d.file === file)
      const change = await frontMatterChange(file, (frontMatter) => {
        // Each menu's ops are computed on the result of the previous ones (a list may become a map).
        let values: Tree = frontMatter ?? {}
        const ops: FrontMatterOp[] = []
        for (const d of fileDrafts) {
          const entry = pageMenuEntries(file, values).find((e) => e.menu === d.menu)
          const next = entry ? setPageMenuOps(entry, d.values) : []
          ops.push(...next)
          values = applyOpsToValues(values, next)
        }
        return ops
      })
      if (change) out.push(change)
    }
    return out
  }, [draftFiles, drafts])

  return {
    items,
    loading: index === null,
    drafts,
    draftOf,
    setDraft,
    dropDraft,
    clear,
    count: Object.keys(drafts).length,
    files: draftFiles,
    prepareChanges,
  }
}

export type PageMenus = ReturnType<typeof usePageMenus>
