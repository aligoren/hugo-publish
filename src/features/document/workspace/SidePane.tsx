import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { clampWidth, PANE_LIMITS, paneKind, type PaneTab } from './panePrefs'

export interface PaneTabDef {
  id: PaneTab
  label: string
}

interface Props {
  tabs: readonly PaneTabDef[]
  active: PaneTab
  onSelect(tab: PaneTab): void
  onClose(): void
  /** Width for the active tab's kind (settings and checks share one, the preview has its own). */
  width: number
  onWidthChange(width: number): void
  /** Narrow window: the pane slides over the text instead of taking room next to it. */
  overlay: boolean
  /** Panels to render; inactive ones stay mounted (hidden) so the preview does not reload. */
  mounted: readonly PaneTab[]
  renderPanel(tab: PaneTab): ReactNode
}

/** Room the document keeps next to a docked pane. */
const MIN_DOCUMENT = 360
const STEP = 24

function subscribeResize(callback: () => void): () => void {
  window.addEventListener('resize', callback)
  return () => window.removeEventListener('resize', callback)
}
const windowWidth = () => window.innerWidth

/** The document's side pane: post settings, checks and the preview, as tabs. */
export function SidePane({ tabs, active, onSelect, onClose, width, onWidthChange, overlay, mounted, renderPanel }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const tabRefs = useRef(new Map<PaneTab, HTMLButtonElement>())
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const kind = paneKind(active)
  const { min, max } = PANE_LIMITS[kind]
  // The app's sidebar (17rem) and some room for the text stay visible.
  const room = useSyncExternalStore(subscribeResize, windowWidth, () => max) - 272 - (overlay ? 32 : MIN_DOCUMENT)
  const limit = Math.max(min, Math.min(max, room))
  const shown = Math.min(width, limit)

  function focusTab(tab: PaneTab) {
    onSelect(tab)
    tabRefs.current.get(tab)?.focus()
  }

  function onTabKeyDown(event: KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.id === active)
    const go = (next: number) => {
      event.preventDefault()
      focusTab(tabs[(next + tabs.length) % tabs.length].id)
    }
    if (event.key === 'ArrowRight') go(index + 1)
    else if (event.key === 'ArrowLeft') go(index - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(tabs.length - 1)
  }

  function onPaneKeyDown(event: KeyboardEvent) {
    if (!overlay || event.key !== 'Escape' || event.defaultPrevented) return
    // An open suggestion list closes first.
    const target = event.target as HTMLElement
    if (target.getAttribute('aria-expanded') === 'true') return
    event.preventDefault()
    onClose()
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = { x: event.clientX, width: shown }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    onWidthChange(clampWidth(kind, Math.min(limit, drag.current.width + drag.current.x - event.clientX)))
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDragging(false)
  }

  function onSplitterKeyDown(event: KeyboardEvent) {
    const change = event.key === 'ArrowLeft' ? STEP : event.key === 'ArrowRight' ? -STEP : 0
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      onWidthChange(event.key === 'Home' ? min : limit)
    } else if (change !== 0) {
      event.preventDefault()
      onWidthChange(clampWidth(kind, Math.min(limit, shown + change)))
    }
  }

  return (
    <aside
      aria-label={t('document.paneLabel')}
      onKeyDown={onPaneKeyDown}
      style={{ width: overlay ? `min(${shown}px, calc(100% - 2rem))` : shown }}
      className={`flex min-h-0 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${
        overlay ? 'absolute inset-y-0 right-0 z-30 shadow-2xl' : 'relative'
      }`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('document.paneResize')}
        aria-valuemin={min}
        aria-valuemax={limit}
        aria-valuenow={shown}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onSplitterKeyDown}
        className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none focus-visible:outline-none"
      >
        <span
          className={`mx-auto block h-full w-px transition-colors group-hover:bg-sky-500 group-focus-visible:bg-sky-500 ${dragging ? 'bg-sky-500' : 'bg-transparent'}`}
        />
      </div>

      <div className="flex items-center gap-1 border-b border-zinc-200 px-2 dark:border-zinc-800">
        <div role="tablist" aria-label={t('document.paneLabel')} className="flex min-w-0 flex-1 items-end gap-1" onKeyDown={onTabKeyDown}>
          {tabs.map((tab) => {
            const selected = tab.id === active
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  if (element) tabRefs.current.set(tab.id, element)
                  else tabRefs.current.delete(tab.id)
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${id}-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(tab.id)}
                className={`-mb-px truncate border-b-2 px-2.5 py-2.5 text-sm ${
                  selected
                    ? 'border-sky-600 font-medium text-zinc-900 dark:border-sky-400 dark:text-zinc-100'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label={t('document.paneClose')}
          title={t('document.paneClose')}
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs
          .filter((tab) => mounted.includes(tab.id) || tab.id === active)
          .map((tab) => (
            <div
              key={tab.id}
              role="tabpanel"
              id={`${id}-panel-${tab.id}`}
              aria-labelledby={`${id}-tab-${tab.id}`}
              hidden={tab.id !== active}
              className={tab.id === 'preview' ? 'h-full' : 'h-full overflow-auto'}
            >
              {renderPanel(tab.id)}
            </div>
          ))}
        {/* The preview frame would swallow the pointer while the pane is resized. */}
        {dragging && <div className="absolute inset-0 cursor-col-resize" aria-hidden="true" />}
      </div>
    </aside>
  )
}
