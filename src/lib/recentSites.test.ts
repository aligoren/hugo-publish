import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    get() {
      return Promise.resolve(undefined)
    }
    set() {
      return Promise.resolve()
    }
  },
}))

const { withRecent } = await import('./recentSites')

describe('withRecent', () => {
  const site = (path: string, openedMs = 1) => ({ path, name: path, openedMs })

  it('puts the opened site first and drops its older entry', () => {
    const list = [site('C:\\a'), site('C:\\b')]
    expect(withRecent(list, site('C:\\b', 9)).map((s) => s.path)).toEqual(['C:\\b', 'C:\\a'])
  })

  it('treats paths case- and trailing-slash-insensitively', () => {
    const list = [site('C:\\Sites\\Blog\\')]
    expect(withRecent(list, site('c:\\sites\\blog'))).toHaveLength(1)
  })

  it('keeps at most `max` entries', () => {
    const list = Array.from({ length: 5 }, (_, i) => site(`/s/${i}`))
    expect(withRecent(list, site('/new'), 3).map((s) => s.path)).toEqual(['/new', '/s/0', '/s/1'])
  })
})
