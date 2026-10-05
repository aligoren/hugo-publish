// @vitest-environment jsdom
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
      configEffective: vi.fn(),
      configPreviewOps: vi.fn(),
      configValidate: vi.fn(),
      writeText: vi.fn(),
    },
  }
})
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))

import i18n from '../../i18n'
import { api, type HugoInfo } from '../../lib/api'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { SettingsView } from './SettingsView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HUGO_TOML = `baseURL = "https://example.com/"
title = "Test"
enableEmoji = false
paginate = 5

[markup.highlight]
  style = "monokai"

[markup.goldmark.renderer]
  unsafe = false

[menu]
  [[menu.main]]
    name = "Home"
    url = "/"
    weight = 10
  [[menu.main]]
    name = "About"
    url = "/about/"
    weight = 20
`

const VALUES = {
  baseURL: 'https://example.com/',
  title: 'Test',
  enableEmoji: false,
  paginate: 5,
  markup: { highlight: { style: 'monokai' }, goldmark: { renderer: { unsafe: false } } },
  menu: {
    main: [
      { name: 'Home', url: '/', weight: 10 },
      { name: 'About', url: '/about/', weight: 20 },
    ],
  },
}

const HUGO: HugoInfo = {
  path: 'hugo',
  raw: 'hugo v0.167.0',
  version: { major: 0, minor: 167, patch: 0, extended: true, withDeploy: false, os: 'windows', arch: 'amd64' },
}

const mocked = api as unknown as Record<keyof typeof api, Mock>

let root: Root | null = null
let container: HTMLDivElement
let notifyConfigChanged: Mock

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

type Files = Record<string, { text: string; values: Record<string, unknown> }>

/** The site's config files, served by the mocked api. */
function serveFiles(files: Files) {
  mocked.listFiles.mockResolvedValue(
    Object.keys(files)
      .filter((p) => p.startsWith('config/'))
      .map((path) => ({ path, size: files[path].text.length })),
  )
  mocked.readText.mockImplementation(async (path: string) => {
    if (!files[path]) throw { code: 'io', message: `missing ${path}` }
    return { text: files[path].text, version: `v-${path}` }
  })
  mocked.tomlRead.mockImplementation(async (path: string) => ({ values: files[path].values, comments: {} }))
}

beforeEach(() => {
  mocked.listFiles.mockResolvedValue([])
  mocked.readText.mockResolvedValue({ text: HUGO_TOML, version: 'v1' })
  mocked.tomlRead.mockResolvedValue({ values: VALUES, comments: {} })
  mocked.configEffective.mockResolvedValue({
    values: {
      baseurl: 'https://example.com/',
      title: 'Test',
      enableemoji: false,
      theme: [],
      markup: { highlight: { style: 'monokai' } },
      languages: { en: { label: '' } },
    },
    messages: [{ level: 'warn', text: 'WARN  deprecated: something Hugo noticed' }],
  })
  mocked.configPreviewOps.mockImplementation(async (path: string) => ({ path, before: HUGO_TOML, after: `${HUGO_TOML}# changed\n`, version: 'v1' }))
  mocked.configValidate.mockResolvedValue({ ok: true, messages: [] })
  mocked.writeText.mockResolvedValue('v2')
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  vi.clearAllMocks()
})

