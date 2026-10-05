import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, type ConfigEdit, type ConfigOp, type ConfigValidation } from '../../lib/api'
import { DiffView } from '../../components/DiffView'
import { previewConfigOps } from './configFile'

interface Props {
  /** Ops per site-relative file. */
  opsByFile: Record<string, ConfigOp[]>
  onClose(): void
  /** Called after every file was written. */
  onWritten(files: string[]): void
  /** Skip `hugo config` validation (for files Hugo does not read as config, e.g. i18n). */
  skipValidation?: boolean
}

interface FileReview {
  edit: ConfigEdit
  validation: ConfigValidation | null
}

/** Shows the diff of pending config changes, checks them with Hugo, then writes them. */
export function ReviewChangesDialog({ opsByFile, onClose, onWritten, skipValidation = false }: Props) {
  const { t } = useTranslation()
  const [reviews, setReviews] = useState<FileReview[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result: FileReview[] = []
        for (const [file, ops] of Object.entries(opsByFile)) {
          if (ops.length === 0) continue
          const edit = await previewConfigOps(file, ops)
          const validation = skipValidation ? null : await api.configValidate(file, edit.after)
          result.push({ edit, validation })
        }
        if (!cancelled) setReviews(result)
      } catch (e) {
        if (!cancelled) setError(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [opsByFile, skipValidation])

  const blocked = reviews?.some((r) => r.validation && !r.validation.ok) ?? false

  async function write() {
    if (!reviews) return
    setWriting(true)
    setError(null)
    try {
      for (const review of reviews) {
        await api.writeText(review.edit.path, review.edit.after, review.edit.version)
      }
      onWritten(reviews.map((r) => r.edit.path))
    } catch (e) {
      setError(e)
    } finally {
      setWriting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">{t('review.title')}</h2>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto">
          {reviews === null && error === null && <p className="text-sm text-zinc-500">{t('review.checking')}</p>}
          {reviews?.map(({ edit, validation }) => (
            <section key={edit.path} className="space-y-2">
              <p className="font-mono text-sm font-medium">{edit.path}</p>
              {edit.before === edit.after ? (
                <p className="text-sm text-zinc-500">{t('review.noChanges')}</p>
              ) : (
                <DiffView before={edit.before} after={edit.after} />
              )}
              {validation && (
                <div className="space-y-1 text-sm">
                  {validation.ok ? (
                    <p className="text-emerald-700 dark:text-emerald-400">✓ {t('review.valid')}</p>
                  ) : (
                    <p className="font-medium text-red-700 dark:text-red-400">{t('review.invalid')}</p>
                  )}
                  {validation.messages.map((m, i) => (
                    <p
                      key={i}
                      className={`font-mono text-xs ${m.level === 'error' ? 'text-red-700 dark:text-red-400' : m.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500'}`}
                    >
                      {m.text}
                    </p>
                  ))}
                </div>
              )}
            </section>
          ))}
          {error !== null && <ErrorNote error={error} />}
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!reviews || blocked || writing} onClick={() => void write()}>
            {writing ? t('common.saving') : t('review.write')}
          </button>
        </div>
      </div>
    </div>
  )
}
