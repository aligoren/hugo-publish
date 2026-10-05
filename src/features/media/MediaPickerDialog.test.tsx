// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import { MediaPickerDialog } from './MediaPickerDialog'
import { button, cleanup, click, doubleClick, flush, image, mount, tile, type } from './testing'

const mocks = vi.hoisted(() => ({
  api: {
    mediaList: vi.fn(),
    mediaImportFiles: vi.fn(),
    mediaStripMetadata: vi.fn(),
    mediaThumbnail: vi.fn(),
  },
  open: vi.fn(),
  unlisten: vi.fn(),
  drop: null as null | ((event: { payload: unknown }) => void),
}))

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: mocks.api,
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, confirm: vi.fn() }))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: (event: { payload: unknown }) => void) => {
      mocks.drop = handler
      return mocks.unlisten
    },
  }),
}))

const cover = image('content/posts/x/cover.jpg')
const logo = image('static/logo.png', { format: 'png', hasGps: true })

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.api.mediaList.mockResolvedValue([cover, logo])
  mocks.api.mediaThumbnail.mockResolvedValue('data:image/png;base64,AA==')
})

afterEach(cleanup)

function setup(defaultTargetDir?: string) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  return mount(<MediaPickerDialog defaultTargetDir={defaultTargetDir} onPick={onPick} onClose={onClose} />).then(
    (mounted) => ({ ...mounted, onPick, onClose }),
  )
}

describe('MediaPickerDialog', () => {
  it('picks an image from the site', async () => {
    const { container, onPick } = await setup()
    expect(button(container, 'Insert').disabled).toBe(true)
    await click(tile(container, cover.path))
    await click(button(container, 'Insert'))
    expect(onPick).toHaveBeenCalledWith(cover.path)
    await doubleClick(tile(container, logo.path))
    expect(onPick).toHaveBeenLastCalledWith(logo.path)
  })

  it('searches and warns about images with a location', async () => {
    const { container } = await setup()
    await type(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'logo')
    expect(container.querySelectorAll('li button[title]').length).toBe(1)
    await click(tile(container, logo.path))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('contains its location')
    mocks.api.mediaStripMetadata.mockResolvedValue({ ...logo, hasGps: false, modifiedMs: 2 })
    await click(button(container, 'Remove location and camera data'))
    expect(mocks.api.mediaStripMetadata).toHaveBeenCalledWith(logo.path)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('imports into the page bundle and picks the new image', async () => {
    mocks.open.mockResolvedValue(['/home/me/IMG_20261003_1.jpg'])
    mocks.api.mediaImportFiles.mockResolvedValue(['content/posts/x/image.jpg'])
    const { container, onPick } = await setup('content/posts/x')
    await click(button(container, 'Import'))
    await click(button(container, 'Choose files…'))
    const target = container.querySelector<HTMLInputElement>('form input:not([type])')!
    expect(target.value).toBe('content/posts/x')
    await type(container.querySelector<HTMLInputElement>('input[type="number"]')!, '1600')
    await click(container.querySelector<HTMLButtonElement>('form button[type="submit"]')!)
    expect(mocks.api.mediaImportFiles).toHaveBeenCalledWith(['/home/me/IMG_20261003_1.jpg'], {
      targetDir: 'content/posts/x',
      stripMetadata: true,
      maxWidth: 1600,
    })
    expect(onPick).toHaveBeenCalledWith('content/posts/x/image.jpg')
  })

  it('switches to importing when files are dropped', async () => {
    const { container, unmount } = await setup()
    await act(async () =>
      mocks.drop!({ payload: { type: 'drop', paths: ['C:\\a\\b.webp'], position: { x: 0, y: 0 } } }),
    )
    await flush()
    const target = container.querySelector<HTMLInputElement>('form input:not([type])')!
    expect(target.value).toBe('static/images')
    expect(container.querySelector('form')?.textContent).toContain('b.webp')
    unmount()
    expect(mocks.unlisten).toHaveBeenCalled()
  })

  it('closes with Escape', async () => {
    const { onClose } = await setup()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onClose).toHaveBeenCalled()
  })
})
