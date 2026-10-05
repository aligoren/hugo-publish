// @vitest-environment jsdom
import i18n from 'i18next'
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HugoInfo, HugoInstallProgress, HugoRelease, ManagedHugo } from '../../lib/api'

const api = vi.hoisted(() => ({
  hugoInstalled: vi.fn(),
  hugoPreferred: vi.fn(),
  hugoReleases: vi.fn(),
  hugoInstall: vi.fn(),
  hugoUninstall: vi.fn(),
  hugoSetPreferred: vi.fn(),
  onHugoInstallProgress: vi.fn(),
  readText: vi.fn(),
  tomlRead: vi.fn(),
  tomlParseText: vi.fn(),
  tomlEditText: vi.fn(),
  writeText: vi.fn(),
}))
const dialog = vi.hoisted(() => ({ open: vi.fn(), confirm: vi.fn() }))

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api,
}))
vi.mock('@tauri-apps/plugin-dialog', () => dialog)

import '../../i18n'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { HugoView } from './HugoView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SITE_TOML = '.hugo-publisher/site.toml'

function hugoInfo(version: string, overrides: Partial<HugoInfo['version']> = {}, path = 'C:/tools/hugo.exe'): HugoInfo {
  const [major, minor, patch] = version.split('.').map(Number)
  return {
    path,
    raw: `hugo v${version}+extended windows/amd64`,
    version: { major, minor, patch, extended: true, withDeploy: false, os: 'windows', arch: 'amd64', ...overrides },
  }
}

const RELEASES: HugoRelease[] = [
  { version: '0.160.1', publishedAt: '2026-05-02T10:00:00Z', prerelease: false },
  { version: '0.168.0', publishedAt: '2026-10-02T09:00:00Z', prerelease: true },
  { version: '0.167.0', publishedAt: '2026-09-28T14:50:38Z', prerelease: false },
  { version: '0.166.2', publishedAt: '2026-09-30T08:00:00Z', prerelease: false },
]

let progressHandler: ((p: HugoInstallProgress) => void) | null = null
const unlisten = vi.fn()

/** Site files the mocked commands serve: text plus parsed values. */
let siteFiles: Record<string, { text: string; values: Record<string, unknown> }>

function notFound() {
  return Promise.reject({ code: 'io', message: 'I/O error: not found' })
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(dialog)]) fn.mockReset()
  unlisten.mockReset()
  progressHandler = null
  siteFiles = {
    'hugo.toml': { text: 'theme = "PaperMod"\n', values: { theme: 'PaperMod' } },
    'themes/PaperMod/theme.toml': { text: '', values: { min_version: '0.146.0' } },
  }
  api.hugoInstalled.mockResolvedValue([])
  api.hugoPreferred.mockResolvedValue(null)
  api.hugoReleases.mockResolvedValue(RELEASES)
  api.onHugoInstallProgress.mockImplementation(async (handler: (p: HugoInstallProgress) => void) => {
    progressHandler = handler
    return unlisten
  })
  api.readText.mockImplementation((path: string) =>
    siteFiles[path] ? Promise.resolve({ text: siteFiles[path].text, version: `ver:${path}` }) : notFound(),
  )
  api.tomlRead.mockImplementation((path: string) =>
    siteFiles[path] ? Promise.resolve({ values: siteFiles[path].values, comments: {} }) : notFound(),
  )
  api.tomlParseText.mockImplementation(async (text: string) => {
    const entry = Object.values(siteFiles).find((f) => f.text === text)
    return { values: entry?.values ?? {}, comments: {} }
  })
})

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mount(hugo: HugoInfo | null, overrides: Partial<SiteContextValue> = {}) {
  const context: SiteContextValue = {
    site: { root: 'D:/blog', name: 'blog', configFiles: ['hugo.toml'], contentDir: 'content', isGitRepo: true },
    hugo,
    files: [],
    pagesAt: '2026-01-01T00:00:00.000Z',
    pages: [],
    reloadFiles: vi.fn(async () => {}),
    reloadPages: vi.fn(async () => {}),
    refreshHugo: vi.fn(async () => {}),
    openFile: vi.fn(),
    showView: vi.fn(),
    configVersion: 0,
    notifyConfigChanged: vi.fn(),
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (element: ReactElement) => act(() => root.render(element))
  render(
    <SiteContext.Provider value={context}>
      <HugoView />
    </SiteContext.Provider>,
  )
  let mounted = true
  const unmount = () => {
    if (!mounted) return
    mounted = false
    act(() => root.unmount())
    container.remove()
  }
  cleanups.push(unmount)
  await flush()
  return { container, context, unmount }
}

function button(container: HTMLElement, name: string | RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) =>
    typeof name === 'string' ? b.textContent?.trim() === name || b.getAttribute('aria-label') === name : name.test(b.textContent ?? ''),
  )
  if (!found) throw new Error(`no button ${String(name)}; have: ${[...container.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`)
  return found
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
  await flush()
}

