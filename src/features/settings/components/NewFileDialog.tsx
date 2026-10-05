import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../../components/DiffView'
import { ErrorNote } from '../../../components/ErrorNote'
import { api, type ConfigValidation } from '../../../lib/api'

interface Props {
  path: string
  text: string
  /** Check the new file with Hugo first (off when Hugo is not installed). */
  validate: boolean
  onClose(): void
  onWritten(path: string): void
}

/** Shows a file that does not exist yet as a diff, checks it with Hugo, then creates it. */
export function NewFileDialog({ path, text, validate, onClose, onWritten }: Props) {
  const { t } = useTranslation()
  const [validation, setValidation] = useState<ConfigValidation | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    if (!validate) return
    let cancelled = false
    api.configValidate(path, text).then(
      (result) => !cancelled && setValidation(result),
      (e: unknown) => !cancelled && setError(e),
    )
    return () => {
      cancelled = true
    }
  }, [path, text, validate])

  async function write() {
    setWriting(true)
    setError(null)
    try {
      await api.writeText(path, text)
      onWritten(path)
    } catch (e) {
      setError(e)
    } finally {
      setWriting(false)
    }
  }

  const checking = validate && validation === null && error === null
  // Hugo must accept the file; if it could not even run, nothing is written.
  const blocked = validation !== null ? !validation.ok : validate && error !== null
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="settings-new-file-title">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h2 id="settings-new-file-title" className="text-lg font-semibold">
          {t('settings.newFile.title')}
        </h2>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto">
          <p className="font-mono text-sm font-medium">{path}</p>
          <DiffView before="" after={text} />
          {checking && <p className="text-sm text-zinc-500">{t('review.checking')}</p>}
          {!validate && <p className="text-xs text-zinc-500">{t('settings.newFile.notChecked')}</p>}
          {validation && (
            <div className="space-y-1 text-sm">
              {validation.ok ? (
                <p className="text-emerald-700 dark:text-emerald-400">✓ {t('review.valid')}</p>
              ) : (
                <p className="font-medium text-red-700 dark:text-red-400">{t('review.invalid')}</p>
              )}
              {validation.messages.map((m, i) => (
                <p key={i} className={`font-mono text-xs ${m.level === 'error' ? 'text-red-700 dark:text-red-400' : 'text-zinc-500'}`}>
                  {m.text}
                </p>
              ))}
            </div>
          )}
          {error !== null && <ErrorNote error={error} />}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={checking || blocked || writing} onClick={() => void write()}>
            {writing ? t('common.saving') : t('settings.newFile.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
