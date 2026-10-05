import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../../components/DiffView'
import { ErrorNote } from '../../../components/ErrorNote'
import type { PageEntry } from '../../../lib/api'
import type { ShortcodeDef } from '../../editor'
import {
  FIELD_KINDS,
  initialValues,
  snippetFromShortcode,
  snippetOps,
  starterSnippets,
  uniqueId,
  validateSnippet,
  type ParsedSnippet,
  type SnippetDef,
  type SnippetField,
  type StarterLabels,
} from './definitions'
import { SnippetForm } from './SnippetForm'
import { renderTemplate, templateKeys, type TemplateValue } from './template'
import type { SnippetsController } from './useSnippets'

type Draft = SnippetDef & { index?: number }

/** Template syntax shown in the help text (passed as values so i18next leaves the braces alone). */
const TEMPLATE_HELP = {
  value: '{{key}}',
  section: '{{#key}}…{{/key}}',
  inverted: '{{^key}}…{{/key}}',
  filter: '{{key|slug}}',
  shortcode: '{{< … >}}',
}

interface Props {
  snippets: SnippetsController
  shortcodes: readonly ShortcodeDef[] | undefined
  pages: readonly PageEntry[]
  contentDir: string
  pickImage(): Promise<string | null>
  onClose(): void
}

const EMPTY: Draft = { id: '', name: '', output: 'markdown', fields: [], template: '' }

