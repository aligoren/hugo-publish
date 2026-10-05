import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../components/DiffView'
import { ErrorNote } from '../../components/ErrorNote'
import { api, type Snapshot } from '../../lib/api'

interface Props {
  path: string
  /** The text in the editor now (saved or not). */
  currentText: string
  /** Loads a version into the editor as an unsaved change. */
  onRestore(text: string): Promise<void>
  onClose(): void
}

function formatSize(bytes: number, language: string): string {
  const format = (n: number, unit: string) =>
    `${new Intl.NumberFormat(language, { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n)} ${unit}`
  if (bytes < 1024) return format(bytes, 'B')
  if (bytes < 1024 * 1024) return format(bytes / 1024, 'KB')
  return format(bytes / (1024 * 1024), 'MB')
}

/** Local snapshots of the document (taken on save, on request and before a restore). */
export function HistoryDrawer({ path, currentText, onRestore, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null)
  const [selected, setSelected] = useState<{ id: string; text: string | null } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setSnapshots(await api.historyList(path))
    } catch (e) {
      setError(e)
      setSnapshots([])
    }
  }, [path])

  useEffect(() => {
    // Fetch on mount; state only changes after the list arrives.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function select(snapshot: Snapshot) {
    setSelected({ id: snapshot.id, text: null })
    setError(null)
    try {
      const text = await api.historyRead(path, snapshot.id)
      setSelected((s) => (s?.id === snapshot.id ? { id: snapshot.id, text } : s))
    } catch (e) {
      setError(e)
    }
  }

  async function saveVersion() {
    setBusy(true)
    setError(null)
    try {
      await api.historySave(path, currentText, 'manual')
      setNotice(t('document.versionSaved'))
      await refresh()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  async function restore(text: string) {
    setBusy(true)
    setError(null)
    try {
      await onRestore(text)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  const selectedText = selected?.text ?? null

  return (
    <aside
      role="dialog"
      aria-label={t('document.history')}
      className="absolute inset-y-0 right-0 z-30 flex w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
    >
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h2 className="flex-1 text-sm font-semibold">{t('document.history')}</h2>
        <button className="btn px-2 py-1 text-xs" disabled={busy} onClick={() => void saveVersion()}>
          {t('document.saveVersion')}
        </button>
        <button className="btn px-2 py-1 text-xs" onClick={onClose} aria-label={t('common.close')}>
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-sm">
        <p className="text-xs text-zinc-500">{t('document.historyIntro')}</p>
        {notice && <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
        {error !== null && <ErrorNote error={error} />}
        {snapshots === null ? (
          <p className="text-zinc-500">{t('common.loading')}</p>
        ) : snapshots.length === 0 ? (
          <p className="text-zinc-500">{t('document.historyEmpty')}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <button
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 ${selected?.id === snapshot.id ? 'bg-sky-50 dark:bg-sky-950' : ''}`}
                  aria-current={selected?.id === snapshot.id ? 'true' : undefined}
                  onClick={() => void select(snapshot)}
                >
                  <span className="flex-1">{dateFormat.format(new Date(snapshot.createdMs))}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">{t(`document.reason_${snapshot.reason}`)}</span>
                  <span className="w-16 text-right text-xs text-zinc-500">{formatSize(snapshot.size, i18n.language)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <section className="space-y-2">
            {selectedText === null ? (
              <p className="text-zinc-500">{t('common.loading')}</p>
            ) : selectedText === currentText ? (
              <p className="text-zinc-500">{t('document.historySame')}</p>
            ) : (
              <>
                <p className="text-xs text-zinc-500">{t('document.historyDiff')}</p>
                <DiffView before={currentText} after={selectedText} />
                <button className="btn btn-primary" disabled={busy} onClick={() => void restore(selectedText)}>
                  {t('document.restore')}
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}
