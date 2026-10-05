import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { slugify } from '../../lib/slug'
import { listPageEnabled, type TaxonomyDef, type TaxonomySettings } from './config'
import { findNearDuplicates, turkishLower, type DuplicateGroup } from './duplicates'
import type { FileRecord, TermInfo } from './indexer'
import { SimilarTerms } from './SimilarTerms'
import { TermChangeDialog, type ChangeRequest } from './TermChangeDialog'
import { TermDetail } from './TermDetail'
import { termPagePath } from './termPage'
import { termSegment } from './urlize'

interface Props {
  taxonomy: TaxonomyDef
  terms: TermInfo[]
  records: ReadonlyMap<string, FileRecord>
  settings: TaxonomySettings
  contentDir: string
  termPages: ReadonlyMap<string, string>
  eol: '\n' | '\r\n'
  onFilesChanged(paths: string[]): Promise<void>
  onOpen(path: string): void
}

type Sort = 'name' | 'count'

const collator = new Intl.Collator('tr')

function matches(term: string, query: string): boolean {
  if (turkishLower(term).includes(turkishLower(query))) return true
  const slug = slugify(query)
  return slug !== '' && slugify(term).includes(slug)
}

/** Terms of one taxonomy: list, detail, similar terms and the rename/merge/delete flow. */
export function TaxonomyPanel({ taxonomy, terms, records, settings, contentDir, termPages, eol, onFilesChanged, onOpen }: Props) {
  const { t } = useTranslation()
  const tabsId = useId()
  const [tab, setTab] = useState<'terms' | 'similar'>('terms')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [checked, setChecked] = useState<string[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [request, setRequest] = useState<ChangeRequest | null>(null)

  const counts = useMemo(() => new Map(terms.map((term) => [term.name, term.posts.length])), [terms])
  const groups = useMemo(
    () => findNearDuplicates(terms.map((term) => ({ name: term.name, count: term.posts.length, segment: term.segment }))),
    [terms],
  )
  const visible = useMemo(() => {
    const q = query.trim()
    const list = q === '' ? [...terms] : terms.filter((term) => matches(term.name, q))
    if (sort === 'count') list.sort((a, b) => b.posts.length - a.posts.length || collator.compare(a.name, b.name))
    return list
  }, [terms, query, sort])

  const selected = checked.filter((name) => counts.has(name))
  const currentTerm = terms.find((term) => term.name === current) ?? null
  const example = `${taxonomy.plural}: ["…"]`

  const toggle = (name: string, on: boolean) =>
    setChecked((list) => (on ? [...list.filter((x) => x !== name), name] : list.filter((x) => x !== name)))

  const openMerge = (group: DuplicateGroup) => setRequest({ kind: 'rename', terms: group.terms, target: group.suggested })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <div role="tablist" aria-label={taxonomy.plural} className="flex gap-1">
          {(['terms', 'similar'] as const).map((name) => (
            <button
              key={name}
              role="tab"
              id={`${tabsId}-${name}`}
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                tab === name ? 'border-sky-600 font-medium' : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              {name === 'terms' ? t('taxonomies.tabTerms') : t('taxonomies.tabSimilar')}
              <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-700">
                {name === 'terms' ? terms.length : groups.length}
              </span>
            </button>
          ))}
        </div>
        {!listPageEnabled(settings) && (
          <p className="text-xs text-zinc-500">{t('taxonomies.listPageDisabled', { url: `/${termSegment(taxonomy.plural, settings)}/` })}</p>
        )}
      </div>

      {terms.length === 0 ? (
        <div className="space-y-1 p-6 text-sm">
          <p className="font-medium">{t('taxonomies.noTerms')}</p>
          <p className="text-zinc-600 dark:text-zinc-400">
            {t('taxonomies.noTermsHint', { example })}
          </p>
        </div>
      ) : tab === 'similar' ? (
        <div role="tabpanel" aria-labelledby={`${tabsId}-similar`} className="min-h-0 flex-1 overflow-auto">
          <SimilarTerms groups={groups} counts={counts} onMerge={openMerge} />
        </div>
      ) : (
        <div role="tabpanel" aria-labelledby={`${tabsId}-terms`} className="grid min-h-0 flex-1 grid-cols-[minmax(15rem,22rem)_1fr]">
          <div className="flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
            <div className="flex gap-2 p-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('taxonomies.search')}
                aria-label={t('taxonomies.search')}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                aria-label={t('taxonomies.sort')}
                className="rounded-md border border-zinc-300 bg-white px-1 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="name">{t('taxonomies.sortName')}</option>
                <option value="count">{t('taxonomies.sortCount')}</option>
              </select>
            </div>

            {selected.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-y border-zinc-200 bg-sky-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-sky-950/40">
                <span className="mr-auto font-medium">{t('taxonomies.selected', { count: selected.length })}</span>
                {selected.length === 1 ? (
                  <button className="btn" onClick={() => setRequest({ kind: 'rename', terms: selected })}>
                    {t('taxonomies.rename')}
                  </button>
                ) : (
                  <button className="btn" onClick={() => setRequest({ kind: 'rename', terms: selected })}>
                    {t('taxonomies.merge')}
                  </button>
                )}
                <button className="btn" onClick={() => setRequest({ kind: 'delete', terms: selected })}>
                  {t('taxonomies.delete')}
                </button>
                <button className="text-xs text-zinc-600 hover:underline dark:text-zinc-400" onClick={() => setChecked([])}>
                  {t('taxonomies.clearSelection')}
                </button>
              </div>
            )}

            <ul className="min-h-0 flex-1 overflow-auto py-1" aria-label={t('taxonomies.tabTerms')}>
              {visible.map((term) => (
                <li
                  key={term.name}
                  className={`flex items-center gap-2 px-3 ${current === term.name ? 'bg-sky-100 dark:bg-sky-900/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(term.name)}
                    onChange={(e) => toggle(term.name, e.target.checked)}
                    aria-label={t('taxonomies.selectTerm', { term: term.name })}
                  />
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm"
                    aria-current={current === term.name ? 'true' : undefined}
                    onClick={() => setCurrent(term.name)}
                  >
                    <span className="min-w-0 flex-1 truncate">{term.name}</span>
                    <span className="text-xs text-zinc-500 tabular-nums">{term.posts.length}</span>
                  </button>
                </li>
              ))}
              {visible.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">{t('taxonomies.noMatch', { query })}</li>}
            </ul>
          </div>

          <div className="min-h-0 overflow-auto">
            {currentTerm ? (
              <TermDetail
                key={currentTerm.name}
                term={currentTerm}
                taxonomy={taxonomy}
                settings={settings}
                sameUrlTerms={terms.filter((x) => x.segment === currentTerm.segment && x.name !== currentTerm.name).map((x) => x.name)}
                pagePath={termPages.get(currentTerm.segment) ?? null}
                newPagePath={termPagePath(contentDir, taxonomy.plural, currentTerm.segment)}
                eol={eol}
                onRename={() => setRequest({ kind: 'rename', terms: [currentTerm.name] })}
                onDelete={() => setRequest({ kind: 'delete', terms: [currentTerm.name] })}
                onOpen={onOpen}
                onSaved={(path) => onFilesChanged([path])}
              />
            ) : (
              <p className="p-6 text-sm text-zinc-500">{t('taxonomies.chooseTerm')}</p>
            )}
          </div>
        </div>
      )}

      {request && (
        <TermChangeDialog
          request={request}
          taxonomy={taxonomy}
          terms={terms}
          records={records}
          settings={settings}
          contentDir={contentDir}
          termPages={termPages}
          onClose={() => setRequest(null)}
          onFilesChanged={async (paths) => {
            setChecked([])
            await onFilesChanged(paths)
          }}
          onRenamed={(term) => setCurrent(term)}
        />
      )}
    </div>
  )
}
