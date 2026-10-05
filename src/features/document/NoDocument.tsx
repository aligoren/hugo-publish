import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { shortcutLabel, useNarrowWindow, usePanePrefs } from './workspace/panePrefs'
import { SidePane } from './workspace/SidePane'

interface Props {
  /** The site preview; without it only the hint is shown. */
  preview?: ReactNode
  onPreviewOpen?: () => void
}

/** The content view before a post is chosen: a hint, and the site preview on request. */
export function NoDocument({ preview, onPreviewOpen }: Props) {
  const { t } = useTranslation()
  const [prefs, updatePrefs] = usePanePrefs()
  const narrow = useNarrowWindow()
  const open = preview !== undefined && prefs.open && prefs.tab === 'preview'

  function toggle() {
    if (open) {
      updatePrefs({ open: false })
      return
    }
    updatePrefs({ open: true, tab: 'preview' })
    onPreviewOpen?.()
  }

  const toggleRef = useRef(toggle)
  useEffect(() => {
    toggleRef.current = toggle
  })
  const hasPreview = preview !== undefined
  useEffect(() => {
    if (!hasPreview) return
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        toggleRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasPreview])

  return (
    <div className="relative flex h-full flex-col">
      {preview !== undefined && (
        <header className="flex min-h-12 items-center justify-end gap-2 border-b border-zinc-200 px-4 py-1.5 dark:border-zinc-800">
          <button
            type="button"
            className="btn px-2.5 py-1 text-xs aria-pressed:border-sky-300 aria-pressed:bg-sky-50 aria-pressed:text-sky-900 dark:aria-pressed:border-sky-700 dark:aria-pressed:bg-sky-950 dark:aria-pressed:text-sky-100"
            aria-pressed={open}
            title={`${t('document.togglePreview')} (${shortcutLabel('P', true)})`}
            onClick={toggle}
          >
            {t('preview.title')}
          </button>
        </header>
      )}
      <div className="relative flex min-h-0 flex-1">
        <p className="min-w-0 flex-1 p-6 text-sm text-zinc-500">{t('document.empty')}</p>
        {open && narrow && <div className="absolute inset-0 z-20 bg-black/20" aria-hidden="true" onClick={toggle} />}
        {open && (
          <SidePane
            tabs={[{ id: 'preview', label: t('preview.title') }]}
            active="preview"
            onSelect={() => {}}
            onClose={() => updatePrefs({ open: false })}
            width={prefs.widths.preview}
            onWidthChange={(width) => updatePrefs((current) => ({ widths: { ...current.widths, preview: width } }))}
            overlay={narrow}
            mounted={['preview']}
            renderPanel={() => preview}
          />
        )}
      </div>
    </div>
  )
}
