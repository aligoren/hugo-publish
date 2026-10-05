// Test helper shared by the checks, publish and new-post component tests.

import { vi } from 'vitest'

import type { SiteInfo } from '../../lib/api'
import type { SiteContextValue } from '../site/SiteContext'

export const testSite: SiteInfo = {
  root: 'D:/site',
  name: 'site',
  configFiles: ['hugo.toml'],
  contentDir: 'content',
  isGitRepo: true,
}

/**
 * A site context with mock callbacks. Fields these features do not use may be added to
 * `SiteContextValue` by others; the cast keeps the tests compiling until they matter here.
 */
export function testSiteContext(overrides: Partial<SiteContextValue> = {}): SiteContextValue {
  const value: Partial<SiteContextValue> = {
    site: testSite,
    hugo: null,
    files: [],
    pages: [],
    reloadFiles: vi.fn(async () => {}),
    reloadPages: vi.fn(async () => {}),
    refreshHugo: vi.fn(async () => {}),
    openFile: vi.fn(),
    showView: vi.fn(),
    configVersion: 0,
    notifyConfigChanged: vi.fn(),
    ...overrides,
  }
  return value as SiteContextValue
}
