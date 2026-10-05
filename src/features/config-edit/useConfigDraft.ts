import { useCallback, useMemo, useState } from 'react'

import type { ConfigOp, KeyPath } from '../../lib/api'
import { pathKey } from './configFile'

export type PendingChange = { kind: 'set'; value: unknown } | { kind: 'remove' }

/**
 * Unsaved config changes, grouped by file. Setting the same key twice keeps only the last
 * change; the review dialog turns each file's ops into one diff and one write.
 */
export function useConfigDraft() {
  const [byFile, setByFile] = useState<Record<string, ConfigOp[]>>({})

  const replace = useCallback((file: string, op: ConfigOp) => {
    setByFile((current) => {
      const key = op.op === 'appendTable' ? null : pathKey(op.path)
      const others = (current[file] ?? []).filter((o) => key === null || o.op === 'appendTable' || pathKey(o.path) !== key)
      return { ...current, [file]: [...others, op] }
    })
  }, [])

  const set = useCallback((file: string, path: KeyPath, value: unknown) => replace(file, { op: 'set', path, value }), [replace])
  const remove = useCallback((file: string, path: KeyPath) => replace(file, { op: 'remove', path }), [replace])
  const append = useCallback(
    (file: string, path: string[], entries: Record<string, unknown>) => replace(file, { op: 'appendTable', path, entries }),
    [replace],
  )

  /** Drops the pending change for one key. */
  const revert = useCallback((file: string, path: KeyPath) => {
    const key = pathKey(path)
    setByFile((current) => ({
      ...current,
      [file]: (current[file] ?? []).filter((o) => o.op === 'appendTable' || pathKey(o.path) !== key),
    }))
  }, [])

  const clear = useCallback((file?: string) => {
    setByFile((current) => {
      if (file === undefined) return {}
      const next = { ...current }
      delete next[file]
      return next
    })
  }, [])

  const pending = useCallback(
    (file: string, path: KeyPath): PendingChange | null => {
      const key = pathKey(path)
      const op = [...(byFile[file] ?? [])].reverse().find((o) => o.op !== 'appendTable' && pathKey(o.path) === key)
      if (!op || op.op === 'appendTable') return null
      return op.op === 'set' ? { kind: 'set', value: op.value } : { kind: 'remove' }
    },
    [byFile],
  )

  const files = useMemo(() => Object.keys(byFile).filter((f) => byFile[f].length > 0), [byFile])
  const count = useMemo(() => files.reduce((sum, f) => sum + byFile[f].length, 0), [byFile, files])

  return { opsByFile: byFile, files, count, set, remove, append, revert, clear, pending }
}

export type ConfigDraft = ReturnType<typeof useConfigDraft>
