import { useCallback, useEffect, useRef, useState } from 'react'

export interface MediaPickerController {
  /** The open picker's default folder, or null when closed. */
  open: { defaultTargetDir: string } | null
  /** Opens the picker; resolves with the chosen site path, or null when it is closed. */
  pick(defaultTargetDir: string): Promise<string | null>
  /** Called by the dialog. */
  finish(path: string | null): void
}

/** The media picker as a promise, for the editor's image action and the image fields. */
export function useMediaPicker(): MediaPickerController {
  const [open, setOpen] = useState<{ defaultTargetDir: string } | null>(null)
  const resolver = useRef<((path: string | null) => void) | null>(null)

  const pick = useCallback(
    (defaultTargetDir: string) =>
      new Promise<string | null>((resolve) => {
        // A second request replaces the first one, which counts as cancelled.
        resolver.current?.(null)
        resolver.current = resolve
        setOpen({ defaultTargetDir })
      }),
    [],
  )

  const finish = useCallback((path: string | null) => {
    const resolve = resolver.current
    resolver.current = null
    setOpen(null)
    resolve?.(path)
  }, [])

  useEffect(
    () => () => {
      resolver.current?.(null)
      resolver.current = null
    },
    [],
  )

  return { open, pick, finish }
}