/** List, add, edit, duplicate and delete the site's snippets; every write is reviewed as a diff. */
export function SnippetManager({ snippets, shortcodes, pages, contentDir, pickImage, onClose }: Props) {
  const { t } = useTranslation()
  const list = useMemo(() => snippets.file?.snippets ?? [], [snippets.file])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [review, setReview] = useState<{ before: string; after: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [shortcode, setShortcode] = useState('')

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const starters = useMemo(() => starterSnippets(starterLabels(t)), [t])
  const taken = list.map((s) => s.id)

  async function propose(next: Draft[]) {
    if (!snippets.file) return
    setBusy(true)
    setError(null)
    try {
      const after = await snippets.preview(snippetOps(list, next))
      setReview({ before: snippets.file.text, after })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  async function write() {
    if (!review) return
    setBusy(true)
    setError(null)
    try {
      await snippets.write(review.after)
      setReview(null)
      setDraft(null)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  function saveDraft(d: Draft) {
    const id = d.id.trim() || uniqueId(d.name, list.filter((s) => s.index !== d.index).map((s) => s.id))
    const clean: Draft = { ...d, id, name: d.name.trim(), description: d.description?.trim() || undefined }
    const next: Draft[] = d.index === undefined ? [...list, clean] : list.map((s) => (s.index === d.index ? clean : s))
    void propose(next)
  }

  const others = draft ? list.filter((s) => s.index !== draft.index) : []
  const draftId = draft ? draft.id.trim() || uniqueId(draft.name, others.map((s) => s.id)) : ''
  const problems = draft ? validateSnippet({ ...draft, id: draftId }, others) : []

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('document.snippetManager')}
        className="flex max-h-full w-full max-w-4xl flex-col rounded-lg bg-white text-sm shadow-xl dark:bg-zinc-900"
      >
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <h2 className="flex-1 font-semibold">{t('document.snippetManager')}</h2>
          <button type="button" className="btn px-2 py-1 text-xs" aria-label={t('common.close')} disabled={busy} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {(error ?? snippets.error) !== null && <ErrorNote error={error ?? snippets.error} />}
          {snippets.file && snippets.file.problems.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{t('document.snippetFileProblems', { list: snippets.file.problems.join(', ') })}</p>
          )}
          {review ? (
            <section className="space-y-2">
              <p>{t('document.snippetReview', { path: '.hugo-publisher/snippets.toml' })}</p>
              <DiffView before={review.before} after={review.after} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn" disabled={busy} onClick={() => setReview(null)}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void write()}>
                  {t('document.snippetWrite')}
                </button>
              </div>
            </section>
          ) : draft ? (
            <DraftEditor
              draft={draft}
              onChange={setDraft}
              problems={problems.map((p) => t(`document.snippetProblem_${p}`))}
              busy={busy}
              onCancel={() => setDraft(null)}
              onSave={() => saveDraft(draft)}
              pages={pages}
              contentDir={contentDir}
              pickImage={pickImage}
            />
          ) : (
            <>
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="flex-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t('document.snippets')}</h3>
                  <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setDraft({ ...EMPTY })}>
                    {t('document.snippetNew')}
                  </button>
                </div>
                {list.length === 0 ? (
                  <p className="text-zinc-500">{t('document.snippetNone')}</p>
                ) : (
                  <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                    {list.map((snippet) => (
                      <li key={snippet.index} className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{snippet.name}</span> <span className="font-mono text-xs text-zinc-500">{snippet.id}</span>
                          {snippet.description && <span className="block truncate text-xs text-zinc-500">{snippet.description}</span>}
                        </span>
                        <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setDraft(copy(snippet))}>
                          {t('document.snippetEdit')}
                        </button>
                        <button
                          type="button"
                          className="btn px-2 py-1 text-xs"
                          onClick={() => {
                            const duplicate = copy(snippet)
                            delete duplicate.index
                            setDraft({ ...duplicate, id: uniqueId(snippet.id, taken), name: t('document.snippetCopyName', { name: snippet.name }) })
                          }}
                        >
                          {t('document.snippetDuplicate')}
                        </button>
                        <button
                          type="button"
                          className="btn px-2 py-1 text-xs"
                          aria-label={t('document.snippetDelete', { name: snippet.name })}
                          onClick={() => void propose(list.filter((s) => s.index !== snippet.index))}
                        >
                          {t('document.snippetDeleteShort')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t('document.snippetStarters')}</h3>
                <ul className="grid gap-2 sm:grid-cols-3">
                  {starters.map((starter) => (
                    <li key={starter.id} className="space-y-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                      <p className="font-medium">{starter.name}</p>
                      <p className="text-xs text-zinc-500">{starter.description}</p>
                      <button
                        type="button"
                        className="btn px-2 py-1 text-xs"
                        onClick={() => setDraft({ ...starter, id: uniqueId(starter.id, taken) })}
                      >
                        {t('document.snippetUseStarter')}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              {shortcodes && shortcodes.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t('document.snippetFromShortcode')}</h3>
                  <div className="flex gap-2">
                    <select
                      aria-label={t('document.snippetFromShortcode')}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                      value={shortcode}
                      onChange={(e) => setShortcode(e.target.value)}
                    >
                      <option value="">{t('document.snippetPickShortcode')}</option>
                      {shortcodes.map((sc) => (
                        <option key={`${sc.source}:${sc.name}`} value={sc.name}>
                          {sc.name} ({sc.source})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn px-2 py-1 text-xs"
                      disabled={!shortcode}
                      onClick={() => {
                        const sc = shortcodes.find((s) => s.name === shortcode)
                        if (sc) setDraft(snippetFromShortcode(sc, taken))
                      }}
                    >
                      {t('document.snippetMakeFromShortcode')}
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function copy(snippet: ParsedSnippet): Draft {
  return { ...snippet, fields: snippet.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined })) }
}

function DraftEditor({
  draft,
  onChange,
  problems,
  busy,
  onCancel,
  onSave,
  pages,
  contentDir,
  pickImage,
}: {
  draft: Draft
  onChange(draft: Draft): void
  problems: string[]
  busy: boolean
  onCancel(): void
  onSave(): void
  pages: readonly PageEntry[]
  contentDir: string
  pickImage(): Promise<string | null>
}) {
  const { t } = useTranslation()
  const [sample, setSample] = useState<Record<string, TemplateValue>>(() => initialValues(draft))
  const keys = draft.fields.map((f) => f.key)
  const unknown = templateKeys(draft.template).filter((k) => !keys.includes(k))
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const setField = (index: number, patch: Partial<SnippetField>) =>
    set({ fields: draft.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) })
  const move = (index: number, by: number) => {
    const fields = [...draft.fields]
    const [field] = fields.splice(index, 1)
    fields.splice(index + by, 0, field)
    set({ fields })
  }
  const input = 'rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900'

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <label className="field">
          <span>{t('document.snippetName')}</span>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="flex gap-2">
          <label className="field flex-1">
            <span>{t('document.snippetId')}</span>
            <input className="font-mono" value={draft.id} placeholder={t('document.snippetIdAuto')} onChange={(e) => set({ id: e.target.value })} />
          </label>
          <label className="field">
            <span>{t('document.snippetOutput')}</span>
            <select value={draft.output} onChange={(e) => set({ output: e.target.value as Draft['output'] })}>
              <option value="markdown">Markdown</option>
              <option value="shortcode">Shortcode</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>{t('document.snippetDescription')}</span>
          <input value={draft.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('document.snippetFields')}</legend>
          {draft.fields.map((field, index) => (
            <div key={index} className="flex flex-wrap items-center gap-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              <input
                aria-label={t('document.snippetFieldKey', { n: index + 1 })}
                className={`${input} w-24 font-mono`}
                value={field.key}
                onChange={(e) => setField(index, { key: e.target.value.trim() })}
              />
              <input
                aria-label={t('document.snippetFieldLabel', { n: index + 1 })}
                className={`${input} min-w-0 flex-1`}
                value={field.label}
                onChange={(e) => setField(index, { label: e.target.value })}
              />
              <select
                aria-label={t('document.snippetFieldKind', { n: index + 1 })}
                className={input}
                value={field.kind}
                onChange={(e) => setField(index, { kind: e.target.value as SnippetField['kind'] })}
              >
                {FIELD_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`document.snippetKind_${kind}`)}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={field.required === true} onChange={(e) => setField(index, { required: e.target.checked || undefined })} />
                {t('document.snippetRequired')}
              </label>
              <button type="button" className="btn px-1.5 py-0.5 text-xs" disabled={index === 0} aria-label={t('document.moveUp')} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button
                type="button"
                className="btn px-1.5 py-0.5 text-xs"
                disabled={index === draft.fields.length - 1}
                aria-label={t('document.moveDown')}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn px-1.5 py-0.5 text-xs"
                aria-label={t('document.removeField', { field: field.key })}
                onClick={() => set({ fields: draft.fields.filter((_, i) => i !== index) })}
              >
                ×
              </button>
              {field.kind === 'select' && (
                <input
                  aria-label={t('document.snippetFieldOptions', { n: index + 1 })}
                  className={`${input} w-full`}
                  placeholder={t('document.snippetOptionsHint')}
                  value={(field.options ?? []).join(', ')}
                  onChange={(e) => setField(index, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                />
              )}
              {field.kind !== 'bool' && field.kind !== 'image' && field.kind !== 'page' && (
                <input
                  aria-label={t('document.snippetFieldDefault', { n: index + 1 })}
                  className={`${input} w-full`}
                  placeholder={t('document.snippetDefault')}
                  value={field.default === undefined ? '' : String(field.default)}
                  onChange={(e) => setField(index, { default: e.target.value === '' ? undefined : e.target.value })}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={() => set({ fields: [...draft.fields, { key: `field${draft.fields.length + 1}`, label: '', kind: 'text' }] })}
          >
            {t('document.snippetAddField')}
          </button>
        </fieldset>

        <label className="field">
          <span>{t('document.snippetTemplate')}</span>
          <textarea className="font-mono text-xs" rows={10} spellCheck={false} value={draft.template} onChange={(e) => set({ template: e.target.value })} />
          <small className="text-zinc-500">{t('document.snippetTemplateHelp', TEMPLATE_HELP)}</small>
          {unknown.length > 0 && (
            <small className="text-amber-700 dark:text-amber-400">{t('document.snippetUnknownKeys', { keys: unknown.join(', ') })}</small>
          )}
        </label>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('document.snippetTry')}</p>
        <SnippetForm def={draft} values={sample} onChange={setSample} pickImage={pickImage} pages={pages} contentDir={contentDir} />
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('document.snippetPreview')}</p>
        <pre className="max-h-72 overflow-auto rounded-md bg-zinc-50 p-2 font-mono text-xs whitespace-pre-wrap dark:bg-zinc-800">
          {renderTemplate(draft.template, { keys, values: sample })}
        </pre>
        {problems.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || problems.length > 0} onClick={onSave}>
            {t('document.snippetSave')}
          </button>
        </div>
      </div>
    </div>
  )
}

function starterLabels(t: (key: string) => string): StarterLabels {
  const keys: (keyof StarterLabels)[] = [
    'book',
    'bookDescription',
    'quote',
    'quoteDescription',
    'product',
    'productDescription',
    'title',
    'author',
    'publisher',
    'year',
    'isbn',
    'link',
    'text',
    'source',
    'name',
    'image',
    'price',
    'description',
  ]
  return Object.fromEntries(keys.map((key) => [key, t(`document.starter_${key}`)])) as unknown as StarterLabels
}
