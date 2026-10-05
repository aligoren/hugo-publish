import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import type { PageEntry } from '../../../lib/api'
import { contentRelative, initialValues, missingRequired, type ParsedSnippet } from './definitions'
import { SnippetForm } from './SnippetForm'
import { renderTemplate, type TemplatePage, type TemplateValue } from './template'
import type { SnippetsController } from './useSnippets'

interface Props {
  snippets: SnippetsController
  /** Opens this snippet's form right away. */
  initialId?: string | null
  pages: readonly PageEntry[]
  contentDir: string
  /** Opens the media picker; resolves with the reference to write, or null. */
  pickImage(): Promise<string | null>
  /** Inserts the rendered text at the cursor (LF line breaks). */
  onInsert(text: string): void
  onManage(): void
  onClose(): void
}

/** Pick a snippet, fill in its fields, see the result, insert it. */
export function SnippetInsertDialog({ snippets, initialId = null, pages, contentDir, pickImage, onInsert, onManage, onClose }: Props) {
  const { t } = useTranslation()
  const list = snippets.file?.snippets ?? []
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ParsedSnippet | null>(() => list.find((s) => s.id === initialId) ?? null)
  const [values, setValues] = useState<Record<string, TemplateValue>>(() => (selected ? initialValues(selected) : {}))

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const pageMap = useMemo(() => {
    const map = new Map<string, TemplatePage>()
    for (const page of pages) map.set(contentRelative(page.path, contentDir), { title: page.title, permalink: page.permalink })
    return map
  }, [contentDir, pages])

  const q = query.trim().toLocaleLowerCase()
  const matches = list.filter((s) => q === '' || s.name.toLocaleLowerCase().includes(q) || (s.description ?? '').toLocaleLowerCase().includes(q))
  const rendered = selected ? renderTemplate(selected.template, { keys: selected.fields.map((f) => f.key), values, pages: pageMap }) : ''
  const missing = selected ? missingRequired(selected, values) : []

  function choose(snippet: ParsedSnippet) {
    setSelected(snippet)
    setValues(initialValues(snippet))
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('document.snippets')}
        className="flex max-h-full w-full max-w-3xl flex-col rounded-lg bg-white text-sm shadow-xl dark:bg-zinc-900"
      >
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <h2 className="flex-1 font-semibold">{selected ? selected.name : t('document.snippets')}</h2>
          <button type="button" className="btn px-2 py-1 text-xs" onClick={onManage}>
            {t('document.snippetManage')}
          </button>
          <button type="button" className="btn px-2 py-1 text-xs" aria-label={t('common.close')} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {snippets.error !== null && <ErrorNote error={snippets.error} />}
          {!snippets.file ? (
            <p className="text-zinc-500">{t('common.loading')}</p>
          ) : selected ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                {selected.description && <p className="text-xs text-zinc-500">{selected.description}</p>}
                <SnippetForm def={selected} values={values} onChange={setValues} pickImage={pickImage} pages={pages} contentDir={contentDir} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('document.snippetPreview')}</p>
                <pre aria-label={t('document.snippetPreview')} className="max-h-80 overflow-auto rounded-md bg-zinc-50 p-2 font-mono text-xs whitespace-pre-wrap dark:bg-zinc-800">
                  {rendered}
                </pre>
              </div>
            </div>
          ) : list.length === 0 ? (
            <div className="space-y-2">
              <p>{t('document.snippetNone')}</p>
              <button type="button" className="btn" onClick={onManage}>
                {t('document.snippetManage')}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                aria-label={t('document.snippetSearch')}
                placeholder={t('document.snippetSearch')}
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {matches.map((snippet) => (
                  <li key={snippet.id}>
                    <button type="button" className="w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => choose(snippet)}>
                      <span className="font-medium">{snippet.name}</span>
                      {snippet.output === 'shortcode' && (
                        <span className="ml-2 rounded bg-zinc-100 px-1 text-[10px] text-zinc-500 dark:bg-zinc-800">shortcode</span>
                      )}
                      {snippet.description && <span className="block text-xs text-zinc-500">{snippet.description}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {selected && (
          <footer className="flex items-center gap-2 border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              {t('document.snippetBack')}
            </button>
            <span className="flex-1 text-xs text-amber-700 dark:text-amber-400">
              {missing.length > 0 &&
                t('document.snippetMissing', { fields: missing.map((key) => selected.fields.find((f) => f.key === key)?.label ?? key).join(', ') })}
            </span>
            <button type="button" className="btn btn-primary" disabled={missing.length > 0 || rendered.trim() === ''} onClick={() => onInsert(rendered)}>
              {t('document.snippetInsert')}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
