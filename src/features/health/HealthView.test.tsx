// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import type { BuildOptions, BuildResult, PageEntry } from '../../lib/api'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { HealthView } from './HealthView'
import { clearSessionState } from './hooks'
import { LINK_CACHE_KEY } from './lib/linkCache'

const { mockApi, mockChecks } = vi.hoisted(() => {
  const texts: Record<string, string> = {
    'content/_index.md': '---\ntitle: Home\n---\n',
    'content/posts/a.md':
      '---\ntitle: A\ndate: 2026-10-03T00:11:40+03:00\n---\nSee [b](/posts/b/#intro) and [gone](/posts/gone/).\nOut: [ext](https://ext.example.com/x) ![i](https://cdn.example.net/i.png)\n',
    'content/posts/b.md': '---\ntitle: B\nbuild:\n  list: never\n---\n## Intro\n[back](../a/)\n',
  }
  const head = (extra: string) =>
    `<!doctype html><html><head><title>Post A</title><meta name="description" content="About A">${extra}</head>`
  const crawlerFiles = {
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    'sitemap.xml':
      '<urlset><url><loc>https://example.org/</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://example.org/posts/a/</loc></url><url><loc>http://localhost:1313/x/</loc></url></urlset>',
    'index.xml':
      '<rss><channel><title>Demo</title><item><title>A</title><description>Short</description></item><item><title></title><description>Short</description></item></channel></rss>',
    'llms.txt': '# Demo\n\n- [A](https://example.org/posts/a/)\n',
  }
  const builds: Record<string, Record<string, string>> = {
    '/tmp/now': {
      'index.html': `${head('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">')}<body></body></html>`,
      'posts/a/index.html': `${head(
        '<meta property="og:title" content="OG A"><meta property="og:image" content="https://example.org/a.png">',
      )}<body><p>new text</p><iframe src="https://www.youtube.com/embed/x"></iframe></body></html>`,
      'posts/b/index.html': '<html><head><title>B</title></head><body><h2 id="other">Intro</h2></body></html>',
      'css/site.css': 'body{}',
      'secret/index.html': '<html><head><meta name="robots" content="noindex, nofollow"></head></html>',
      ...crawlerFiles,
    },
    '/tmp/head': {
      'index.html': `${head('')}<body></body></html>`,
      'posts/a/index.html': `${head('')}<body><p>old text</p></body></html>`,
      'posts/b/index.html': '<html><head><title>B</title></head><body><h2 id="other">Intro</h2></body></html>',
      'css/site.css': 'body{}',
      'secret/index.html': '<html><head><meta name="robots" content="noindex, nofollow"></head></html>',
      ...crawlerFiles,
    },
  }
  const result = (dir: string): BuildResult => ({
    ok: true,
    outputDir: dir,
    files: Object.entries(builds[dir]).map(([path, text]) => ({ path, size: text.length, hash: `${text.length}` })),
    messages: [],
    durationMs: 1200,
  })
  const mockApi = {
    readText: vi.fn(async (path: string) => {
      const text = texts[path]
      if (text === undefined) throw { code: 'io', message: `${path} not found` }
      return { text, version: 'v1' }
    }),
    listArchetypes: vi.fn(async () => [{ name: 'posts', path: 'archetypes/posts.md', source: 'site' }]),
    buildSite: vi.fn(async (options: BuildOptions = {}) => result(options.revision ? '/tmp/head' : '/tmp/now')),
    readBuildFile: vi.fn(async (dir: string, path: string) => {
      const text = builds[dir]?.[path]
      if (text === undefined) throw { code: 'invalid', message: 'not found' }
      return text
    }),
    discardBuild: vi.fn(async () => undefined),
    checkLinks: vi.fn(async (urls: string[]) =>
      urls.map((url) => ({ url, ok: false, status: 404, finalUrl: url, error: null })),
    ),
    fetchPreview: vi.fn(),
    fetchPage: vi.fn(async () => ({ status: 200, finalUrl: 'https://example.org/', body: '<title>Live title</title>' })),
    configEffective: vi.fn(async () => ({
      values: {
        baseurl: 'https://example.org/',
        timezone: 'Europe/Istanbul',
        privacy: { youtube: { disable: false, privacyenhanced: false } },
      },
      messages: [{ level: 'warn', text: 'WARN  deprecated: site config key paginate was deprecated' }],
    })),
    mediaList: vi.fn(async () => [
      { path: 'static/img/trip.jpg', size: 1, width: 1, height: 1, format: 'jpeg', hasGps: true, hasMetadata: true, modifiedMs: 0 },
      { path: 'static/img/clean.png', size: 1, width: 1, height: 1, format: 'png', hasGps: false, hasMetadata: false, modifiedMs: 0 },
    ]),
    gitStatus: vi.fn(async () => ({
      isRepo: true,
      branch: 'main',
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      userName: 'Writer',
      userEmail: 'writer@example.com',
      remoteUrl: null,
    })),
    serverStatus: vi.fn(async () => null),
    historySave: vi.fn(async () => ({})),
    writeText: vi.fn(async () => 'v2'),
  }
  const mockChecks = {
    runChecks: vi.fn((input: { path: string }) =>
      input.path === 'content/posts/a.md'
        ? [{ rule: 'description-empty', severity: 'warn', messageKey: 'rules.descriptionEmpty', line: 2 }]
        : [],
    ),
    archetypeForDocument: vi.fn((_path: string, _text: string, archetypes: { text: string }[]) => archetypes[0]?.text ?? null),
    clearCheckContextCache: vi.fn(),
    loadCheckContext: vi.fn(async () => ({ archetypes: [{ name: 'posts', path: 'archetypes/posts.md', source: 'site', text: 'ARCH' }], siteUsesDescription: true })),
  }
  return { mockApi, mockChecks }
})

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: mockApi }
})
vi.mock('../checks', async (importOriginal) => ({ ...(await importOriginal<typeof import('../checks')>()), ...mockChecks }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function page(path: string, permalink: string, kind = 'page', date = '2026-01-01'): PageEntry {
  return { path, slug: '', title: path, date, expiryDate: '', publishDate: '', draft: false, permalink, kind, section: 'posts' }
}

const site = {
  openFile: vi.fn(),
  showView: vi.fn(),
}

function contextValue(): SiteContextValue {
  return {
    site: { root: 'C:/sites/demo', name: 'demo', configFiles: ['hugo.toml'], contentDir: 'content', isGitRepo: true },
    hugo: null,
    files: ['content/_index.md', 'content/posts/a.md', 'content/posts/b.md'].map((path) => ({ path, title: null, modifiedMs: 0 })),
    pagesAt: '2026-01-01T00:00:00.000Z',
    pages: [
      page('content/_index.md', 'https://example.org/', 'home'),
      page('content/posts/a.md', 'https://example.org/posts/a/', 'page', '2026-02-01'),
      page('content/posts/b.md', 'https://example.org/posts/b/'),
    ],
    reloadFiles: vi.fn(async () => undefined),
    reloadPages: vi.fn(async () => undefined),
    refreshHugo: vi.fn(async () => undefined),
    openFile: site.openFile,
    showView: site.showView,
    configVersion: 0,
    notifyConfigChanged: vi.fn(),
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mount() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root!.render(
      <SiteContext.Provider value={contextValue()}>
        <HealthView />
      </SiteContext.Provider>,
    ),
  )
  await flush()
  return container
}

function unmount() {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
}

/** The visible panel. */
function panel(): HTMLElement {
  return container!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!
}

function buttonIn(scope: HTMLElement, text: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`no button "${text}" in: ${scope.textContent}`)
  return found
}

async function click(element: HTMLElement) {
  act(() => element.click())
  await flush()
}

async function openTab(name: string) {
  await click(buttonIn(container!.querySelector('[role="tablist"]')!, name))
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  clearSessionState()
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  if (root) unmount()
})

