import { save } from '@tauri-apps/plugin-dialog'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, type GitStatus, type HugoMessage } from '../../lib/api'
import { useSite } from '../site/SiteContext'
import { backupFileName, countPages, recentlyEdited } from './summary'

/** The first screen after opening a site: what is there, what is pending, what needs attention. */
export function DashboardView() {
  const { t, i18n } = useTranslation()
  const { site, hugo, files, pages, pagesAt: now, openFile, showView, configVersion } = useSite()
  const [git, setGit] = useState<GitStatus | null | 'error'>(null)
  const [warnings, setWarnings] = useState<HugoMessage[] | null>(null)
  const [backup, setBackup] = useState<{ path: string; files: number } | null>(null)
  const [backupError, setBackupError] = useState<unknown>(null)
  const [backingUp, setBackingUp] = useState(false)

  const counts = useMemo(() => countPages(pages, now), [pages, now])
  const recent = useMemo(() => recentlyEdited(files), [files])
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.resolvedLanguage],
  )

  useEffect(() => {
    let cancelled = false
    api
      .gitStatus()
      .then((status) => !cancelled && setGit(status))
      .catch(() => !cancelled && setGit('error'))
    api
      .configEffective()
      .then((config) => !cancelled && setWarnings(config.messages.filter((m) => m.level !== 'info')))
      .catch(() => !cancelled && setWarnings([]))
    return () => {
      cancelled = true
    }
  }, [configVersion])

  async function runBackup() {
    setBackupError(null)
    const destination = await save({
      title: t('dashboard.backupTitle'),
      defaultPath: backupFileName(site.name, new Date()),
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    })
    if (!destination) return
    setBackingUp(true)
    try {
      setBackup(await api.siteBackup(destination))
    } catch (error) {
      setBackupError(error)
    } finally {
      setBackingUp(false)
    }
  }

  const changes = git && git !== 'error' && git.isRepo ? git.files.length : null

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{site.name}</h1>
        <p className="font-mono text-xs text-zinc-500">{site.root}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-4" aria-label={t('dashboard.pages')}>
        {(
          [
            ['published', counts.published, 'text-emerald-700 dark:text-emerald-400'],
            ['drafts', counts.drafts, 'text-amber-700 dark:text-amber-400'],
            ['scheduled', counts.scheduled, 'text-sky-700 dark:text-sky-400'],
            ['expired', counts.expired, 'text-zinc-500'],
          ] as const
        ).map(([key, value, colour]) => (
          <div key={key} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className={`text-3xl font-semibold ${colour}`}>{value}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t(`dashboard.${key}`)}</p>
          </div>
        ))}
      </section>
      {counts.scheduled > 0 && <p className="text-sm text-sky-800 dark:text-sky-300">{t('dashboard.scheduledNote')}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t('dashboard.recent')}</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-zinc-500">{t('site.noContent')}</p>
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {recent.map((file) => (
                <li key={file.path}>
                  <button className="block w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => openFile(file.path)}>
                    <span className="block truncate text-sm">{file.title || file.path}</span>
                    <span className="block text-xs text-zinc-500">{dateFormat.format(file.modifiedMs)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('dashboard.publishing')}</h2>
            <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              {git === null ? (
                <p className="text-zinc-500">{t('common.loading')}</p>
              ) : git === 'error' || !git.isRepo ? (
                <p>{t('dashboard.noGit')}</p>
              ) : (
                <>
                  <p>
                    {t('dashboard.branch', { branch: git.branch ?? '—' })}
                    {git.upstream && ` · ${t('dashboard.aheadBehind', { ahead: git.ahead, behind: git.behind })}`}
                  </p>
                  <p>{changes ? t('dashboard.changes', { count: changes }) : t('dashboard.clean')}</p>
                </>
              )}
              <button className="btn" onClick={() => showView('publish')}>
                {t('dashboard.goPublish')}
              </button>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('dashboard.attention')}</h2>
            <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p>
                {hugo
                  ? t('dashboard.hugo', { version: `${hugo.version.major}.${hugo.version.minor}.${hugo.version.patch}` })
                  : t('welcome.hugoMissing')}
              </p>
              {warnings === null ? (
                <p className="text-zinc-500">{t('common.loading')}</p>
              ) : warnings.length === 0 ? (
                <p className="text-emerald-700 dark:text-emerald-400">✓ {t('dashboard.noWarnings')}</p>
              ) : (
                <>
                  <p className="text-amber-800 dark:text-amber-300">{t('dashboard.warnings', { count: warnings.length })}</p>
                  <ul className="max-h-32 space-y-1 overflow-auto font-mono text-xs text-zinc-600 dark:text-zinc-400">
                    {warnings.slice(0, 5).map((w, i) => (
                      <li key={i}>{w.text}</li>
                    ))}
                  </ul>
                  <button className="btn" onClick={() => showView('settings')}>
                    {t('dashboard.goSettings')}
                  </button>
                </>
              )}
              <button className="btn" onClick={() => showView('health')}>
                {t('dashboard.goHealth')}
              </button>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('dashboard.backup')}</h2>
            <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-zinc-600 dark:text-zinc-400">{t('dashboard.backupIntro')}</p>
              <button className="btn" disabled={backingUp} onClick={() => void runBackup()}>
                {backingUp ? t('common.saving') : t('dashboard.backupNow')}
              </button>
              {backup && <p className="text-emerald-700 dark:text-emerald-400">{t('dashboard.backupDone', { path: backup.path, count: backup.files })}</p>}
              {backupError !== null && <ErrorNote error={backupError} />}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
