import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../../lib/api'
import { useSite } from '../site/SiteContext'
import {
  aggregateChecks,
  checkHost,
  liveUrlFor,
  pagesForFiles,
  titleMatches,
  extractTitle,
  urlsForBuiltFiles,
  type DeployOutcome,
} from './deploy'
import { deployApi, type DeployStatus, type ForgeKind } from './deployApi'
import { notifyInBackground } from './notify'
import { DEFAULT_TIMINGS, type TrackerTimings, type TrackTarget } from './tracking'

type ChecksState = DeployOutcome | 'waiting' | 'unavailable' | 'needsAuth' | 'timeout'

type LiveState = 'checking' | 'retrying' | 'ok' | 'wrongTitle' | 'status' | 'failed'

interface LiveResult {
  url: string
  title: string | null
  state: LiveState
  detail?: string | number
}

const MAX_LIVE_PAGES = 5

interface Props {
  target: TrackTarget
  /** Live address override (`liveUrl` setting); empty = permalinks as they are. */
  liveUrl: string
  /** The site's baseURL, for the gh-pages method and as the fallback page. */
  baseUrl: string | null
  /** The forge `origin` is on, when its checks can be read (GitHub, GitLab, Gitea/Forgejo). */
  forge: ForgeKind | null
  onClose(): void
  timings?: TrackerTimings
}

