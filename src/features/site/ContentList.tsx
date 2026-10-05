import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ContentFile, PageEntry } from '../../lib/api'
import { fold } from '../palette/match'
import type { BulkAction } from './bulk'
import { isExpired, isFuture } from './dates'

interface Props {
  files: ContentFile[]
  /** Hugo's page list, for draft/future status and dates. */
  pages: PageEntry[]
  /** ISO time `pages` was read: posts dated after it are scheduled. */
  now: string
  /** Taxonomy front matter keys (plural), e.g. `tags`, `categories`. */
  taxonomies: string[]
  selected: string | null
  onSelect(path: string): void
  onDelete(path: string): void
  /** Applies an action to several files; resolves when done. */
  onBulk(paths: string[], action: BulkAction | { kind: 'delete' }): Promise<void>
  onReload(): void
}

type Sort = 'date' | 'title' | 'path'

const ZERO_DATE = '0001-01-01'

/** The first folder under content/, or '/' for files directly in it. */
function sectionOf(file: ContentFile): string {
  const parts = file.path.replace(/^content\//, '').split('/')
  return parts.length > 1 ? parts[0] : '/'
}

export function ContentList({ files, pages, now, taxonomies, selected, onSelect, onDelete, onBulk, onReload }: Props) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('date')
  // '' = everything, '/' = pages directly under content/, else a section folder.
  const [section, setSection] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [termTaxonomy, setTermTaxonomy] = useState('')
  const [term, setTerm] = useState('')
  const [busy, setBusy] = useState(false)
  const byPath = useMemo(() => new Map(pages.map((p) => [p.path, p])), [pages])
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' }), [i18n.resolvedLanguage])
  const collator = useMemo(() => new Intl.Collator(i18n.resolvedLanguage), [i18n.resolvedLanguage])
  const taxonomy = termTaxonomy || taxonomies[0] || 'tags'

  const sections = useMemo(() => [...new Set(files.map(sectionOf))].sort((a, b) => a.localeCompare(b)), [files])

  const visible = useMemo(() => {
    const needle = fold(query.trim())
    const inSection = section ? files.filter((f) => sectionOf(f) === section) : files
    const matching = needle ? inSection.filter((f) => fold(`${f.title ?? ''} ${f.path}`).includes(needle)) : inSection
    const dateOf = (f: ContentFile) => {
      const date = byPath.get(f.path)?.date ?? ''
      return date.startsWith(ZERO_DATE) ? '' : date
    }
    return [...matching].sort((a, b) => {
      if (sort === 'title') return collator.compare(a.title ?? a.path, b.title ?? b.path)
      if (sort === 'path') return a.path.localeCompare(b.path)
      // Newest first; undated (sections, pages) after dated posts.
      return dateOf(b).localeCompare(dateOf(a)) || collator.compare(a.title ?? a.path, b.title ?? b.path)
    })
  }, [files, query, sort, section, byPath, collator])

  function toggle(path: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function stopSelecting() {
    setSelecting(false)
    setChecked(new Set())
    setTerm('')
  }

  async function bulk(action: BulkAction | { kind: 'delete' }) {
    setBusy(true)
    try {
      await onBulk([...checked], action)
      stopSelecting()
    } finally {
      setBusy(false)
    }
  }

  function badges(path: string) {
    const page = byPath.get(path)
    if (!page) return null
    const future = isFuture(page.publishDate, now)
    const expired = isExpired(page.expiryDate, now)
    return (
      <>
        {page.draft && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{t('site.draft')}</span>}
        {future && <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">{t('site.scheduled')}</span>}
        {expired && <span className="rounded bg-zinc-200 px-1 text-[10px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">{t('site.expired')}</span>}
      </>
    )
  }

  function dateText(path: string) {
    const date = byPath.get(path)?.date
    if (!date || date.startsWith(ZERO_DATE)) return null
    const parsed = new Date(date)
    return Number.isNaN(parsed.getTime()) ? null : dateFormat.format(parsed)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="mr-auto text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t('site.content')}</h2>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label={t('site.sort')}
          className="rounded border border-zinc-300 bg-transparent px-1 text-xs text-zinc-500 dark:border-zinc-700"
        >
          <option value="date">{t('site.sortDate')}</option>
          <option value="title">{t('site.sortTitle')}</option>
          <option value="path">{t('site.sortPath')}</option>
        </select>
        <button className="text-xs text-zinc-500 hover:underline" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
          {selecting ? t('common.cancel') : t('site.select')}
        </button>
        <button className="text-xs text-zinc-500 hover:underline" onClick={onReload}>
          {t('site.reload')}
        </button>
      </div>
      {sections.length > 1 && (
        <div className="px-3 pb-2">
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            aria-label={t('site.section')}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">{t('site.allSections')}</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s === '/' ? t('site.rootPages') : s}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="px-3 pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('site.search')}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-auto px-1 pb-3">
        {visible.map((file) => (
          <li key={file.path} className="group relative flex items-start">
            {selecting && (
              <input
                type="checkbox"
                className="mt-2.5 ml-2"
                checked={checked.has(file.path)}
                onChange={() => toggle(file.path)}
                aria-label={file.title || file.path}
              />
            )}
            <button
              onClick={() => (selecting ? toggle(file.path) : onSelect(file.path))}
              className={`block min-w-0 flex-1 rounded-md px-2 py-1.5 pr-7 text-left ${
                !selecting && file.path === selected ? 'bg-sky-100 dark:bg-sky-900/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="flex items-center gap-1">
                <span className="truncate text-sm">{file.title || file.path.split('/').pop()}</span>
                {badges(file.path)}
              </span>
              <span className="flex gap-2 font-mono text-[11px] text-zinc-500">
                <span className="truncate">{file.path.replace(/^content\//, '')}</span>
                {dateText(file.path) && <span className="shrink-0 font-sans">{dateText(file.path)}</span>}
              </span>
            </button>
            {!selecting && (
              <button
                className="absolute top-1.5 right-1 rounded px-1.5 text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-600 focus:opacity-100"
                aria-label={t('site.delete', { title: file.title || file.path })}
                title={t('site.delete', { title: file.title || file.path })}
                onClick={() => onDelete(file.path)}
              >
                ×
              </button>
            )}
          </li>
        ))}
        {files.length === 0 && <li className="px-2 text-sm text-zinc-500">{t('site.noContent')}</li>}
        {files.length > 0 && visible.length === 0 && (
          <li className="px-2 text-sm text-zinc-500">{t('site.noMatch', { query })}</li>
        )}
      </ul>

      {selecting && (
        <div className="space-y-2 border-t border-zinc-200 p-3 text-xs dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="mr-auto">{t('site.selected', { count: checked.size })}</span>
            <button className="hover:underline" onClick={() => setChecked(new Set(visible.map((f) => f.path)))}>
              {t('site.selectAll')}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            <button className="btn px-2 py-1 text-xs" disabled={busy || checked.size === 0} onClick={() => void bulk({ kind: 'draft', draft: true })}>
              {t('site.bulkDraft')}
            </button>
            <button className="btn px-2 py-1 text-xs" disabled={busy || checked.size === 0} onClick={() => void bulk({ kind: 'draft', draft: false })}>
              {t('site.bulkPublish')}
            </button>
            <button
              className="btn px-2 py-1 text-xs text-red-700 dark:text-red-400"
              disabled={busy || checked.size === 0}
              onClick={() => void bulk({ kind: 'delete' })}
            >
              {t('site.bulkDelete')}
            </button>
          </div>
          <div className="flex gap-1">
            {taxonomies.length > 1 && (
              <select
                value={taxonomy}
                onChange={(e) => setTermTaxonomy(e.target.value)}
                aria-label={t('site.taxonomy')}
                className="rounded border border-zinc-300 bg-transparent px-1 dark:border-zinc-700"
              >
                {taxonomies.map((tx) => (
                  <option key={tx} value={tx}>
                    {tx}
                  </option>
                ))}
              </select>
            )}
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('site.termPlaceholder', { taxonomy })}
              className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              className="btn px-2 py-1 text-xs"
              disabled={busy || checked.size === 0 || !term.trim()}
              onClick={() => void bulk({ kind: 'addTerm', taxonomy, term: term.trim() })}
            >
              {t('site.bulkAddTerm')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
