// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import type { ContentFile } from '../../lib/api'
import { clearCheckContextCache } from '../checks/context'
import { testSiteContext } from '../checks/testing'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { PublishView } from './PublishView'
import { gitFile, gitStatus } from './testing'

const api = vi.hoisted(() => ({
  gitStatus: vi.fn(),
  gitDiff: vi.fn(),
  gitCommit: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitFetch: vi.fn(),
  readText: vi.fn(),
  listArchetypes: vi.fn(),
  configEffective: vi.fn(),
  tomlParseText: vi.fn(),
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

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const contentFiles: ContentFile[] = [
  { path: 'content/posts/yeni.md', title: 'Yeni yazı', modifiedMs: 2 },
  { path: 'content/posts/eski.md', title: 'Eski yazı', modifiedMs: 1 },
]
const texts: Record<string, string> = {
  'content/posts/yeni.md': '---\ntitle: Yeni yazı\ndescription: ""\n---\n\nBuraya giriş yazılacak.\n',
  'content/posts/eski.md': '---\ntitle: Eski yazı\ndescription: Özet\n---\n\nTamam bir metin.\n',
  'archetypes/posts.md': '---\ntitle: ""\ndescription: ""\n---\n\nBuraya giriş yazılacak.\n',
}

let siteContext: SiteContextValue
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <SiteContext.Provider value={siteContext}>
        <PublishView />
      </SiteContext.Provider>,
    ),
  )
  await flush()
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {})
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text))
  if (!found) throw new Error(`no button "${text}" in: ${[...container.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`)
  return found
}

function click(element: HTMLElement) {
  return act(async () => element.click())
}

const message = (container: HTMLElement) => container.querySelector('textarea')!.value

beforeEach(async () => {
  await i18n.changeLanguage('tr')
  clearCheckContextCache()
  for (const fn of [...Object.values(api), ...Object.values(deployApi)]) fn.mockReset()
  api.gitFetch.mockResolvedValue({ output: '' })
  api.configEffective.mockResolvedValue({ values: { baseurl: 'https://example.org/' }, messages: [] })
  deployApi.commitFiles.mockResolvedValue({ sha: 'a'.repeat(40), files: [] })
  deployApi.status.mockResolvedValue({ owner: 'yazar', repo: 'blog', sha: 'a'.repeat(40), checks: [], source: 'api', needsAuth: false })
  api.readText.mockImplementation(async (path: string) => {
    if (!(path in texts)) throw { code: 'io', message: 'missing' }
    return { text: texts[path], version: 'v' }
  })
  api.listArchetypes.mockResolvedValue([{ name: 'posts', path: 'archetypes/posts.md', source: 'site' }])
  siteContext = testSiteContext({ files: contentFiles })
})

