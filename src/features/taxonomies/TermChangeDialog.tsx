import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../components/DiffView'
import { ErrorNote } from '../../components/ErrorNote'
import { errorMessage } from '../../i18n'
import { api, isAppError } from '../../lib/api'
import type { TaxonomyDef, TaxonomySettings } from './config'
import { filesUsingTerms, type FileRecord, type TermInfo } from './indexer'
import { frontMatterBlock, planTermEdit, writePlan, type ChangePlan, type PlannedFile, type TermEdit, type WriteOutcome } from './termEdit'
import { planTermPageMove, type TermPageMovePlan } from './termPage'

/** What the user asked for: rename one term, merge several (rename with several sources) or delete. */
export interface ChangeRequest {
  kind: 'rename' | 'delete'
  terms: string[]
  /** Suggested new name (merges from the similar terms list). */
  target?: string
}

interface Props {
  request: ChangeRequest
  taxonomy: TaxonomyDef
  terms: readonly TermInfo[]
  records: ReadonlyMap<string, FileRecord>
  settings: TaxonomySettings
  contentDir: string
  termPages: ReadonlyMap<string, string>
  onClose(): void
  /** Called after files were written or moved; returns when the file list is reloaded. */
  onFilesChanged(paths: string[]): Promise<void>
  /** The term to show after a rename. */
  onRenamed?(term: string): void
}

type Step =
  | { name: 'edit' }
  | { name: 'planning'; done: number; total: number }
  | { name: 'review'; plan: ChangePlan; edit: TermEdit; pages: TermPageMovePlan }
  | { name: 'writing'; done: number; total: number }
  | { name: 'done'; outcome: WriteOutcome; moved: string | null; moveError: unknown }

const tomlParseText = async (text: string) => (await api.tomlParseText(text)).values

function mostUsed(names: readonly string[], terms: readonly TermInfo[]): string {
  const counts = new Map(terms.map((t) => [t.name, t.posts.length]))
  return [...names].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? ''
}

