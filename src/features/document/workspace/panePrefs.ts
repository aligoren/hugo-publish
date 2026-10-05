// The document's side pane remembers whether it is open, its last tab and its width (one for
// settings and checks, one for the preview) across documents and restarts.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export type PaneTab = 'settings' | 'checks' | 'preview'
export type PaneKind = 'panel' | 'preview'

export interface PanePrefs {
  open: boolean
  tab: PaneTab
  widths: Record<PaneKind, number>
}

export const PANE_PREFS_KEY = 'hugo-publisher.documentPane'
export const DEFAULT_PANE_PREFS: PanePrefs = { open: false, tab: 'settings', widths: { panel: 400, preview: 600 } }
export const PANE_LIMITS: Record<PaneKind, { min: number; max: number }> = {
  panel: { min: 320, max: 640 },
  preview: { min: 360, max: 1600 },
}

const TABS: readonly PaneTab[] = ['settings', 'checks', 'preview']

export const paneKind = (tab: PaneTab): PaneKind => (tab === 'preview' ? 'preview' : 'panel')

export function clampWidth(kind: PaneKind, width: number): number {
  const { min, max } = PANE_LIMITS[kind]
  return Math.round(Math.min(max, Math.max(min, width)))
}

export function loadPanePrefs(): PanePrefs {
  try {
    const raw = localStorage.getItem(PANE_PREFS_KEY)
    if (!raw) return DEFAULT_PANE_PREFS
    const data = JSON.parse(raw) as Partial<PanePrefs> | null
    const widths = (data?.widths ?? {}) as Partial<Record<PaneKind, unknown>>
    const width = (kind: PaneKind) =>
      typeof widths[kind] === 'number' && Number.isFinite(widths[kind]) ? clampWidth(kind, widths[kind]) : DEFAULT_PANE_PREFS.widths[kind]
    return {
      open: data?.open === true,
      tab: TABS.includes(data?.tab as PaneTab) ? (data?.tab as PaneTab) : DEFAULT_PANE_PREFS.tab,
      widths: { panel: width('panel'), preview: width('preview') },
    }
  } catch {
    return DEFAULT_PANE_PREFS
  }
}

export function savePanePrefs(prefs: PanePrefs) {
  try {
    localStorage.setItem(PANE_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Not remembered; the pane still works for this session.
  }
}

export function usePanePrefs(): [PanePrefs, (change: Partial<PanePrefs> | ((prefs: PanePrefs) => Partial<PanePrefs>)) => void] {
  const [prefs, setPrefs] = useState(loadPanePrefs)
  useEffect(() => savePanePrefs(prefs), [prefs])
  const update = useCallback(
    (change: Partial<PanePrefs> | ((prefs: PanePrefs) => Partial<PanePrefs>)) =>
      setPrefs((current) => ({ ...current, ...(typeof change === 'function' ? change(current) : change) })),
    [],
  )
  return [prefs, update]
}

/** Below this window width the pane slides over the text instead of squeezing it. */
const NARROW_QUERY = '(max-width: 1099px)'

function subscribeNarrow(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function isNarrow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches
}

export function useNarrowWindow(): boolean {
  return useSyncExternalStore(subscribeNarrow, isNarrow, () => false)
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** "Ctrl+Shift+P" or "⌘⇧P". */
export function shortcutLabel(key: string, shift = false): string {
  return isMac() ? `⌘${shift ? '⇧' : ''}${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`
}
