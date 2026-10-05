import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PageEntry } from '../../../lib/api'
import { contentRelative, type SnippetDef, type SnippetField } from './definitions'
import type { TemplateValue } from './template'

interface Props {
  def: SnippetDef
  values: Record<string, TemplateValue>
  onChange(values: Record<string, TemplateValue>): void
  /** Opens the media picker; resolves with the reference to write, or null. */
  pickImage(): Promise<string | null>
  /** Pages for `page` fields; a page's value is its path inside the content folder. */
  pages: readonly PageEntry[]
  contentDir: string
}

/** A form generated from a snippet's fields. */
export function SnippetForm({ def, values, onChange, pickImage, pages, contentDir }: Props) {
  const { t } = useTranslation()
  if (def.fields.length === 0) return <p className="text-xs text-zinc-500">{t('document.snippetNoFields')}</p>
  const set = (key: string, value: TemplateValue) => onChange({ ...values, [key]: value })
  return (
    <div className="grid gap-3">
      {def.fields.map((field) => (
        <SnippetFieldInput
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={(value) => set(field.key, value)}
          pickImage={pickImage}
          pages={pages}
          contentDir={contentDir}
        />
      ))}
    </div>
  )
}

function SnippetFieldInput({
  field,
  value,
  onChange,
  pickImage,
  pages,
  contentDir,
}: {
  field: SnippetField
  value: TemplateValue
  onChange(value: TemplateValue): void
  pickImage(): Promise<string | null>
  pages: readonly PageEntry[]
  contentDir: string
}) {
  const { t } = useTranslation()
  const label = field.required ? `${field.label} *` : field.label
  const text = value === undefined || value === null ? '' : String(value)
  switch (field.kind) {
    case 'bool':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      )
    case 'multiline':
      return (
        <label className="field">
          <span>{label}</span>
          <textarea rows={3} value={text} onChange={(e) => onChange(e.target.value)} />
        </label>
      )
    case 'select':
      return (
        <label className="field">
          <span>{label}</span>
          <select value={text} onChange={(e) => onChange(e.target.value)}>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )
    case 'image':
      return (
        <label className="field">
          <span>{label}</span>
          <div className="flex gap-2">
            <input className="min-w-0 flex-1 font-mono" value={text} onChange={(e) => onChange(e.target.value)} />
            <button
              type="button"
              className="btn px-2 py-1 text-xs"
              onClick={() => {
                void pickImage().then((picked) => {
                  if (picked) onChange(picked)
                })
              }}
            >
              {t('document.chooseImage')}
            </button>
          </div>
        </label>
      )
    case 'page':
      return <PageInput label={label} value={text} onChange={onChange} pages={pages} contentDir={contentDir} />
    default:
      return (
        <label className="field">
          <span>{label}</span>
          <input
            type={field.kind === 'number' ? 'number' : field.kind === 'url' ? 'url' : field.kind === 'date' ? 'date' : 'text'}
            value={text}
            onChange={(e) => {
              const next = e.target.value
              onChange(field.kind === 'number' && next.trim() !== '' && Number.isFinite(Number(next)) ? Number(next) : next)
            }}
          />
        </label>
      )
  }
}

/** Searches the site's pages by title or path. */
function PageInput({
  label,
  value,
  onChange,
  pages,
  contentDir,
}: {
  label: string
  value: string
  onChange(value: string): void
  pages: readonly PageEntry[]
  contentDir: string
}) {
  const { t } = useTranslation()
  const id = useId()
  const [query, setQuery] = useState('')
  const options = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return pages
      .filter((p) => p.path && (q === '' || p.title.toLocaleLowerCase().includes(q) || p.path.toLocaleLowerCase().includes(q)))
      .slice(0, 8)
  }, [pages, query])
  const chosen = pages.find((p) => contentRelative(p.path, contentDir) === value)
  return (
    <div className="field">
      <span id={id}>{label}</span>
      {value && (
        <p className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {chosen?.title ?? value} <span className="font-mono text-xs text-zinc-500">{value}</span>
          </span>
          <button type="button" className="btn px-2 py-0.5 text-xs" aria-label={t('document.clearField', { field: label })} onClick={() => onChange('')}>
            ×
          </button>
        </p>
      )}
      <input aria-labelledby={id} placeholder={t('document.snippetSearchPage')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {query.trim() !== '' && (
        <ul className="max-h-40 overflow-auto rounded-md border border-zinc-200 text-sm dark:border-zinc-700">
          {options.map((page) => (
            <li key={page.path}>
              <button
                type="button"
                className="w-full px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => {
                  onChange(contentRelative(page.path, contentDir))
                  setQuery('')
                }}
              >
                {page.title || page.path} <span className="font-mono text-xs text-zinc-500">{page.path}</span>
              </button>
            </li>
          ))}
          {options.length === 0 && <li className="px-2 py-1 text-zinc-500">{t('document.snippetNoPages')}</li>}
        </ul>
      )}
    </div>
  )
}
