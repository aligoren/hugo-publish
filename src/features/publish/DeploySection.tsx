import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type GitStatus } from '../../lib/api'
import { detectForge, formatStamp, parseGitHubRemote } from './deploy'
import { deployApi, type DeployStage, type GhPagesResult } from './deployApi'
import { loadSettingsFile, type SettingsFile } from './deploySettings'
import { DeploySettingsPanel } from './DeploySettingsPanel'
import { DeployTracker } from './DeployTracker'
import type { TrackerTimings, TrackTarget } from './tracking'
import { GitErrorNote } from './GitErrorNote'
import { notifyInBackground } from './notify'
import { ScheduledPanel } from './ScheduledPanel'
import { SharePanel } from './SharePanel'
import { useSite } from '../site/SiteContext'

interface Props {
  status: GitStatus
  /** Full id of the commit just pushed from the Publish view (starts following it). */
  pushedSha: string | null
  /** Another git action is running. */
  busy: boolean
  /** Suggested name for a draft share link. */
  shareName: string
  /** Called after the gh-pages method published (the branch list changed). */
  onPublished(): void
  timings?: TrackerTimings
}

/** Publishing method, gh-pages publishing, deploy status, scheduled posts and share links. */
export function DeploySection({ status, pushedSha, busy, shareName, onPublished, timings }: Props) {
  const { t } = useTranslation()
  const { site } = useSite()
  const [file, setFile] = useState<SettingsFile | null>(null)
  const [fileError, setFileError] = useState<unknown>(null)
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [tracking, setTracking] = useState<TrackTarget | null>(null)
  const [stage, setStage] = useState<DeployStage | null>(null)
  const [ghResult, setGhResult] = useState<GhPagesResult | null>(null)
  const [ghError, setGhError] = useState<unknown>(null)
  const repo = parseGitHubRemote(status.remoteUrl)

  const loadSettings = useCallback(async () => {
    try {
      setFile(await loadSettingsFile())
      setFileError(null)
    } catch (e) {
      setFileError(e)
    }
  }, [])

  useEffect(() => {
    // Read the settings once; state changes only after the file was read.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadSettings()
    let alive = true
    api
      .configEffective()
      .then((config) => {
        const value = config.values.baseurl ?? config.values.baseURL
        if (alive && typeof value === 'string' && /^https?:\/\//.test(value)) setBaseUrl(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [loadSettings])

  const settings = file?.settings
  const forge = detectForge(status.remoteUrl, settings?.forge ?? '')
  useEffect(() => {
    // A push from the Publish view publishes only with the push method.
    if (pushedSha && settings?.method === 'push') {
      // oxlint-disable-next-line react/set-state-in-effect
      setTracking({ rev: pushedSha, kind: 'push' })
    }
  }, [pushedSha, settings?.method])

  async function publishGhPages() {
    if (!settings) return
    setGhError(null)
    setGhResult(null)
    setStage('build')
    const unlisten = await deployApi.onProgress((progress) => setStage(progress.stage)).catch(() => null)
    try {
      const message = t('publish.deploy.ghPages.message', { date: formatStamp(new Date()) })
      const result = await deployApi.ghPages(settings.branch, message)
      setGhResult(result)
      if (result.pushed) setTracking({ rev: `refs/heads/${settings.branch}`, kind: 'gh-pages' })
      onPublished()
    } catch (e) {
      setGhError(e)
      void notifyInBackground(t('publish.deploy.notify.failureTitle'), t('publish.deploy.notify.failureBody', { site: site.name, reason: t('publish.deploy.tracker.failure') }))
    } finally {
      unlisten?.()
      setStage(null)
    }
  }

  return (
    <section aria-label={t('publish.deploy.title')} className="space-y-3">
      <h2 className="text-sm font-semibold">{t('publish.deploy.title')}</h2>
      {fileError !== null && <GitErrorNote error={fileError} />}
      {file && <DeploySettingsPanel key={file.version} file={file} baseUrl={baseUrl} onSaved={() => void loadSettings()} />}

      {settings?.method === 'gh-pages' && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-zinc-700 dark:text-zinc-300">{t('publish.deploy.ghPages.hint', { branch: settings.branch })}</p>
          <button
            className="btn btn-primary"
            disabled={busy || stage !== null || status.remoteUrl === null}
            onClick={() => void publishGhPages()}
          >
            {t('publish.deploy.ghPages.button', { branch: settings.branch })}
          </button>
          {stage && (
            <p role="status" className="text-xs text-zinc-600 dark:text-zinc-400">
              {t(`publish.deploy.ghPages.stages.${stage}`, { branch: settings.branch })}
            </p>
          )}
          {ghResult && (
            <p role="status" className="text-xs text-emerald-800 dark:text-emerald-300">
              {ghResult.upToDate
                ? t('publish.deploy.ghPages.upToDate', { branch: ghResult.branch })
                : t('publish.deploy.ghPages.published', { files: ghResult.files, branch: ghResult.branch, commit: ghResult.commit ?? '' })}
            </p>
          )}
          {ghError !== null && <GitErrorNote error={ghError} />}
        </div>
      )}

      {tracking && settings && (
        <DeployTracker
          key={`${tracking.kind}:${tracking.rev}:${ghResult?.commit ?? ''}`}
          target={tracking}
          liveUrl={settings.liveUrl}
          baseUrl={baseUrl}
          forge={forge}
          onClose={() => setTracking(null)}
          timings={timings}
        />
      )}

      {settings && <ScheduledPanel method={settings.method} repo={repo} />}
      {settings && status.remoteUrl !== null && (
        <SharePanel cloudflareProject={settings.cloudflareProject} suggestedName={shareName} disabled={busy || status.branch === null} />
      )}
    </section>
  )
}