async function render(hugo: HugoInfo | null = HUGO) {
  notifyConfigChanged = vi.fn()
  const context: SiteContextValue = {
    site: { root: 'C:/site', name: 'site', configFiles: ['hugo.toml'], contentDir: 'content', isGitRepo: false },
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
    notifyConfigChanged,
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
  await waitFor(() => field('title'))
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

function field(path: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-setting="${path}"]`)
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

async function reviewOps() {
  click(button(container, 'Review and save'))
  await waitFor(() => mocked.configPreviewOps.mock.calls.length > 0)
  return mocked.configPreviewOps.mock.calls
}

describe('SettingsView', () => {
  it('shows the values of the files with their owner and Hugo’s view', async () => {
    await render()
    const title = field('title')!
    expect(title.querySelector('input')!.value).toBe('Test')
    expect(title.textContent).toContain('hugo.toml')
    expect(mocked.configEffective).toHaveBeenCalledWith(undefined)
    // A key no file sets is shown with its default.
    expect(field('timeZone')!.textContent).toContain('default')
  })

  it('turns a toggle, a select, a list edit and a reset into ops for the owning file', async () => {
    await render()

    click(button(field('title')!, 'Reset to default'))
    const theme = field('theme')!
    setValue(theme.querySelector('input')!, 'PaperMod')
    click(button(theme, 'Add'))

    click(button(container, 'Content'))
    click(await waitFor(() => field('enableEmoji')?.querySelector<HTMLInputElement>('input[role="switch"]')))

    click(button(container, 'Syntax highlighting'))
    setValue(await waitFor(() => field('markup.highlight.style')?.querySelector('select')), 'dracula')

    expect(container.textContent).toContain('4 unsaved changes')
    const calls = await reviewOps()
    expect(calls).toEqual([
      [
        'hugo.toml',
        [
          { op: 'remove', path: ['title'] },
          { op: 'set', path: ['theme'], value: 'PaperMod' },
          { op: 'set', path: ['enableEmoji'], value: true },
          { op: 'set', path: ['markup', 'highlight', 'style'], value: 'dracula' },
        ],
      ],
    ])
    await waitFor(() => mocked.configValidate.mock.calls.length > 0)
    expect(mocked.configValidate).toHaveBeenCalledWith('hugo.toml', `${HUGO_TOML}# changed\n`)

    const write = await waitFor(() => {
      const b = button(document.body, 'Write to files')
      return !b.disabled && b
    })
    click(write)
    await waitFor(() => notifyConfigChanged.mock.calls.length > 0)
    expect(mocked.writeText).toHaveBeenCalledWith('hugo.toml', `${HUGO_TOML}# changed\n`, 'v1')
    expect(container.textContent).not.toContain('unsaved change')
  })

  it('undoes a pending change and discards all of them', async () => {
    await render()
    setValue(field('title')!.querySelector('input')!, 'New title')
    expect(container.textContent).toContain('1 unsaved change')
    click(button(field('title')!, 'Undo'))
    expect(container.textContent).not.toContain('unsaved change')
    expect(field('title')!.querySelector('input')!.value).toBe('Test')

    setValue(field('copyright')!.querySelector('input')!, '© 2026')
    click(button(container, 'Discard'))
    expect(container.textContent).not.toContain('unsaved change')
  })

  it('asks before applying a risky change', async () => {
    await render()
    click(button(container, 'Markdown'))
    const unsafe = await waitFor(() => field('markup.goldmark.renderer.unsafe'))
    click(unsafe.querySelector<HTMLInputElement>('input[role="switch"]')!)
    expect(unsafe.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(container.textContent).not.toContain('unsaved change')
    click(button(unsafe, 'Apply change'))
    expect(container.textContent).toContain('1 unsaved change')

    // The review asks again, with an explicit confirmation.
    click(button(container, 'Review and save'))
    const gate = await waitFor(() => document.querySelector<HTMLElement>('[aria-labelledby="settings-risk-title"]'))
    expect(gate.textContent).toContain('markup.goldmark.renderer.unsafe')
    expect(mocked.configPreviewOps).not.toHaveBeenCalled()
    const go = button(gate, 'Continue to review')
    expect(go.disabled).toBe(true)
    click(gate.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
    click(go)
    await waitFor(() => mocked.configPreviewOps.mock.calls.length > 0)
    expect(mocked.configPreviewOps.mock.calls).toEqual([['hugo.toml', [{ op: 'set', path: ['markup', 'goldmark', 'renderer', 'unsafe'], value: true }]]])
  })

  it('reorders menu entries by rewriting their weights', async () => {
    await render()
    click(button(container, 'Menus'))
    click(await waitFor(() => button(container, 'Move About up')))
    expect(await reviewOps()).toEqual([
      [
        'hugo.toml',
        [
          { op: 'set', path: ['menu', 'main', 0, 'weight'], value: 20 },
          { op: 'set', path: ['menu', 'main', 1, 'weight'], value: 10 },
        ],
      ],
    ])
  })

  it('fixes a silently ignored key through the review dialog', async () => {
    await render()
    const tab = container.querySelector<HTMLButtonElement>('#settings-tab-migration')!
    expect(tab.textContent).toBe('Migration2')
    click(tab)
    await waitFor(() => container.textContent?.includes('Silently ignored'))
    expect(container.textContent).toContain('something Hugo noticed')
    click(button(container, 'Review the fix'))
    await waitFor(() => mocked.configPreviewOps.mock.calls.length > 0)
    expect(mocked.configPreviewOps.mock.calls[0]).toEqual([
      'hugo.toml',
      [
        { op: 'set', path: ['pagination', 'pagerSize'], value: 5 },
        { op: 'remove', path: ['paginate'] },
      ],
    ])
  })

  it('writes overrides to the selected environment and shows what it inherits', async () => {
    serveFiles({
      'hugo.toml': { text: 'title = "Test"\n', values: { title: 'Test', baseURL: 'https://example.com/' } },
      'config/production/hugo.toml': { text: 'baseURL = "https://www.example.com/"\n', values: { baseURL: 'https://www.example.com/' } },
    })
    await render()
    expect(field('baseURL')!.textContent).toContain('Overridden in production/hugo.toml.')

    setValue(container.querySelector<HTMLSelectElement>('select')!, 'production')
    await waitFor(() => mocked.configEffective.mock.calls.some((c) => c[0] === 'production'))
    const title = field('title')!
    expect(title.querySelector('[title^="Inherited from hugo.toml"]')).not.toBeNull()
    expect(button(field('baseURL')!, 'Remove override')).toBeTruthy()

    setValue(title.querySelector('input')!, 'Live site')
    expect(await reviewOps()).toEqual([['config/production/hugo.toml', [{ op: 'set', path: ['title'], value: 'Live site' }]]])
  })

  it('creates a new environment file after showing it', async () => {
    await render()
    click(button(container, 'New environment…'))
    setValue(container.querySelector<HTMLInputElement>('input[aria-label="Environment name"]')!, 'staging')
    click(button(container, 'Create'))
    const dialog = await waitFor(() => document.querySelector('[aria-labelledby="settings-new-file-title"]'))
    expect(dialog.textContent).toContain('config/staging/hugo.toml')
    await waitFor(() => mocked.configValidate.mock.calls.length > 0)
    expect(mocked.configValidate.mock.calls[0][0]).toBe('config/staging/hugo.toml')
    click(await waitFor(() => !button(dialog, 'Create file').disabled && button(dialog, 'Create file')))
    await waitFor(() => notifyConfigChanged.mock.calls.length > 0)
    const [path, text, version] = mocked.writeText.mock.calls[0]
    expect(path).toBe('config/staging/hugo.toml')
    expect(text).toContain('# Settings for the "staging" environment.')
    expect(version).toBeUndefined()
  })

  it('keeps working without Hugo', async () => {
    await render(null)
    expect(mocked.configEffective).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Hugo was not found')
    setValue(field('title')!.querySelector('input')!, 'Offline')
    click(button(container, 'Review and save'))
    await waitFor(() => mocked.configPreviewOps.mock.calls.length > 0)
    expect(mocked.configValidate).not.toHaveBeenCalled()
  })
})
