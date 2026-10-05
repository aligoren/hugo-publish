import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import { api } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'
import { readTexts, useSessionState, type HealthBuild } from '../hooks'
import { pageUrlPath } from '../lib/buildDiff'
import {
  analyzeLlms,
  analyzeRobots,
  analyzeSitemap,
  frontMatterValues,
  hidingFlags,
  pageArticle,
  parseFeed,
  summarizeFeed,
  suspiciousUrls,
  type FeedInfo,
  type LlmsInfo,
  type PageArticle,
  type RobotsInfo,
} from '../lib/feeds'
import { extractMeta } from '../lib/html'
import { findOutput, makeSiteIndex, urlPath } from '../lib/internalLinks'
import { mapLimit } from '../lib/pool'
import { Badge, Note, OpenFileButton, Progress, Section } from '../ui'

/** At most this many feeds and pages are read. */
const MAX_FEEDS = 200
const MAX_PAGES = 3000
/** Feed items are compared with at most this many built pages (the rest are judged by length). */
const MAX_COMPARED_PAGES = 400

interface Report {
  robots: RobotsInfo | null
  robotsEnabled: boolean
  sitemap: { urls: number; withLastmod: number; suspicious: string[]; files: number; invalid: number } | null
  feeds: { path: string; info: FeedInfo }[]
  llms: LlmsInfo | null
  noindex: string[]
  pagesScanned: number
  /** Content files whose front matter keeps them out of lists, the sitemap or search. */
  hidden: { path: string; flags: string[] }[]
}

