// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import type { ConfigOp, ContentFile } from '../../lib/api'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { TaxonomiesView } from './TaxonomiesView'

const { mockApi, disk, mtimes } = vi.hoisted(() => {
  const disk = new Map<string, string>()
  const mtimes = new Map<string, number>()
  const versionOf = (text: string) => `v-${text.length}-${[...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)}`
  const parseToml = (text: string) => {
    const values: Record<string, unknown> = {}
    for (const line of text.split('\n')) {
      const match = /^(\w+) = (.*)$/.exec(line)
      if (match) values[match[1]] = JSON.parse(match[2])
    }
    return values
  }
  const mockApi = {
    configEffective: vi.fn(),
    readText: vi.fn(async (path: string) => {
      const text = disk.get(path)
      if (text === undefined) throw { code: 'io', message: `${path} not found` }
      return { text, version: versionOf(text) }
    }),
    writeText: vi.fn(async (path: string, text: string, expectedVersion?: string) => {
      if (expectedVersion !== undefined) {
        const current = disk.has(path) ? versionOf(disk.get(path)!) : ''
        if (current !== expectedVersion) throw { code: 'conflict', message: 'the file changed on disk since it was opened' }
      }
      disk.set(path, text)
      mtimes.set(path, (mtimes.get(path) ?? 0) + 1)
      return versionOf(text)
    }),
    tomlParseText: vi.fn(async (text: string) => ({ values: parseToml(text), comments: {} })),
    tomlEditText: vi.fn(async (text: string, ops: ConfigOp[]) => {
      let out = text
      for (const op of ops) {
        if (op.op !== 'set') continue
        const key = String(op.path[0])
        out = out.replace(new RegExp(`^${key} = .*$`, 'm'), `${key} = ${JSON.stringify(op.value)}`)
      }
      return out
    }),
    historySave: vi.fn(async () => ({})),
    renameFile: vi.fn(async (from: string, to: string) => {
      for (const path of [...disk.keys()]) {
        if (!path.startsWith(`${from}/`)) continue
        disk.set(to + path.slice(from.length), disk.get(path)!)
        disk.delete(path)
      }
      return to
    }),
  }
  return { mockApi, disk, mtimes }
})

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: mockApi }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const POSTS: Record<string, string> = {
  'content/yazilar/siir-notu.md': '---\ntitle: "Şiir Notu: 140"\ndraft: false\ncategories: ["deneme"]\ntags: ["siir", "alinti"]\n---\n\nMetin\n',
  'content/yazilar/kitap.md': '---\ntitle: "Örnek Kitap"\ndraft: true\ncategories: ["kitap"]\ntags:\n  - Kitap\n  - alinti\n---\n',
  'content/yazilar/toml.md': '+++\ntitle = "TOML örneği"\ntags = ["kitap", "kitaplar"]\n+++\n',
  'content/hakkinda.md': '---\ntitle: Hakkında\n---\n',
}

function filesOnDisk(): ContentFile[] {
  return [...disk.keys()]
    .filter((path) => path.startsWith('content/'))
    .sort()
    .map((path) => ({ path, title: null, modifiedMs: mtimes.get(path) ?? 0 }))
}

const site = {
  openFile: vi.fn(),
  showView: vi.fn(),
  reloadFiles: vi.fn(),
}

function Harness() {
  const [files, setFiles] = useState(filesOnDisk)
  const value: SiteContextValue = {
    site: { root: 'C:/site', name: 'site', configFiles: ['hugo.toml'], contentDir: 'content', isGitRepo: false },
    hugo: null,
    files,
    pagesAt: '2026-01-01T00:00:00.000Z',
    pages: [],
    reloadFiles: async () => {
      site.reloadFiles()
      setFiles(filesOnDisk())
    },
    reloadPages: async () => {},
    refreshHugo: async () => {},
    openFile: site.openFile,
    showView: site.showView,
    configVersion: 0,
    notifyConfigChanged: () => {},
  }
  return (
    <SiteContext.Provider value={value}>
      <TaxonomiesView />
    </SiteContext.Provider>
  )
}

let root: Root | null = null
let container: HTMLDivElement

function render() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<Harness />))
}

async function waitFor(check: () => void, timeout = 3000) {
  const start = Date.now()
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - start > timeout) throw error
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
}

const text = () => container.textContent ?? ''

function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label))
  if (!found) throw new Error(`No button “${label}”`)
  return found
}

function termButton(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('li button')].find((b) => b.querySelector('span')?.textContent === name)
  if (!found) throw new Error(`No term “${name}”`)
  return found as HTMLButtonElement
}

