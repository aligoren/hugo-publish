import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, deploySettingsOps, forgeSetting, readDeploySettings, validateSettings } from './deploySettings'

describe('deploy settings', () => {
  it('reads the [deploy] table with defaults', () => {
    expect(readDeploySettings({})).toEqual(DEFAULT_SETTINGS)
    expect(
      readDeploySettings({ deploy: { Method: 'gh-pages', branch: ' pages ', liveurl: 'https://x.org', cloudflareProject: 'blog' } }),
    ).toEqual({ method: 'gh-pages', branch: 'pages', liveUrl: 'https://x.org', cloudflareProject: 'blog', forge: '' })
    expect(readDeploySettings({ deploy: { Forge: 'GitLab' } }).forge).toBe('gitlab')
    expect(readDeploySettings({ deploy: { forge: 'svn' } }).forge).toBe('')
    expect(readDeploySettings({ deploy: { method: 'ftp', branch: 3 } })).toEqual(DEFAULT_SETTINGS)
    expect(readDeploySettings({ deploy: 'odd' })).toEqual(DEFAULT_SETTINGS)
  })

  it('builds minimal ops, keeping existing key casing and removing emptied values', () => {
    expect(deploySettingsOps({}, DEFAULT_SETTINGS)).toEqual([
      { op: 'set', path: ['deploy', 'method'], value: 'push' },
      { op: 'set', path: ['deploy', 'branch'], value: 'gh-pages' },
    ])
    const values = { deploy: { method: 'push', branch: 'gh-pages', liveurl: 'https://old.org', cloudflareProject: 'blog' } }
    expect(
      deploySettingsOps(values, { method: 'gh-pages', branch: 'gh-pages', liveUrl: 'https://new.org', cloudflareProject: '', forge: 'gitea' }),
    ).toEqual([
      { op: 'set', path: ['deploy', 'method'], value: 'gh-pages' },
      { op: 'set', path: ['deploy', 'liveurl'], value: 'https://new.org' },
      { op: 'remove', path: ['deploy', 'cloudflareProject'] },
      { op: 'set', path: ['deploy', 'forge'], value: 'gitea' },
    ])
    expect(deploySettingsOps(values, readDeploySettings(values))).toEqual([])
  })

  it('reads the forge kind like the Rust side', () => {
    expect(forgeSetting(' GitHub ')).toBe('github')
    expect(forgeSetting('forgejo')).toBe('gitea')
    expect(forgeSetting('codeberg')).toBe('gitea')
    expect(forgeSetting('bitbucket')).toBe('')
  })

  it('validates values', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull()
    expect(validateSettings({ ...DEFAULT_SETTINGS, method: 'gh-pages', branch: 'a..b' })).toBe('branch')
    expect(validateSettings({ ...DEFAULT_SETTINGS, method: 'gh-pages', branch: '-x' })).toBe('branch')
    expect(validateSettings({ ...DEFAULT_SETTINGS, method: 'gh-pages', branch: 'site/pages' })).toBeNull()
    expect(validateSettings({ ...DEFAULT_SETTINGS, liveUrl: 'example.org' })).toBe('liveUrl')
    expect(validateSettings({ ...DEFAULT_SETTINGS, cloudflareProject: 'my blog' })).toBe('cloudflareProject')
  })
})
