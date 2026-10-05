import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import { api, type GitStatus, type MediaFile } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'
import { useSessionState, type HealthBuild } from '../hooks'
import { pageUrlPath } from '../lib/buildDiff'
import { parseBaseUrl } from '../lib/internalLinks'
import { mapLimit } from '../lib/pool'
import { groupByService, isNoreplyEmail, PrivacyAudit, privacySettings, type ThirdPartyHost } from '../lib/privacy'
import { Badge, Note, Progress, Section } from '../ui'
import { DateZones } from './DateZones'

/** Built pages and stylesheets are scanned; beyond this many, the rest is skipped. */
const MAX_FILES = 3000

/** Third-party requests in the built site, Hugo's privacy settings, GPS in images, git identity. */
export function Privacy({ build, baseUrl, values }: { build: HealthBuild; baseUrl: string | null; values: Record<string, unknown> | null }) {
  const { t } = useTranslation()
  const [hosts, setHosts] = useSessionState<{ hosts: ThirdPartyHost[]; scanned: number; total: number } | null>('privacy.hosts', null)
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null)
  const [error, setError] = useState<unknown>(null)

  async function audit() {
    setError(null)
    setProgress({ label: t('health.build.building'), done: 0, total: 1 })
    try {
      const built = await build.ensure()
      const all = built.files.map((f) => f.path).filter((p) => /\.(html?|css)$/i.test(p))
      const targets = all.slice(0, MAX_FILES)
      const { host } = parseBaseUrl(baseUrl)
      const scanner = new PrivacyAudit(baseUrl ?? 'https://site.invalid/', host)
      const label = t('health.privacy.scanning')
      setProgress({ label, done: 0, total: targets.length })
      await mapLimit(
        targets,
        8,
        async (path) => {
          const text = await build.read(path).catch(() => null)
          if (text !== null) scanner.add(path, text)
        },
        { onProgress: (done) => setProgress({ label, done, total: targets.length }) },
      )
      setHosts({ hosts: scanner.result(), scanned: targets.length, total: all.length })
    } catch (failure) {
      setError(failure)
    } finally {
      setProgress(null)
    }
  }

  const groups = hosts ? groupByService(hosts.hosts) : []

  return (
    <div className="space-y-4">
      <Section
        id="health-privacy"
        title={t('health.privacy.title')}
        intro={t('health.privacy.intro')}
        actions={
          <button className="btn btn-primary" disabled={progress !== null} onClick={() => void audit()}>
            {hosts ? t('health.runAgain') : t('health.run')}
          </button>
        }
      >
        {progress && <Progress done={progress.done} total={progress.total} label={progress.label} />}
        {error !== null && <ErrorNote error={error} />}
        {hosts && !progress && (
          <>
            <p className="text-sm">
              {t('health.privacy.scanned', { count: hosts.scanned })}
              {hosts.total > hosts.scanned && ` ${t('health.privacy.partial', { count: hosts.total })}`}
            </p>
            {groups.length === 0 ? (
              <Note tone="ok">{t('health.privacy.clean')}</Note>
            ) : (
              <ul className="space-y-2">
                {groups.map((group) => {
                  const files = [...new Set(group.hosts.flatMap((h) => h.files))]
                  const kinds = [...new Set(group.hosts.flatMap((h) => h.kinds))]
                  return (
                    <li key={group.key} className="space-y-1 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{group.key}</span>
                        {group.service?.tip === 'compromised' && <Badge tone="red">{t('health.privacy.dangerous')}</Badge>}
                        {kinds.map((kind) => (
                          <Badge key={kind}>{t(`health.privacy.kinds.${kind}`)}</Badge>
                        ))}
                        <span className="ml-auto text-xs text-zinc-500">{t('health.privacy.usedOn', { count: files.length })}</span>
                      </div>
                      <p className="font-mono text-xs text-zinc-500">{group.hosts.map((h) => h.host).join(', ')}</p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {t(`health.privacy.tips.${group.service?.tip ?? 'unknown'}`)}
                      </p>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-zinc-500">{t('health.privacy.details')}</summary>
                        <ul className="mt-1 space-y-0.5 font-mono">
                          {group.hosts.flatMap((h) => h.urls).map((url) => (
                            <li key={url} className="break-all">
                              {url}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 text-zinc-500">
                          {files
                            .slice(0, 8)
                            .map((f) => pageUrlPath(f))
                            .join(', ')}
                          {files.length > 8 && ' …'}
                        </p>
                      </details>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </Section>
      <HugoPrivacySettings values={values} />
      <DateZones values={values} />
      <GpsImages />
      <GitIdentity />
    </div>
  )
}

function HugoPrivacySettings({ values }: { values: Record<string, unknown> | null }) {
  const { t } = useTranslation()
  const { showView } = useSite()
  const settings = privacySettings(values)
  if (settings.length === 0) return null
  return (
    <Section
      id="health-privacy-settings"
      title={t('health.privacy.settings.title')}
      intro={t('health.privacy.settings.intro')}
      actions={
        <button className="btn" onClick={() => showView('settings')}>
          {t('health.openSettings')}
        </button>
      }
    >
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {settings.map((s) => (
          <li key={s.service} className="flex flex-wrap items-center gap-2">
            <code className="text-xs">privacy.{s.service}</code>
            <Badge tone={s.disabled ? 'emerald' : 'neutral'}>
              {s.disabled ? t('health.privacy.settings.disabled') : t('health.privacy.settings.enabled')}
            </Badge>
            {!s.disabled &&
              Object.entries(s.options).map(([key, on]) => (
                <span key={key} className="text-xs text-zinc-500">
                  {key} = {String(on)}
                </span>
              ))}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function GpsImages() {
  const { t } = useTranslation()
  const { showView } = useSite()
  const [images, setImages] = useState<MediaFile[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    api.mediaList().then(
      (list) => !cancelled && setImages(list.filter((m) => m.hasGps)),
      (failure: unknown) => !cancelled && setError(failure),
    )
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Section
      id="health-gps"
      title={t('health.privacy.gps.title')}
      intro={t('health.privacy.gps.intro')}
      actions={
        <button className="btn" onClick={() => showView('media')}>
          {t('health.privacy.gps.openMedia')}
        </button>
      }
    >
      {error !== null && <ErrorNote error={error} />}
      {images &&
        (images.length === 0 ? (
          <Note tone="ok">{t('health.privacy.gps.none')}</Note>
        ) : (
          <>
            <Note tone="warn">{t('health.privacy.gps.found', { count: images.length })}</Note>
            <ul className="space-y-0.5 font-mono text-xs">
              {images.slice(0, 20).map((image) => (
                <li key={image.path}>{image.path}</li>
              ))}
              {images.length > 20 && <li className="text-zinc-500">…</li>}
            </ul>
          </>
        ))}
    </Section>
  )
}

function GitIdentity() {
  const { t } = useTranslation()
  const { site } = useSite()
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!site.isGitRepo) return
    let cancelled = false
    api.gitStatus().then(
      (s) => !cancelled && setStatus(s),
      (failure: unknown) => !cancelled && setError(failure),
    )
    return () => {
      cancelled = true
    }
  }, [site.isGitRepo])

  if (!site.isGitRepo) return null
  const email = status?.userEmail ?? null
  return (
    <Section id="health-git-identity" title={t('health.privacy.git.title')} intro={t('health.privacy.git.intro')}>
      {error !== null && <ErrorNote error={error} />}
      {status &&
        (email === null ? (
          <Note tone="warn">{t('health.privacy.git.noEmail')}</Note>
        ) : isNoreplyEmail(email) ? (
          <Note tone="ok">{t('health.privacy.git.noreply', { email })}</Note>
        ) : (
          <Note tone="info">{t('health.privacy.git.public', { email, name: status.userName ?? '' })}</Note>
        ))}
    </Section>
  )
}
