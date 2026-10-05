// @vitest-environment jsdom
// The settings helpers in the running view: permalink tester, code style sample, menus from front
// matter, commented-out menu entries and splitting the config.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    api: {
      listFiles: vi.fn(),
      readText: vi.fn(),
      tomlRead: vi.fn(),
      tomlParseText: vi.fn(),
      configEffective: vi.fn(),
      configPreviewOps: vi.fn(),
      configValidate: vi.fn(),
      writeText: vi.fn(),
      renameFile: vi.fn(),
      configValidateFiles: vi.fn(),
    },
  }
})
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))

import i18n from '../../i18n'
import { api, type ContentFile, type HugoInfo, type PageEntry } from '../../lib/api'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { SettingsView } from './SettingsView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocked = api as unknown as Record<keyof typeof api, Mock>

interface Fixture {
  text: string
  values?: Record<string, unknown>
}

let files: Record<string, Fixture>
let root: Root | null = null
let container: HTMLDivElement
let context: SiteContextValue
let siteCounter = 0

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  mocked.listFiles.mockResolvedValue([])
  mocked.readText.mockImplementation(async (path: string) => {
    if (!files[path]) throw { code: 'io', message: `missing ${path}` }
    return { text: files[path].text, version: `v-${path}` }
  })
  mocked.tomlRead.mockImplementation(async (path: string) => ({ values: files[path]?.values ?? {}, comments: {} }))
  mocked.tomlParseText.mockImplementation(async (text: string) => {
    const found = Object.values(files).find((f) => f.text === text)
    return { values: found?.values ?? {}, comments: {} }
  })
  mocked.configEffective.mockResolvedValue({ values: {}, messages: [] })
  mocked.configPreviewOps.mockImplementation(async (path: string) => ({ path, before: files[path].text, after: `${files[path].text}# changed\n`, version: 'v1' }))
  mocked.configValidate.mockResolvedValue({ ok: true, messages: [] })
  mocked.writeText.mockResolvedValue('v2')
  mocked.renameFile.mockImplementation(async (_from: string, to: string) => to)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  vi.clearAllMocks()
})

function page(path: string, extra: Partial<PageEntry> = {}): PageEntry {
  return {
    path,
    slug: '',
    title: 'Untitled',
    date: '2024-03-05T10:00:00+00:00',
    expiryDate: '',
    publishDate: '',
    draft: false,
    permalink: '',
    kind: 'page',
    section: '',
    ...extra,
  }
}

const HUGO: HugoInfo = {
  path: 'hugo',
  version: { major: 0, minor: 167, patch: 0, extended: true, withDeploy: false, os: 'windows', arch: 'amd64' },
  raw: 'hugo v0.167.0',
}

async function render(pages: PageEntry[] = [], contentFiles: ContentFile[] = [], options: { configFiles?: string[]; hugo?: HugoInfo | null } = {}) {
  siteCounter++
  context = {
    // A new root per test, so the front matter index does not reuse another test's pages.
    site: { root: `C:/site-${siteCounter}`, name: 'site', configFiles: options.configFiles ?? ['hugo.toml'], contentDir: 'content', isGitRepo: false },
    hugo: options.hugo ?? null,
    files: contentFiles,
    pagesAt: '2026-01-01T00:00:00.000Z',
    pages,
    reloadFiles: vi.fn(async () => {}),
    reloadPages: vi.fn(async () => {}),
    refreshHugo: vi.fn(async () => {}),
    openFile: vi.fn(),
    showView: vi.fn(),
    configVersion: 0,
    notifyConfigChanged: vi.fn(),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root!.render(
      <SiteContext.Provider value={context}>
        <SettingsView />
      </SiteContext.Provider>,
    ),
  )
  await waitFor(() => container.querySelector('[data-setting="title"]'))
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitFor<T>(find: () => T | null | undefined | false, timeout = 3000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const found = find()
    if (found) return found
    if (Date.now() - start > timeout) throw new Error('waitFor timed out')
    await flush()
  }
}

