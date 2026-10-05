// Loading and saving one document: the text as last read or written, the edited parts, conflict
// handling with `expectedVersion`, and a local history snapshot after every save.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, isAppError, type TextFile } from '../../lib/api'
import { joinFrontMatter, splitFrontMatter, type FrontMatterParts } from '../../lib/frontmatter'
import { editorEolInfo } from '../editor'

export interface Loaded {
  /** File contents as last read or written; the unsaved check compares against this. */
  original: string
  version: string
}

export type SaveState = 'idle' | 'saving' | 'saved'

export interface Conflict {
  /** The file as it is on disk now (null while it is read, or when it was deleted). */
  disk: TextFile | null
}

export interface DocumentController {
  loaded: Loaded | null
  parts: FrontMatterParts | null
  /** The whole file as it would be saved. */
  text: string | null
  dirty: boolean
  /** Increases whenever the editor must start over (file read from disk, version restored). */
  generation: number
  eolInfo: ReturnType<typeof editorEolInfo> | null
  error: unknown
  setError(error: unknown): void
  saveState: SaveState
  conflict: Conflict | null
  load(): Promise<void>
  /** Saves when there are changes. Resolves to false when nothing was written because of an error. */
  save(): Promise<boolean>
  /** After a conflict: writes this version over the one on disk (which is kept in history). */
  overwrite(): Promise<boolean>
  /** After a conflict: keeps the edits in history, then reads the file from disk. */
  reloadFromDisk(): Promise<void>
  getParts(): FrontMatterParts | null
  /** The latest loaded state, for async work that outlives a render. */
  getLoaded(): Loaded | null
  setParts(next: FrontMatterParts): void
  setBody(body: string): void
  /** Replaces the whole text as an unsaved change (e.g. a restored version). */
  replaceText(text: string): void
}

interface Options {
  path: string
  onSaved(path: string): void
  /** Awaited before saving, e.g. to finish pending front matter edits. */
  beforeSave?: () => Promise<void>
}

export function useDocument({ path, onSaved, beforeSave }: Options): DocumentController {
  const [loaded, setLoadedState] = useState<Loaded | null>(null)
  const [parts, setPartsState] = useState<FrontMatterParts | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [generation, setGeneration] = useState(0)
  // The text the editor's line ending is taken from (the file, or a restored version).
  const [eolBase, setEolBase] = useState<string | null>(null)

  // Refs hold the latest values for async work (saving, queued front matter edits).
  const partsRef = useRef<FrontMatterParts | null>(null)
  const loadedRef = useRef<Loaded | null>(null)
  const savingRef = useRef<Promise<boolean> | null>(null)
  const originalSnapshotted = useRef(false)
  const beforeSaveRef = useRef(beforeSave)
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    beforeSaveRef.current = beforeSave
    onSavedRef.current = onSaved
  })

  const setParts = useCallback((next: FrontMatterParts) => {
    partsRef.current = next
    setPartsState(next)
  }, [])

  const setLoaded = useCallback((next: Loaded) => {
    loadedRef.current = next
    setLoadedState(next)
  }, [])

  const getParts = useCallback(() => partsRef.current, [])
  const getLoaded = useCallback(() => loadedRef.current, [])

  const applyFile = useCallback(
    (file: TextFile) => {
      setParts(splitFrontMatter(file.text))
      setLoaded({ original: file.text, version: file.version })
      setEolBase(file.text)
      setGeneration((g) => g + 1)
      setConflict(null)
      setSaveState('idle')
      originalSnapshotted.current = false
    },
    [setLoaded, setParts],
  )

  const load = useCallback(async () => {
    try {
      applyFile(await api.readText(path))
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [applyFile, path])

  useEffect(() => {
    // Fetch on mount; state only changes after the file has been read.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  const write = useCallback(
    async (expectedVersion: string | undefined): Promise<boolean> => {
      const current = partsRef.current
      const base = loadedRef.current
      if (!current || !base) return false
      const text = joinFrontMatter(current)
      if (text === base.original && expectedVersion !== undefined) return true
      setSaveState('saving')
      setError(null)
      try {
        // The version on disk before the first save is kept too, so it can be restored.
        if (!originalSnapshotted.current) {
          await api.historySave(path, base.original, 'save').catch(() => undefined)
          originalSnapshotted.current = true
        }
        const version = await api.writeText(path, text, expectedVersion)
        setLoaded({ original: text, version })
        setConflict(null)
        setSaveState('saved')
        onSavedRef.current(path)
        void api.historySave(path, text, 'save').catch(() => undefined)
        return true
      } catch (e) {
        setSaveState('idle')
        if (isAppError(e) && e.code === 'conflict') {
          setConflict({ disk: null })
          api.readText(path).then(
            (disk) => setConflict((c) => (c ? { disk } : c)),
            () => undefined,
          )
        } else {
          setError(e)
        }
        return false
      }
    },
    [path, setLoaded],
  )

  const save = useCallback((): Promise<boolean> => {
    if (savingRef.current) return savingRef.current
    const run = (async () => {
      try {
        await beforeSaveRef.current?.()
      } catch (e) {
        setError(e)
        return false
      }
      const base = loadedRef.current
      if (!base) return false
      return write(base.version)
    })()
    savingRef.current = run
    void run.finally(() => {
      if (savingRef.current === run) savingRef.current = null
    })
    return run
  }, [write])

  const overwrite = useCallback(async () => {
    if (conflict?.disk) await api.historySave(path, conflict.disk.text, 'save').catch(() => undefined)
    return write(undefined)
  }, [conflict, path, write])

  const reloadFromDisk = useCallback(async () => {
    const current = partsRef.current
    const base = loadedRef.current
    if (current && base) {
      const text = joinFrontMatter(current)
      if (text !== base.original) await api.historySave(path, text, 'manual').catch(() => undefined)
    }
    await load()
  }, [load, path])

  const setBody = useCallback((body: string) => {
    const current = partsRef.current
    if (current && current.body !== body) setParts({ ...current, body })
  }, [setParts])

  const replaceText = useCallback(
    (text: string) => {
      setParts(splitFrontMatter(text))
      setEolBase(text)
      setGeneration((g) => g + 1)
      setSaveState('idle')
    },
    [setParts],
  )

  const text = parts ? joinFrontMatter(parts) : null
  const dirty = loaded !== null && text !== null && text !== loaded.original

  // Decided once per editor document; the editor keeps that line ending for every new line.
  const eolInfo = useMemo(
    () => (eolBase === null ? null : editorEolInfo(splitFrontMatter(eolBase).body, eolBase.includes('\r\n') ? 'crlf' : 'lf')),
    [eolBase],
  )

  return {
    loaded,
    parts,
    text,
    dirty,
    generation,
    eolInfo,
    error,
    setError,
    saveState,
    conflict,
    load,
    save,
    overwrite,
    reloadFromDisk,
    getParts,
    getLoaded,
    setParts,
    setBody,
    replaceText,
  }
}
