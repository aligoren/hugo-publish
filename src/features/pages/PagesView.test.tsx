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
      tomlParseText: vi.fn(),
      writeText: vi.fn(),
    },
  }
})

import i18n from '../../i18n'
import { api, type PageEntry } from '../../lib/api'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { messages } from './messages'
import { PagesView } from './PagesView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocked = api as unknown as Record<keyof typeof api, Mock>

const FILES: Record<string, string> = {
  'hugo.toml': '[[menus.main]]\n  name = "About"\n  pageRef = "/about"\n  weight = 10\n',
  'content/_index.md': '---\ntitle: Home\n---\n',
  'content/about.md': '---\ntitle: About\n---\n',
  'content/search.md': '---\ntitle: Search\ndraft: true\nlayout: search\n---\n',
  'content/posts/hello.md': '---\ntitle: Hello\n---\n',
}

let root: Root | null = null
let container: HTMLDivElement
let context: SiteContextValue

beforeAll(async () => {
  // The app registers these in src/i18n; the test adds them itself.
  i18n.addResourceBundle('en', 'translation', { pages: messages.en }, true, true)
  i18n.addResourceBundle('tr', 'translation', { pages: messages.tr }, true, true)
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  mocked.listFiles.mockResolvedValue([])
  mocked.readText.mockImplementation(async (path: string) => ({ text: FILES[path], version: `v-${path}` }))
  mocked.tomlRead.mockResolvedValue({ values: { menus: { main: [{ name: 'About', pageRef: '/about', weight: 10 }] } }, comments: {} })
  mocked.writeText.mockResolvedValue('v2')
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  vi.clearAllMocks()
})

function entry(path: string, extra: Partial<PageEntry> = {}): PageEntry {
  return { path, slug: '', title: '', date: '', expiryDate: '', publishDate: '', draft: false, permalink: '', kind: 'page', section: '', ...extra }
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

async function render() {
  const contentFiles = Object.keys(FILES)
    .filter((p) => p.startsWith('content/'))
    .map((path) => ({ path, title: null, modifiedMs: 1 }))
  context = {
    site: { root: 'C:/pages-site', name: 'site', configFiles: ['hugo.toml'], contentDir: 'content', isGitRepo: false },
    hugo: null,
    files: contentFiles,
    pagesAt: '2026-01-01T00:00:00.000Z',
    pages: [entry('content/search.md', { draft: true, permalink: 'https://example.org/search/' })],
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
        <PagesView />
      </SiteContext.Provider>,
    ),
  )
  await waitFor(() => container.querySelector('tbody tr'))
  await waitFor(() => container.textContent?.includes('main'))
}

describe('PagesView', () => {
  it('lists standalone pages with their menus and draft state, not posts', async () => {
    await render()
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows.map((r) => r.querySelector('.font-medium')?.textContent)).toEqual(['Home', 'About', 'Search'])
    expect(rows[1].textContent).toContain('main')
    expect(rows[2].textContent).toContain('draft')
    expect(rows[2].textContent).toContain('layout: search')
    expect(container.textContent).not.toContain('Hello')
    click(button(rows[1], 'Open About in the editor'))
    expect(context.openFile).toHaveBeenCalledWith('content/about.md')
  })

  it('adds a page to a menu through its front matter after showing the diff', async () => {
    await render()
    const search = [...container.querySelectorAll('tbody tr')][2]
    click(button(search, 'Add to menu'))
    const dialog = await waitFor(() => document.querySelector<HTMLElement>('[aria-labelledby="settings-file-changes-title"]'))
    const write = await waitFor(() => !button(dialog, 'Write files').disabled && button(dialog, 'Write files'))
    click(write)
    await waitFor(() => mocked.writeText.mock.calls.length > 0)
    expect(mocked.writeText).toHaveBeenCalledWith('content/search.md', '---\ntitle: Search\ndraft: true\nlayout: search\nmenus:\n  main:\n    weight: 20\n---\n', 'v-content/search.md')
    expect(context.reloadFiles).toHaveBeenCalled()
  })
})