describe('PublishView', () => {
  it('groups changes with titles and suggests a message in the UI language', async () => {
    api.gitStatus.mockResolvedValue(
      gitStatus({
        ahead: 1,
        files: [
          gitFile('content/posts/yeni.md', 'untracked'),
          gitFile('hugo.toml'),
          gitFile('static/logo.png', 'untracked'),
        ],
      }),
    )
    const container = await mount()
    const groups = [...container.querySelectorAll('section[aria-label] > h2')].map((h) => h.textContent)
    expect(groups).toEqual(['Yazılar ve sayfalar(1)', 'Site ayarları(1)', 'Medya ve statik dosyalar(1)', 'Yayından önce', 'Yayın'])
    expect(container.textContent).toContain('Yeni yazı')
    expect(container.textContent).toContain('origin/main')
    expect(message(container)).toBe('Yazı eklendi: Yeni yazı; 1 görsel eklendi; site ayarları güncellendi')

    // Deselecting a file updates the suggestion.
    const settings = container.querySelector<HTMLInputElement>('input[aria-label="hugo.toml yayınlansın"]')!
    await click(settings)
    expect(message(container)).toBe('Yazı eklendi: Yeni yazı; 1 görsel eklendi')
  })

  it('shows pre-publish checks and asks before committing with problems', async () => {
    api.gitStatus.mockResolvedValue(gitStatus({ files: [gitFile('content/posts/yeni.md', 'untracked')] }))
    api.gitCommit.mockResolvedValue('abc1234')
    const container = await mount()
    const checks = container.querySelector('section[aria-label="Yayından önce"]')!
    expect(checks.textContent).toContain('Açıklama boş')
    expect(checks.textContent).toContain('Şablondan kalmış: “Buraya giriş yazılacak.”')

    await click(button(container, 'Commit et'))
    expect(api.gitCommit).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Yine de yayınlansın mı?')
    await click(button(container, 'Yine de yayınla'))
    await flush()
    expect(api.gitCommit).toHaveBeenCalledWith('Yazı eklendi: Yeni yazı', ['content/posts/yeni.md'])
    expect(container.textContent).toContain('abc1234 olarak commit edildi.')
    // On open, again after the background fetch, and after the commit.
    expect(api.gitStatus).toHaveBeenCalledTimes(3)
  })

  it('commits renames with both paths and an edited message, then pushes', async () => {
    api.gitStatus.mockResolvedValue(gitStatus({ files: [gitFile('content/posts/eski.md', 'renamed', 'content/posts/old.md')] }))
    api.gitCommit.mockResolvedValue('def5678')
    api.gitPush.mockResolvedValue({ output: 'To github.com:yazar/blog.git\n   a..b  main -> main' })
    const container = await mount()
    expect(message(container)).toBe('Yazı güncellendi: Eski yazı')
    const textarea = container.querySelector('textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(textarea, 'Taşındı: "eski" yazı')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button(container, 'Commit et ve gönder'))
    await flush()
    expect(api.gitCommit).toHaveBeenCalledWith('Taşındı: "eski" yazı', ['content/posts/eski.md', 'content/posts/old.md'])
    expect(api.gitPush).toHaveBeenCalled()
    expect(container.textContent).toContain('Uzak depoya gönderildi.')
  })

  it('fetches in the background on open and on refresh, ignoring network errors', async () => {
    api.gitStatus.mockResolvedValueOnce(gitStatus()).mockResolvedValue(gitStatus({ behind: 3 }))
    api.gitFetch.mockRejectedValueOnce({ code: 'git_network', message: 'offline' })
    const container = await mount()
    expect(api.gitFetch).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('uzak depoda 3 yeni commit')
    await click(button(container, 'Yenile'))
    await flush()
    expect(api.gitFetch).toHaveBeenCalledTimes(2)
  })

  it('does not fetch without a remote', async () => {
    api.gitStatus.mockResolvedValue(gitStatus({ remoteUrl: null, upstream: null }))
    await mount()
    expect(api.gitFetch).not.toHaveBeenCalled()
  })

  it('follows a push: deploy status and the live page', async () => {
    api.gitStatus.mockResolvedValue(gitStatus({ ahead: 1 }))
    api.gitPush.mockResolvedValue({ output: 'main -> main' })
    deployApi.commitFiles.mockResolvedValue({ sha: 'b'.repeat(40), files: [] })
    deployApi.status.mockResolvedValue({
      owner: 'yazar',
      repo: 'blog',
      sha: 'b'.repeat(40),
      checks: [{ name: 'Cloudflare Pages', status: 'completed', conclusion: 'success', url: 'https://dash.cloudflare.com/x' }],
      source: 'api',
      needsAuth: false,
    })
    const container = await mount()
    await click(button(container, 'Gönder'))
    await flush()
    expect(deployApi.status).toHaveBeenCalledWith('b'.repeat(40))
    const tracker = container.querySelector('section[aria-label="Yayın durumu"]')!
    expect(tracker.textContent).toContain('Derleme başarılı.')
    expect(tracker.textContent).toContain('Cloudflare Pages')
  })

  it('shows a diff on request', async () => {
    api.gitStatus.mockResolvedValue(gitStatus({ files: [gitFile('content/posts/eski.md')] }))
    api.gitDiff.mockResolvedValue('--- a/content/posts/eski.md\n+++ b/content/posts/eski.md\n@@ -1,2 +1,2 @@\n bir\n-iki\n+İKİ\n')
    const container = await mount()
    await click(button(container, 'Değişiklikleri göster'))
    await flush()
    expect(api.gitDiff).toHaveBeenCalledWith('content/posts/eski.md')
    const rows = [...container.querySelectorAll('[role="row"][data-type]')].map((r) => [r.getAttribute('data-type'), r.textContent])
    expect(rows).toEqual([
      ['context', '11 bir'],
      ['del', '2−iki'],
      ['add', '2+İKİ'],
    ])
  })

  it('offers pull when behind, reloads files after it, and explains conflicts', async () => {
    api.gitStatus.mockResolvedValue(gitStatus({ behind: 2 }))
    api.gitPull.mockRejectedValue({ code: 'invalid', message: 'git_conflict: CONFLICT (content): Merge conflict in content/posts/a.md' })
    const container = await mount()
    expect(container.textContent).toContain('Değişiklik yok')
    const pull = button(container, 'Çek')
    expect(pull.className).toContain('btn-primary')
    expect(pull.textContent).toContain('↓2')
    await click(pull)
    await flush()
    expect(siteContext.reloadFiles).toHaveBeenCalled()
    const alert = container.querySelector('[data-code="git_conflict"]')!
    expect(alert.textContent).toContain('uzak depodakilerle çakışıyor')
    expect(alert.textContent).toContain('Merge conflict in content/posts/a.md')
  })

  it('shows the identity and a privacy tip for personal emails', async () => {
    api.gitStatus.mockResolvedValue(gitStatus({ userName: 'Ali', userEmail: 'ali@example.com' }))
    const container = await mount()
    expect(container.textContent).toContain('Ali <ali@example.com>')
    expect(container.textContent).toContain('noreply')
  })

  it('warns when the identity is missing', async () => {
    api.gitStatus.mockResolvedValue(gitStatus({ userName: null, userEmail: null }))
    const container = await mount()
    expect(container.textContent).toContain('Git henüz adını ve e-postanı bilmiyor')
  })

  it('guides when the folder is not a repository, has no remote, or git is missing', async () => {
    api.gitStatus.mockResolvedValue({ ...gitStatus(), isRepo: false })
    let container = await mount()
    expect(container.textContent).toContain('git init -b main')

    cleanups.pop()!()
    api.gitStatus.mockResolvedValue(gitStatus({ remoteUrl: null, upstream: null, files: [gitFile('content/posts/eski.md')] }))
    container = await mount()
    expect(container.textContent).toContain('git remote add origin')
    expect(() => button(container, 'Commit et ve gönder')).toThrow()

    cleanups.pop()!()
    api.gitStatus.mockRejectedValue({ code: 'invalid', message: 'git_not_found: git was not found' })
    container = await mount()
    expect(container.textContent).toContain('winget install --id Git.Git')
  })

  it('suggests English messages in English', async () => {
    await i18n.changeLanguage('en')
    api.gitStatus.mockResolvedValue(gitStatus({ files: [gitFile('content/posts/eski.md'), gitFile('layouts/x.html')] }))
    const container = await mount()
    expect(message(container)).toBe('Update post: Eski yazı; update theme and layouts')
  })
})
