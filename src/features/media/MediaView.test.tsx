// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import type { ContentFile, MediaDetails, SiteInfo } from '../../lib/api'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { MediaView } from './MediaView'
import { button, cleanup, click, flush, image, mount, tile } from './testing'
import { clearUsageCache } from './usage'

const mocks = vi.hoisted(() => ({
  api: {
    mediaList: vi.fn(),
    mediaDetails: vi.fn(),
    mediaImportFiles: vi.fn(),
    mediaStripMetadata: vi.fn(),
    mediaDelete: vi.fn(),
    mediaThumbnail: vi.fn(),
    readText: vi.fn(),
    listFiles: vi.fn(),
  },
  open: vi.fn(),
  confirm: vi.fn(),
  unlisten: vi.fn(),
  drop: null as null | ((event: { payload: unknown }) => void),
}))

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: mocks.api,
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, confirm: mocks.confirm }))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: (event: { payload: unknown }) => void) => {
      mocks.drop = handler
      return mocks.unlisten
    },
  }),
}))

const site: SiteInfo = { root: 'C:/site', name: 'site', configFiles: ['hugo.toml'], contentDir: 'content', isGitRepo: true }
const files: ContentFile[] = [{ path: 'content/posts/x/index.md', title: 'X', modifiedMs: 5 }]

const located = image('static/images/beach.jpg', { hasGps: true, hasMetadata: true })
const used = image('content/posts/x/used.png', { format: 'png' })
const orphan = image('assets/orphan.webp', { format: 'webp', size: 5000 })

function details(file = located, gps = true): MediaDetails {
  return {
    file,
    entries: gps
      ? [
          { group: 'GPS', key: 'Latitude', value: '41.010000°' },
          { group: 'EXIF', key: 'Camera model', value: 'Canon EOS R6' },
        ]
      : [],
    camera: gps ? 'Canon EOS R6' : null,
    takenAt: null,
    gps: gps ? { lat: 41.01, lon: 28.975 } : null,
  }
}

function render() {
  const value = {
    site,
    hugo: null,
    files,
    pages: [],
    configVersion: 0,
  } as unknown as SiteContextValue
  return mount(
    <SiteContext.Provider value={value}>
      <MediaView />
    </SiteContext.Provider>,
  )
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  vi.clearAllMocks()
  clearUsageCache()
  mocks.drop = null
  mocks.api.mediaList.mockResolvedValue([located, used, orphan])
  mocks.api.mediaThumbnail.mockResolvedValue('data:image/png;base64,AA==')
  mocks.api.readText.mockImplementation(async (path: string) => ({
    text: path === 'hugo.toml' ? 'title = "x"' : '![](used.png) and ![](/images/beach.jpg)',
    version: '1',
  }))
  mocks.api.listFiles.mockResolvedValue([])
  mocks.api.mediaDetails.mockImplementation(async (path: string) => details(image(path, { hasGps: true })))
})

afterEach(cleanup)

