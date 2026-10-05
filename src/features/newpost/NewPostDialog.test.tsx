// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import type { ContentFile } from '../../lib/api'
import { testSiteContext } from '../checks/testing'
import { SiteContext } from '../site/SiteContext'
import { NewPostDialog } from './NewPostDialog'

const api = vi.hoisted(() => ({
  listArchetypes: vi.fn(),
  newContent: vi.fn(),
  readText: vi.fn(),
  writeText: vi.fn(),
}))
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<object>()), api }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const files: ContentFile[] = [
  { path: 'content/posts/var-olan.md', title: 'Var olan', modifiedMs: 1 },
  { path: 'content/posts/ikinci.md', title: 'İkinci', modifiedMs: 2 },
  { path: 'content/notlar/galeri/index.md', title: 'Galeri', modifiedMs: 3 },
  { path: 'content/hakkinda.md', title: 'Hakkında', modifiedMs: 4 },
]

const context = () => testSiteContext({ files })

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<SiteContext.Provider value={context()}>{element}</SiteContext.Provider>))
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

function byLabel<T extends HTMLElement>(container: HTMLElement, text: string): T {
  const label = [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === text)
  if (!label) throw new Error(`no field labelled ${text}`)
  return label.querySelector('input, select') as unknown as T
}

const flush = () => act(async () => {})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  api.listArchetypes.mockResolvedValue([
    { name: 'default', path: 'archetypes/default.md', source: 'site' },
    { name: 'posts', path: 'archetypes/posts.md', source: 'site' },
    { name: 'galeri', path: 'archetypes/galeri', source: 'site' },
    { name: 'note', path: 'themes/t/archetypes/note.md', source: 'theme' },
  ])
  api.newContent.mockReset()
  api.readText.mockReset()
  api.writeText.mockReset()
})

