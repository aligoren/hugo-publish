import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import {
  archetypeForDocument,
  clearCheckContextCache,
  loadCheckContext,
  runChecks,
  type CheckIssue,
  type CheckSeverity,
} from '../../checks'
import { useSite } from '../../site/SiteContext'
import { readTexts, useSessionState } from '../hooks'
import { Badge, Note, OpenFileButton, Progress, Section, type Tone } from '../ui'

interface FileResult {
  path: string
  issues: CheckIssue[]
}

const SEVERITIES: CheckSeverity[] = ['error', 'warn', 'info']
const TONE: Record<CheckSeverity, Tone> = { error: 'red', warn: 'amber', info: 'sky' }

/** Pre-publish checks over every content file. */
export function ContentChecks() {
  const { t } = useTranslation()
  const { site, files, openFile } = useSite()
  const [results, setResults] = useSessionState<FileResult[] | null>('checks.results', null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [showInfo, setShowInfo] = useState(false)

  async function run() {
    setError(null)
    setProgress({ done: 0, total: files.length })
    try {
      // Archetypes may have changed since the editor loaded them: read them afresh.
      clearCheckContextCache()
      const context = await loadCheckContext(site.root, files)
      const paths = files.map((f) => f.path)
      const texts = await readTexts(paths, { onProgress: (done) => setProgress({ done, total: paths.length }) })
      setResults(
        [...texts].map(([path, text]) => ({
          path,
          issues: runChecks({
            path,
            text,
            archetypeText: archetypeForDocument(path, text, context.archetypes),
            siteUsesDescription: context.siteUsesDescription,
            rawHtmlAllowed: context.rawHtmlAllowed,
          }),
        })),
      )
    } catch (failure) {
      setError(failure)
    } finally {
      setProgress(null)
    }
  }

  const counts = { error: 0, warn: 0, info: 0 }
  for (const result of results ?? []) for (const issue of result.issues) counts[issue.severity]++
  const visible = SEVERITIES.filter((s) => s !== 'info' || showInfo)

  return (
    <Section
      id="health-checks"
      title={t('health.checks.title')}
      intro={t('health.checks.intro')}
      actions={
        <button className="btn btn-primary" disabled={progress !== null || files.length === 0} onClick={() => void run()}>
          {results ? t('health.runAgain') : t('health.run')}
        </button>
      }
    >
      {progress && <Progress done={progress.done} total={progress.total} label={t('health.readingFiles')} />}
      {error !== null && <ErrorNote error={error} />}
      {results && !progress && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t('health.checks.summary', { count: results.length })}</span>
            <Badge tone="red">{t('health.checks.errors', { count: counts.error })}</Badge>
            <Badge tone="amber">{t('health.checks.warnings', { count: counts.warn })}</Badge>
            <Badge tone="sky">{t('health.checks.infos', { count: counts.info })}</Badge>
            <label className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
              <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} />
              {t('health.checks.showInfo')}
            </label>
          </div>
          {counts.error + counts.warn === 0 && <Note tone="ok">{t('health.checks.clean')}</Note>}
          {visible.map((severity) => {
            const withIssues = results
              .map((r) => ({ path: r.path, issues: r.issues.filter((i) => i.severity === severity) }))
              .filter((r) => r.issues.length > 0)
            if (withIssues.length === 0) return null
            return (
              <div key={severity} className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <Badge tone={TONE[severity]}>{t(`health.severity.${severity}`)}</Badge>
                  <span className="text-zinc-500">{t('health.checks.files', { count: withIssues.length })}</span>
                </h3>
                <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {withIssues.map((result) => (
                    <li key={result.path} className="space-y-1 px-3 py-2">
                      <OpenFileButton path={result.path} onOpen={openFile} />
                      <ul className="space-y-0.5 text-xs">
                        {result.issues.map((issue, index) => (
                          <li key={`${issue.rule}-${index}`} className="flex gap-2">
                            <span className="min-w-0 flex-1 break-words">{t(`checks.${issue.messageKey}`, issue.params)}</span>
                            {issue.line !== undefined && (
                              <span className="shrink-0 font-mono text-zinc-500">{t('health.line', { line: issue.line })}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
    </Section>
  )
}
