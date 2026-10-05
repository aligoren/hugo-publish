import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, isAppError } from '../../lib/api'
import { useSite } from '../site/SiteContext'
import { futurePages, scheduledWorkflowYaml, secretsUrl, WORKFLOW_PATH, type GitHubRepo } from './deploy'
import type { DeployMethod } from './deploySettings'

interface Props {
  method: DeployMethod
  repo: GitHubRepo | null
  /** For tests: the current time. */
  now?: Date
}

/** Future-dated posts: why they will not appear by themselves, and a daily rebuild workflow. */
export function ScheduledPanel({ method, repo, now }: Props) {
  const { t, i18n } = useTranslation()
  const { pages } = useSite()
  const [today] = useState(() => now ?? new Date())
  const scheduled = useMemo(() => futurePages(pages, today), [pages, today])
  const [hour, setHour] = useState(0)
  const [showYaml, setShowYaml] = useState(false)
  const [result, setResult] = useState<'created' | 'exists' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const yaml = scheduledWorkflowYaml({ hourUtc: hour })

  if (scheduled.length === 0) return null

  async function create() {
    setError(null)
    try {
      // Version '' means "the file must not exist yet".
      await api.writeText(WORKFLOW_PATH, yaml, '')
      setResult('created')
    } catch (e) {
      if (isAppError(e) && e.code === 'conflict') setResult('exists')
      else setError(e)
    }
  }

  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' })
  const list = (
    <ul className="list-disc space-y-0.5 pl-5 text-xs">
      {scheduled.map(({ page, date }) => (
        <li key={page.path}>{t('publish.deploy.scheduled.item', { title: page.title || page.path, date: dateFormat.format(date) })}</li>
      ))}
    </ul>
  )

  return (
    <details className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer font-semibold">{t('publish.deploy.scheduled.title', { count: scheduled.length })}</summary>
      <div className="mt-2 space-y-2">
        <p className="text-zinc-700 dark:text-zinc-300">{t('publish.deploy.scheduled.explain')}</p>
        {method === 'gh-pages' ? (
          <>
            <p>{t('publish.deploy.scheduled.ghPages')}</p>
            {list}
          </>
        ) : (
          <>
            {list}
            <p>{t('publish.deploy.scheduled.workflowIntro')}</p>
            <ol className="list-decimal space-y-1 pl-5 text-xs">
              <li>{t('publish.deploy.scheduled.steps.hook')}</li>
              <li>
                {t('publish.deploy.scheduled.steps.secret')}{' '}
                {repo && (
                  <a className="text-sky-700 hover:underline dark:text-sky-400" href={secretsUrl(repo)} target="_blank" rel="noreferrer">
                    {t('publish.deploy.scheduled.openSecrets')}
                  </a>
                )}
              </li>
              <li>{t('publish.deploy.scheduled.steps.push')}</li>
            </ol>
            <div className="flex flex-wrap items-end gap-3">
              <label className="field">
                <span>{t('publish.deploy.scheduled.hour')}</span>
                <select value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:05
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn" onClick={() => setShowYaml((v) => !v)}>
                {t('publish.deploy.scheduled.show')}
              </button>
              <button className="btn btn-primary" disabled={result !== null} onClick={() => void create()}>
                {t('publish.deploy.scheduled.create', { path: WORKFLOW_PATH })}
              </button>
            </div>
            {showYaml && (
              <pre data-testid="workflow-yaml" className="max-h-72 overflow-auto rounded-md bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-950">
                {yaml}
              </pre>
            )}
            {result && (
              <p role="status" className="text-xs text-emerald-800 dark:text-emerald-300">
                {t(`publish.deploy.scheduled.${result}`)}
              </p>
            )}
            {error !== null && <ErrorNote error={error} />}
          </>
        )}
      </div>
    </details>
  )
}