export function TermChangeDialog(props: Props) {
  const { request, taxonomy, terms, records, settings, contentDir, termPages, onClose, onFilesChanged, onRenamed } = props
  const { t } = useTranslation()
  const nameId = useId()
  const listId = useId()
  const [included, setIncluded] = useState<string[]>(request.terms)
  const [name, setName] = useState(() => request.target ?? (request.terms.length === 1 ? request.terms[0] : mostUsed(request.terms, terms)))
  const [movePage, setMovePage] = useState(true)
  const [step, setStep] = useState<Step>({ name: 'edit' })
  const [error, setError] = useState<unknown>(null)

  const merging = request.kind === 'rename' && request.terms.length > 1
  const target = name.trim()
  const busy = step.name === 'planning' || step.name === 'writing'

  const edit: TermEdit | null = useMemo(() => {
    if (included.length === 0) return null
    if (request.kind === 'delete') return { kind: 'delete', terms: included }
    if (target === '' || included.every((term) => term === target)) return null
    return { kind: 'rename', from: included, to: target }
  }, [included, request.kind, target])

  const sources = edit ? (edit.kind === 'rename' ? edit.from : edit.terms) : included
  const affected = useMemo(() => filesUsingTerms(records.values(), taxonomy.plural, sources), [records, taxonomy.plural, sources])
  const existingTarget = request.kind === 'rename' && target !== '' && !included.includes(target) && terms.some((term) => term.name === target)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function preview() {
    if (!edit) return
    setError(null)
    setStep({ name: 'planning', done: 0, total: affected.length })
    try {
      const plan = await planTermEdit(
        affected,
        taxonomy.plural,
        edit,
        { readText: api.readText, tomlEditText: api.tomlEditText, tomlParseText },
        (done, total) => setStep({ name: 'planning', done, total }),
      )
      const pages = planTermPageMove(edit, terms, termPages, contentDir, taxonomy.plural, settings)
      setStep({ name: 'review', plan, edit, pages })
    } catch (e) {
      setError(e)
      setStep({ name: 'edit' })
    }
  }

  async function write(plan: ChangePlan, pages: TermPageMovePlan, applied: TermEdit) {
    setError(null)
    const total = plan.files.length
    let done = 0
    setStep({ name: 'writing', done, total })
    const outcome = await writePlan(plan.files, {
      writeText: async (path, text, version) => {
        try {
          return await api.writeText(path, text, version)
        } finally {
          setStep({ name: 'writing', done: ++done, total })
        }
      },
      snapshot: (path, text) => api.historySave(path, text, 'save'),
    })
    let moved: string | null = null
    let moveError: unknown = null
    const changed = [...outcome.written]
    if (pages.move && movePage) {
      try {
        moved = await api.renameFile(pages.move.from, pages.move.to)
        changed.push(pages.move.from, moved)
      } catch (e) {
        moveError = e
      }
    }
    if (changed.length > 0) {
      try {
        await onFilesChanged(changed)
      } catch (e) {
        setError(e)
      }
    }
    if (applied.kind === 'rename' && outcome.written.length > 0) onRenamed?.(applied.to)
    setStep({ name: 'done', outcome, moved, moveError })
  }

  const title =
    request.kind === 'delete'
      ? t('taxonomies.deleteTitle', { count: request.terms.length })
      : merging
        ? t('taxonomies.mergeTitle')
        : t('taxonomies.renameTitle', { term: request.terms[0] })

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">{title}</h2>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto">
          {(step.name === 'edit' || step.name === 'planning') && (
            <>
              {request.terms.length > 1 && (
                <fieldset className="space-y-1">
                  <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    {request.kind === 'delete' ? title : t('taxonomies.mergeTerms')}
                  </legend>
                  {request.terms.map((term) => (
                    <label key={term} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={included.includes(term)}
                        disabled={busy}
                        onChange={(e) =>
                          setIncluded((list) => (e.target.checked ? request.terms.filter((x) => x === term || list.includes(x)) : list.filter((x) => x !== term)))
                        }
                      />
                      <span>{term}</span>
                      <span className="text-xs text-zinc-500">
                        {t('taxonomies.posts', { count: terms.find((x) => x.name === term)?.posts.length ?? 0 })}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              {request.kind === 'rename' ? (
                <label className="field" htmlFor={nameId}>
                  <span>{merging ? t('taxonomies.mergeInto') : t('taxonomies.newName')}</span>
                  <input
                    id={nameId}
                    list={listId}
                    value={name}
                    disabled={busy}
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && edit && affected.length > 0) void preview()
                    }}
                  />
                  <datalist id={listId}>
                    {terms.map((term) => (
                      <option key={term.name} value={term.name} />
                    ))}
                  </datalist>
                </label>
              ) : (
                <p className="text-sm">{t('taxonomies.deleteIntro')}</p>
              )}

              <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                {request.kind === 'delete' && request.terms.length === 1 && <p className="font-medium text-zinc-900 dark:text-zinc-100">{request.terms[0]}</p>}
                <p>{t('taxonomies.usedBy', { count: affected.length })}</p>
                {existingTarget && <p className="text-sky-800 dark:text-sky-300">{t('taxonomies.targetExists', { term: target })}</p>}
                {request.kind === 'rename' && target === '' && <p className="text-amber-700 dark:text-amber-400">{t('taxonomies.nameEmpty')}</p>}
                {request.kind === 'rename' && target !== '' && !edit && <p>{t('taxonomies.nothingToChange')}</p>}
              </div>

              {step.name === 'planning' && (
                <div className="space-y-1">
                  <p className="text-sm text-zinc-500">{t('taxonomies.planning', { done: step.done, total: step.total })}</p>
                  <progress className="w-full" max={Math.max(step.total, 1)} value={step.done} />
                </div>
              )}
            </>
          )}

          {step.name === 'review' && <Review plan={step.plan} pages={step.pages} movePage={movePage} onMovePage={setMovePage} />}

          {step.name === 'writing' && (
            <div className="space-y-1">
              <p className="text-sm text-zinc-500">{t('taxonomies.writing', { done: step.done, total: step.total })}</p>
              <progress className="w-full" max={Math.max(step.total, 1)} value={step.done} />
            </div>
          )}

          {step.name === 'done' && <Result outcome={step.outcome} moved={step.moved} moveError={step.moveError} />}

          {error !== null && <ErrorNote error={error} />}
        </div>

        <div className="flex justify-end gap-2">
          {step.name === 'done' ? (
            <button className="btn btn-primary" onClick={onClose}>
              {t('taxonomies.done')}
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </button>
              {step.name === 'review' ? (
                <>
                  <button className="btn" onClick={() => setStep({ name: 'edit' })}>
                    {t('taxonomies.back')}
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={step.plan.files.length === 0 && !(step.pages.move && movePage)}
                    onClick={() => void write(step.plan, step.pages, step.edit)}
                  >
                    {t('taxonomies.write', { count: step.plan.files.length })}
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" disabled={!edit || busy} onClick={() => void preview()}>
                  {t('taxonomies.showChanges')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Review({
  plan,
  pages,
  movePage,
  onMovePage,
}: {
  plan: ChangePlan
  pages: TermPageMovePlan
  movePage: boolean
  onMovePage(value: boolean): void
}) {
  const { t } = useTranslation()
  const openByDefault = plan.files.length <= 8
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">
        {plan.files.length === 0 ? t('taxonomies.noFileChanges') : t('taxonomies.filesToChange', { count: plan.files.length })}
      </p>
      {plan.files.map((file) => (
        <FileDiff key={file.path} file={file} defaultOpen={openByDefault} />
      ))}

      {pages.move && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={movePage} onChange={(e) => onMovePage(e.target.checked)} />
          <span>{t('taxonomies.moveTermPage', { from: pages.move.from, to: pages.move.to })}</span>
        </label>
      )}
      {pages.kept.map((path) => (
        <p key={path} className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('taxonomies.termPageKept', { path })}
        </p>
      ))}

      {plan.skipped.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-medium text-amber-800 dark:text-amber-300">{t('taxonomies.skippedHeading')}</h3>
          <ul className="space-y-1 text-sm">
            {plan.skipped.map((skipped) => (
              <li key={skipped.path}>
                <span className="font-mono text-xs">{skipped.path}</span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {' '}
                  · {skipped.reason === 'readOnly' ? t('taxonomies.skippedReadOnly') : t('taxonomies.skippedError')}
                </span>
                {skipped.reason === 'error' && (
                  <span className="block font-mono text-xs text-zinc-500">{errorMessage(skipped.error).detail}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function FileDiff({ file, defaultOpen }: { file: PlannedFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="space-y-1">
      <summary className="cursor-pointer font-mono text-sm">{file.path}</summary>
      {open && <DiffView before={frontMatterBlock(file.before)} after={frontMatterBlock(file.after)} />}
    </details>
  )
}

function Result({ outcome, moved, moveError }: { outcome: WriteOutcome; moved: string | null; moveError: unknown }) {
  const { t } = useTranslation()
  const conflicts = outcome.failed.some((f) => isAppError(f.error) && f.error.code === 'conflict')
  return (
    <div className="space-y-3 text-sm">
      {outcome.written.length > 0 && (
        <p className="text-emerald-700 dark:text-emerald-400">✓ {t('taxonomies.written', { count: outcome.written.length })}</p>
      )}
      {outcome.failed.length > 0 && (
        <section className="space-y-1">
          <p className="font-medium text-red-700 dark:text-red-400">{t('taxonomies.failed', { count: outcome.failed.length })}</p>
          <ul className="space-y-1">
            {outcome.failed.map(({ path, error }) => (
              <li key={path}>
                <span className="font-mono text-xs">{path}</span>
                <span className="text-zinc-600 dark:text-zinc-400"> · {errorMessage(error).summary}</span>
              </li>
            ))}
          </ul>
          {conflicts && <p className="text-zinc-600 dark:text-zinc-400">{t('taxonomies.conflictHint')}</p>}
        </section>
      )}
      {moved && <p>{t('taxonomies.movedTermPage', { path: moved })}</p>}
      {moveError !== null && (
        <div className="space-y-1">
          <p className="font-medium text-red-700 dark:text-red-400">{t('taxonomies.moveFailed')}</p>
          <ErrorNote error={moveError} />
        </div>
      )}
    </div>
  )
}
