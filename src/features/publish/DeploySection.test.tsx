// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import type { PageEntry } from '../../lib/api'
import { testSiteContext } from '../checks/testing'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { DeploySection } from './DeploySection'
import { DeployTracker } from './DeployTracker'
import { ScheduledPanel } from './ScheduledPanel'
import { SharePanel } from './SharePanel'
import { gitStatus } from './testing'
import type { TrackerTimings } from './tracking'

const api = vi.hoisted(() => ({
  readText: vi.fn(),
  writeText: vi.fn(),
  tomlParseText: vi.fn(),
  tomlEditText: vi.fn(),
  configEffective: vi.fn(),
  fetchPage: vi.fn(),
}))
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<object>()), api }))
const deployApi = vi.hoisted(() => ({
  commitFiles: vi.fn(),
  status: vi.fn(),
  ghPages: vi.fn(),
  previewPush: vi.fn(),
  previewDelete: vi.fn(),
  previewList: vi.fn(),
  onProgress: vi.fn(),
}))
vi.mock('./deployApi', () => ({ deployApi }))
const notify = vi.hoisted(() => ({ notifyInBackground: vi.fn(async () => {}) }))
vi.mock('./notify', () => notify)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FAST: TrackerTimings = { pollMs: 1, maxMs: 1000, emptyPolls: 2, retryDelays: [0, 1, 1] }
const SHA = 'c'.repeat(40)

function page(path: string, title: string, overrides: Partial<PageEntry> = {}): PageEntry {
  const slug = path.replace(/^content\//, '').replace(/\.md$/, '')
  return {
    path,
    slug,
    title,
    date: '2026-01-01T00:00:00Z',
    expiryDate: '',
    publishDate: '2026-01-01T00:00:00Z',
    draft: false,
    permalink: `https://example.org/${slug}/`,
    kind: 'page',
    section: 'posts',
    ...overrides,
  }
}

const pages = [
  page('content/posts/ilk.md', 'İlk yazı'),
  page('content/posts/gelecek.md', 'Gelecek yazı', { publishDate: '2999-05-01T09:00:00Z' }),
]

let context: SiteContextValue
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<SiteContext.Provider value={context}>{element}</SiteContext.Provider>))
  await flush()
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 2)))
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text))
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  for (const fn of [...Object.values(api), ...Object.values(deployApi), notify.notifyInBackground]) fn.mockReset()
  context = testSiteContext({ pages })
  api.readText.mockRejectedValue({ code: 'io', message: 'missing' })
  api.configEffective.mockResolvedValue({ values: { baseurl: 'https://example.org/' }, messages: [] })
  deployApi.onProgress.mockResolvedValue(() => {})
})