function dialog(): HTMLElement {
  const found = container.querySelector<HTMLElement>('[role="dialog"]')
  if (!found) throw new Error('No dialog')
  return found
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function showTab(name: string) {
  await waitFor(() => button(name))
  await click(button(name))
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  disk.clear()
  mtimes.clear()
  for (const [path, content] of Object.entries(POSTS)) disk.set(path, content)
  vi.clearAllMocks()
  mockApi.configEffective.mockResolvedValue({
    values: { taxonomies: { category: 'categories', tag: 'tags' }, disablekinds: [], removepathaccents: true },
    messages: [],
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container.remove()
})

describe('TaxonomiesView', () => {
  it('lists the terms of each taxonomy with counts, details and posts', async () => {
    render()
    await waitFor(() => expect(termButton('kitap')).toBeTruthy())
    expect(termButton('deneme').textContent).toBe('deneme1')
    expect(text()).toContain('Categories2')
    expect(text()).toContain('Tags5')

    await click(termButton('kitap'))
    expect(text()).toContain('/categories/kitap/')
    expect(text()).toContain('Örnek Kitap')
    expect(text()).toContain('Draft')
    await click(button('Örnek Kitap'))
    expect(site.openFile).toHaveBeenCalledWith('content/yazilar/kitap.md')

    await showTab('Tags')
    await waitFor(() => expect(termButton('alinti').textContent).toBe('alinti2'))
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Sort"]')!
    await act(async () => {
      select.value = 'count'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const names = [...container.querySelectorAll('li button > span:first-child')].map((s) => s.textContent)
    expect(names[0]).toBe('alinti')

    await type(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'KİTAP')
    const filtered = [...container.querySelectorAll('li button > span:first-child')].map((s) => s.textContent)
    expect(filtered).toEqual(['kitap', 'Kitap', 'kitaplar'])
  })

  it('shows progress while posts are read', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    mockApi.readText.mockImplementationOnce(async (path: string) => {
      await gate
      return { text: disk.get(path)!, version: 'v' }
    })
    render()
    await waitFor(() => expect(text()).toMatch(/Reading posts… \d \/ 4/))
    release()
    await waitFor(() => expect(text()).not.toContain('Reading posts'))
  })

  it('explains when taxonomies are turned off', async () => {
    mockApi.configEffective.mockResolvedValue({ values: { taxonomies: {} }, messages: [] })
    render()
    await waitFor(() => expect(text()).toContain('Categories and tags are turned off for this site.'))
    await click(button('Open site settings'))
    expect(site.showView).toHaveBeenCalledWith('settings')
  })

  it('falls back to the config files when Hugo cannot be asked', async () => {
    mockApi.configEffective.mockRejectedValue({ code: 'hugo_not_found', message: 'no hugo' })
    ;(mockApi as Record<string, unknown>).tomlRead = vi.fn(async () => ({ values: { taxonomies: { tag: 'tags' } }, comments: {} }))
    disk.set('hugo.toml', '[taxonomies]\ntag = "tags"\n')
    render()
    await waitFor(() => expect(text()).toContain('Hugo could not report the site settings'))
    await waitFor(() => expect(termButton('alinti')).toBeTruthy())
    expect([...container.querySelectorAll('nav button')].map((b) => b.textContent)).toEqual(['Tags5'])
  })

  it('renames a term after showing the front matter diff, then reloads', async () => {
    render()
    await showTab('Tags')
    await waitFor(() => termButton('alinti'))
    const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Select “alinti”"]')!
    await click(checkbox)
    await click(button('Rename…'))
    expect(dialog().getAttribute('aria-label')).toBe('Rename “alinti”')
    expect(dialog().textContent).toContain('Used by 2 posts.')

    await type(dialog().querySelector('input')!, 'alintilar')
    await click(button('Show changes', dialog()))
    await waitFor(() => expect(dialog().textContent).toContain('2 files will change'))
    expect(dialog().textContent).toContain('content/yazilar/siir-notu.md')
    expect(dialog().textContent).toContain('tags: ["siir", "alintilar"]')

    await click(button('Write 2 files', dialog()))
    await waitFor(() => expect(dialog().textContent).toContain('2 files updated.'))
    expect(mockApi.writeText).toHaveBeenCalledTimes(2)
    for (const [, , version] of mockApi.writeText.mock.calls) expect(version).toMatch(/^v-/)
    expect(disk.get('content/yazilar/siir-notu.md')).toBe(POSTS['content/yazilar/siir-notu.md'].replace('"alinti"]', '"alintilar"]'))
    expect(disk.get('content/yazilar/kitap.md')).toBe(POSTS['content/yazilar/kitap.md'].replace('  - alinti\n', '  - alintilar\n'))
    expect(site.reloadFiles).toHaveBeenCalled()

    await click(button('Done', dialog()))
    await waitFor(() => expect(termButton('alintilar').textContent).toBe('alintilar2'))
    expect(() => termButton('alinti')).toThrow()
  })

  it('reports files that changed on disk and writes the others', async () => {
    render()
    await waitFor(() => termButton('kitap'))
    await click(termButton('deneme'))
    await click(button('Delete…'))
    await click(button('Show changes', dialog()))
    await waitFor(() => expect(dialog().textContent).toContain('1 file will change'))
    // Another program edits the file between the preview and the write.
    disk.set('content/yazilar/siir-notu.md', POSTS['content/yazilar/siir-notu.md'] + 'Ek\n')
    await click(button('Write 1 file', dialog()))
    await waitFor(() => expect(dialog().textContent).toContain('1 file could not be written'))
    expect(dialog().textContent).toContain('content/yazilar/siir-notu.md')
    expect(dialog().textContent).toContain('never overwritten')
    expect(disk.get('content/yazilar/siir-notu.md')).toContain('categories: ["deneme"]')
  })

  it('suggests merging similar terms and dedupes when merging', async () => {
    render()
    await showTab('Tags')
    await showTab('Similar terms')
    await waitFor(() => expect(text()).toContain('same page in Hugo'))
    expect(text()).toContain('singular/plural')
    await click(button('Merge into “kitap”…'))
    expect(dialog().getAttribute('aria-label')).toBe('Merge terms')
    expect(dialog().querySelector<HTMLInputElement>('input:not([type])')!.value).toBe('kitap')

    await click(button('Show changes', dialog()))
    await waitFor(() => expect(dialog().textContent).toContain('2 files will change'))
    await click(button('Write 2 files', dialog()))
    await waitFor(() => expect(dialog().textContent).toContain('2 files updated.'))
    expect(disk.get('content/yazilar/toml.md')).toBe('+++\ntitle = "TOML örneği"\ntags = ["kitap"]\n+++\n')
    expect(disk.get('content/yazilar/kitap.md')).toContain('tags:\n  - kitap\n  - alinti\n')
    expect(mockApi.tomlEditText).toHaveBeenCalledWith('title = "TOML örneği"\ntags = ["kitap", "kitaplar"]\n', [
      { op: 'set', path: ['tags'], value: ['kitap'] },
    ])
  })

  it('creates a term page with a title and description', async () => {
    render()
    await waitFor(() => termButton('kitap'))
    await click(termButton('kitap'))
    await waitFor(() => expect(text()).toContain('No term page yet'))
    expect(container.querySelector('section input')).toBeNull()
    await click(button('Add a term page…'))
    const title = container.querySelector<HTMLInputElement>('section input')!
    expect(title.value).toBe('kitap')
    await type(title, 'Kitaplar')
    await type(container.querySelector<HTMLTextAreaElement>('section textarea')!, 'Okuma notları')
    await waitFor(() => expect(text()).toContain('New file content/categories/kitap/_index.md'))
    await click(button('Create term page'))
    await waitFor(() => expect(mockApi.writeText).toHaveBeenCalled())
    expect(mockApi.writeText).toHaveBeenCalledWith(
      'content/categories/kitap/_index.md',
      '---\ntitle: "Kitaplar"\ndescription: "Okuma notları"\n---\n',
      '',
    )
    await waitFor(() => expect(text()).toContain('This term has its own page.'))
    // The term page is not counted as a post.
    expect(termButton('kitap').textContent).toBe('kitap1')
  })

  it('edits an existing term page with its version', async () => {
    disk.set('content/categories/kitap/_index.md', '---\ntitle: Kitaplar # başlık\n---\n\nKitap notları.\n')
    render()
    await waitFor(() => termButton('kitap'))
    await click(termButton('kitap'))
    await waitFor(() => expect(container.querySelector<HTMLInputElement>('section input')?.value).toBe('Kitaplar'))
    expect(text()).toContain('This term has its own page.')
    await type(container.querySelector<HTMLInputElement>('section input')!, 'Kitap Notları')
    await waitFor(() => expect(text()).toContain('title: Kitap Notları # başlık'))
    await click(button('Save'))
    await waitFor(() => expect(text()).toContain('Saved.'))
    expect(disk.get('content/categories/kitap/_index.md')).toBe('---\ntitle: Kitap Notları # başlık\n---\n\nKitap notları.\n')
    const [, , version] = mockApi.writeText.mock.calls[0]
    expect(version).toMatch(/^v-/)
  })

  it('moves the term page along when a term is renamed', async () => {
    disk.set('content/categories/kitap/_index.md', '---\ntitle: Kitaplar\n---\n')
    render()
    await waitFor(() => termButton('kitap'))
    await click(termButton('kitap'))
    await click(button('Rename…'))
    await type(dialog().querySelector('input')!, 'Okuma Notları')
    await click(button('Show changes', dialog()))
    await waitFor(() => expect(dialog().textContent).toContain('Also move the term page from content/categories/kitap to content/categories/okuma-notları'))
    await click(button('Write 1 file', dialog()))
    await waitFor(() => expect(dialog().textContent).toContain('The term page was moved to content/categories/okuma-notları.'))
    expect(mockApi.renameFile).toHaveBeenCalledWith('content/categories/kitap', 'content/categories/okuma-notları')
    expect(disk.get('content/yazilar/kitap.md')).toContain('categories: ["Okuma Notları"]')
    await click(button('Done', dialog()))
    await waitFor(() => expect(text()).toContain('This term has its own page.'))
    expect(text()).toContain('/categories/okuma-notları/')
  })
})