function releaseVersions(container: HTMLElement): string[] {
  const list = container.querySelector('ul[aria-label="Available versions"]')
  return [...(list?.querySelectorAll('li') ?? [])].map((li) => li.querySelector('span')?.textContent ?? '')
}

describe('HugoView', () => {
  it('shows the active Hugo and goes back to automatic detection', async () => {
    const { container, context } = await mount(hugoInfo('0.167.0'))
    expect(container.querySelector('[data-testid="active-version"]')?.textContent).toBe('Hugo 0.167.0')
    expect(container.textContent).toContain('C:/tools/hugo.exe')
    expect(container.textContent).toContain('Found automatically')

    api.hugoSetPreferred.mockResolvedValue(hugoInfo('0.167.0'))
    await click(button(container, 'Detect automatically'))
    expect(api.hugoSetPreferred).toHaveBeenCalledWith(null)
    expect(context.refreshHugo).toHaveBeenCalledTimes(1)
    expect(api.hugoInstalled).toHaveBeenCalledTimes(2)
  })

  it('uses a Hugo binary chosen in the file dialog', async () => {
    api.hugoPreferred.mockResolvedValueOnce(null).mockResolvedValue('D:/bin/hugo.exe')
    dialog.open.mockResolvedValue('D:/bin/hugo.exe')
    api.hugoSetPreferred.mockResolvedValue(hugoInfo('0.150.0', {}, 'D:/bin/hugo.exe'))
    const { container, context } = await mount(hugoInfo('0.167.0'))
    await click(button(container, 'Choose a Hugo binary…'))
    expect(dialog.open).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: false, directory: false, filters: [{ name: 'Hugo', extensions: ['exe'] }] }),
    )
    expect(api.hugoSetPreferred).toHaveBeenCalledWith('D:/bin/hugo.exe')
    expect(context.refreshHugo).toHaveBeenCalled()
    expect(container.textContent).toContain('Chosen by you:')
    expect(container.textContent).toContain('D:/bin/hugo.exe')

    // A cancelled dialog changes nothing.
    dialog.open.mockResolvedValue(null)
    await click(button(container, 'Choose a Hugo binary…'))
    expect(api.hugoSetPreferred).toHaveBeenCalledTimes(1)
  })

  it('lists releases newest first and hides pre-releases until asked', async () => {
    const { container } = await mount(hugoInfo('0.167.0'))
    expect(releaseVersions(container)).toEqual(['0.167.0', '0.166.2', '0.160.1'])
    expect(container.textContent).toContain('latest')
    const toggle = [...container.querySelectorAll('label')].find((l) => l.textContent?.includes('Show pre-releases'))!
    await click(toggle.querySelector('input')!)
    expect(releaseVersions(container)).toEqual(['0.168.0', '0.167.0', '0.166.2', '0.160.1'])
  })

  it('explains a GitHub rate limit', async () => {
    api.hugoReleases.mockRejectedValue({
      code: 'invalid',
      message: 'GitHub rate limit reached (HTTP 403) while listing Hugo releases; try again in about 12 minute(s)',
    })
    const { container } = await mount(hugoInfo('0.167.0'))
    expect(container.textContent).toContain('GitHub limits how often')
    expect(container.textContent).toContain('12 minute')
  })

  it('installs with a progress bar, offers to use the result and unlistens on unmount', async () => {
    let finish: (value: ManagedHugo) => void = () => {}
    api.hugoInstall.mockImplementation(() => new Promise<ManagedHugo>((resolve) => (finish = resolve)))
    const { container, unmount } = await mount(hugoInfo('0.160.1'))
    expect(api.onHugoInstallProgress).toHaveBeenCalledTimes(1)

    await click(button(container, 'Install 0.167.0'))
    expect(api.hugoInstall).toHaveBeenCalledWith('0.167.0', true)
    // Every install button is disabled while one runs.
    expect(button(container, 'Install 0.166.2').disabled).toBe(true)

    await act(async () => {
      progressHandler!({ version: '0.167.0', received: 15 * 1024 * 1024, total: 30 * 1024 * 1024, stage: 'download' })
      // Events of other versions are ignored.
      progressHandler!({ version: '0.1.0', received: 1, total: 1, stage: 'done' })
    })
    const bar = container.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
    expect(container.textContent).toContain('Downloading Hugo 0.167.0')
    expect(container.textContent).toContain('15.0 MB of 30.0 MB')

    await act(async () => {
      progressHandler!({ version: '0.167.0', received: 0, total: null, stage: 'verify' })
    })
    expect(container.textContent).toContain('Checking the checksum')

    const installed: ManagedHugo = { version: '0.167.0', extended: true, path: 'C:/app/hugo/0.167.0-extended/hugo.exe' }
    api.hugoInstalled.mockResolvedValue([installed])
    api.hugoSetPreferred.mockResolvedValue(hugoInfo('0.167.0', {}, installed.path))
    await act(async () => finish(installed))
    await flush()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    expect(container.textContent).toContain('Hugo 0.167.0 is installed.')
    await click(button(container, 'Use it now'))
    expect(api.hugoSetPreferred).toHaveBeenCalledWith(installed.path)

    unmount()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('removes an installed version only after confirmation', async () => {
    const entry: ManagedHugo = { version: '0.160.1', extended: true, path: 'C:/app/hugo/0.160.1-extended/hugo.exe' }
    api.hugoInstalled.mockResolvedValue([entry])
    const { container, context } = await mount(hugoInfo('0.167.0'))
    expect(container.textContent).toContain('0.160.1')

    dialog.confirm.mockResolvedValueOnce(false)
    await click(button(container, 'Remove 0.160.1'))
    expect(api.hugoUninstall).not.toHaveBeenCalled()

    dialog.confirm.mockResolvedValueOnce(true)
    api.hugoInstalled.mockResolvedValue([])
    await click(button(container, 'Remove 0.160.1'))
    expect(dialog.confirm).toHaveBeenLastCalledWith(
      'Remove Hugo 0.160.1 (extended) from the app folder?',
      expect.objectContaining({ kind: 'warning' }),
    )
    expect(api.hugoUninstall).toHaveBeenCalledWith('0.160.1', true)
    // Not the active binary: no re-detection needed.
    expect(context.refreshHugo).not.toHaveBeenCalled()
    expect(container.textContent).toContain('No versions installed yet.')
  })

  it('warns about the active binary before removing it', async () => {
    const entry: ManagedHugo = { version: '0.167.0', extended: true, path: 'C:\\App\\hugo\\0.167.0-extended\\hugo.exe' }
    api.hugoInstalled.mockResolvedValue([entry])
    dialog.confirm.mockResolvedValue(true)
    const { container, context } = await mount(hugoInfo('0.167.0', {}, 'c:/app/hugo/0.167.0-extended/hugo.exe'))
    expect(container.textContent).toContain('In use')
    await click(button(container, 'Remove 0.167.0'))
    expect(dialog.confirm.mock.calls[0][0]).toContain('is the version in use')
    expect(context.refreshHugo).toHaveBeenCalled()
  })

  it('disables the extended toggle on Windows on ARM and installs the standard build', async () => {
    api.hugoInstall.mockResolvedValue({ version: '0.167.0', extended: false, path: 'C:/app/hugo/0.167.0/hugo.exe' })
    const { container } = await mount(hugoInfo('0.160.1', { extended: false, arch: 'arm64' }))
    const toggle = [...container.querySelectorAll('label')].find((l) => l.textContent?.includes('Extended edition'))!
    const input = toggle.querySelector('input')!
    expect(input.disabled).toBe(true)
    expect(input.checked).toBe(false)
    expect(toggle.textContent).toContain('no extended build for Windows on ARM')
    await click(button(container, 'Install 0.167.0'))
    expect(api.hugoInstall).toHaveBeenCalledWith('0.167.0', false)
  })

  it('says so when the standard build replaced the extended one', async () => {
    api.hugoInstall.mockResolvedValue({ version: '0.167.0', extended: false, path: 'C:/app/hugo/0.167.0/hugo.exe' })
    const { container } = await mount(hugoInfo('0.160.1'))
    await click(button(container, 'Install 0.167.0'))
    expect(container.textContent).toContain('has no extended build for this computer')
  })
})

