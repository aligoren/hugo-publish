import { beforeEach, describe, expect, it, vi } from 'vitest'

const relaunch = vi.fn(async () => {})
const stored = new Map<string, unknown>()

vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => relaunch() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get(key: string) {
      return stored.get(key)
    }
    async set(key: string, value: unknown) {
      stored.set(key, value)
    }
  },
}))

const { installUpdate, loadCheckAtStartup, saveCheckAtStartup } = await import('./updates')

type Event = { event: 'Started'; data: { contentLength?: number } } | { event: 'Progress'; data: { chunkLength: number } } | { event: 'Finished' }

function fakeUpdate(events: Event[]) {
  return {
    version: '0.2.0',
    downloadAndInstall: vi.fn(async (onEvent: (event: Event) => void) => {
      for (const event of events) onEvent(event)
    }),
  } as unknown as Parameters<typeof installUpdate>[0]
}

beforeEach(() => {
  stored.clear()
  relaunch.mockClear()
})

describe('installUpdate', () => {
  it('reports progress as a fraction and restarts at the end', async () => {
    const progress: (number | null)[] = []
    const update = fakeUpdate([
      { event: 'Started', data: { contentLength: 200 } },
      { event: 'Progress', data: { chunkLength: 50 } },
      { event: 'Progress', data: { chunkLength: 150 } },
      { event: 'Finished' },
    ])
    await installUpdate(update, (p) => progress.push(p))
    expect(progress).toEqual([0, 0.25, 1, 1])
    expect(relaunch).toHaveBeenCalledOnce()
  })

  it('reports unknown progress when the size is not known', async () => {
    const progress: (number | null)[] = []
    await installUpdate(fakeUpdate([{ event: 'Started', data: {} }, { event: 'Progress', data: { chunkLength: 10 } }]), (p) => progress.push(p))
    expect(progress).toEqual([null, null])
  })

  it('does not restart when the install fails', async () => {
    const update = {
      downloadAndInstall: vi.fn(async () => {
        throw new Error('bad signature')
      }),
    } as unknown as Parameters<typeof installUpdate>[0]
    await expect(installUpdate(update, () => {})).rejects.toThrow('bad signature')
    expect(relaunch).not.toHaveBeenCalled()
  })
})

describe('check at startup', () => {
  it('is on until turned off', async () => {
    expect(await loadCheckAtStartup()).toBe(true)
    await saveCheckAtStartup(false)
    expect(await loadCheckAtStartup()).toBe(false)
    await saveCheckAtStartup(true)
    expect(await loadCheckAtStartup()).toBe(true)
  })
})
