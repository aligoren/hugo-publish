import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../../components/DiffView'
import { ErrorNote } from '../../../components/ErrorNote'
import { api, type BuildResult } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'
import { diffBuilds, diffWindow, htmlForDiff, isPagePath, isTextPath, pageUrlPath, type BuildChange, type BuildDiff } from '../lib/buildDiff'
import { formatMs } from '../lib/format'
import { Badge, Note, Section, Spinner } from '../ui'

interface Builds {
  head: BuildResult
  now: BuildResult
  diff: BuildDiff
}

interface Shown {
  change: BuildChange
  before: string
  after: string
  skipped: number
  truncated: boolean
}

function discardAll(builds: Builds | null) {
  if (!builds) return
  for (const build of [builds.head, builds.now]) void api.discardBuild(build.outputDir).catch(() => undefined)
}

/** The site as built from the last commit against the files on disk: what publishing changes. */
export function Changes() {
  const { t } = useTranslation()
  const { site } = useSite()
  const [builds, setBuilds] = useState<Builds | null>(null)
  const [stage, setStage] = useState<'head' | 'now' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [showOther, setShowOther] = useState(false)
  const current = useRef<Builds | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      discardAll(current.current)
      current.current = null
    }
  }, [])

  async function run() {
    discardAll(current.current)
    current.current = null
    setBuilds(null)
    setShown(null)
    setError(null)
    let head: BuildResult | null = null
    try {
      setStage('head')
      head = await api.buildSite({ revision: 'HEAD' })
      setStage('now')
      const now = await api.buildSite({})
      const result = { head, now, diff: diffBuilds(head.files, now.files) }
      if (!alive.current) {
        discardAll(result)
        return
      }
      current.current = result
      setBuilds(result)
    } catch (failure) {
      if (head) void api.discardBuild(head.outputDir).catch(() => undefined)
      if (alive.current) setError(failure)
    } finally {
      if (alive.current) setStage(null)
    }
  }

  async function show(change: BuildChange) {
    if (!builds) return
    try {
      const read = (build: BuildResult) => api.readBuildFile(build.outputDir, change.path)
      let before = change.kind === 'added' ? '' : await read(builds.head)
      let after = change.kind === 'removed' ? '' : await read(builds.now)
      if (isPagePath(change.path)) {
        before = htmlForDiff(before)
        after = htmlForDiff(after)
      }
      const window = diffWindow(before, after)
      setShown({ change, ...window })
    } catch (failure) {
      setError(failure)
    }
  }

  const all = builds ? [...builds.diff.added, ...builds.diff.changed, ...builds.diff.removed] : []
  const pages = all.filter((c) => c.isPage)
  const other = all.filter((c) => !c.isPage)
  const messages = builds ? [...builds.head.messages, ...builds.now.messages].filter((m) => m.level === 'error') : []

  const list = (changes: BuildChange[]) => (
    <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-800">
      {changes.map((change) => (
        <li key={`${change.kind}-${change.path}`} className="flex items-center gap-2 px-3 py-1.5">
          <Badge tone={change.kind === 'added' ? 'emerald' : change.kind === 'removed' ? 'red' : 'amber'}>
            {t(`health.changes.kinds.${change.kind}`)}
          </Badge>
          {isTextPath(change.path) ? (
            <button
              type="button"
              className={`min-w-0 truncate text-left font-mono hover:underline ${shown?.change === change ? 'font-semibold' : ''}`}
              onClick={() => void show(change)}
            >
              {change.isPage ? pageUrlPath(change.path) : change.path}
            </button>
          ) : (
            <span className="min-w-0 truncate font-mono">{change.path}</span>
          )}
        </li>
      ))}
    </ul>
  )

  return (
    <Section
      id="health-changes"
      title={t('health.changes.title')}
      intro={t('health.changes.intro')}
      actions={
        <button className="btn btn-primary" disabled={stage !== null || !site.isGitRepo} onClick={() => void run()}>
          {builds ? t('health.runAgain') : t('health.changes.compare')}
        </button>
      }
    >
      {!site.isGitRepo && <Note>{t('health.changes.noGit')}</Note>}
      {stage && (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner />
          {t(stage === 'head' ? 'health.changes.buildingHead' : 'health.changes.buildingNow')}
        </p>
      )}
      {error !== null && <ErrorNote error={error} />}
      {builds && (
        <>
          <p className="text-sm">
            {t('health.changes.summary', {
              added: builds.diff.added.length,
              changed: builds.diff.changed.length,
              removed: builds.diff.removed.length,
              unchanged: builds.diff.unchanged,
            })}{' '}
            <span className="text-zinc-500">
              {t('health.changes.durations', { head: formatMs(builds.head.durationMs), now: formatMs(builds.now.durationMs) })}
            </span>
          </p>
          {messages.length > 0 && (
            <Note tone="error">
              <p>{t('health.changes.buildErrors')}</p>
              <ul className="mt-1 font-mono text-xs">
                {messages.map((m, i) => (
                  <li key={i}>{m.text}</li>
                ))}
              </ul>
            </Note>
          )}
          {all.length === 0 ? (
            <Note tone="ok">{t('health.changes.none')}</Note>
          ) : (
            <>
              <h3 className="text-sm font-medium">{t('health.changes.pages', { count: pages.length })}</h3>
              {pages.length > 0 && list(pages)}
              {other.length > 0 && (
                <>
                  <button className="text-xs text-sky-700 hover:underline dark:text-sky-400" onClick={() => setShowOther((v) => !v)}>
                    {t(showOther ? 'health.changes.hideOther' : 'health.changes.showOther', { count: other.length })}
                  </button>
                  {showOther && list(other)}
                </>
              )}
              <p className="text-xs text-zinc-500">{t('health.changes.noise')}</p>
            </>
          )}
          {shown && (
            <div className="space-y-1">
              <h3 className="font-mono text-xs font-medium">{shown.change.path}</h3>
              {shown.skipped > 0 && <p className="text-xs text-zinc-500">{t('health.changes.skipped', { count: shown.skipped })}</p>}
              <DiffView before={shown.before} after={shown.after} />
              {shown.truncated && <p className="text-xs text-zinc-500">{t('health.changes.truncated')}</p>}
            </div>
          )}
        </>
      )}
    </Section>
  )
}
