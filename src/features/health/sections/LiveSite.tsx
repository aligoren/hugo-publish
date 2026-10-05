import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, isAppError } from '../../../lib/api'
import { useSessionState, type HealthBuild } from '../hooks'
import { extractMeta } from '../lib/html'
import { isPlaceholderBaseUrl } from '../lib/internalLinks'
import { formatMs } from '../lib/format'
import { Badge, Note, Section, type Tone } from '../ui'

interface LiveResult {
  url: string
  status: number
  finalUrl: string
  title: string | null
  ms: number
  /** Title of the home page in the local build, when one was made. */
  localTitle: string | null
  checkedAt: number
}

function statusTone(status: number): Tone {
  if (status >= 200 && status < 300) return 'emerald'
  if (status >= 300 && status < 400) return 'amber'
  return 'red'
}

/** The published site's home page: does it answer, how fast, with which title. */
export function LiveSite({ build, baseUrl }: { build: HealthBuild; baseUrl: string | null }) {
  const { t } = useTranslation()
  const [result, setResult] = useSessionState<LiveResult | null>('live.result', null)
  const [checking, setChecking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const placeholder = isPlaceholderBaseUrl(baseUrl)

  async function check() {
    if (!baseUrl) return
    setChecking(true)
    setFailure(null)
    const started = performance.now()
    try {
      const page = await api.fetchPage(baseUrl)
      const ms = performance.now() - started
      let localTitle: string | null = null
      if (build.result?.files.some((f) => f.path === 'index.html')) {
        localTitle = await build.read('index.html').then((html) => extractMeta(html).title, () => null)
      }
      setResult({
        url: baseUrl,
        status: page.status,
        finalUrl: page.finalUrl,
        title: extractMeta(page.body).title,
        ms,
        localTitle,
        checkedAt: Date.now(),
      })
    } catch (error) {
      setResult(null)
      setFailure(isAppError(error) ? error.message : String(error))
    } finally {
      setChecking(false)
    }
  }

  const redirected = result && result.finalUrl.replace(/\/$/, '') !== result.url.replace(/\/$/, '')
  return (
    <Section
      id="health-live"
      title={t('health.live.title')}
      intro={t('health.live.intro')}
      actions={
        <button className="btn btn-primary" disabled={checking || !baseUrl} onClick={() => void check()}>
          {checking ? t('health.live.checking') : t('health.live.check')}
        </button>
      }
    >
      {baseUrl ? (
        <p className="font-mono text-xs text-zinc-500">{baseUrl}</p>
      ) : (
        <Note tone="warn">{t('health.live.noBaseUrl')}</Note>
      )}
      {baseUrl && placeholder && <Note tone="warn">{t('health.live.placeholder')}</Note>}
      {failure !== null && (
        <Note tone="error">
          <p className="font-medium">{t('health.live.unreachable')}</p>
          <p className="font-mono text-xs opacity-80">{failure}</p>
        </Note>
      )}
      {result && !checking && (
        <>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm">
            <dt className="text-zinc-500">{t('health.live.status')}</dt>
            <dd>
              <Badge tone={statusTone(result.status)}>{result.status}</Badge>
            </dd>
            <dt className="text-zinc-500">{t('health.live.time')}</dt>
            <dd>{formatMs(result.ms)}</dd>
            <dt className="text-zinc-500">{t('health.live.pageTitle')}</dt>
            <dd className="break-words">{result.title ?? '—'}</dd>
            {redirected && (
              <>
                <dt className="text-zinc-500">{t('health.live.finalUrl')}</dt>
                <dd className="break-all font-mono text-xs">{result.finalUrl}</dd>
              </>
            )}
          </dl>
          {result.status >= 200 && result.status < 300 ? (
            <Note tone="ok">{t('health.live.ok')}</Note>
          ) : (
            <Note tone="error">{t('health.live.badStatus', { status: result.status })}</Note>
          )}
          {result.localTitle !== null && result.title !== null && result.localTitle !== result.title && (
            <Note tone="info">{t('health.live.titleDiffers', { live: result.title, local: result.localTitle })}</Note>
          )}
        </>
      )}
    </Section>
  )
}
