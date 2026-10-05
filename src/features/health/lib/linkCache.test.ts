import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearCachedChecks, LINK_CACHE_KEY, LINK_CACHE_TTL_MS, loadCachedChecks, saveCachedChecks } from './linkCache'
import { Cancelled, mapLimit } from './pool'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  }
}

const check = (url: string, checkedAt: number) => ({ url, ok: true, status: 200, finalUrl: url, error: null, checkedAt })

describe('link cache', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps results for a day', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const now = 1_000_000_000
    saveCachedChecks([check('https://a.org/', now), check('https://old.org/', now - LINK_CACHE_TTL_MS - 1)], now)
    expect([...loadCachedChecks(now).keys()]).toEqual(['https://a.org/'])
    expect(loadCachedChecks(now + LINK_CACHE_TTL_MS).size).toBe(0)
    clearCachedChecks()
    expect(loadCachedChecks(now).size).toBe(0)
  })

  it('survives broken or missing storage', () => {
    const broken = memoryStorage()
    broken.setItem(LINK_CACHE_KEY, '{not json')
    vi.stubGlobal('localStorage', broken)
    expect(loadCachedChecks().size).toBe(0)
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('full')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    })
    expect(loadCachedChecks().size).toBe(0)
    expect(() => saveCachedChecks([check('https://a.org/', Date.now())])).not.toThrow()
    expect(() => clearCachedChecks()).not.toThrow()
  })
})

describe('mapLimit', () => {
  it('keeps order, limits concurrency and reports progress', async () => {
    let running = 0
    let peak = 0
    const progress: number[] = []
    const result = await mapLimit(
      [1, 2, 3, 4, 5],
      2,
      async (n) => {
        running++
        peak = Math.max(peak, running)
        await new Promise((r) => setTimeout(r, 5 - n))
        running--
        return n * 10
      },
      { onProgress: (d) => progress.push(d) },
    )
    expect(result).toEqual([10, 20, 30, 40, 50])
    expect(peak).toBe(2)
    expect(progress).toEqual([1, 2, 3, 4, 5])
  })

  it('stops starting work when cancelled', async () => {
    const controller = new AbortController()
    const started: number[] = []
    const run = mapLimit(
      [1, 2, 3, 4],
      1,
      async (n) => {
        started.push(n)
        if (n === 2) controller.abort()
        return n
      },
      { signal: controller.signal },
    )
    await expect(run).rejects.toBeInstanceOf(Cancelled)
    expect(started).toEqual([1, 2])
  })
})
