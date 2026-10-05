import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { indexFrontMatter } from '../document/termIndex'
import { FileChangesDialog } from '../settings/components/FileChangesDialog'
import { BADGE, INPUT, LINK_BUTTON, NOTE } from '../settings/components/styles'
import { useConfigSources } from '../settings/hooks/useConfigSources'
import { useEffectiveConfig } from '../settings/hooks/useEffectiveConfig'
import { frontMatterChange } from '../settings/hooks/usePageMenus'
import { findMenus } from '../settings/model/menus'
import { addPageMenuOps, pageMenuEntries } from '../settings/model/pageMenus'
import { mergedFiles, urlConfigOf } from '../settings/model/urlConfig'
import type { Tree } from '../settings/model/values'
import { useSite } from '../site/SiteContext'
import { nextMenuWeight, standalonePages, type ConfigMenu, type StandalonePage } from './model'

interface Adding {
  page: StandalonePage
  menu: string
}

/** Standalone pages (About, sections, home…) with their menus, a link to the editor and "add to menu". */
export function PagesView() {
  const { t } = useTranslation()
  const { site, files, pages, hugo, openFile, reloadFiles, reloadPages } = useSite()
  const config = useConfigSources()
  // `hugo config` adds what the files do not say: theme settings, content mounts.
  const effective = useEffectiveConfig(null, hugo !== null, 0).effective?.values ?? null
  const [frontMatter, setFrontMatter] = useState<ReadonlyMap<string, Tree | null> | null>(null)
  const [query, setQuery] = useState('')
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState<Adding | null>(null)

  useEffect(() => {
    let cancelled = false
    void indexFrontMatter(site.root, files).then((index) => {
      if (!cancelled) setFrontMatter(index)
    })
    return () => {
      cancelled = true
    }
  }, [files, site.root])

  const configMenus = useMemo<ConfigMenu[]>(
    () => findMenus(config.sources, null).filter((m) => !m.overridden).map((m) => ({ name: m.name, lang: m.lang, entries: m.entries })),
    [config.sources],
  )
  // Languages and their content folders (`languages.<lang>.contentDir`, content mounts).
  const urlConfig = useMemo(
    () => urlConfigOf(mergedFiles(config.sources, null), effective, hugo?.version ?? null, site.root),
    [config.sources, effective, hugo, site.root],
  )

  const list = useMemo(
    () => (frontMatter ? standalonePages({ files, pages, frontMatter, configMenus, contentDir: site.contentDir, config: urlConfig }) : []),
    [configMenus, files, frontMatter, pages, site.contentDir, urlConfig],
  )
  const menuNames = useMemo(() => {
    const names = new Map<string, string>([['main', 'main']])
    for (const m of configMenus) names.set(m.name.toLowerCase(), m.name)
    for (const [path, values] of frontMatter ?? []) for (const e of pageMenuEntries(path, values)) names.set(e.menu.toLowerCase(), e.menu)
    return [...names.values()].sort()
  }, [configMenus, frontMatter])

  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const shown = list.filter((p) => terms.every((term) => `${p.title} ${p.path}`.toLocaleLowerCase().includes(term)))

  function pageWeights(menu: string): number[] {
    const out: number[] = []
    for (const [path, values] of frontMatter ?? []) {
      for (const e of pageMenuEntries(path, values)) if (e.menu.toLowerCase() === menu.toLowerCase()) out.push(Number(e.values.weight))
    }
    return out
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-1 px-4 pt-3 pb-2">
        <h1 className="text-lg font-semibold">{t('pages.title')}</h1>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{t('pages.intro')}</p>
      </header>
      <div className="border-b border-zinc-200 px-4 pb-2 dark:border-zinc-800">
        <input type="search" aria-label={t('pages.search')} placeholder={t('pages.search')} className={`${INPUT} w-72`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {frontMatter === null && <p className="text-sm text-zinc-500">{t('pages.loading')}</p>}
        {frontMatter !== null && list.length === 0 && <p className={NOTE}>{t('pages.none')}</p>}
        {list.length > 0 && shown.length === 0 && <p className="text-sm text-zinc-500">{t('pages.noMatch')}</p>}
        {shown.length > 0 && (
          <table className="w-full table-fixed text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-medium">{t('pages.columns.page')}</th>
                <th className="w-1/4 py-1 font-medium">{t('pages.columns.menus')}</th>
                <th className="w-72 py-1 font-medium">{t('pages.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((page) => {
                const inMenus = new Set(page.menus.map((m) => m.menu.toLowerCase()))
                const menu = choice[page.path] ?? menuNames.find((m) => !inMenus.has(m.toLowerCase())) ?? menuNames[0]
                const already = inMenus.has(menu.toLowerCase())
                return (
                  <tr key={page.path} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{page.title}</span>
                        {page.lang && <span className={`${BADGE} bg-sky-100 font-mono text-sky-800 dark:bg-sky-950 dark:text-sky-300`}>{page.lang}</span>}
                        <span className={`${BADGE} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>{t(`pages.reason.${page.reason}`)}</span>
                        {page.draft && <span className={`${BADGE} bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200`}>{t('pages.draft')}</span>}
                      </div>
                      <p className="truncate font-mono text-xs text-zinc-500" title={page.path}>
                        {page.path}
                        {page.url && <span className="ml-2 text-zinc-400">{page.url}</span>}
                      </p>
                      {(page.type || page.layout) && <p className="text-xs text-zinc-500">{t('pages.typeLayout', { type: page.type ?? '—', layout: page.layout ?? '—' })}</p>}
                    </td>
                    <td className="py-2 pr-3">
                      {page.menus.length === 0 ? (
                        <span className="text-xs text-zinc-400">{t('pages.notInMenu')}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {page.menus.map((m) => (
                            <span
                              key={`${m.from}:${m.menu}:${m.lang ?? ''}`}
                              title={m.from === 'page' ? t('pages.fromPage') : t('pages.fromConfig')}
                              className={`${BADGE} font-mono ${m.from === 'page' ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'}`}
                            >
                              {m.lang ? `${m.menu} (${m.lang})` : m.menu}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className={LINK_BUTTON} aria-label={t('pages.openPage', { title: page.title })} onClick={() => openFile(page.path)}>
                          {t('pages.open')}
                        </button>
                        <select
                          aria-label={t('pages.menuFor', { title: page.title })}
                          className={`${INPUT} py-1 text-xs`}
                          value={menu}
                          onChange={(e) => setChoice((c) => ({ ...c, [page.path]: e.target.value }))}
                        >
                          {menuNames.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn py-1 text-xs"
                          disabled={already}
                          title={already ? t('pages.alreadyIn') : undefined}
                          onClick={() => setAdding({ page, menu })}
                        >
                          {t('pages.addToMenu')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {adding && (
        <FileChangesDialog
          title={t('pages.addTitle', { title: adding.page.title, menu: adding.menu })}
          intro={t('pages.addIntro')}
          prepare={async () => {
            const weight = nextMenuWeight(adding.menu, configMenus, pageWeights(adding.menu))
            const change = await frontMatterChange(adding.page.path, (fm) => addPageMenuOps(fm, adding.menu, { weight }))
            return change ? [change] : []
          }}
          hugoAvailable={false}
          onClose={() => setAdding(null)}
          onWritten={() => {
            setAdding(null)
            void reloadFiles()
            void reloadPages()
          }}
        />
      )}
    </div>
  )
}
