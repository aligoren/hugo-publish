import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../../components/DiffView'
import { ErrorNote } from '../../../components/ErrorNote'
import { errorMessage } from '../../../i18n'
import { api } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'
import { useSessionState } from '../hooks'
import { diffWindow } from '../lib/buildDiff'
import { convertToUtc, countOffsets, dateKeys, offsetDates, offsetLabel, regionalTimeZone, type OffsetDate } from '../lib/dateZones'
import { mapLimit } from '../lib/pool'
import { Badge, Note, OpenFileButton, Progress, Section } from '../ui'

interface Found {
  path: string
  dates: OffsetDate[]
  text: string
  version: string
}

interface Planned {
  path: string
  before: string
  after: string
  version: string
  changes: { key: string; before: string; after: string }[]
}

interface Plan {
  files: Planned[]
  readOnly: string[]
}

/** Dates with a fixed UTC offset (a hint at the author's region), with an optional rewrite to UTC. */
export function DateZones({ values }: { values: Record<string, unknown> | null }) {
  const { t } = useTranslation()
  const { files, openFile, reloadFiles } = useSite()
  const [found, setFound] = useSessionState<Found[] | null>('privacy.dates', null)
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [written, setWritten] = useState<{ ok: number; failed: { path: string; reason: string }[] } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const zone = regionalTimeZone(values)
  // Hugo's date aliases and the site's [frontmatter] lists; only real front matter keys.
  const keys = dateKeys(values)

  async function scan() {
    setError(null)
    setPlan(null)
    const label = t('health.readingFiles')
    setProgress({ label, done: 0, total: files.length })
    try {
      const read = await mapLimit(
        files.map((f) => f.path),
        8,
        (path) => api.readText(path).then((file) => ({ path, ...file }), () => null),
        { onProgress: (done) => setProgress({ label, done, total: files.length }) },
      )
      setFound(
        read
          .filter((f): f is { path: string; text: string; version: string } => f !== null)
          .map((f) => ({ ...f, dates: offsetDates(f.text, keys) }))
          .filter((f) => f.dates.length > 0),
      )
    } catch (failure) {
      setError(failure)
    } finally {
      setProgress(null)
    }
  }

  async function prepare() {
    if (!found) return
    setError(null)
    setWritten(null)
    try {
      const planned: Planned[] = []
      const readOnly: string[] = []
      for (const file of found) {
        const result = await convertToUtc(file.text, undefined, keys)
        if (result.kind === 'converted') {
          planned.push({ path: file.path, before: file.text, after: result.text, version: file.version, changes: result.changes })
        } else if (result.kind === 'readOnly') {
          readOnly.push(file.path)
        }
      }
      setPlan({ files: planned, readOnly })
    } catch (failure) {
      setError(failure)
    }
  }

  async function write() {
    if (!plan) return
    const label = t('health.privacy.dates.writing')
    setProgress({ label, done: 0, total: plan.files.length })
    let ok = 0
    const failed: { path: string; reason: string }[] = []
    for (const [i, file] of plan.files.entries()) {
      try {
        // A snapshot first, so each file can be restored from its history.
        await api.historySave(file.path, file.before, 'manual')
        await api.writeText(file.path, file.after, file.version)
        ok++
      } catch (failure) {
        failed.push({ path: file.path, reason: errorMessage(failure).summary })
      }
      setProgress({ label, done: i + 1, total: plan.files.length })
    }
    setProgress(null)
    setPlan(null)
    setWritten({ ok, failed })
    await reloadFiles()
    await scan()
  }

  const counts = found ? countOffsets(found) : []

  return (
    <Section
      id="health-dates"
      title={t('health.privacy.dates.title')}
      intro={t('health.privacy.dates.intro')}
      actions={
        <button className="btn" disabled={progress !== null || files.length === 0} onClick={() => void scan()}>
          {found ? t('health.runAgain') : t('health.privacy.dates.scan')}
        </button>
      }
    >
      {zone && <Note tone="warn">{t('health.privacy.dates.timeZone', { zone })}</Note>}
      <p className="text-xs text-zinc-500">{t('health.privacy.dates.keys', { keys: keys.join(', ') })}</p>
      {progress && <Progress done={progress.done} total={progress.total} label={progress.label} />}
      {error !== null && <ErrorNote error={error} />}
      {written && (
        <Note tone={written.failed.length > 0 ? 'warn' : 'ok'}>
          <p>{t('health.privacy.dates.written', { count: written.ok })}</p>
          {written.failed.map((f) => (
            <p key={f.path} className="font-mono text-xs">
              {f.path}: {f.reason}
            </p>
          ))}
        </Note>
      )}
      {found && !progress && (
        <>
          {found.length === 0 ? (
            <Note tone="ok">{t('health.privacy.dates.none')}</Note>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {counts.map((c) => (
                  <Badge key={c.label} tone="amber">
                    {t('health.privacy.dates.offset', { offset: c.label, count: c.pages })}
                  </Badge>
                ))}
                {!plan && (
                  <button className="btn ml-auto" onClick={() => void prepare()}>
                    {t('health.privacy.dates.convert')}
                  </button>
                )}
              </div>
              {!plan && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-zinc-500">{t('health.privacy.dates.files', { count: found.length })}</summary>
                  <ul className="mt-1 space-y-0.5">
                    {found.map((f) => (
                      <li key={f.path} className="flex flex-wrap items-center gap-2">
                        <OpenFileButton path={f.path} onOpen={openFile} />
                        <span className="text-zinc-500">{[...new Set(f.dates.map((d) => offsetLabel(d.minutes)))].join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}
      {plan && !progress && (
        <div className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-sm font-medium">{t('health.privacy.dates.review', { count: plan.files.length })}</p>
          <p className="text-xs text-zinc-500">{t('health.privacy.dates.reviewNote')}</p>
          {plan.readOnly.length > 0 && (
            <Note tone="warn">{t('health.privacy.dates.readOnly', { files: plan.readOnly.join(', ') })}</Note>
          )}
          <ul className="max-h-[28rem] space-y-2 overflow-auto">
            {plan.files.map((file) => {
              const window = diffWindow(file.before, file.after, 1)
              return (
                <li key={file.path} className="space-y-1">
                  <p className="font-mono text-xs">{file.path}</p>
                  <DiffView before={window.before} after={window.after} />
                </li>
              )
            })}
          </ul>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={plan.files.length === 0} onClick={() => void write()}>
              {t('health.privacy.dates.write', { count: plan.files.length })}
            </button>
            <button className="btn" onClick={() => setPlan(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}
