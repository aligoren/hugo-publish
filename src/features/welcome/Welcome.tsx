import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, type HugoInfo } from '../../lib/api'
import type { RecentSite } from '../../lib/recentSites'
import { shortPath, timeAgo } from './display'
import { NewSiteDialog } from './NewSiteDialog'

interface Props {
  hugo: HugoInfo | null | 'checking'
  hugoError: unknown
  /** An error from opening a site passed on the command line. */
  openError?: unknown
  recent: RecentSite[]
  onRetryHugo(): void
  onOpen(path: string): Promise<void>
  onForget(path: string): void
}

export function Welcome({ hugo, hugoError, openError = null, recent, onRetryHugo, onOpen, onForget }: Props) {
  const { t, i18n } = useTranslation()
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const shownError = error !== null ? error : openError
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' })
  const [now] = useState(() => Date.now())

  // Sites whose folder was moved or deleted stay listed (to be removed by hand) but are marked.
  useEffect(() => {
    let current = true
    const paths = recent.map((site) => site.path)
    api
      .pathsExist(paths)
      .then((exist) => {
        if (current) setMissing(new Set(paths.filter((_, i) => exist[i] === false)))
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [recent])

  async function openPath(path: string) {
    setError(null)
    setBusy(true)
    try {
      await onOpen(path)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  async function chooseFolder() {
    const selected = await open({ directory: true, multiple: false, title: t('welcome.chooseFolder') })
    if (typeof selected === 'string') await openPath(selected)
  }

  return (
    <main className="flex h-full overflow-y-auto">
      <div className="m-auto grid w-full max-w-5xl gap-12 p-8 md:grid-cols-[minmax(0,1fr)_20rem] md:items-center">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-balance">{t('welcome.heading')}</h1>
            <p className="max-w-prose text-zinc-600 dark:text-zinc-400">{t('welcome.intro')}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary px-4 py-2 text-base" disabled={busy} onClick={() => void chooseFolder()}>
              {busy ? t('common.loading') : t('welcome.openSite')}
            </button>
            <button className="btn px-4 py-2 text-base" disabled={busy || !hugo || hugo === 'checking'} onClick={() => setCreating(true)}>
              {t('welcome.createSite')}
            </button>
          </div>
          {shownError !== null && <ErrorNote error={shownError} />}

          <div className="text-sm">
            {hugo === 'checking' ? (
              <p className="text-zinc-500">{t('welcome.hugoChecking')}</p>
            ) : hugo ? (
              <p
                className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
                title={hugo.path}
              >
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                {t('welcome.hugoFound', { version: `${hugo.version.major}.${hugo.version.minor}.${hugo.version.patch}` })}
                {hugo.version.extended && ` (${t('welcome.hugoExtended')})`}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="font-medium">{t('welcome.hugoMissing')}</p>
                <p className="text-zinc-600 dark:text-zinc-400">{t('welcome.hugoMissingHint')}</p>
                {hugoError !== null && <ErrorNote error={hugoError} />}
                <button className="btn" onClick={onRetryHugo}>
                  {t('common.retry')}
                </button>
              </div>
            )}
          </div>
        </div>

        <section
          className="min-w-0 rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900/60"
          aria-labelledby="recent-sites"
        >
          <h2 id="recent-sites" className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            {t('welcome.recent')}
          </h2>
          {recent.length === 0 ? (
            <p className="px-2 pb-2 text-sm text-zinc-500">{t('welcome.noRecent')}</p>
          ) : (
            <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
              {recent.map((site) => {
                const gone = missing.has(site.path)
                return (
                  <li key={site.path} className="group flex items-center">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      disabled={busy}
                      title={site.path}
                      onClick={() => void openPath(site.path)}
                    >
                      <span
                        className={`grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold uppercase ${
                          gone ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500' : 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                        }`}
                        aria-hidden
                      >
                        {site.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-sm font-medium ${gone ? 'text-zinc-500' : ''}`}>{site.name}</span>
                          <span className="shrink-0 text-[11px] text-zinc-500" title={dateFormat.format(site.openedMs)}>
                            {timeAgo(site.openedMs, now, i18n.resolvedLanguage)}
                          </span>
                        </span>
                        {gone ? (
                          <span className="block truncate text-xs text-amber-700 dark:text-amber-400">{t('welcome.missing')}</span>
                        ) : (
                          <span className="block truncate font-mono text-[11px] text-zinc-500">{shortPath(site.path)}</span>
                        )}
                      </span>
                    </button>
                    <button
                      className="ml-0.5 rounded px-1.5 py-1 text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-600 focus:opacity-100"
                      aria-label={t('welcome.forget', { name: site.name })}
                      title={t('welcome.forget', { name: site.name })}
                      onClick={() => onForget(site.path)}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {creating && (
        <NewSiteDialog
          onClose={() => setCreating(false)}
          onCreated={async (path) => {
            setCreating(false)
            await openPath(path)
          }}
        />
      )}
    </main>
  )
}
