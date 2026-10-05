// Reading and writing `.hugo-publisher/snippets.toml`. Changes go through the TOML editor as ops,
// so comments and formatting in the file survive; a new file is created only if none appeared
// in the meantime (expected version "").

import { useCallback, useEffect, useState } from 'react'

import { api, isAppError, type ConfigOp } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'
import { parseSnippets, SNIPPETS_FILE_HEADER, SNIPPETS_PATH, type ParsedSnippet } from './definitions'

export interface SnippetsFile {
  /** The file as read ('' when it does not exist). */
  text: string
  /** Null when the file does not exist. */
  version: string | null
  snippets: ParsedSnippet[]
  problems: string[]
}

export interface SnippetsDeps {
  readText(path: string): Promise<{ text: string; version: string }>
  tomlParseText(text: string): Promise<{ values: Record<string, unknown> }>
}

export async function readSnippetsFile(deps: SnippetsDeps = api): Promise<SnippetsFile> {
  let file: { text: string; version: string }
  try {
    file = await deps.readText(SNIPPETS_PATH)
  } catch (error) {
    if (isAppError(error) && error.code !== 'io') throw error
    return { text: '', version: null, snippets: [], problems: [] }
  }
  const { values } = await deps.tomlParseText(file.text)
  return { text: file.text, version: file.version, ...parseSnippets(values) }
}

/** The file's text after `ops` (nothing is written). A missing file starts with a comment. */
export async function previewSnippetOps(file: SnippetsFile, ops: ConfigOp[], toml: Pick<typeof api, 'tomlEditText'> = api): Promise<string> {
  const base = file.version === null ? SNIPPETS_FILE_HEADER : file.text
  return ops.length === 0 ? base : toml.tomlEditText(base, ops)
}

export interface SnippetsController {
  file: SnippetsFile | null
  error: unknown
  reload(): Promise<void>
  preview(ops: ConfigOp[]): Promise<string>
  /** Writes text made by `preview`; fails with a conflict when the file changed meanwhile. */
  write(text: string): Promise<void>
}

const cache = new Map<string, SnippetsFile>()

export function useSnippets(): SnippetsController {
  const { site } = useSite()
  const [file, setFile] = useState<SnippetsFile | null>(() => cache.get(site.root) ?? null)
  const [error, setError] = useState<unknown>(null)

  const reload = useCallback(async () => {
    try {
      const next = await readSnippetsFile()
      cache.set(site.root, next)
      setFile(next)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [site.root])

  useEffect(() => {
    // Read on open; state changes only after the file arrives.
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [reload])

  const preview = useCallback(
    async (ops: ConfigOp[]) => {
      if (!file) throw new Error('snippets not loaded')
      return previewSnippetOps(file, ops)
    },
    [file],
  )

  const write = useCallback(
    async (text: string) => {
      if (!file) return
      await api.writeText(SNIPPETS_PATH, text, file.version ?? '')
      await reload()
    },
    [file, reload],
  )

  return { file, error, reload, preview, write }
}
