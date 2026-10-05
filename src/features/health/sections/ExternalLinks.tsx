import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import { api } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'
import { readTexts, useSessionState } from '../hooks'
import { classifyLink, extractContentLinks } from '../lib/content'
import { parseBaseUrl } from '../lib/internalLinks'
import { loadCachedChecks, saveCachedChecks, type CachedCheck } from '../lib/linkCache'
import { Badge, Note, OpenFileButton, Progress, Section, type Tone } from '../ui'

/** URLs sent to the backend per call; the backend checks eight at a time. */
const BATCH = 8

interface Usage {
  path: string
  line: number
}

interface Collected {
  urls: string[]
  usages: Record<string, Usage[]>
  files: number
}

interface Row {
  url: string
  check: CachedCheck | null
  cached: boolean
}

/** Sites that refuse automated requests answer with these; the link may still work in a browser. */
const BLOCKING_STATUSES = new Set([401, 403, 429, 999])

function checkTone(check: CachedCheck | null): Tone {
  if (!check) return 'neutral'
  if (check.ok) return 'emerald'
  return check.status !== null && BLOCKING_STATUSES.has(check.status) ? 'amber' : 'red'
}

function differs(a: string, b: string | null): boolean {
  return b !== null && a.replace(/\/$/, '') !== b.replace(/\/$/, '')
}

/** http(s) links to other sites, checked on request and remembered for a day. */
export function ExternalLinks({ baseUrl }: { baseUrl: string | null }) {
  const { t } = useTranslation()
  const { files, openFile } = useSite()
  const [collected, setCollected] = useSessionState<Collected | null>('external.collected', null)
  const [rows, setRows] = useSessionState<Row[] | null>('external.rows', null)
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [onlyProblems, setOnlyProblems] = useState(true)
  const cancelled = useRef(false)

  async function collect(): Promise<Collected> {
    const { host } = parseBaseUrl(baseUrl)
    const paths = files.map((f) => f.path)
    const label = t('health.readingFiles')
    setProgress({ label, done: 0, total: paths.length })
    const texts = await readTexts(paths, { onProgress: (done) => setProgress({ label, done, total: paths.length }) })
    const usages: Record<string, Usage[]> = {}
    for (const [path, text] of texts) {
      for (const link of extractContentLinks(text)) {
        const target = classifyLink(link, host)
        if (target.type !== 'external') continue
        ;(usages[target.url] ??= []).push({ path, line: link.line })
      }
    }
    const result = { urls: Object.keys(usages).sort(), usages, files: texts.size }
    setCollected(result)
    return result
  }

  async function scan() {
    setError(null)
    try {
      await collect()
      setRows(null)
    } catch (failure) {
      setError(failure)
    } finally {
      setProgress(null)
    }
  }

  async function check(force: boolean) {
    setError(null)
    cancelled.current = false
    try {
      const { urls } = collected ?? (await collect())
      const cache = force ? new Map<string, CachedCheck>() : loadCachedChecks()
      const results = new Map<string, Row>()
      for (const url of urls) {
        const hit = cache.get(url)
        if (hit) results.set(url, { url, check: hit, cached: true })
      }
      const todo = urls.filter((url) => !results.has(url))
      const label = t('health.external.checking')
      setProgress({ label, done: 0, total: todo.length })
      const publish = () => setRows(urls.map((url) => results.get(url) ?? { url, check: null, cached: false }))
      publish()
      for (let i = 0; i < todo.length && !cancelled.current; i += BATCH) {
        const now = Date.now()
        const checked = (await api.checkLinks(todo.slice(i, i + BATCH))).map((c) => ({ ...c, checkedAt: now }))
        for (const c of checked) results.set(c.url, { url: c.url, check: c, cached: false })
        saveCachedChecks(checked, now)
        setProgress({ label, done: Math.min(i + BATCH, todo.length), total: todo.length })
        publish()
      }
    } catch (failure) {
      setError(failure)
    } finally {
      setProgress(null)
    }
  }

  const sorted = (rows ?? [])
    .filter((row) => !onlyProblems || !row.check || !row.check.ok)
    .sort((a, b) => Number(a.check?.ok ?? true) - Number(b.check?.ok ?? true) || a.url.localeCompare(b.url))
  const broken = (rows ?? []).filter((r) => r.check && !r.check.ok).length
  const unchecked = (rows ?? []).filter((r) => !r.check).length
  const busy = progress !== null

  return (
    <Section
      id="health-external"
      title={t('health.external.title')}
      intro={t('health.external.intro')}
      actions={
        busy ? (
          <button className="btn" onClick={() => (cancelled.current = true)}>
            {t('common.cancel')}
          </button>
        ) : (
          <>
            <button className="btn" disabled={files.length === 0} onClick={() => void scan()}>
              {t('health.external.scan')}
            </button>
            <button className="btn btn-primary" disabled={files.length === 0} onClick={() => void check(false)}>
              {t('health.external.check')}
            </button>
            {rows && (
              <button className="btn" onClick={() => void check(true)}>
                {t('health.external.recheck')}
              </button>
            )}
          </>
        )
      }
    >
      {progress && <Progress done={progress.done} total={progress.total} label={progress.label} />}
      {error !== null && <ErrorNote error={error} />}
      {collected && <p className="text-sm">{t('health.external.found', { count: collected.urls.length, files: collected.files })}</p>}
      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={broken > 0 ? 'red' : 'emerald'}>{t('health.external.broken', { count: broken })}</Badge>
            {unchecked > 0 && <Badge>{t('health.external.unchecked', { count: unchecked })}</Badge>}
            <label className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
              {t('health.external.onlyProblems')}
            </label>
          </div>
          {!busy && broken === 0 && unchecked === 0 && rows.length > 0 && <Note tone="ok">{t('health.external.clean')}</Note>}
          {sorted.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">{t('health.external.status')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('health.external.link')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('health.external.usedIn')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {sorted.map((row) => (
                    <tr key={row.url} className="align-top">
                      <td className="px-2 py-1.5">
                        <Badge tone={checkTone(row.check)} title={row.check?.error ?? undefined}>
                          {row.check
                            ? row.check.status !== null
                              ? String(row.check.status)
                              : t('health.external.noAnswer')
                            : t('health.external.pending')}
                        </Badge>
                        {row.cached && <span className="ml-1 text-[10px] text-zinc-400">{t('health.external.cached')}</span>}
                      </td>
                      <td className="max-w-md px-2 py-1.5">
                        <span className="break-all font-mono select-text">{row.url}</span>
                        {row.check?.error && <p className="text-red-700 dark:text-red-300">{row.check.error}</p>}
                        {row.check && checkTone(row.check) === 'amber' && (
                          <p className="text-amber-700 dark:text-amber-300">{t('health.external.blocked')}</p>
                        )}
                        {row.check?.ok && differs(row.url, row.check.finalUrl) && (
                          <p className="break-all text-zinc-500">{t('health.external.redirected', { url: row.check.finalUrl })}</p>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <ul>
                          {(collected?.usages[row.url] ?? []).slice(0, 5).map((u, i) => (
                            <li key={i}>
                              <OpenFileButton path={u.path} line={u.line} onOpen={openFile} />
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  )
}
