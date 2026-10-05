import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api } from '../../lib/api'
import { fileNameOf } from './reference'

interface Props {
  /** Absolute paths of the files to import. */
  sources: string[]
  defaultTargetDir: string
  /** Called with the new site-relative paths. */
  onImported(paths: string[]): void
  onCancel(): void
}

/** Import options: target folder, metadata removal (on by default) and an optional max width. */
export function ImportForm({ sources, defaultTargetDir, onImported, onCancel }: Props) {
  const { t } = useTranslation()
  const [targetDir, setTargetDir] = useState(defaultTargetDir)
  const [stripMetadata, setStripMetadata] = useState(true)
  const [maxWidth, setMaxWidth] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const width = Number.parseInt(maxWidth, 10)
      const paths = await api.mediaImportFiles(sources, {
        targetDir: targetDir.trim(),
        stripMetadata,
        maxWidth: width > 0 ? width : null,
      })
      onImported(paths)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-label={t('media.importTitle')}>
      <div>
        <p className="text-sm font-medium">{t('media.importFiles', { count: sources.length })}</p>
        <ul className="mt-1 max-h-28 overflow-auto rounded-md bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          {sources.map((source) => (
            <li key={source} className="truncate" title={source}>
              {fileNameOf(source)}
            </li>
          ))}
        </ul>
      </div>
      <label className="field">
        <span>{t('media.targetDir')}</span>
        <input value={targetDir} onChange={(e) => setTargetDir(e.target.value)} className="font-mono" required />
        <small className="text-xs text-zinc-500">{t('media.targetHint')}</small>
      </label>
      <label className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={stripMetadata}
          onChange={(e) => setStripMetadata(e.target.checked)}
        />
        <span>
          <span className="block font-medium">{t('media.stripOption')}</span>
          <span className="block text-xs text-zinc-600 dark:text-zinc-400">{t('media.stripHint')}</span>
        </span>
      </label>
      <label className="field">
        <span>{t('media.maxWidth')}</span>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={maxWidth}
          onChange={(e) => setMaxWidth(e.target.value)}
          className="w-40"
        />
        <small className="text-xs text-zinc-500">{t('media.maxWidthHint')}</small>
      </label>
      {error !== null && <ErrorNote error={error} />}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !targetDir.trim()}>
          {busy ? t('media.importing') : t('media.importButton')}
        </button>
      </div>
    </form>
  )
}
