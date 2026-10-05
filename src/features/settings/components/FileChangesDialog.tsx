import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../../components/DiffView'
import { ErrorNote } from '../../../components/ErrorNote'
import { api, type ConfigValidation } from '../../../lib/api'
import type { FileChange } from '../model/fileChange'
import { shortName } from '../model/sources'
import { BADGE, DANGER_NOTE, NOTE } from './styles'

export type { FileChange }

interface Props {
  title: string
  intro?: string
  /** Reads the files and computes the changes; called once when the dialog opens. */
  prepare(): Promise<FileChange[]>
  /** Extra checks; any message blocks writing. */
  verify?(changes: FileChange[]): Promise<string[]>
  /**
   * Loads the site with every change at once (e.g. a split into config/_default/), when Hugo is
   * available; a failure blocks writing. Null skips the check.
   */
  validateAll?(changes: FileChange[]): Promise<ConfigValidation | null>
  /** Hugo is available for validation. */
  hugoAvailable: boolean
  onClose(): void
  onWritten(changes: FileChange[]): void
}

interface Prepared {
  changes: FileChange[]
  validations: (ConfigValidation | null)[]
  /** All changes checked together. */
  combined: ConfigValidation | null
  problems: string[]
}

function MessageList({ validation }: { validation: ConfigValidation }) {
  return validation.messages.map((m, j) => (
    <p key={j} className={`font-mono text-xs ${m.level === 'error' ? 'text-red-700 dark:text-red-400' : m.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500'}`}>
      {m.text}
    </p>
  ))
}

/** Review of text-level changes (front matter, uncommented lines, new files), then one write each. */
export function FileChangesDialog({ title, intro, prepare, verify, validateAll, hugoAvailable, onClose, onWritten }: Props) {
  const { t } = useTranslation()
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [writing, setWriting] = useState(false)
  const [written, setWritten] = useState<string[]>([])
  // The dialog prepares once; the parent remounts it for another change.
  const setup = useRef({ prepare, verify, validateAll, hugoAvailable })

  useEffect(() => {
    let cancelled = false
    const { prepare, verify, validateAll, hugoAvailable } = setup.current
    void (async () => {
      try {
        const changes = await prepare()
        const validations = await Promise.all(changes.map((c) => (c.validate && hugoAvailable ? api.configValidate(c.path, c.after) : Promise.resolve(null))))
        const combined = validateAll && hugoAvailable && changes.length > 0 ? await validateAll(changes) : null
        const problems = verify ? await verify(changes) : []
        if (!cancelled) setPrepared({ changes, validations, combined, problems })
      } catch (e) {
        if (!cancelled) setError(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const blocked =
    !prepared ||
    prepared.problems.length > 0 ||
    prepared.validations.some((v) => v !== null && !v.ok) ||
    (prepared.combined !== null && !prepared.combined.ok) ||
    prepared.changes.length === 0

  async function write() {
    if (!prepared) return
    setWriting(true)
    setError(null)
    const done: string[] = []
    try {
      for (const change of prepared.changes) {
        if (change.before === change.after && change.version !== '') continue
        await api.writeText(change.path, change.after, change.version)
        done.push(change.path)
      }
      for (const change of prepared.changes) {
        if (change.moveTo) {
          await api.renameFile(change.path, change.moveTo)
          done.push(change.moveTo)
        }
      }
      onWritten(prepared.changes)
    } catch (e) {
      setError(e)
      setWritten(done)
    } finally {
      setWriting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="settings-file-changes-title">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h2 id="settings-file-changes-title" className="text-lg font-semibold">
          {title}
        </h2>
        {intro && <p className="text-sm text-zinc-600 dark:text-zinc-400">{intro}</p>}
        <div className="min-h-0 flex-1 space-y-4 overflow-auto">
          {prepared === null && error === null && <p className="text-sm text-zinc-500">{t('review.checking')}</p>}
          {prepared?.changes.length === 0 && <p className={NOTE}>{t('settings.changes.nothing')}</p>}
          {prepared?.changes.map((change, i) => {
            const validation = prepared.validations[i]
            return (
              <section key={change.path} className="space-y-2">
                <p className="flex flex-wrap items-center gap-2 font-mono text-sm font-medium">
                  {change.path}
                  {change.version === '' && <span className={`${BADGE} bg-emerald-100 font-sans text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300`}>{t('settings.changes.newFile')}</span>}
                  {change.moveTo && (
                    <span className={`${BADGE} bg-violet-100 font-sans text-violet-800 dark:bg-violet-950 dark:text-violet-300`}>
                      {t('settings.changes.movedTo', { path: shortName(change.moveTo) })}
                    </span>
                  )}
                </p>
                {change.before === change.after ? <p className="text-sm text-zinc-500">{t('settings.changes.unchanged')}</p> : <DiffView before={change.before} after={change.after} />}
                {validation && (
                  <div className="space-y-1 text-sm">
                    {validation.ok ? (
                      <p className="text-emerald-700 dark:text-emerald-400">✓ {t('review.valid')}</p>
                    ) : (
                      <p className="font-medium text-red-700 dark:text-red-400">{t('review.invalid')}</p>
                    )}
                    <MessageList validation={validation} />
                  </div>
                )}
              </section>
            )
          })}
          {prepared?.combined && (
            <section className="space-y-1 text-sm" aria-label={t('settings.changes.checkedTogether')}>
              <p className="text-zinc-600 dark:text-zinc-400">{t('settings.changes.checkedTogether')}</p>
              {prepared.combined.ok ? (
                <p className="text-emerald-700 dark:text-emerald-400">✓ {t('review.valid')}</p>
              ) : (
                <p className="font-medium text-red-700 dark:text-red-400">{t('review.invalid')}</p>
              )}
              <MessageList validation={prepared.combined} />
            </section>
          )}
          {prepared && prepared.problems.length > 0 && (
            <div className={DANGER_NOTE}>
              <p className="font-medium">{t('settings.changes.problems')}</p>
              <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                {prepared.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {error !== null && <ErrorNote error={error} />}
          {written.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{t('settings.changes.partial', { files: written.join(', ') })}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={blocked || writing} onClick={() => void write()}>
            {writing ? t('common.saving') : t('settings.changes.write')}
          </button>
        </div>
      </div>
    </div>
  )
}
