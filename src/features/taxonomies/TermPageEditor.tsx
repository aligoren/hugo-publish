import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../components/DiffView'
import { ErrorNote } from '../../components/ErrorNote'
import { api } from '../../lib/api'
import { frontMatterBlock } from './termEdit'
import { newTermPage, readTermPage, updateTermPage, type TermPageFields } from './termPage'

interface Props {
  term: string
  /** The existing term page, or `null` when the term has none yet. */
  pagePath: string | null
  /** Where a new page is created. */
  newPath: string
  eol: '\n' | '\r\n'
  /** Called with the written path; returns when the file list is reloaded. */
  onSaved(path: string): Promise<void>
  onOpen(path: string): void
}

interface Loaded {
  /** `null` for a page that does not exist yet. */
  text: string | null
  version: string
  fields: TermPageFields
  editable: boolean
}

const tomlDeps = {
  tomlParseText: async (text: string) => (await api.tomlParseText(text)).values,
  tomlEditText: api.tomlEditText,
}

/** Title and description of a term page; creates `content/<plural>/<term>/_index.md` when missing. */
export function TermPageEditor({ term, pagePath, newPath, eol, onSaved, onOpen }: Props) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [fields, setFields] = useState<TermPageFields>({ title: '', description: '' })
  const [after, setAfter] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // A missing page starts as a button, so browsing terms does not show a form for each one.
  const [expanded, setExpanded] = useState(pagePath !== null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<Loaded> => {
      if (pagePath === null) return { text: null, version: '', fields: { title: term, description: '' }, editable: true }
      const file = await api.readText(pagePath)
      const page = await readTermPage(file.text, tomlDeps)
      return { text: file.text, version: file.version, ...page }
    }
    load().then(
      (result) => {
        if (cancelled) return
        setLoaded(result)
        setFields(result.fields)
        setError(null)
      },
      (e: unknown) => {
        if (!cancelled) setError(e)
      },
    )
    return () => {
      cancelled = true
    }
  }, [pagePath, term])

  // The text that would be written, recomputed as the fields change.
  useEffect(() => {
    if (!loaded || !loaded.editable) return
    let cancelled = false
    const compute = async () => (loaded.text === null ? newTermPage(fields, eol) : updateTermPage(loaded.text, fields, tomlDeps))
    compute().then(
      (text) => {
        if (!cancelled) setAfter(text)
      },
      (e: unknown) => {
        if (!cancelled) setError(e)
      },
    )
    return () => {
      cancelled = true
    }
  }, [loaded, fields, eol])

  async function save() {
    if (!loaded || after === null) return
    setSaving(true)
    setError(null)
    try {
      const path = pagePath ?? newPath
      // An empty expected version makes the write fail if the file appeared in the meantime.
      const version = await api.writeText(path, after, loaded.text === null ? '' : loaded.version)
      if (loaded.text !== null) setLoaded({ ...loaded, text: after, version, fields })
      setSaved(true)
      await onSaved(path)
    } catch (e) {
      setError(e)
    } finally {
      setSaving(false)
    }
  }

  const exists = pagePath !== null
  const changed = loaded !== null && after !== null && (loaded.text === null || after !== loaded.text)
  const update = (patch: Partial<TermPageFields>) => {
    setSaved(false)
    setFields((current) => ({ ...current, ...patch }))
  }

  return (
    <section className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold">{t('taxonomies.termPage')}</h3>
        {exists && (
          <button className="text-xs text-sky-700 hover:underline dark:text-sky-400" onClick={() => onOpen(pagePath)}>
            {t('taxonomies.openInEditor')}
          </button>
        )}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {exists ? t('taxonomies.termPageExists') : t('taxonomies.termPageMissing')}{' '}
        <span className="font-mono text-xs">{pagePath ?? newPath}</span>
      </p>

      {loaded === null && error === null && <p className="text-sm text-zinc-500">{t('taxonomies.termPageLoading')}</p>}
      {loaded !== null && !loaded.editable && <p className="text-sm text-amber-700 dark:text-amber-400">{t('taxonomies.termPageReadOnly')}</p>}

      {loaded !== null && loaded.editable && !expanded && !exists && (
        <button className="btn" onClick={() => setExpanded(true)}>
          {t('taxonomies.addTermPage')}
        </button>
      )}

      {loaded !== null && loaded.editable && (expanded || exists) && (
        <>
          <label className="field" htmlFor={titleId}>
            <span>{t('taxonomies.termPageTitle')}</span>
            <input id={titleId} value={fields.title} onChange={(e) => update({ title: e.target.value })} />
          </label>
          <label className="field" htmlFor={descriptionId}>
            <span>{t('taxonomies.termPageDescription')}</span>
            <textarea id={descriptionId} rows={2} value={fields.description} onChange={(e) => update({ description: e.target.value })} />
          </label>
          {changed && after !== null && (
            <>
              {!exists && <p className="text-xs text-zinc-500">{t('taxonomies.newFile', { path: newPath })}</p>}
              <DiffView before={loaded.text === null ? '' : frontMatterBlock(loaded.text)} after={frontMatterBlock(after)} />
            </>
          )}
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" disabled={!changed || saving} onClick={() => void save()}>
              {saving ? t('common.saving') : exists ? t('taxonomies.saveTermPage') : t('taxonomies.createTermPage')}
            </button>
            {saved && !changed && <span className="text-sm text-emerald-700 dark:text-emerald-400">{t('taxonomies.termPageSaved')}</span>}
          </div>
        </>
      )}
      {error !== null && <ErrorNote error={error} />}
    </section>
  )
}
