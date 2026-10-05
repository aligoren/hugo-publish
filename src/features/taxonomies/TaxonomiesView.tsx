import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { useSite } from '../site/SiteContext'
import { buildTermIndex, isTaxonomyPage, preferredEol, type TermInfo } from './indexer'
import { TaxonomyPanel } from './TaxonomyPanel'
import { findTermPages } from './termPage'
import { useTaxonomyIndex } from './useTaxonomyIndex'

/** Categories, tags and any other taxonomy the site defines. */
export function TaxonomiesView() {
  const { t } = useTranslation()
  const { site, files, reloadFiles, openFile, showView } = useSite()
  const index = useTaxonomyIndex()
  const { settings, records, progress, invalidate } = index
  const [active, setActive] = useState<string | null>(null)
  const contentDir = site.contentDir

  const termsByTaxonomy = useMemo(() => {
    if (!settings || !records) return null
    const plurals = settings.taxonomies.map((taxonomy) => taxonomy.plural)
    const exclude = (path: string) => isTaxonomyPage(path, contentDir, plurals)
    const result = new Map<string, TermInfo[]>()
    for (const taxonomy of settings.taxonomies) {
      result.set(taxonomy.plural, buildTermIndex(records.values(), taxonomy.plural, settings, exclude))
    }
    return result
  }, [settings, records, contentDir])

  const pagesByTaxonomy = useMemo(() => {
    const result = new Map<string, Map<string, string>>()
    if (!settings) return result
    const paths = files.map((file) => file.path)
    for (const taxonomy of settings.taxonomies) {
      result.set(taxonomy.plural, findTermPages(paths, contentDir, taxonomy.plural, settings))
    }
    return result
  }, [settings, files, contentDir])

  const eol = useMemo(() => (records ? preferredEol(records.values()) : '\n'), [records])
  const unreadable = useMemo(() => (records ? [...records.values()].filter((record) => record.error !== null) : []), [records])

  const onFilesChanged = useCallback(
    async (paths: string[]) => {
      invalidate(paths)
      await reloadFiles()
    },
    [invalidate, reloadFiles],
  )

  const taxonomy = settings?.taxonomies.find((x) => x.plural === active) ?? settings?.taxonomies[0] ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-2 border-b border-zinc-200 px-4 pt-4 pb-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">{t('taxonomies.title')}</h1>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{t('taxonomies.intro')}</p>
        {progress && (
          <div className="max-w-md space-y-1" role="status">
            <p className="text-xs text-zinc-500">{t('taxonomies.indexing', { done: progress.done, total: progress.total })}</p>
            <progress className="h-1.5 w-full" max={Math.max(progress.total, 1)} value={progress.done} />
          </div>
        )}
        {index.hugoError !== null && <p className="text-xs text-amber-700 dark:text-amber-400">{t('taxonomies.hugoFallback')}</p>}
        {unreadable.length > 0 && (
          <details className="text-xs text-zinc-600 dark:text-zinc-400">
            <summary className="cursor-pointer text-amber-700 dark:text-amber-400">
              {t('taxonomies.unreadable', { count: unreadable.length })}
            </summary>
            <ul className="mt-1 space-y-0.5">
              {unreadable.map((record) => (
                <li key={record.path}>
                  <button className="font-mono hover:underline" onClick={() => openFile(record.path)}>
                    {record.path}
                  </button>
                  <span> · {record.error}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </header>

      {index.settingsError !== null && settings === null ? (
        <div className="p-4">
          <ErrorNote error={index.settingsError} />
        </div>
      ) : settings === null ? (
        <p className="p-6 text-sm text-zinc-500">{t('taxonomies.loadingSettings')}</p>
      ) : settings.taxonomies.length === 0 || taxonomy === null ? (
        <div className="max-w-2xl space-y-2 p-6 text-sm">
          <p className="font-medium">{t('taxonomies.noTaxonomies')}</p>
          <p className="text-zinc-600 dark:text-zinc-400">{t('taxonomies.noTaxonomiesHint')}</p>
          <button className="btn" onClick={() => showView('settings')}>
            {t('taxonomies.openSettings')}
          </button>
        </div>
      ) : (
        <>
          <nav className="flex flex-wrap gap-1 px-4 pt-3" aria-label={t('taxonomies.title')}>
            {settings.taxonomies.map((x) => {
              const count = termsByTaxonomy?.get(x.plural)?.length
              return (
                <button
                  key={x.plural}
                  aria-current={x.plural === taxonomy.plural ? 'page' : undefined}
                  onClick={() => setActive(x.plural)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    x.plural === taxonomy.plural ? 'bg-sky-100 font-medium dark:bg-sky-900/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {t(`taxonomies.names.${x.plural}`, { defaultValue: x.plural })}
                  {count !== undefined && <span className="ml-1.5 text-xs text-zinc-500">{count}</span>}
                </button>
              )
            })}
          </nav>
          {termsByTaxonomy && records ? (
            <TaxonomyPanel
              key={taxonomy.plural}
              taxonomy={taxonomy}
              terms={termsByTaxonomy.get(taxonomy.plural) ?? []}
              records={records}
              settings={settings}
              contentDir={contentDir}
              termPages={pagesByTaxonomy.get(taxonomy.plural) ?? new Map()}
              eol={eol}
              onFilesChanged={onFilesChanged}
              onOpen={openFile}
            />
          ) : (
            !progress && <p className="p-6 text-sm text-zinc-500">{t('common.loading')}</p>
          )}
        </>
      )}
    </div>
  )
}
