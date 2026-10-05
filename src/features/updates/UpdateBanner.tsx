import { confirm } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { installUpdate, type Update } from './updates'

interface Props {
  update: Update
  /** There are unsaved edits, which the restart would lose. */
  dirty: boolean
  onDismiss(): void
}

/** "Version X is available" with install-and-restart. */
export function UpdateBanner({ update, dirty, onDismiss }: Props) {
  const { t } = useTranslation()
  const [progress, setProgress] = useState<number | null | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const installing = progress !== undefined && error === null

  async function install() {
    if (dirty && !(await confirm(t('updates.unsavedWarning')))) return
    setError(null)
    setProgress(null)
    try {
      await installUpdate(update, setProgress)
    } catch (e) {
      setError(e)
      setProgress(undefined)
    }
  }

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-40 flex max-w-md flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 shadow-lg dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100"
    >
      <p className="w-full">
        {t('updates.available', { version: update.version })}
        {update.body ? <span className="block text-xs opacity-80">{update.body.split('\n')[0]}</span> : null}
      </p>
      {installing ? (
        <span className="text-xs">
          {progress === null || progress === undefined
            ? t('updates.downloading')
            : t('updates.downloadingPercent', { percent: Math.round(progress * 100) })}
        </span>
      ) : (
        <>
          <button className="btn btn-primary" onClick={() => void install()}>
            {t('updates.install')}
          </button>
          <button className="btn" onClick={onDismiss}>
            {t('updates.later')}
          </button>
        </>
      )}
      {error !== null && (
        <div className="w-full">
          <ErrorNote error={error} />
        </div>
      )}
    </div>
  )
}
