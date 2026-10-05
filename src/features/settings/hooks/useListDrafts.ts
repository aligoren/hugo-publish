import { useCallback, useMemo, useState } from 'react'

import type { KeyPath } from '../../../lib/api'
import { listDraftKey, listOpsByFile, type ListDraft } from '../model/lists'

/** Unsaved edits to arrays of tables (menus, `server.redirects`…), one desired list per file path. */
export function useListDrafts() {
  const [drafts, setDrafts] = useState<Record<string, ListDraft>>({})

  const update = useCallback((draft: ListDraft) => {
    setDrafts((current) => ({ ...current, [listDraftKey(draft.file, draft.path)]: draft }))
  }, [])

  const drop = useCallback((file: string, path: KeyPath) => {
    setDrafts((current) => {
      const key = listDraftKey(file, path)
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const clear = useCallback(() => setDrafts({}), [])

  const get = useCallback((file: string, path: KeyPath): ListDraft | undefined => drafts[listDraftKey(file, path)], [drafts])

  const opsByFile = useMemo(() => listOpsByFile(Object.values(drafts)), [drafts])

  return { drafts, update, drop, clear, get, opsByFile }
}

export type ListDrafts = ReturnType<typeof useListDrafts>