describe('DeployTracker', () => {
  it('waits for the checks, then verifies the changed pages live and notifies', async () => {
    deployApi.status
      .mockResolvedValueOnce({ owner: 'a', repo: 'b', sha: SHA, checks: [], source: 'api', needsAuth: false })
      .mockResolvedValueOnce({
        owner: 'a',
        repo: 'b',
        sha: SHA,
        checks: [{ name: 'Cloudflare Pages', status: 'in_progress', conclusion: null, url: null }],
        source: 'api',
        needsAuth: false,
      })
      .mockResolvedValue({
        owner: 'a',
        repo: 'b',
        sha: SHA,
        checks: [{ name: 'Cloudflare Pages', status: 'completed', conclusion: 'success', url: 'https://dash.cloudflare.com/x' }],
        source: 'api',
        needsAuth: false,
      })
    deployApi.commitFiles.mockResolvedValue({ sha: SHA, files: ['content/posts/ilk.md', 'hugo.toml'] })
    api.fetchPage
      .mockResolvedValueOnce({ status: 200, finalUrl: '', body: '<title>Old title | Blog</title>' })
      .mockResolvedValue({ status: 200, finalUrl: '', body: '<title>İlk yazı | Blog</title>' })
    const container = await mount(
      <DeployTracker target={{ rev: SHA, kind: 'push' }} liveUrl="https://live.example.com" baseUrl={null} forge="github" onClose={() => {}} timings={FAST} />,
    )
    await flush(20)
    expect(deployApi.status).toHaveBeenCalledWith(SHA)
    expect(container.querySelector('[data-state]')!.getAttribute('data-state')).toBe('success')
    expect(container.textContent).toContain('Cloudflare Pages')
    expect(api.fetchPage).toHaveBeenCalledWith('https://live.example.com/posts/ilk/')
    expect(api.fetchPage).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-live]')!.getAttribute('data-live')).toBe('ok')
    expect(container.textContent).toContain('The changed pages are online.')
    expect(notify.notifyInBackground).toHaveBeenCalledWith('Site published', expect.stringContaining('site'))
  })

  it('reports failed builds without checking the live site', async () => {
    deployApi.status.mockResolvedValue({
      owner: 'a',
      repo: 'b',
      sha: SHA,
      checks: [{ name: 'build', status: 'completed', conclusion: 'failure', url: null }],
      source: 'gh',
      needsAuth: false,
    })
    const container = await mount(
      <DeployTracker target={{ rev: SHA, kind: 'push' }} liveUrl="" baseUrl={null} forge="github" onClose={() => {}} timings={FAST} />,
    )
    expect(container.textContent).toContain('The build failed.')
    expect(api.fetchPage).not.toHaveBeenCalled()
    expect(notify.notifyInBackground).toHaveBeenCalledWith('Publishing failed', expect.any(String))
  })

  it('explains private repositories and checks the home page when no posts changed', async () => {
    deployApi.status.mockResolvedValue({ owner: 'a', repo: 'b', sha: SHA, checks: [], source: 'api', needsAuth: true })
    deployApi.commitFiles.mockResolvedValue({ sha: SHA, files: ['hugo.toml'] })
    api.fetchPage.mockResolvedValue({ status: 404, finalUrl: '', body: '' })
    const container = await mount(
      <DeployTracker target={{ rev: SHA, kind: 'push' }} liveUrl="" baseUrl="https://example.org/" forge="github" onClose={() => {}} timings={FAST} />,
    )
    await flush(10)
    expect(container.textContent).toContain('gh auth login')
    expect(api.fetchPage).toHaveBeenCalledWith('https://example.org/')
    expect(container.querySelector('[data-live]')!.getAttribute('data-live')).toBe('status')
    expect(container.textContent).toContain('HTTP 404')
    expect(api.fetchPage).toHaveBeenCalledTimes(3)
  })

  it('skips checks for non-GitHub remotes', async () => {
    deployApi.commitFiles.mockResolvedValue({ sha: SHA, files: [] })
    api.fetchPage.mockResolvedValue({ status: 200, finalUrl: '', body: '<title>Blog</title>' })
    const container = await mount(
      <DeployTracker target={{ rev: SHA, kind: 'push' }} liveUrl="" baseUrl="https://example.org/" forge={null} onClose={() => {}} timings={FAST} />,
    )
    expect(deployApi.status).not.toHaveBeenCalled()
    expect(container.textContent).toContain('GitHub, GitLab and Gitea/Forgejo')
  })

  it('reads GitLab pipelines and explains private projects', async () => {
    deployApi.commitFiles.mockResolvedValue({ sha: SHA, files: [] })
    api.fetchPage.mockResolvedValue({ status: 200, finalUrl: '', body: '<title>Blog</title>' })
    deployApi.status.mockResolvedValue({
      owner: 'group/sub',
      repo: 'blog',
      sha: SHA,
      checks: [
        { name: 'pipeline #12 (main)', status: 'completed', conclusion: 'success', url: 'https://gitlab.com/p/12' },
        { name: 'pages', status: 'completed', conclusion: 'success', url: null },
      ],
      source: 'api',
      needsAuth: false,
      forge: 'gitlab',
    })
    const container = await mount(
      <DeployTracker target={{ rev: SHA, kind: 'push' }} liveUrl="" baseUrl="https://example.org/" forge="gitlab" onClose={() => {}} timings={FAST} />,
    )
    await flush(10)
    expect(container.textContent).toContain('Built successfully.')
    expect(container.textContent).toContain('GitLab CI')
    expect(container.textContent).toContain('GitLab Pages')

    deployApi.status.mockResolvedValue({ owner: 'a', repo: 'b', sha: SHA, checks: [], source: 'api', needsAuth: true, forge: 'gitea' })
    const hidden = await mount(
      <DeployTracker target={{ rev: SHA, kind: 'push' }} liveUrl="" baseUrl="https://example.org/" forge="gitea" onClose={() => {}} timings={FAST} />,
    )
    await flush(10)
    expect(hidden.textContent).toContain('read without signing in')
    expect(hidden.textContent).not.toContain('gh auth login')
  })
})