describe('NewPostDialog', () => {
  it('builds the slug and path from the title, in the busiest section', async () => {
    const container = await mount(<NewPostDialog onCreated={vi.fn()} onClose={vi.fn()} />)
    const preview = () => container.querySelector('[data-testid="path-preview"]')!.textContent
    setValue(byLabel(container, 'Title'), 'Işık ve Gölge: Çağrışımlar')
    expect(byLabel<HTMLInputElement>(container, 'Address (slug)').value).toBe('isik-ve-golge-cagrisimlar')
    expect(preview()).toBe('content/posts/isik-ve-golge-cagrisimlar.md')

    // The slug can be edited; the box keeps what was typed.
    setValue(byLabel(container, 'Address (slug)'), 'Işık-')
    expect(byLabel<HTMLInputElement>(container, 'Address (slug)').value).toBe('Işık-')
    expect(preview()).toBe('content/posts/isik.md')

    // Bundle option and archetype labels.
    setValue(byLabel(container, 'Folder'), 'notlar')
    const bundle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(bundle.checked).toBe(true)
    expect(preview()).toBe('content/notlar/isik/index.md')
    const options = [...byLabel<HTMLSelectElement>(container, 'Type').options].map((o) => o.textContent)
    expect(options).toEqual(['Automatic (default)', 'default', 'posts', 'galeri', 'note (theme)'])
  })

  it('flags duplicates and missing titles', async () => {
    const container = await mount(<NewPostDialog onCreated={vi.fn()} onClose={vi.fn()} />)
    const create = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Create')!
    expect(create.disabled).toBe(true)
    setValue(byLabel(container, 'Title'), 'Var Olan')
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('content/posts/var-olan.md')
    expect(create.disabled).toBe(true)
    setValue(byLabel(container, 'Title'), 'Yepyeni')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(create.disabled).toBe(false)
  })

  it('creates the post, writes the real title and reports the path', async () => {
    api.newContent.mockResolvedValue('content/posts/ilk-yazi/index.md')
    api.readText.mockResolvedValue({ text: '---\ntitle: "Ilk Yazi"\ndraft: true\n---\n', version: 'v1' })
    api.writeText.mockResolvedValue('v2')
    const onCreated = vi.fn()
    const container = await mount(<NewPostDialog onCreated={onCreated} onClose={vi.fn()} />)
    setValue(byLabel(container, 'Title'), 'İlk yazı')
    setValue(byLabel(container, 'Type'), 'galeri')
    const bundle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(bundle.checked && bundle.disabled).toBe(true)
    await act(async () => container.querySelector('form')!.requestSubmit())
    await flush()

    expect(api.newContent).toHaveBeenCalledWith('content/posts/ilk-yazi/index.md', 'galeri')
    expect(api.writeText).toHaveBeenCalledWith('content/posts/ilk-yazi/index.md', '---\ntitle: "İlk yazı"\ndraft: true\n---\n', 'v1')
    expect(onCreated).toHaveBeenCalledWith('content/posts/ilk-yazi/index.md')
  })

  it('passes no kind for the automatic choice and creates new sections', async () => {
    api.newContent.mockResolvedValue('content/gezi-notlari/ilk.md')
    api.readText.mockResolvedValue({ text: '+++\ntitle = "İlk"\n+++\n', version: 'v1' })
    const onCreated = vi.fn()
    const container = await mount(<NewPostDialog onCreated={onCreated} onClose={vi.fn()} />)
    setValue(byLabel(container, 'Title'), 'İlk')
    setValue(byLabel(container, 'Folder'), '//new')
    setValue(byLabel(container, 'Section name'), 'Gezi Notları')
    await act(async () => container.querySelector('form')!.requestSubmit())
    await flush()
    expect(api.newContent).toHaveBeenCalledWith('content/gezi-notlari/ilk.md', undefined)
    // The title was already right: nothing to write.
    expect(api.writeText).not.toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith('content/gezi-notlari/ilk.md')
  })

  it('needs only a title: the folder and type default to the last ones used on the site', async () => {
    api.newContent.mockResolvedValue('content/notlar/ilk/index.md')
    api.readText.mockResolvedValue({ text: '---\ntitle: "İlk"\n---\n', version: 'v1' })
    const first = await mount(<NewPostDialog onCreated={vi.fn()} onClose={vi.fn()} />)
    // The title comes first and has the focus.
    const title = byLabel<HTMLInputElement>(first, 'Title')
    expect(first.querySelector('input')).toBe(title)
    expect(document.activeElement).toBe(title)
    setValue(title, 'İlk')
    setValue(byLabel(first, 'Folder'), 'notlar')
    setValue(byLabel(first, 'Type'), 'galeri')
    await act(async () => first.querySelector('form')!.requestSubmit())
    await flush()
    expect(api.newContent).toHaveBeenCalledWith('content/notlar/ilk/index.md', 'galeri')

    const second = await mount(<NewPostDialog onCreated={vi.fn()} onClose={vi.fn()} />)
    await flush()
    expect(byLabel<HTMLSelectElement>(second, 'Folder').value).toBe('notlar')
    expect(byLabel<HTMLSelectElement>(second, 'Type').value).toBe('galeri')
    setValue(byLabel(second, 'Title'), 'İkinci not')
    expect(second.querySelector('[data-testid="path-preview"]')!.textContent).toBe('content/notlar/ikinci-not/index.md')
  })

  it('forgets a remembered type the site no longer has', async () => {
    localStorage.setItem('hugo-publisher.newPost', JSON.stringify({ 'D:/site': { section: 'gone', kind: 'eski' } }))
    const container = await mount(<NewPostDialog onCreated={vi.fn()} onClose={vi.fn()} />)
    await flush()
    expect(byLabel<HTMLSelectElement>(container, 'Folder').value).toBe('posts')
    expect(byLabel<HTMLSelectElement>(container, 'Type').value).toBe('')
  })

  it('shows errors from Hugo and keeps the dialog open', async () => {
    api.newContent.mockRejectedValue({ code: 'hugo_failed', message: 'ERROR boom' })
    const onCreated = vi.fn()
    const container = await mount(<NewPostDialog onCreated={onCreated} onClose={vi.fn()} />)
    setValue(byLabel(container, 'Title'), 'Yeni')
    await act(async () => container.querySelector('form')!.requestSubmit())
    await flush()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('ERROR boom')
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const container = await mount(<NewPostDialog onCreated={vi.fn()} onClose={onClose} />)
    act(() => {
      byLabel(container, 'Title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalled()
  })
})
