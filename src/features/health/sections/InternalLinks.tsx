import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import { useSite } from '../../site/SiteContext'
import { readTexts, useSessionState, type HealthBuild } from '../hooks'
import { extractContentLinks } from '../lib/content'
import { extractIds, hasFragment } from '../lib/html'
import { makeSiteIndex, resolveInternalLink, type LinkProblem } from '../lib/internalLinks'
import { mapLimit } from '../lib/pool'
import { Badge, Note, OpenFileButton, Progress, Section } from '../ui'

interface Problem {
  path: string
  line: number
  url: string
  problem: LinkProblem
  fragment: string | null
}

interface Report {
  checked: number
  skipped: number
  files: number
  problems: Problem[]
}

/** Links between pages of the site, checked against a production build. */
export function InternalLinks({ build, baseUrl }: { build: HealthBuild; baseUrl: string | null }) {
  const { t } = useTranslation()
  const { site, files, pages, openFile } = useSite()
  const [report, setReport] = useSessionState<Report | null>('internal.report', null)
  const [stage, setStage] = useState<{ label: string; done: number; total: number } | null>(null)
  const [error, setError] = useState<unknown>(null)

  async function run() {
    setError(null)
    setStage({ label: t('health.build.building'), done: 0, total: 1 })
    try {
      const built = await build.ensure()
      const paths = files.map((f) => f.path)
      setStage({ label: t('health.readingFiles'), done: 0, total: paths.length })
      const texts = await readTexts(paths, { onProgress: (done) => setStage({ label: t('health.readingFiles'), done, total: paths.length }) })
      const index = makeSiteIndex({
        outputFiles: built.files.map((f) => f.path),
        baseUrl,
        contentDir: site.contentDir,
        contentFiles: paths,
        pages,
      })
      let checked = 0
      let skipped = 0
      const problems: Problem[] = []
      const fragmentChecks: { path: string; line: number; url: string; outputFile: string; fragment: string }[] = []
      for (const [path, text] of texts) {
        for (const link of extractContentLinks(text)) {
          const resolved = resolveInternalLink(path, link, index)
          if (!resolved) continue
          if (resolved.unknown) {
            skipped++
            continue
          }
          checked++
          if (resolved.problem) {
            problems.push({ path, line: link.line, url: link.url, problem: resolved.problem, fragment: null })
          } else if (resolved.fragment !== null && resolved.outputFile && /\.html?$/i.test(resolved.outputFile)) {
            fragmentChecks.push({ path, line: link.line, url: link.url, outputFile: resolved.outputFile, fragment: resolved.fragment })
          }
        }
      }
      const targets = [...new Set(fragmentChecks.map((c) => c.outputFile))]
      setStage({ label: t('health.internal.readingPages'), done: 0, total: targets.length })
      const idSets = await mapLimit(
        targets,
        8,
        (file) => build.read(file).then(extractIds, () => null),
        { onProgress: (done) => setStage({ label: t('health.internal.readingPages'), done, total: targets.length }) },
      )
      const ids = new Map(targets.map((file, i) => [file, idSets[i]]))
      for (const check of fragmentChecks) {
        const set = ids.get(check.outputFile)
        if (set && !hasFragment(set, check.fragment)) {
          problems.push({ path: check.path, line: check.line, url: check.url, problem: 'fragmentMissing', fragment: check.fragment })
        }
      }
      problems.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
      setReport({ checked, skipped, files: texts.size, problems })
    } catch (failure) {
      setError(failure)
    } finally {
      setStage(null)
    }
  }

  const byFile = new Map<string, Problem[]>()
  for (const problem of report?.problems ?? []) byFile.set(problem.path, [...(byFile.get(problem.path) ?? []), problem])

  return (
    <Section
      id="health-internal"
      title={t('health.internal.title')}
      intro={t('health.internal.intro')}
      actions={
        <button className="btn btn-primary" disabled={stage !== null || files.length === 0} onClick={() => void run()}>
          {report ? t('health.runAgain') : t('health.run')}
        </button>
      }
    >
      {stage && <Progress done={stage.done} total={stage.total} label={stage.label} />}
      {error !== null && <ErrorNote error={error} />}
      {report && !stage && (
        <>
          <p className="text-sm">
            {t('health.internal.summary', { count: report.checked, files: report.files })}{' '}
            {report.skipped > 0 && <span className="text-zinc-500">{t('health.internal.skipped', { count: report.skipped })}</span>}
          </p>
          {report.problems.length === 0 ? (
            <Note tone="ok">{t('health.internal.clean')}</Note>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {[...byFile].map(([path, problems]) => (
                <li key={path} className="space-y-1 px-3 py-2">
                  <OpenFileButton path={path} onOpen={openFile} />
                  <ul className="space-y-1 text-xs">
                    {problems.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="w-14 shrink-0 font-mono text-zinc-500">{t('health.line', { line: p.line })}</span>
                        <code className="min-w-0 break-all rounded bg-zinc-100 px-1 dark:bg-zinc-800">{p.url}</code>
                        <Badge tone={p.problem === 'unpublished' || p.problem === 'fragmentMissing' ? 'amber' : 'red'}>
                          {t(`health.internal.problems.${p.problem}`, { fragment: p.fragment ?? '' })}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  )
}