describe('MediaView', () => {
  it('shows images with privacy badges and finds unused ones', async () => {
    const { container } = await render()
    expect(container.textContent).toContain('Images: 3')
    expect(tile(container, located.path).textContent).toContain('Location')
    expect(tile(container, orphan.path).textContent).toContain('Unused')
    expect(tile(container, used.path).textContent).not.toContain('Unused')
    expect(mocks.api.readText).toHaveBeenCalledWith('content/posts/x/index.md')
    expect(mocks.api.readText).toHaveBeenCalledWith('hugo.toml')
  })

  it('filters by location and by usage', async () => {
    const { container } = await render()
    await click(button(container, 'Has location'))
    expect(container.querySelectorAll('li button[title]').length).toBe(1)
    await click(button(container, 'Has location'))
    await click(button(container, 'Unused'))
    expect([...container.querySelectorAll('li button[title]')].map((b) => b.getAttribute('title'))).toEqual([orphan.path])
  })

  it('warns about the location and removes it', async () => {
    const cleaned = { ...located, hasGps: false, hasMetadata: false, modifiedMs: 2 }
    mocks.api.mediaStripMetadata.mockResolvedValue(cleaned)
    const { container } = await render()
    await click(tile(container, located.path))
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('41.01000, 28.97500')
    expect(container.textContent).toContain('/images/beach.jpg')
    expect(container.textContent).toContain('Canon EOS R6')

    mocks.api.mediaDetails.mockResolvedValue(details(cleaned, false))
    await click(button(container, 'Remove location and camera data'))
    expect(mocks.api.mediaStripMetadata).toHaveBeenCalledWith(located.path)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Metadata removed')
    expect(tile(container, located.path).textContent).not.toContain('Location')
  })

  it('cleans every image with a location after confirmation', async () => {
    const second = image('static/two.jpg', { hasGps: true })
    mocks.api.mediaList.mockResolvedValue([located, second, used])
    mocks.api.mediaStripMetadata.mockImplementation(async (path: string) => image(path))
    mocks.confirm.mockResolvedValue(true)
    const { container } = await render()
    await click(button(container, 'Clean all images with location data (2)'))
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.api.mediaStripMetadata.mock.calls.map((c) => c[0])).toEqual([located.path, second.path])
    expect(container.textContent).toContain('Cleaned 2 images.')
  })

  it('does nothing when the bulk clean is not confirmed', async () => {
    mocks.confirm.mockResolvedValue(false)
    const { container } = await render()
    await click(button(container, 'Clean all images with location data (1)'))
    expect(mocks.api.mediaStripMetadata).not.toHaveBeenCalled()
  })

  it('imports chosen files with metadata removal on by default', async () => {
    mocks.open.mockResolvedValue(['C:\\Photos\\IMG_1.jpg'])
    mocks.api.mediaImportFiles.mockResolvedValue(['static/images/image.jpg'])
    const { container } = await render()
    await click(button(container, 'Import images…'))
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }))
    const form = container.querySelector('form')!
    expect(form.textContent).toContain('IMG_1.jpg')
    const checkbox = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(true)
    await click(button(container, 'Import'))
    expect(mocks.api.mediaImportFiles).toHaveBeenCalledWith(['C:\\Photos\\IMG_1.jpg'], {
      targetDir: 'static/images',
      stripMetadata: true,
      maxWidth: null,
    })
    expect(container.querySelector('form')).toBeNull()
    expect(mocks.api.mediaList).toHaveBeenCalledTimes(2)
  })

  it('imports files dropped from the system and stops listening when closed', async () => {
    const { container, unmount } = await render()
    expect(mocks.drop).not.toBeNull()
    await act(() => mocks.drop!({ payload: { type: 'enter', paths: [], position: { x: 0, y: 0 } } }))
    expect(container.textContent).toContain('Drop images here')
    await act(() => mocks.drop!({ payload: { type: 'drop', paths: ['/home/a/b.PNG', '/home/a/notes.txt'], position: { x: 0, y: 0 } } }))
    const form = container.querySelector('form')!
    expect(form.textContent).toContain('b.PNG')
    expect(form.textContent).not.toContain('notes.txt')
    unmount()
    expect(mocks.unlisten).toHaveBeenCalled()
  })

  it('deletes after confirmation', async () => {
    mocks.confirm.mockResolvedValue(true)
    mocks.api.mediaDelete.mockResolvedValue(undefined)
    const { container } = await render()
    await click(tile(container, orphan.path))
    await click(button(container, 'Delete'))
    expect(mocks.api.mediaDelete).toHaveBeenCalledWith(orphan.path)
    expect(container.querySelector(`button[title="${orphan.path}"]`)).toBeNull()
  })
})

async function act(callback: () => void) {
  const { act: reactAct } = await import('react')
  await reactAct(async () => callback())
  await flush()
}