describe('DeploySection', () => {
  it('creates the settings file after showing the diff', async () => {
    api.tomlEditText.mockResolvedValue('[deploy]\nmethod = "gh-pages"\nbranch = "gh-pages"\n')
    api.writeText.mockResolvedValue('v1')
    const container = await mount(
      <DeploySection status={gitStatus()} pushedSha={null} busy={false} shareName="" onPublished={() => {}} timings={FAST} />,
    )
    const radio = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')][1]
    act(() => radio.click())
    await act(async () => button(container, 'Review changes').click())
    expect(api.tomlEditText).toHaveBeenCalledWith('', [
      { op: 'set', path: ['deploy', 'method'], value: 'gh-pages' },
      { op: 'set', path: ['deploy', 'branch'], value: 'gh-pages' },
    ])
    expect(container.textContent).toContain('method = "gh-pages"')
    await act(async () => button(container, 'Save settings').click())
    expect(api.writeText).toHaveBeenCalledWith('.hugo-publisher/site.toml', '[deploy]\nmethod = "gh-pages"\nbranch = "gh-pages"\n', '')
  })

  it('publishes with the gh-pages method and follows the branch', async () => {
    api.readText.mockResolvedValue({ text: "[deploy]\nmethod = 'gh-pages'\nbranch = 'pages'\n", version: 'v1' })
    api.tomlParseText.mockResolvedValue({ values: { deploy: { method: 'gh-pages', branch: 'pages' } }, comments: {} })
    deployApi.ghPages.mockResolvedValue({ branch: 'pages', commit: 'abc1234', pushed: true, upToDate: false, files: 12, output: '' })
    deployApi.status.mockResolvedValue({ owner: 'yazar', repo: 'blog', sha: SHA, checks: [], source: 'api', needsAuth: false })
    deployApi.commitFiles.mockResolvedValue({ sha: SHA, files: ['index.html'] })
    api.fetchPage.mockResolvedValue({ status: 200, finalUrl: '', body: '<title>Blog</title>' })
    const onPublished = vi.fn()
    const container = await mount(
      <DeploySection status={gitStatus()} pushedSha={null} busy={false} shareName="" onPublished={onPublished} timings={FAST} />,
    )
    await act(async () => button(container, 'Build and publish to pages').click())
    await flush(10)
    expect(deployApi.ghPages).toHaveBeenCalledWith('pages', expect.stringMatching(/^Publish: \d{4}-\d\d-\d\d \d\d:\d\d$/))
    expect(container.textContent).toContain('Published 12 files to pages (abc1234).')
    expect(onPublished).toHaveBeenCalled()
    expect(deployApi.status).toHaveBeenCalledWith('refs/heads/pages')
    expect(api.fetchPage).toHaveBeenCalledWith('https://example.org/')
  })

  it('follows pushes from the Publish view with the push method', async () => {
    deployApi.status.mockResolvedValue({ owner: 'yazar', repo: 'blog', sha: SHA, checks: [], source: 'api', needsAuth: false })
    deployApi.commitFiles.mockResolvedValue({ sha: SHA, files: [] })
    api.fetchPage.mockResolvedValue({ status: 200, finalUrl: '', body: '' })
    const container = await mount(
      <DeploySection status={gitStatus()} pushedSha={SHA} busy={false} shareName="" onPublished={() => {}} timings={FAST} />,
    )
    expect(container.querySelector('section[aria-label="Deploy status"]')).not.toBeNull()
    expect(deployApi.status).toHaveBeenCalledWith(SHA)
  })
})

