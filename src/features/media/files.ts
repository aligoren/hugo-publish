// Getting image files from the user's computer: the open dialog and drag & drop from the OS.
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState } from 'react'

import { IMAGE_EXTENSIONS } from './reference'

/** Asks for image files; resolves to absolute paths (empty when cancelled). */
export async function chooseImageFiles(filterName: string): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: filterName, extensions: IMAGE_EXTENSIONS }],
  })
  if (!selected) return []
  return Array.isArray(selected) ? selected : [selected]
}

/**
 * Listens for files dropped from the OS while mounted (and `enabled`). Returns whether files are
 * being dragged over the window. `onDrop` receives absolute paths.
 */
export function useFileDrop(onDrop: (paths: string[]) => void, enabled = true): boolean {
  const [dragging, setDragging] = useState(false)
  const handler = useRef(onDrop)
  useEffect(() => {
    handler.current = onDrop
  })

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let unlisten: (() => void) | null = null
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload
          if (payload.type === 'enter' || payload.type === 'over') setDragging(true)
          else if (payload.type === 'leave') setDragging(false)
          else {
            setDragging(false)
            handler.current(payload.paths)
          }
        })
        .then((stop) => {
          if (disposed) stop()
          else unlisten = stop
        })
        .catch(() => {})
    } catch {
      // Not running inside Tauri (e.g. tests without a mock): no drag & drop.
    }
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [enabled])

  return enabled && dragging
}