/** robots.txt, sitemaps, feeds and llms.txt of a production build, plus hidden pages. */
export function Feeds({ build, baseUrl, values }: { build: HealthBuild; baseUrl: string | null; values: Record<string, unknown> | null }) {
  const { t } = useTranslation()
  const { site, files, pages, openFile } = useSite()
  const [report, setReport] = useSessionState<Report | null>('feeds.report', null)
  const [stage, setStage] = useState<{ label: string; done: number; total: number } | null>(null)
  const [error, setError] = useState<unknown>(null)

  async function run() {
    setError(null)
    setStage({ label: t('health.build.building'), done: 0, total: 1 })
    try {
      const built = await build.ensure()
      const paths = built.files.map((f) => f.path)
      const has = new Set(paths)
      const read = (path: string) => build.read(path).catch(() => null)

      const robotsText = has.has('robots.txt') ? await read('robots.txt') : null
      const robots = robotsText === null ? null : analyzeRobots(robotsText)

      const index = makeSiteIndex({ outputFiles: paths, baseUrl, contentDir: site.contentDir, contentFiles: [], pages })
      let sitemap: Report['sitemap'] = null
      if (has.has('sitemap.xml')) {
        const root = analyzeSitemap((await read('sitemap.xml')) ?? '')
        const children = root.isIndex
          ? root.sitemaps.map((loc) => findOutput(urlPath(loc), index)).filter((p): p is string => p !== null)
          : []
        const parts = root.isIndex ? await Promise.all(children.map(async (p) => analyzeSitemap((await read(p)) ?? ''))) : [root]
        const urls = parts.flatMap((p) => p.urls)
        const drafts = new Set(pages.filter((p) => p.draft).map((p) => urlPath(p.permalink)))
        sitemap = {
          urls: urls.length,
          withLastmod: parts.reduce((n, p) => n + p.withLastmod, 0),
          suspicious: suspiciousUrls(urls, drafts),
          files: 1 + children.length,
          invalid: parts.filter((p) => !p.valid).length,
        }
      }

      const feedPaths = paths
        .filter((p) => p.endsWith('.xml') && !/(^|\/)sitemap[^/]*\.xml$/.test(p))
        .sort((a, b) => (a === 'index.xml' ? -1 : b === 'index.xml' ? 1 : a.split('/').length - b.split('/').length || a.localeCompare(b)))
        .slice(0, MAX_FEEDS)
      // Built pages behind feed items, read once each, to tell full posts from summaries.
      const articles = new Map<string, PageArticle | null>()
      const outputFor = (link: string) => findOutput(urlPath(link), index)
      const feeds: Report['feeds'] = []
      for (const path of feedPaths) {
        const text = await read(path)
        const feed = text === null ? null : parseFeed(text)
        if (!feed) continue
        const wanted = [
          ...new Set(feed.items.map((item) => (item.link ? outputFor(item.link) : null)).filter((p): p is string => p !== null)),
        ].filter((p) => !articles.has(p))
        const room = Math.max(0, MAX_COMPARED_PAGES - articles.size)
        const fresh = wanted.slice(0, room)
        const loaded = await mapLimit(fresh, 8, async (p) => {
          const html = await read(p)
          return html === null ? null : pageArticle(html)
        })
        fresh.forEach((p, i) => articles.set(p, loaded[i]))
        const info = summarizeFeed(feed, (link) => {
          const output = outputFor(link)
          return output === null ? null : (articles.get(output) ?? null)
        })
        feeds.push({ path, info })
      }

      const llmsText = has.has('llms.txt') ? await read('llms.txt') : null

      const htmlPages = paths.filter((p) => /\.html?$/i.test(p)).slice(0, MAX_PAGES)
      const label = t('health.feeds.scanning')
      setStage({ label, done: 0, total: htmlPages.length })
      const flags = await mapLimit(
        htmlPages,
        8,
        async (path) => {
          const html = await read(path)
          const robotsMeta = html === null ? null : extractMeta(html).robots
          return robotsMeta !== null && /\bnoindex\b|\bnone\b/i.test(robotsMeta)
        },
        { onProgress: (done) => setStage({ label, done, total: htmlPages.length }) },
      )
      const noindex = htmlPages.filter((_, i) => flags[i]).map(pageUrlPath)

      const contentLabel = t('health.readingFiles')
      const texts = await readTexts(
        files.map((f) => f.path),
        { onProgress: (done) => setStage({ label: contentLabel, done, total: files.length }) },
      )
      const hidden: Report['hidden'] = []
      for (const [path, text] of texts) {
        const flags = hidingFlags(await frontMatterValues(text, api))
        if (flags.length > 0) hidden.push({ path, flags })
      }

      setReport({
        robots,
        robotsEnabled: values?.enablerobotstxt === true,
        sitemap,
        feeds,
        llms: llmsText === null ? null : analyzeLlms(llmsText),
        noindex,
        pagesScanned: htmlPages.length,
        hidden,
      })
    } catch (failure) {
      setError(failure)
    } finally {
      setStage(null)
    }
  }

  const mainFeed = report?.feeds[0]

  return (
    <Section
      id="health-feeds"
      title={t('health.feeds.title')}
      intro={t('health.feeds.intro')}
      actions={
        <button className="btn btn-primary" disabled={stage !== null} onClick={() => void run()}>
          {report ? t('health.runAgain') : t('health.run')}
        </button>
      }
    >
      {stage && <Progress done={stage.done} total={stage.total} label={stage.label} />}
      {error !== null && <ErrorNote error={error} />}
      {report && !stage && (
        <div className="space-y-4 text-sm">
          <Part title="robots.txt">
            {report.robots === null ? (
              <Note tone="warn">{t(report.robotsEnabled ? 'health.feeds.robotsMissing' : 'health.feeds.robotsDisabled')}</Note>
            ) : report.robots.disallowAll ? (
              <Note tone="error">{t('health.feeds.robotsBlocksAll')}</Note>
            ) : (
              <Note tone="ok">{t('health.feeds.robotsOk', { count: report.robots.disallowRules })}</Note>
            )}
            {report.robots && report.robots.sitemaps.length === 0 && (
              <p className="text-xs text-zinc-500">{t('health.feeds.robotsNoSitemap')}</p>
            )}
          </Part>

          <Part title="sitemap.xml">
            {report.sitemap === null ? (
              <Note tone="warn">{t('health.feeds.sitemapMissing')}</Note>
            ) : (
              <>
                <p>
                  {t('health.feeds.sitemapUrls', { count: report.sitemap.urls })}{' '}
                  <span className="text-zinc-500">
                    {t('health.feeds.sitemapLastmod', { count: report.sitemap.withLastmod, total: report.sitemap.urls })}
                  </span>
                </p>
                {report.sitemap.invalid > 0 && (
                  <Note tone="error">{t('health.feeds.sitemapInvalid', { count: report.sitemap.invalid })}</Note>
                )}
                {report.sitemap.suspicious.length > 0 ? (
                  <Note tone="warn">
                    <p>{t('health.feeds.sitemapSuspicious', { count: report.sitemap.suspicious.length })}</p>
                    <ul className="mt-1 font-mono text-xs">
                      {report.sitemap.suspicious.slice(0, 20).map((url) => (
                        <li key={url} className="break-all">
                          {url}
                        </li>
                      ))}
                    </ul>
                  </Note>
                ) : (
                  <p className="text-xs text-zinc-500">{t('health.feeds.sitemapClean')}</p>
                )}
              </>
            )}
          </Part>

          <Part title={t('health.feeds.feeds')}>
            {!mainFeed ? (
              <Note tone="warn">{t('health.feeds.noFeeds')}</Note>
            ) : (
              <>
                <p>{t('health.feeds.feedCount', { count: report.feeds.length })}</p>
                <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">{t('health.feeds.feed')}</th>
                        <th className="px-2 py-1.5 font-medium">{t('health.feeds.items')}</th>
                        <th className="px-2 py-1.5 font-medium">{t('health.feeds.content')}</th>
                        <th className="px-2 py-1.5 font-medium">{t('health.feeds.problems')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {report.feeds.slice(0, 30).map(({ path, info }) => (
                        <tr key={path}>
                          <td className="px-2 py-1.5 font-mono">/{path}</td>
                          <td className="px-2 py-1.5">{info.items}</td>
                          <td className="px-2 py-1.5">
                            <Badge tone={info.content === 'full' ? 'sky' : 'neutral'}>{t(`health.feeds.modes.${info.content}`)}</Badge>
                          </td>
                          <td className="px-2 py-1.5">
                            {info.invalid && <Badge tone="amber">{t('health.feeds.invalidFeed')}</Badge>}{' '}
                            {info.missingTitles > 0 && (
                              <Badge tone="amber">{t('health.feeds.missingTitles', { count: info.missingTitles })}</Badge>
                            )}{' '}
                            {info.missingDescriptions > 0 && (
                              <Badge tone="amber">{t('health.feeds.missingDescriptions', { count: info.missingDescriptions })}</Badge>
                            )}
                            {info.missingTitles + info.missingDescriptions === 0 && !info.invalid && (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {mainFeed.info.items > 0 && (
                  <p className="text-xs text-zinc-500">
                    {t('health.feeds.compared', { count: mainFeed.info.compared, items: mainFeed.info.items })}
                  </p>
                )}
                {mainFeed.info.content === 'full' && <p className="text-xs text-zinc-500">{t('health.feeds.fullNote')}</p>}
                {mainFeed.info.items === 0 && <Note tone="warn">{t('health.feeds.emptyFeed')}</Note>}
              </>
            )}
          </Part>

          <Part title="llms.txt">
            {report.llms === null ? (
              <p className="text-zinc-500">{t('health.feeds.noLlms')}</p>
            ) : (
              <p>
                {t('health.feeds.llms', { title: report.llms.title ?? '—', lines: report.llms.lines, links: report.llms.links })}
              </p>
            )}
          </Part>

          <Part title={t('health.feeds.hidden')}>
            {report.noindex.length === 0 ? (
              <p className="text-zinc-500">{t('health.feeds.noNoindex', { count: report.pagesScanned })}</p>
            ) : (
              <>
                <p>{t('health.feeds.noindex', { count: report.noindex.length })}</p>
                <ul className="font-mono text-xs">
                  {report.noindex.slice(0, 50).map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                  {report.noindex.length > 50 && <li className="text-zinc-500">…</li>}
                </ul>
              </>
            )}
            {report.hidden.length === 0 ? (
              <p className="text-zinc-500">{t('health.feeds.noUnlisted')}</p>
            ) : (
              <>
                <p>{t('health.feeds.unlisted', { count: report.hidden.length })}</p>
                <ul className="space-y-0.5">
                  {report.hidden.map((h) => (
                    <li key={h.path} className="flex flex-wrap items-center gap-2">
                      <OpenFileButton path={h.path} onOpen={openFile} />
                      {h.flags.map((flag) => (
                        <Badge key={flag}>{flag}</Badge>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Part>
        </div>
      )}
    </Section>
  )
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="font-medium">{title}</h3>
      {children}
    </div>
  )
}