describe('ScheduledPanel', () => {
  it('lists future posts and writes the workflow with instructions', async () => {
    api.writeText.mockResolvedValue('v1')
    const container = await mount(<ScheduledPanel method="push" repo={{ owner: 'yazar', repo: 'blog' }} now={new Date('2026-10-04T00:00:00Z')} />)
    expect(container.textContent).toContain('1 post scheduled for later')
    expect(container.textContent).toContain('Gelecek yazı')
    expect(container.querySelector<HTMLAnchorElement>('a[href*="settings/secrets/actions"]')!.href).toBe(
      'https://github.com/yazar/blog/settings/secrets/actions',
    )
    setValue(container.querySelector('select')!, '7')
    act(() => button(container, 'Show the workflow').click())
    expect(container.querySelector('[data-testid="workflow-yaml"]')!.textContent).toContain("cron: '5 7 * * *'")
    await act(async () => button(container, 'Create .github/workflows/scheduled-rebuild.yml').click())
    expect(api.writeText).toHaveBeenCalledWith('.github/workflows/scheduled-rebuild.yml', expect.stringContaining('DEPLOY_HOOK_URL'), '')
    expect(container.textContent).toContain('Created. Commit and push it')
  })

  it('does not overwrite an existing workflow', async () => {
    api.writeText.mockRejectedValue({ code: 'conflict', message: 'changed' })
    const container = await mount(<ScheduledPanel method="push" repo={null} now={new Date('2026-10-04T00:00:00Z')} />)
    await act(async () => button(container, 'Create').click())
    expect(container.textContent).toContain('already exists')
  })

  it('shows reminders for the gh-pages method and nothing without future posts', async () => {
    let container = await mount(<ScheduledPanel method="gh-pages" repo={null} now={new Date('2026-10-04T00:00:00Z')} />)
    expect(container.textContent).toContain('publish again')
    expect(container.querySelector('button')).toBeNull()
    cleanups.pop()!()
    container = await mount(<ScheduledPanel method="push" repo={null} now={new Date('3000-01-01T00:00:00Z')} />)
    expect(container.textContent).toBe('')
  })
})

describe('SharePanel', () => {
  it('pushes a preview branch, shows its Cloudflare address, lists and deletes branches', async () => {
    deployApi.previewPush.mockResolvedValue({ output: '' })
    deployApi.previewList.mockResolvedValue(['preview/eski', 'preview/ilk-yazi'])
    deployApi.previewDelete.mockResolvedValue({ output: '' })
    const container = await mount(<SharePanel cloudflareProject="benim-blog" suggestedName="İlk Yazı" disabled={false} />)
    expect(container.textContent).toContain('becomes public')
    expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('ilk-yazi')
    await act(async () => button(container, 'Push the preview').click())
    expect(deployApi.previewPush).toHaveBeenCalledWith('preview/ilk-yazi')
    expect(container.querySelector<HTMLAnchorElement>('a')!.href).toBe('https://preview-ilk-yazi.benim-blog.pages.dev/')
    await act(async () => button(container, 'Show shared previews').click())
    expect(container.querySelectorAll('li')).toHaveLength(2)
    await act(async () => container.querySelectorAll('li')[0].querySelector('button')!.click())
    expect(deployApi.previewDelete).toHaveBeenCalledWith('preview/eski')
    expect(container.querySelectorAll('li')).toHaveLength(1)
  })

  it('explains git errors and missing project names', async () => {
    deployApi.previewPush.mockRejectedValueOnce({ code: 'git_rejected', message: '! [rejected]' }).mockResolvedValue({ output: '' })
    const container = await mount(<SharePanel cloudflareProject="" suggestedName="" disabled={false} />)
    await act(async () => button(container, 'Push the preview').click())
    expect(container.querySelector('[data-code="git_rejected"]')).not.toBeNull()
    await act(async () => button(container, 'Push the preview').click())
    expect(deployApi.previewPush).toHaveBeenLastCalledWith('preview/taslak')
    expect(container.textContent).toContain('Set the Cloudflare Pages project')
  })
})
