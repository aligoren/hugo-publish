// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clampWidth, DEFAULT_PANE_PREFS, loadPanePrefs, PANE_PREFS_KEY, savePanePrefs } from './panePrefs'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('pane preferences', () => {
  it('round-trips and clamps what was stored', () => {
    savePanePrefs({ open: true, tab: 'preview', widths: { panel: 450, preview: 700 } })
    expect(loadPanePrefs()).toEqual({ open: true, tab: 'preview', widths: { panel: 450, preview: 700 } })
    localStorage.setItem(PANE_PREFS_KEY, JSON.stringify({ open: 'yes', tab: 'other', widths: { panel: 5000, preview: 'wide' } }))
    expect(loadPanePrefs()).toEqual({ open: false, tab: 'settings', widths: { panel: 640, preview: 600 } })
  })

  it('falls back to the defaults when storage is broken or unavailable', () => {
    localStorage.setItem(PANE_PREFS_KEY, '{not json')
    expect(loadPanePrefs()).toEqual(DEFAULT_PANE_PREFS)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadPanePrefs()).toEqual(DEFAULT_PANE_PREFS)
    expect(() => savePanePrefs(DEFAULT_PANE_PREFS)).not.toThrow()
  })

  it('keeps widths within limits per kind', () => {
    expect(clampWidth('panel', 100)).toBe(320)
    expect(clampWidth('preview', 100)).toBe(360)
    expect(clampWidth('preview', 1000.4)).toBe(1000)
  })
})
