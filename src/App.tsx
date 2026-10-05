import { confirm, open } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from './components/ErrorNote'
import { DashboardView } from './features/dashboard/DashboardView'
import { DocumentPane } from './features/document/DocumentPane'
import { NoDocument } from './features/document/NoDocument'
import { clearShortcodeUnlocks } from './features/editor'
import { HealthView } from './features/health/HealthView'
import { HugoView } from './features/hugo/HugoView'
import { MediaView } from './features/media/MediaView'
import { NewPostDialog } from './features/newpost/NewPostDialog'
import { CommandPalette, type PaletteAction } from './features/palette/CommandPalette'
import { PreferencesDialog } from './features/preferences/PreferencesDialog'
import { UpdateBanner } from './features/updates/UpdateBanner'
import { checkForUpdate, loadCheckAtStartup, type Update } from './features/updates/updates'
import { PreviewPane } from './features/preview/PreviewPane'
import { usePreviewServer } from './features/preview/usePreviewServer'
import { PagesView } from './features/pages'
import { PublishView } from './features/publish/PublishView'
import { SettingsView } from './features/settings/SettingsView'
import { applyBulk, type BulkAction } from './features/site/bulk'
import { ContentList } from './features/site/ContentList'
import { SiteContext, type SiteContextValue, type View } from './features/site/SiteContext'
import { TaxonomiesView } from './features/taxonomies/TaxonomiesView'
import { ThemeView } from './features/theme/ThemeView'
import { languagesFromConfig } from './features/translations/model'
import { TranslationsView } from './features/translations/TranslationsView'
import { Welcome } from './features/welcome/Welcome'
import { languages, setLanguage, type Language } from './i18n'
import { api, previewUrl, type ContentFile, type HugoInfo, type PageEntry, type ServerOptions, type SiteInfo } from './lib/api'
import { forgetSite, loadRecentSites, rememberSite, type RecentSite } from './lib/recentSites'

const VIEWS: View[] = ['dashboard', 'content', 'pages', 'translations', 'taxonomies', 'media', 'settings', 'theme', 'health', 'publish', 'hugo']