function button(scope: ParentNode, text: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

function click(element: HTMLElement) {
  act(() => element.click())
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

async function writeDialog(): Promise<HTMLElement> {
  const dialog = await waitFor(() => document.querySelector<HTMLElement>('[aria-labelledby="settings-file-changes-title"]'))
  await waitFor(() => !button(dialog, 'Write files').disabled)
  return dialog
}

describe('settings helpers', () => {
  it('tries a permalink pattern on real pages and warns about collisions', async () => {
    files = { 'hugo.toml': { text: 'title = "Test"\n', values: { title: 'Test' } } }
    await render([
      page('content/posts/one.md', { section: 'posts', title: 'Same', permalink: 'https://example.org/posts/one/' }),
      page('content/posts/two.md', { section: 'posts', title: 'Same', permalink: 'https://example.org/posts/two/' }),
    ])
    click(button(container, 'URLs and permalinks'))
    const tester = await waitFor(() => document.querySelector<HTMLElement>('[aria-labelledby="permalink-tester-title"]'))
    setValue(tester.querySelector<HTMLInputElement>('input.font-mono')!, '/:year/:title/')
    expect(tester.textContent).toContain('/2024/same/')
    expect(tester.textContent).toContain('2 pages would get an address that another page already has')
    expect(tester.textContent).toContain('The addresses of 2 pages change')
    click(button(tester, 'Use this pattern'))
    expect(container.textContent).toContain('1 unsaved change')
    click(button(container, 'Review and save'))
    await waitFor(() => mocked.configPreviewOps.mock.calls.length > 0)
    expect(mocked.configPreviewOps.mock.calls[0]).toEqual(['hugo.toml', [{ op: 'set', path: ['permalinks', 'page', 'posts'], value: '/:year/:title/' }]])
  })

  it('shows a code sample in the chosen highlighting style', async () => {
    files = { 'hugo.toml': { text: 'title = "Test"\n', values: { title: 'Test' } } }
    await render()
    click(button(container, 'Syntax highlighting'))
    const field = await waitFor(() => container.querySelector<HTMLElement>('[data-setting="markup.highlight.style"]'))
    setValue(field.querySelector('select')!, 'dracula')
    const sample = field.querySelector<HTMLElement>('pre[aria-label^="Sample code"]')!
    expect(sample.style.background).toBe('rgb(40, 42, 54)')
    expect(sample.querySelector('[data-token="keyword"]')!.textContent).toBe('func')
    setValue(field.querySelector('select')!, 'abap')
    expect(field.textContent).toContain('No preview for “abap”')
  })

  it('lists menu entries from front matter and writes a move into the page', async () => {
    const config = '[[menus.main]]\n  name = "Home"\n  url = "/"\n  weight = 10\n'
    const about = '---\ntitle: About\nmenus: main\n---\nHello\n'
    files = {
      'hugo.toml': { text: config, values: { menus: { main: [{ name: 'Home', url: '/', weight: 10 }] } } },
      'content/about.md': { text: about },
    }
    await render([], [{ path: 'content/about.md', title: 'About', modifiedMs: 1 }])
    click(container.querySelector<HTMLButtonElement>('#settings-tab-menus')!)
    const card = await waitFor(() => container.querySelector<HTMLElement>('section[aria-label="main"] li[aria-label="About"]'))
    expect(card.textContent).toContain('content/about.md')
    click(button(card, 'Open page'))
    expect(context.openFile).toHaveBeenCalledWith('content/about.md')

    // The page has no weight, so Hugo lists it last; moving it up rewrites both weights.
    click(button(card, 'Move About up'))
    expect(container.textContent).toContain('2 unsaved changes')
    click(button(container, 'Review and save'))
    await waitFor(() => mocked.configPreviewOps.mock.calls.length > 0)
    expect(mocked.configPreviewOps.mock.calls[0]).toEqual(['hugo.toml', [{ op: 'set', path: ['menus', 'main', 0, 'weight'], value: 20 }]])
    const review = await waitFor(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Write to files')
      return b && !b.disabled && b
    })
    click(review)

    // Then the page itself, with its own diff.
    const dialog = await writeDialog()
    expect(dialog.textContent).toContain('content/about.md')
    click(button(dialog, 'Write files'))
    await waitFor(() => mocked.writeText.mock.calls.some((c) => c[0] === 'content/about.md'))
    const [, text, version] = mocked.writeText.mock.calls.find((c) => c[0] === 'content/about.md')!
    expect(text).toBe('---\ntitle: About\nmenus:\n  main:\n    weight: 10\n---\nHello\n')
    expect(version).toBe('v-content/about.md')
  })

  it('enables a commented-out menu entry by removing exactly its comment markers', async () => {
    const config = 'title = "Test"\n\n# [[menus.main]]\n#   name = "Tags"\n#   url = "/tags/"\n'
    files = { 'hugo.toml': { text: config, values: { title: 'Test' } } }
    await render()
    click(container.querySelector<HTMLButtonElement>('#settings-tab-menus')!)
    click(await waitFor(() => button(container, 'Enable Tags')))
    const dialog = await writeDialog()
    click(button(dialog, 'Write files'))
    await waitFor(() => mocked.writeText.mock.calls.length > 0)
    expect(mocked.writeText).toHaveBeenCalledWith('hugo.toml', 'title = "Test"\n\n[[menus.main]]\n  name = "Tags"\n  url = "/tags/"\n', 'v-hugo.toml')
    expect(context.notifyConfigChanged).toHaveBeenCalled()
  })

  it('splits a single config file into config/_default and moves the rest last', async () => {
    const config = 'title = "Test"\n\n[params]\n  author = "x"\n'
    files = {
      'hugo.toml': { text: config, values: { title: 'Test', params: { author: 'x' } } },
      remainder: { text: 'title = "Test"\n', values: { title: 'Test' } },
      params: { text: '  author = "x"\n', values: { author: 'x' } },
    }
    await render()
    click(button(container, 'Split into config/_default/…'))
    const dialog = await writeDialog()
    expect(dialog.textContent).toContain('config/_default/params.toml')
    expect(dialog.textContent).toContain('then moved to _default/hugo.toml')
    click(button(dialog, 'Write files'))
    await waitFor(() => mocked.renameFile.mock.calls.length > 0)
    expect(mocked.writeText.mock.calls).toEqual([
      ['config/_default/params.toml', '  author = "x"\n', ''],
      ['hugo.toml', 'title = "Test"\n', 'v-hugo.toml'],
    ])
    expect(mocked.renameFile).toHaveBeenCalledWith('hugo.toml', 'config/_default/hugo.toml')
  })

  it('enables a commented-out entry of a YAML menu, keeping the indentation', async () => {
    const config = 'title: Test\nmenus:\n  main:\n    - name: Home\n    # - name: Tags\n    #   url: /tags/\n'
    files = { 'hugo.yaml': { text: config } }
    await render([], [], { configFiles: ['hugo.yaml'] })
    click(container.querySelector<HTMLButtonElement>('#settings-tab-menus')!)
    click(await waitFor(() => button(container, 'Enable Tags')))
    const dialog = await writeDialog()
    click(button(dialog, 'Write files'))
    await waitFor(() => mocked.writeText.mock.calls.length > 0)
    expect(mocked.writeText).toHaveBeenCalledWith('hugo.yaml', 'title: Test\nmenus:\n  main:\n    - name: Home\n    - name: Tags\n      url: /tags/\n', 'v-hugo.yaml')
  })

  it('loads the whole split with Hugo and says when another root file must be deleted first', async () => {
    const config = 'title = "Test"\n\n[params]\n  author = "x"\n'
    files = {
      'hugo.toml': { text: config, values: { title: 'Test', params: { author: 'x' } } },
      'config.toml': { text: 'title = "Old"\n', values: { title: 'Old' } },
      remainder: { text: 'title = "Test"\n', values: { title: 'Test' } },
      params: { text: '  author = "x"\n', values: { author: 'x' } },
    }
    mocked.configValidateFiles.mockResolvedValue({ ok: false, messages: [{ level: 'error', text: 'ERROR config.toml: something is off' }] })
    await render([], [], { configFiles: ['hugo.toml', 'config.toml'], hugo: HUGO })
    click(button(container, 'Split into config/_default/…'))
    const dialog = await waitFor(() => document.querySelector<HTMLElement>('[aria-labelledby="settings-file-changes-title"]'))
    await waitFor(() => dialog.textContent?.includes('something is off'))
    expect(mocked.configValidateFiles).toHaveBeenCalledWith([
      { path: 'config/_default/params.toml', text: '  author = "x"\n' },
      { path: 'hugo.toml', text: null },
      { path: 'config/_default/hugo.toml', text: 'title = "Test"\n' },
    ])
    expect(dialog.textContent).toContain('Hugo loaded the site with all of these files at once')
    expect(dialog.textContent).toContain('config.toml is also in the site folder')
    expect(dialog.textContent).toContain('It has to be deleted, not moved')
    expect(button(dialog, 'Write files').disabled).toBe(true)
  })
})
