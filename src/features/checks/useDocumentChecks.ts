import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import { useSite } from '../site/SiteContext'
import { loadCheckContext, type CheckContext } from './context'
import { archetypeForDocument, runChecks, type CheckIssue } from './runChecks'

/** Runs the pre-publish checks on a document as it is being edited (the whole file's text). */
export function useDocumentChecks(path: string, text: string): CheckIssue[] {
  const { site, files } = useSite()
  const [context, setContext] = useState<CheckContext | null>(null)
  const deferredText = useDeferredValue(text)
  // The file list only seeds the one-time sample, so a newer list does not reload anything.
  const filesRef = useRef(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])

  useEffect(() => {
    let alive = true
    void loadCheckContext(site.root, filesRef.current).then((loaded) => {
      if (alive) setContext(loaded)
    })
    return () => {
      alive = false
    }
  }, [site.root])

  return useMemo(
    () =>
      runChecks({
        path,
        text: deferredText,
        archetypeText: context ? archetypeForDocument(path, deferredText, context.archetypes) : null,
        siteUsesDescription: context?.siteUsesDescription,
        rawHtmlAllowed: context?.rawHtmlAllowed,
      }),
    [path, deferredText, context],
  )
}