export default function App() {
  const { t, i18n } = useTranslation()
  const [hugo, setHugo] = useState<HugoInfo | null | 'checking'>('checking')
  const [hugoError, setHugoError] = useState<unknown>(null)
  const [site, setSite] = useState<SiteInfo | null>(null)
  const [files, setFiles] = useState<ContentFile[]>([])
  const [pages, setPages] = useState<PageEntry[]>([])
  // When the page list was read: drafts, scheduled and expired posts are judged against it.
  const [pagesAt, setPagesAt] = useState(() => new Date().toISOString())
  const [selected, setSelected] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState<View>('content')
  const [newPost, setNewPost] = useState(false)
  const [palette, setPalette] = useState(false)
  const [preferences, setPreferences] = useState(false)
  const [configVersion, setConfigVersion] = useState(0)
  const [startupError, setStartupError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [recent, setRecent] = useState<RecentSite[]>([])
  const [update, setUpdate] = useState<Update | null>(null)
  // The Translations view is only offered for sites with more than one language.
  const [multilingual, setMultilingual] = useState(false)
  const [taxonomies, setTaxonomies] = useState<string[]>(['tags', 'categories'])
  // Bumped to make the open document re-read its file (after a bulk edit changed it).
  const [docReload, setDocReload] = useState(0)
  // A post just made with "New post": it opens with the cursor where writing starts.
  const [freshPath, setFreshPath] = useState<string | null>(null)
  const server = usePreviewServer()
  const [previewOptions, setPreviewOptions] = useState<ServerOptions>({ drafts: true, future: false })
  const labels = useMemo(() => alertLabels(t), [t])

  const detectHugo = useCallback(async () => {
    try {
      setHugo(await api.hugoDetect())
      setHugoError(null)
    } catch (error) {
      setHugo(null)
      setHugoError(error)
    }
  }, [])

  useEffect(() => {
    // Fetch on mount; state only changes after the command resolves.
    // oxlint-disable-next-line react/set-state-in-effect
    void detectHugo()
    void loadRecentSites().then(setRecent)
  }, [detectHugo])

  function retryHugo() {
    setHugo('checking')
    void detectHugo()
  }

  const loadFiles = useCallback(async () => {
    setFiles(await api.listContent())
  }, [])

  const loadPages = useCallback(async () => {
    // Permalinks come from Hugo itself; without Hugo the preview simply shows the home page.
    const list = await api.listPages().catch(() => [])
    setPagesAt(new Date().toISOString())
    setPages(list)
  }, [])

  const activate = useCallback(
    async (info: SiteInfo) => {
      setSite(info)
      setSelected(null)
      setDirty(false)
      setView('dashboard')
      setRecent(await rememberSite(info.root, info.name))
      await loadFiles()
      void loadPages()
    },
    [loadFiles, loadPages],
  )

  useEffect(() => {
    // Looks for a newer release once per start, unless turned off in Preferences. Dev builds skip it.
    if (import.meta.env.DEV) return
    void (async () => {
      if (!(await loadCheckAtStartup())) return
      setUpdate(await checkForUpdate().catch(() => null))
    })()
  }, [])

  useEffect(() => {
    // `hugo-publisher <folder>` opens that site right away.
    void (async () => {
      const path = await api.startupSite().catch(() => null)
      if (!path) return
      try {
        await activate(await api.siteOpen(path))
      } catch (error) {
        setStartupError(error)
      }
    })()
  }, [activate])

  async function openSite(path: string) {
    await activate(await api.siteOpen(path))
  }

  const closeSite = useCallback(async () => {
    if (dirty && !(await confirm(t('document.discardChanges')))) return false
    await server.stop()
    clearShortcodeUnlocks()
    setSite(null)
    setFiles([])
    setPages([])
    setSelected(null)
    setDirty(false)
    return true
  }, [dirty, server, t])

  const switchSite = useCallback(
    async (path: string) => {
      if (!(await closeSite())) return
      try {
        await activate(await api.siteOpen(path))
      } catch (error) {
        setStartupError(error)
      }
    },
    [activate, closeSite],
  )

  const select = useCallback(
    async (path: string) => {
      if (path === selected) return
      if (dirty && !(await confirm(t('document.discardChanges')))) return
      setDirty(false)
      setSelected(path)
    },
    [dirty, selected, t],
  )

  async function deleteContent(path: string) {
    const title = files.find((f) => f.path === path)?.title ?? path
    if (!(await confirm(t('site.deleteConfirm', { title }), { kind: 'warning' }))) return
    setActionError(null)
    try {
      await api.siteDelete(bundleOrFile(path))
      if (selected === path) {
        setSelected(null)
        setDirty(false)
      }
      await loadFiles()
      void loadPages()
    } catch (error) {
      setActionError(error)
    }
  }

  async function bulk(paths: string[], action: BulkAction | { kind: 'delete' }) {
    setActionError(null)
    if (action.kind === 'delete' && !(await confirm(t('site.bulkDeleteConfirm', { count: paths.length }), { kind: 'warning' }))) return
    const failed: string[] = []
    for (const path of paths) {
      try {
        if (action.kind === 'delete') {
          await api.siteDelete(bundleOrFile(path))
          if (path === selected) {
            setSelected(null)
            setDirty(false)
          }
          continue
        }
        // Never overwrite edits that are still open in the editor.
        if (path === selected && dirty) {
          failed.push(`${path}: ${t('site.bulkSkippedOpen')}`)
          continue
        }
        const file = await api.readText(path)
        const result = await applyBulk(file.text, action, {
          edit: api.tomlEditText,
          parse: async (text) => (await api.tomlParseText(text)).values,
        })
        if (result.skipped === 'json') failed.push(`${path}: ${t('site.bulkSkippedJson')}`)
        if (!result.skipped) await api.writeText(path, result.text, file.version)
      } catch (error) {
        failed.push(`${path}: ${errorText(error)}`)
      }
    }
    if (selected && paths.includes(selected)) setDocReload((n) => n + 1)
    if (failed.length > 0) setActionError(new Error([t('site.bulkFailed'), ...failed].join('\n')))
    await loadFiles()
    void loadPages()
  }

  const handleSaved = useCallback(
    (path: string) => {
      // A new file or a changed title needs fresh listings; Hugo reloads the preview by itself.
      void loadFiles()
      if (!pages.some((p) => p.path === path)) void loadPages()
    },
    [loadFiles, loadPages, pages],
  )

  const pageUrl = useMemo(() => {
    if (server.state.status !== 'running') return null
    const page = pages.find((p) => p.path === selected)
    return page ? previewUrl(server.state.url, page.permalink) : server.state.url
  }, [server.state, pages, selected])

  // A page created or renamed a moment ago exists only after Hugo's next rebuild: keep showing
  // the previous page until the new address answers, instead of flashing a 404.
  const [readyUrl, setReadyUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!pageUrl) return
    let cancelled = false
    void (async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        try {
          await api.fetchPreview(pageUrl)
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
      }
      if (!cancelled) setReadyUrl(pageUrl)
    })()
    return () => {
      cancelled = true
    }
  }, [pageUrl])
  // A ready address from an earlier server (another port) is no use.
  const shownUrl = pageUrl && readyUrl && sameOrigin(readyUrl, pageUrl) ? readyUrl : pageUrl

  const openFile = useCallback(
    (path: string) => {
      setView('content')
      void select(path)
    },
    [select],
  )

  const context = useMemo<SiteContextValue | null>(
    () =>
      site && {
        site,
        hugo: hugo === 'checking' ? null : hugo,
        files,
        pages,
        pagesAt,
        reloadFiles: loadFiles,
        reloadPages: loadPages,
        refreshHugo: detectHugo,
        openFile,
        showView: setView,
        configVersion,
        notifyConfigChanged: () => {
          setConfigVersion((v) => v + 1)
          void loadPages()
          // Config files may have been added or moved (e.g. split into config/_default/).
          void api
            .siteRefresh()
            .then((info) => setSite((current) => (JSON.stringify(current) === JSON.stringify(info) ? current : info)))
            .catch(() => {})
        },
      },
    [site, hugo, files, pages, pagesAt, loadFiles, loadPages, detectHugo, openFile, configVersion],
  )

  useEffect(() => {
    if (!site) return
    let cancelled = false
    api
      .configEffective()
      .then((config) => {
        if (cancelled) return
        setMultilingual(languagesFromConfig(config.values).languages.length > 1)
        const map = config.values.taxonomies as Record<string, string> | undefined
        setTaxonomies(map ? Object.values(map).map(String) : ['tags', 'categories'])
      })
      .catch(() => !cancelled && setMultilingual(false))
    return () => {
      cancelled = true
    }
  }, [site, configVersion])

  const views = useMemo(() => VIEWS.filter((v) => v !== 'translations' || multilingual), [multilingual])

  // Ctrl/Cmd+K opens the command palette while a site is open.
  useEffect(() => {
    if (!site) return
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [site])

  const paletteActions = useMemo<PaletteAction[]>(() => {
    if (!site) return []
    const otherLanguage = i18n.resolvedLanguage === 'tr' ? 'en' : 'tr'
    const actions: PaletteAction[] = [
      { id: 'new-post', label: t('palette.newPost'), run: () => setNewPost(true) },
      server.state.status === 'running'
        ? { id: 'stop-preview', label: t('palette.stopPreview'), run: () => void server.stop() }
        : { id: 'start-preview', label: t('palette.startPreview'), run: () => void server.start(previewOptions).then(loadPages) },
      ...views.map((v) => ({
        id: `view-${v}`,
        label: t('palette.goTo', { view: t(`nav.${v}`) }),
        run: () => setView(v),
      })),
      ...files.map((file) => ({
        id: `file-${file.path}`,
        label: file.title || file.path.split('/').pop() || file.path,
        hint: file.path.replace(/^content\//, ''),
        run: () => openFile(file.path),
      })),
      ...recent
        .filter((r) => r.path !== site.root)
        .map((r) => ({ id: `site-${r.path}`, label: `${t('palette.switchSite')}: ${r.name}`, hint: r.path, run: () => void switchSite(r.path) })),
      {
        id: 'open-site',
        label: t('palette.openSite'),
        run: () =>
          void open({ directory: true, multiple: false, title: t('welcome.chooseFolder') }).then((path) => {
            if (typeof path === 'string') void switchSite(path)
          }),
      },
      { id: 'close-site', label: t('palette.closeSite'), run: () => void closeSite() },
      { id: 'preferences', label: t('preferences.open'), run: () => setPreferences(true) },
      {
        id: 'language',
        label: t('palette.language', { language: otherLanguage.toUpperCase() }),
        run: () => setLanguage(otherLanguage),
      },
    ]
    return actions
  }, [site, views, files, recent, server, previewOptions, t, i18n.resolvedLanguage, loadPages, openFile, switchSite, closeSite])

  const languagePicker = (
    <label className="flex items-center gap-1 text-xs text-zinc-500">
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => setLanguage(e.target.value as Language)}
        className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
      >
        {languages.map((language) => (
          <option key={language} value={language}>
            {language.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  )

  const { start: startServer, state: serverState } = server
  // Opening the preview means the writer wants to see it: start Hugo unless it already runs.
  const openPreview = useCallback(() => {
    if (serverState.status === 'stopped') void startServer(previewOptions).then(loadPages)
  }, [serverState.status, startServer, previewOptions, loadPages])
  const clearFresh = useCallback(() => setFreshPath(null), [])

  const previewPane = (
    <PreviewPane
      embedded
      state={server.state}
      pageUrl={shownUrl}
      logs={server.logs}
      options={previewOptions}
      onOptionsChange={setPreviewOptions}
      onStart={(options) => void server.start(options).then(loadPages)}
      onStop={() => void server.stop()}
      onClearLogs={server.clearLogs}
    />
  )

  if (!site || !context) {
    return (
      <div className="relative h-full">
        <div className="absolute top-3 right-3">{languagePicker}</div>
        {update && <UpdateBanner update={update} dirty={false} onDismiss={() => setUpdate(null)} />}
        <Welcome
          hugo={hugo}
          hugoError={hugoError}
          openError={startupError}
          recent={recent}
          onRetryHugo={retryHugo}
          onOpen={openSite}
          onForget={(path) => void forgetSite(path).then(setRecent)}
        />
      </div>
    )
  }

  return (
    <SiteContext.Provider value={context}>
      <div className="grid h-full grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <details className="group relative">
                  <summary className="cursor-pointer list-none truncate font-semibold" title={t('site.switchSite')}>
                    {site.name} <span className="text-xs text-zinc-400">▾</span>
                  </summary>
                  <ul className="absolute left-0 z-30 mt-1 max-h-80 w-64 overflow-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    {recent
                      .filter((r) => r.path.toLowerCase() !== site.root.toLowerCase())
                      .map((r) => (
                        <li key={r.path}>
                          <button
                            className="w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title={r.path}
                            onClick={(event) => {
                              event.currentTarget.closest('details')?.removeAttribute('open')
                              void switchSite(r.path)
                            }}
                          >
                            <span className="block truncate">{r.name}</span>
                            <span className="block truncate font-mono text-[11px] text-zinc-500">{r.path}</span>
                          </button>
                        </li>
                      ))}
                    <li>
                      <button
                        className="w-full rounded px-2 py-1 text-left text-sky-700 hover:bg-zinc-100 dark:text-sky-400 dark:hover:bg-zinc-800"
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open')
                          void closeSite()
                        }}
                      >
                        {t('site.otherSites')}
                      </button>
                    </li>
                  </ul>
                </details>
                <p className="truncate font-mono text-[11px] text-zinc-500" title={site.root}>
                  {site.root}
                </p>
              </div>
              {languagePicker}
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <button className="hover:underline" onClick={() => void closeSite()}>
                {t('site.closeSite')}
              </button>
              <button className="hover:underline" onClick={() => setPreferences(true)}>
                {t('preferences.open')}
              </button>
              <button className="hover:underline" onClick={() => setPalette(true)} title="Ctrl+K">
                {t('palette.title')} <kbd className="font-mono">Ctrl K</kbd>
              </button>
            </div>
          </div>

          <nav className="flex flex-col gap-0.5 border-b border-zinc-200 p-2 dark:border-zinc-800" aria-label={site.name}>
            {views.map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-current={view === v ? 'page' : undefined}
                className={`rounded-md px-2 py-1.5 text-left text-sm ${
                  view === v ? 'bg-sky-100 font-medium dark:bg-sky-900/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {t(`nav.${v}`)}
              </button>
            ))}
          </nav>

          {view === 'content' && (
            <>
              <div className="px-3 pt-3">
                <button className="btn btn-primary w-full justify-center" onClick={() => setNewPost(true)}>
                  {t('site.newPost')}
                </button>
              </div>
              {actionError !== null && (
                <div className="px-3 pt-2">
                  <ErrorNote error={actionError} />
                </div>
              )}
              <ContentList
                now={pagesAt}
                files={files}
                pages={pages}
                taxonomies={taxonomies}
                selected={selected}
                onSelect={(p) => void select(p)}
                onDelete={(p) => void deleteContent(p)}
                onBulk={bulk}
                onReload={() => void loadFiles()}
              />
            </>
          )}
        </aside>

        {view === 'content' ? (
          <main className="min-h-0 min-w-0">
            {selected ? (
              <DocumentPane
                key={`${selected}:${docReload}`}
                path={selected}
                alertLabels={labels}
                onDirtyChange={setDirty}
                onSaved={handleSaved}
                preview={previewPane}
                onPreviewOpen={openPreview}
                fresh={freshPath === selected}
                onFreshHandled={clearFresh}
              />
            ) : (
              <NoDocument preview={previewPane} onPreviewOpen={openPreview} />
            )}
          </main>
        ) : (
          <main className="min-h-0 min-w-0 overflow-auto">
            {view === 'dashboard' && <DashboardView />}
            {view === 'pages' && <PagesView />}
            {view === 'translations' && <TranslationsView />}
            {view === 'settings' && <SettingsView />}
            {view === 'theme' && <ThemeView />}
            {view === 'publish' && <PublishView />}
            {view === 'taxonomies' && <TaxonomiesView />}
            {view === 'media' && <MediaView />}
            {view === 'health' && <HealthView />}
            {view === 'hugo' && <HugoView />}
          </main>
        )}

        {newPost && (
          <NewPostDialog
            onClose={() => setNewPost(false)}
            onCreated={(path) => {
              setNewPost(false)
              setFreshPath(path)
              void loadFiles()
              void loadPages()
              setView('content')
              void select(path)
            }}
          />
        )}
        {palette && <CommandPalette actions={paletteActions} onClose={() => setPalette(false)} />}
        {preferences && <PreferencesDialog onClose={() => setPreferences(false)} onUpdateFound={setUpdate} />}
        {update && <UpdateBanner update={update} dirty={dirty} onDismiss={() => setUpdate(null)} />}
      </div>
    </SiteContext.Provider>
  )
}

/** What to delete for a content file: a page bundle (`x/index.md`) goes as a whole folder. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function bundleOrFile(path: string): string {
  return /\/(index|_index)\.[^/]+$/.test(path) ? path.replace(/\/[^/]+$/, '') : path
}

function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

function alertLabels(t: (key: string) => string) {
  return {
    note: t('alerts.note'),
    tip: t('alerts.tip'),
    important: t('alerts.important'),
    warning: t('alerts.warning'),
    caution: t('alerts.caution'),
  }
}