describe('HealthView', () => {
  it('runs the content checks on every file and opens a file from the results', async () => {
    await mount()
    await click(buttonIn(panel(), 'Run'))
    expect(mockChecks.runChecks).toHaveBeenCalledTimes(3)
    expect(mockChecks.runChecks).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'content/posts/a.md', archetypeText: 'ARCH', siteUsesDescription: true }),
    )
    expect(mockChecks.clearCheckContextCache).toHaveBeenCalled()
    expect(mockChecks.loadCheckContext).toHaveBeenCalledWith('C:/sites/demo', expect.any(Array))
    expect(panel().textContent).toContain('1 warning')
    expect(panel().textContent).toContain('line 2')
    await click(buttonIn(panel(), 'posts/a.md'))
    expect(site.openFile).toHaveBeenCalledWith('content/posts/a.md')
  })

  it('reports broken internal links and missing anchors with their lines', async () => {
    await mount()
    await openTab('Internal links')
    await click(buttonIn(panel(), 'Run'))
    expect(mockApi.buildSite).toHaveBeenCalledWith({})
    const text = panel().textContent!
    expect(text).toContain('3 internal links checked in 3 files.')
    expect(text).toContain('/posts/gone/')
    expect(text).toContain('nothing at this address')
    expect(text).toContain('no “#intro” on that page')
    expect(text).not.toContain('../a/')
    expect(text).toContain('line 5')
    // The build bar shows the shared build.
    expect(container!.textContent).toContain('Built 9 files in 1.2 s.')
  })

  it('checks external links, using results cached within a day', async () => {
    localStorage.setItem(
      LINK_CACHE_KEY,
      JSON.stringify({
        'https://cdn.example.net/i.png': {
          url: 'https://cdn.example.net/i.png',
          ok: true,
          status: 200,
          finalUrl: 'https://cdn.example.net/i.png',
          error: null,
          checkedAt: Date.now(),
        },
      }),
    )
    await mount()
    await openTab('External links')
    await click(buttonIn(panel(), 'Check links'))
    expect(mockApi.checkLinks).toHaveBeenCalledTimes(1)
    expect(mockApi.checkLinks).toHaveBeenCalledWith(['https://ext.example.com/x'])
    const text = panel().textContent!
    expect(text).toContain('2 external links found in 3 files.')
    expect(text).toContain('1 problem')
    expect(text).toContain('404')
    expect(text).not.toContain('cdn.example.net')
    // The new result was cached too.
    expect(JSON.parse(localStorage.getItem(LINK_CACHE_KEY)!)).toHaveProperty(['https://ext.example.com/x'])
    // Showing everything brings back the cached, working link.
    const onlyProblems = panel().querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await click(onlyProblems)
    expect(panel().textContent).toContain('cdn.example.net')
    expect(panel().textContent).toContain('cached')
  })

  it('audits third-party requests, GPS data and the git identity', async () => {
    await mount()
    await openTab('Privacy')
    const text = () => panel().textContent!
    expect(text()).toContain('1 image carries GPS data.')
    expect(text()).toContain('static/img/trip.jpg')
    expect(text()).not.toContain('clean.png')
    expect(text()).toContain('writer@example.com')
    expect(text()).toContain('privacy.youtube')
    await click(buttonIn(panel(), 'Run'))
    expect(text()).toContain('Google Fonts')
    expect(text()).toContain('YouTube')
    expect(text()).toContain('Self-host the fonts')
    await click(buttonIn(panel(), 'Open Media'))
    expect(site.showView).toHaveBeenCalledWith('media')
  })

  it('finds dates with a UTC offset and rewrites them in UTC after a review', async () => {
    await mount()
    await openTab('Privacy')
    expect(panel().textContent).toContain('timeZone = "Europe/Istanbul"')
    await click(buttonIn(panel(), 'Scan dates'))
    expect(panel().textContent).toContain('+03:00: 1 page')
    await click(buttonIn(panel(), 'Convert to UTC…'))
    expect(panel().textContent).toContain('Review the change to 1 file')
    expect(panel().textContent).toContain('date: 2026-10-02T21:11:40Z')
    expect(mockApi.writeText).not.toHaveBeenCalled()
    await click(buttonIn(panel(), 'Write 1 file'))
    const original = '---\ntitle: A\ndate: 2026-10-03T00:11:40+03:00\n---\n'
    expect(mockApi.historySave).toHaveBeenCalledWith('content/posts/a.md', expect.stringContaining(original), 'manual')
    const [path, text, version] = mockApi.writeText.mock.calls[0] as unknown as [string, string, string]
    expect(path).toBe('content/posts/a.md')
    expect(text).toContain('---\ntitle: A\ndate: 2026-10-02T21:11:40Z\n---\nSee [b]')
    expect(version).toBe('v1')
    expect(mockApi.historySave.mock.invocationCallOrder[0]).toBeLessThan(mockApi.writeText.mock.invocationCallOrder[0])
    expect(panel().textContent).toContain('1 file written.')
  })

  it('shows share cards and hints for a page of the build', async () => {
    await mount()
    await openTab('Share cards')
    const select = panel().querySelector('select')!
    expect(select.value).toBe('https://example.org/posts/a/')
    await click(buttonIn(panel(), 'Show'))
    expect(mockApi.readBuildFile).toHaveBeenCalledWith('/tmp/now', 'posts/a/index.html')
    const text = panel().textContent!
    expect(text).toContain('OG A')
    expect(text).toContain('No twitter:card')
    expect(text).toContain('/a.png')
    for (const network of ['Google', 'X', 'Facebook', 'LinkedIn', 'WhatsApp', 'Telegram']) expect(text).toContain(network)
  })

  it('compares the last commit with the working tree and discards both builds', async () => {
    await mount()
    await openTab('What will change')
    await click(buttonIn(panel(), 'Compare'))
    expect(mockApi.buildSite).toHaveBeenCalledWith({ revision: 'HEAD' })
    expect(mockApi.buildSite).toHaveBeenCalledWith({})
    expect(panel().textContent).toContain('0 added, 2 changed, 0 removed, 7 unchanged.')
    await click(buttonIn(panel(), '/posts/a/'))
    const diff = panel().querySelector('.font-mono.text-xs.dark\\:border-zinc-700')
    expect(diff?.textContent).toContain('old text')
    expect(diff?.textContent).toContain('new text')
    unmount()
    const discarded = mockApi.discardBuild.mock.calls.map((call) => (call as unknown[])[0])
    expect(discarded).toEqual(expect.arrayContaining(['/tmp/head', '/tmp/now']))
  })

  it('lists config warnings and links to the site settings', async () => {
    await mount()
    const tab = buttonIn(container!.querySelector('[role="tablist"]')!, 'Config1')
    await click(tab)
    expect(panel().textContent).toContain('deprecated: site config key paginate was deprecated')
    await click(buttonIn(panel(), 'Site settings'))
    expect(site.showView).toHaveBeenCalledWith('settings')
  })

  it('reports robots.txt, the sitemap, feeds, llms.txt and hidden pages', async () => {
    await mount()
    await openTab('Feeds & crawlers')
    await click(buttonIn(panel(), 'Run'))
    const text = panel().textContent!
    expect(text).toContain('robots.txt disallows the whole site')
    expect(text).toContain('3 addresses in the sitemap.')
    expect(text).toContain('1 of 3 have a last-modified date.')
    expect(text).toContain('http://localhost:1313/x/')
    expect(text).toContain('/index.xml')
    expect(text).toContain('1 without title')
    expect(text).toContain('summaries')
    expect(text).toContain('llms.txt “Demo”: 2 lines, 1 links.')
    expect(text).toContain('1 page asks search engines not to index it')
    expect(text).toContain('/secret/')
    expect(text).toContain('build.list = never')
    await click(buttonIn(panel(), 'posts/b.md'))
    expect(site.openFile).toHaveBeenCalledWith('content/posts/b.md')
  })

  it('checks the live site', async () => {
    await mount()
    await openTab('Live site')
    await click(buttonIn(panel(), 'Check now'))
    expect(mockApi.fetchPage).toHaveBeenCalledWith('https://example.org/')
    const text = panel().textContent!
    expect(text).toContain('200')
    expect(text).toContain('Live title')
    expect(text).toContain('The site is up.')
  })

  it('discards the shared build when the view closes', async () => {
    await mount()
    await openTab('Internal links')
    await click(buttonIn(panel(), 'Run'))
    expect(mockApi.discardBuild).not.toHaveBeenCalled()
    unmount()
    expect(mockApi.discardBuild).toHaveBeenCalledWith('/tmp/now')
  })

  it('keeps results when the view is opened again', async () => {
    await mount()
    await openTab('Internal links')
    await click(buttonIn(panel(), 'Run'))
    unmount()
    await mount()
    expect(panel().textContent).toContain('/posts/gone/')
  })
})
