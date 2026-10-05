import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import { api, previewUrl, type PageEntry } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'
import { useSessionState, type HealthBuild } from '../hooks'
import { extractMeta, type PageMeta } from '../lib/html'
import { makeSiteIndex, pageOutput, parseBaseUrl } from '../lib/internalLinks'
import { cardHints, cardInfo } from '../lib/socialCard'
import { Badge, Note, Section } from '../ui'
import {
  FacebookCardMock,
  LinkedInCardMock,
  SearchResultMock,
  TelegramCardMock,
  WhatsAppCardMock,
  XCardMock,
  type ImageContext,
} from './SocialCards'

type Source = 'build' | 'preview'

/** The chosen page has no file in the build (a draft, a future or expired page). */
class NotBuilt extends Error {}

interface Loaded {
  permalink: string
  source: Source
  meta: PageMeta
}

/** Home first, then pages newest first, then sections and the rest. */
function sortPages(pages: PageEntry[]): PageEntry[] {
  const rank = (p: PageEntry) => (p.kind === 'home' ? 0 : p.kind === 'page' ? 1 : 2)
  return pages.toSorted((a, b) => rank(a) - rank(b) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
}

/** How a page looks when shared on social networks and in a search result. */
export function SocialPreview({ build, baseUrl }: { build: HealthBuild; baseUrl: string | null }) {
  const { t } = useTranslation()
  const { pages, site, files } = useSite()
  const sorted = useMemo(() => sortPages(pages), [pages])
  const [permalink, setPermalink] = useSessionState<string>('social.page', '')
  const [source, setSource] = useState<Source>('build')
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useSessionState<Loaded | null>('social.loaded', null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const chosen = permalink || sorted.find((p) => p.kind === 'page')?.permalink || sorted[0]?.permalink || ''

  useEffect(() => {
    let cancelled = false
    api.serverStatus().then(
      (status) => !cancelled && setServerUrl(status?.url ?? null),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function load() {
    setError(null)
    setLoading(true)
    try {
      let html: string
      if (source === 'preview' && serverUrl) {
        html = await api.fetchPreview(previewUrl(serverUrl, chosen))
      } else {
        const built = await build.ensure()
        const page = pages.find((p) => p.permalink === chosen)
        const index = makeSiteIndex({
          outputFiles: built.files.map((f) => f.path),
          baseUrl,
          contentDir: site.contentDir,
          contentFiles: files.map((f) => f.path),
          pages,
        })
        const output = page ? pageOutput(page, index) : null
        if (!output) throw new NotBuilt()
        html = await build.read(output)
      }
      setLoaded({ permalink: chosen, source, meta: extractMeta(html) })
    } catch (failure) {
      setLoaded(null)
      setError(failure)
    } finally {
      setLoading(false)
    }
  }

  const context: ImageContext = { siteHost: parseBaseUrl(baseUrl).host, serverUrl }
  const info = loaded ? cardInfo(loaded.meta, loaded.permalink) : null
  const hints = loaded ? cardHints(loaded.meta) : []

  return (
    <Section id="health-social" title={t('health.social.title')} intro={t('health.social.intro')}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="field min-w-0 flex-1">
          <span>{t('health.social.page')}</span>
          <select value={chosen} onChange={(e) => setPermalink(e.target.value)}>
            {sorted.map((page) => (
              <option key={`${page.path}-${page.permalink}`} value={page.permalink}>
                {(page.title || page.path) + (page.draft ? ` (${t('health.social.draft')})` : '')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('health.social.source')}</span>
          <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
            <option value="build">{t('health.social.fromBuild')}</option>
            <option value="preview" disabled={!serverUrl}>
              {t('health.social.fromPreview')}
            </option>
          </select>
        </label>
        <button className="btn btn-primary" disabled={loading || !chosen} onClick={() => void load()}>
          {t('health.social.show')}
        </button>
      </div>
      {error instanceof NotBuilt ? (
        <Note tone="warn">{t('health.social.notBuilt')}</Note>
      ) : (
        error !== null && <ErrorNote error={error} />
      )}
      {loaded && info && !loading && (
        <>
          {hints.length === 0 ? (
            <Note tone="ok">{t('health.social.allGood')}</Note>
          ) : (
            <ul className="space-y-1 text-sm">
              {hints.map((hint) => (
                <li key={hint.key} className="flex items-start gap-2">
                  <Badge tone={hint.severity === 'warn' ? 'amber' : 'sky'}>{t(`health.severity.${hint.severity}`)}</Badge>
                  <span>{t(`health.social.hints.${hint.key}`, hint.params)}</span>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-zinc-500">title</dt>
            <dd className="break-words">{loaded.meta.title ?? '—'}</dd>
            <dt className="text-zinc-500">description</dt>
            <dd className="break-words">{loaded.meta.description ?? '—'}</dd>
            {Object.entries(loaded.meta.og).map(([key, value]) => (
              <FragmentRow key={`og-${key}`} name={`og:${key}`} value={value} />
            ))}
            {Object.entries(loaded.meta.twitter).map(([key, value]) => (
              <FragmentRow key={`tw-${key}`} name={`twitter:${key}`} value={value} />
            ))}
          </dl>
          <div className="grid gap-4 md:grid-cols-2">
            <SearchResultMock meta={loaded.meta} info={info} />
            <XCardMock meta={loaded.meta} info={info} context={context} />
            <FacebookCardMock info={info} context={context} />
            <LinkedInCardMock info={info} context={context} />
            <WhatsAppCardMock info={info} context={context} />
            <TelegramCardMock info={info} context={context} />
          </div>
          <p className="text-xs text-zinc-500">{t('health.social.imagesNote')}</p>
        </>
      )}
    </Section>
  )
}

function FragmentRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="font-mono text-zinc-500">{name}</dt>
      <dd className="break-all">{value}</dd>
    </>
  )
}