describe('HugoView site parity', () => {
  it('warns when the active Hugo is not the pinned one and installs and uses the pin in one click', async () => {
    siteFiles[SITE_TOML] = {
      text: '[hugo]\nversion = "0.167.0"\n\n[hosting]\nhugoVersion = "0.167.0"\n',
      values: { hugo: { version: '0.167.0' }, hosting: { hugoVersion: '0.167.0' } },
    }
    const installed: ManagedHugo = { version: '0.167.0', extended: true, path: 'C:/app/hugo/0.167.0-extended/hugo.exe' }
    api.hugoInstall.mockResolvedValue(installed)
    api.hugoSetPreferred.mockResolvedValue(hugoInfo('0.167.0', {}, installed.path))
    const { container, context } = await mount(hugoInfo('0.160.1'))

    const warning = container.querySelector('li[data-kind="activeNotPinned"]')!
    expect(warning.textContent).toContain('pinned to Hugo 0.167.0, but Hugo 0.160.1 is in use')
    await click(button(warning as HTMLElement, 'Install and use 0.167.0'))
    expect(api.hugoInstall).toHaveBeenCalledWith('0.167.0', true)
    expect(api.hugoSetPreferred).toHaveBeenCalledWith(installed.path)
    expect(context.refreshHugo).toHaveBeenCalled()
  })

  it('uses an already installed pinned version without downloading', async () => {
    siteFiles[SITE_TOML] = { text: '[hugo]\nversion = "0.167.0"\n', values: { hugo: { version: '0.167.0' } } }
    const installed: ManagedHugo = { version: '0.167.0', extended: true, path: 'C:/app/hugo/0.167.0-extended/hugo.exe' }
    api.hugoInstalled.mockResolvedValue([installed])
    api.hugoSetPreferred.mockResolvedValue(hugoInfo('0.167.0'))
    const { container } = await mount(hugoInfo('0.160.1'))
    await click(button(container, 'Use 0.167.0'))
    expect(api.hugoInstall).not.toHaveBeenCalled()
    expect(api.hugoSetPreferred).toHaveBeenCalledWith(installed.path)
  })

  it('flags config keys the host default cannot build and the theme minimum', async () => {
    siteFiles['hugo.toml'] = {
      text: 'theme = "PaperMod"\n[languages.tr]\nlocale = "tr-TR"\n',
      values: { theme: 'PaperMod', languages: { tr: { locale: 'tr-TR' } } },
    }
    siteFiles['themes/PaperMod/theme.toml'] = { text: 'x', values: { min_version: '0.168.0' } }
    const { container } = await mount(hugoInfo('0.167.0'))
    const kinds = [...container.querySelectorAll('li[data-kind]')].map((li) => li.getAttribute('data-kind'))
    expect(kinds).toEqual(['themeTooNew', 'themeTooNew', 'featureTooNew', 'hostingMissing'])
    expect(container.textContent).toContain('PaperMod needs Hugo 0.168.0 or newer')
    expect(container.textContent).toContain('“locale”, which needs Hugo 0.158.0')
    expect(container.textContent).toContain('set HUGO_VERSION at your host')
  })

  it('pins the active version through a reviewed diff, creating site.toml', async () => {
    const after = '[hugo]\nversion = "0.167.0"\n'
    api.tomlEditText.mockResolvedValue(after)
    api.writeText.mockImplementation(async (path: string, text: string) => {
      siteFiles[path] = { text, values: { hugo: { version: '0.167.0' } } }
      return 'v2'
    })
    const { container } = await mount(hugoInfo('0.167.0'))
    expect(container.querySelector('[data-testid="pinned-version"]')?.textContent).toContain('Not pinned')

    await click(button(container, 'Pin 0.167.0 for this site'))
    expect(api.tomlEditText).toHaveBeenCalledWith('', [{ op: 'set', path: ['hugo', 'version'], value: '0.167.0' }])
    const review = container.querySelector('[data-testid="site-toml-review"]')!
    expect(review.textContent).toContain('version = "0.167.0"')
    expect(api.writeText).not.toHaveBeenCalled()

    await click(button(review as HTMLElement, `Write to ${SITE_TOML}`))
    expect(api.writeText).toHaveBeenCalledWith(SITE_TOML, after, '')
    expect(container.textContent).toContain(`Saved to ${SITE_TOML}.`)
    expect(container.querySelector('[data-testid="pinned-version"]')?.textContent).toContain('0.167.0')
  })

  it('refuses a host version that is not a version', async () => {
    const { container } = await mount(hugoInfo('0.167.0'))
    const input = [...container.querySelectorAll('label')]
      .find((l) => l.textContent?.includes('HUGO_VERSION at the host'))!
      .querySelector('input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'latest')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button(container, 'Review changes'))
    expect(container.textContent).toContain('Write a version like 0.167.0.')
    expect(api.tomlEditText).not.toHaveBeenCalled()
  })
})
