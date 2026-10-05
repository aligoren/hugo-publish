import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../components/DiffView'
import { ErrorNote } from '../../components/ErrorNote'
import { api, type ConfigOp, type ConfigValidation } from '../../lib/api'
import { previewConfigOps } from '../config-edit'

/** A whole-file change computed by the caller; `before: null` creates the file. */
export interface TextChange {
  path: string
  before: string | null
  after: string
  /** Version the file had when read (null for a new file: writing fails if it appeared meanwhile). */
  version: string | null
}

interface Props {
  title: string
  /** Config ops per file, previewed and (unless `skipValidation`) checked with Hugo. */
  opsByFile?: Record<string, ConfigOp[]>
  texts?: TextChange[]
  skipValidation?: boolean
  onClose(): void
  onWritten(files: string[]): void
}

interface Review {
  path: string
  before: string | null
  after: string
  version: string | null
  validation: ConfigValidation | null
}

/**
 * Shows every file a theme action touches as a diff (new files in full), then writes them.
 * Used for feature actions, colour overrides and new text-override files; plain param edits go
 * through the shared ReviewChangesDialog.
 */
// Stable defaults: the preview effect depends on these props.
const NO_OPS: Record<string, ConfigOp[]> = {}
const NO_TEXTS: TextChange[] = []

export function ChangesDialog({ title, opsByFile = NO_OPS, texts = NO_TEXTS, skipValidation = false, onClose, onWritten }: Props) {
  const { t } = useTranslation()
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result: Review[] = []
        for (const [file, ops] of Object.entries(opsByFile)) {
          if (ops.length === 0) continue
          const edit = await previewConfigOps(file, ops)
          const validation = skipValidation ? null : await api.configValidate(file, edit.after)
          result.push({ path: file, before: edit.before, after: edit.after, version: edit.version, validation })
        }
        for (const change of texts) result.push({ ...change, validation: null })
        if (!cancelled) setReviews(result)
      } catch (e) {
        if (!cancelled) setError(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [opsByFile, texts, skipValidation])

  const blocked = reviews?.some((r) => r.validation && !r.validation.ok) ?? false
  const changed = reviews?.filter((r) => r.before !== r.after) ?? []

  async function write() {
    if (!reviews) return
    setWriting(true)
    setError(null)
    try {
      for (const review of changed) {
        // An empty expected version means "the file must not exist yet".
        await api.writeText(review.path, review.after, review.version ?? '')
      }
      onWritten(changed.map((r) => r.path))
    } catch (e) {
      setError(e)
    } finally {
      setWriting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto">
          {reviews === null && error === null && <p className="text-sm text-zinc-500">{t('theme.changes.preparing')}</p>}
          {reviews?.map((review) => (
            <section key={review.path} className="space-y-2">
              <p className="flex items-center gap-2 font-mono text-sm font-medium">
                {review.path}
                {review.before === null && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-sans text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    {t('theme.changes.newFile')}
                  </span>
                )}
              </p>
              {review.before === review.after ? (
                <p className="text-sm text-zinc-500">{t('review.noChanges')}</p>
              ) : (
                <DiffView before={review.before ?? ''} after={review.after} />
              )}
              {review.validation && (
                <div className="space-y-1 text-sm">
                  {review.validation.ok ? (
                    <p className="text-emerald-700 dark:text-emerald-400">✓ {t('review.valid')}</p>
                  ) : (
                    <p className="font-medium text-red-700 dark:text-red-400">{t('review.invalid')}</p>
                  )}
                  {review.validation.messages.map((m, i) => (
                    <p key={i} className={`font-mono text-xs ${m.level === 'error' ? 'text-red-700 dark:text-red-400' : 'text-zinc-500'}`}>
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
          <button className="btn btn-primary" disabled={!reviews || blocked || writing || changed.length === 0} onClick={() => void write()}>
            {writing ? t('common.saving') : t('review.write')}
          </button>
        </div>
      </div>
    </div>
  )
}