/** Follows a pushed commit: host checks, then the live pages, then a notification. */
export function DeployTracker({ target, liveUrl, baseUrl, forge, onClose, timings = DEFAULT_TIMINGS }: Props) {
  const { t } = useTranslation()
  const { site, pages } = useSite()
  const [checks, setChecks] = useState<ChecksState>(forge ? 'waiting' : 'unavailable')
  const [status, setStatus] = useState<DeployStatus | null>(null)
  const [live, setLive] = useState<LiveResult[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    async function followChecks(): Promise<ChecksState> {
      if (!forge) return 'unavailable'
      const started = Date.now()
      let empty = 0
      for (;;) {
        try {
          const next = await deployApi.status(target.rev)
          if (cancelled) return 'unavailable'
          setStatus(next)
          if (next.needsAuth) return 'needsAuth'
          const outcome = aggregateChecks(next.checks)
          if (outcome === 'success' || outcome === 'failure') return outcome
          if (outcome === 'none' && ++empty >= timings.emptyPolls) return 'none'
        } catch {
          return 'unavailable'
        }
        if (Date.now() - started >= timings.maxMs) return 'timeout'
        await sleep(timings.pollMs)
        if (cancelled) return 'unavailable'
      }
    }

    async function liveTargets(): Promise<{ url: string; title: string | null }[]> {
      const base = liveUrl.trim() || baseUrl || ''
      let found: { url: string; title: string | null }[] = []
      try {
        const { files } = await deployApi.commitFiles(target.rev)
        found =
          target.kind === 'gh-pages'
            ? urlsForBuiltFiles(files, pages, base).toSorted((a, b) => Number(b.title !== null) - Number(a.title !== null))
            : pagesForFiles(files, pages).map((p) => ({ url: liveUrlFor(p.permalink, liveUrl), title: p.title }))
      } catch {
        // Fall back to the home page.
      }
      if (found.length === 0 && base) found = [{ url: base, title: null }]
      return found.slice(0, MAX_LIVE_PAGES)
    }

    async function verify(index: number, page: { url: string; title: string | null }): Promise<boolean> {
      const set = (state: LiveState, detail?: string | number) =>
        setLive((current) => current && current.map((r, i) => (i === index ? { ...r, state, detail } : r)))
      for (let attempt = 0; attempt < timings.retryDelays.length; attempt++) {
        if (attempt > 0) set('retrying')
        await sleep(timings.retryDelays[attempt])
        if (cancelled) return false
        try {
          const response = await api.fetchPage(page.url)
          if (response.status !== 200) {
            set('status', response.status)
          } else if (page.title !== null && !titleMatches(response.body, page.title)) {
            set('wrongTitle', extractTitle(response.body) ?? '')
          } else {
            set('ok')
            return true
          }
        } catch {
          set('failed')
        }
      }
      return false
    }

    void (async () => {
      const outcome = await followChecks()
      if (cancelled) return
      setChecks(outcome)
      if (outcome === 'failure') {
        void notifyInBackground(
          t('publish.deploy.notify.failureTitle'),
          t('publish.deploy.notify.failureBody', { site: site.name, reason: t('publish.deploy.tracker.failure') }),
        )
        return
      }
      if (outcome === 'timeout') return
      const targets = await liveTargets()
      if (cancelled || targets.length === 0) return
      setLive(targets.map((p) => ({ ...p, state: 'checking' })))
      const results = await Promise.all(targets.map((page, index) => verify(index, page)))
      if (cancelled) return
      if (results.every(Boolean)) {
        void notifyInBackground(t('publish.deploy.notify.successTitle'), t('publish.deploy.notify.successBody', { site: site.name }))
      } else {
        void notifyInBackground(
          t('publish.deploy.notify.failureTitle'),
          t('publish.deploy.notify.failureBody', { site: site.name, reason: t('publish.deploy.live.problems') }),
        )
      }
    })()
    return () => {
      cancelled = true
    }
    // One run per target; the page list and texts at that moment are what counts.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [target.rev, target.kind])

  const summary: Record<ChecksState, string> = {
    waiting: t('publish.deploy.tracker.waiting'),
    pending: t('publish.deploy.tracker.pending'),
    success: t('publish.deploy.tracker.success'),
    failure: t('publish.deploy.tracker.failure'),
    none: t('publish.deploy.tracker.noChecks'),
    unavailable: forge ? t('publish.deploy.tracker.error') : t('publish.deploy.tracker.noForge'),
    needsAuth: t((status?.forge ?? forge) === 'github' ? 'publish.deploy.tracker.needsAuth' : 'publish.deploy.tracker.needsAuthPublic'),
    timeout: t('publish.deploy.tracker.timeout', { minutes: Math.round(timings.maxMs / 60_000) }),
  }
  const shownState: ChecksState = checks === 'waiting' && status && status.checks.length > 0 ? 'pending' : checks
  const tone =
    shownState === 'failure'
      ? 'border-red-300 dark:border-red-800'
      : shownState === 'success'
        ? 'border-emerald-300 dark:border-emerald-800'
        : 'border-zinc-200 dark:border-zinc-800'

  return (
    <section aria-label={t('publish.deploy.tracker.title')} className={`space-y-2 rounded-lg border bg-white p-3 text-sm dark:bg-zinc-900 ${tone}`}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 font-semibold">{t('publish.deploy.tracker.title')}</h3>
        <button className="text-xs text-zinc-500 hover:underline" onClick={onClose}>
          {t('publish.deploy.tracker.close')}
        </button>
      </div>
      <p data-state={shownState}>{summary[shownState]}</p>
      {status && status.checks.length > 0 && (
        <ul className="space-y-1 text-xs">
          {status.checks.map((check, index) => (
            <li key={`${check.name}-${index}`} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t(`publish.deploy.tracker.hosts.${checkHost(check, status.forge ?? forge ?? 'github')}`)}</span>
              <span className="text-zinc-500">{check.name}</span>
              <span>{t(`publish.deploy.tracker.states.${check.conclusion ?? check.status}`, { defaultValue: check.conclusion ?? check.status })}</span>
              {check.url && (
                <a className="text-sky-700 hover:underline dark:text-sky-400" href={check.url} target="_blank" rel="noreferrer">
                  {t('publish.deploy.tracker.details')}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {live && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold">{t('publish.deploy.live.title')}</h4>
          <ul className="space-y-1 text-xs">
            {live.map((result) => (
              <li key={result.url} data-live={result.state} className="flex flex-wrap gap-2">
                <a className="font-mono text-sky-700 hover:underline dark:text-sky-400" href={result.url} target="_blank" rel="noreferrer">
                  {result.url}
                </a>
                <span className={result.state === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-400'}>
                  {t(`publish.deploy.live.${result.state}`, { title: result.detail, status: result.detail })}
                </span>
              </li>
            ))}
          </ul>
          {live.every((r) => r.state === 'ok') && <p className="text-xs text-emerald-800 dark:text-emerald-300">{t('publish.deploy.live.allOk')}</p>}
          {live.some((r) => ['wrongTitle', 'status', 'failed'].includes(r.state)) && !live.some((r) => ['checking', 'retrying'].includes(r.state)) && (
            <p className="text-xs text-amber-800 dark:text-amber-300">{t('publish.deploy.live.problems')}</p>
          )}
        </div>
      )}
    </section>
  )
}
