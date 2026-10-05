import { describe, expect, it } from 'vitest'

import { findInstalledVersion } from './useHugoManager'
import { formatBytes, progressPercent, errorHintKey, formatDate } from './format'
import { isWindowsArm64 } from './platform'
import {
  compareVersions,
  formatVersion,
  hugoVersionString,
  isOlder,
  normalizeVersion,
  parseVersion,
  samePath,
  sameVersion,
  sortNewestFirst,
} from './versions'
import type { HugoInfo, ManagedHugo } from '../../lib/api'

describe('version strings', () => {
  it('parses plain, v-prefixed, two-part and numeric versions', () => {
    expect(parseVersion('0.167.0')).toEqual([0, 167, 0])
    expect(parseVersion('v0.153.2')).toEqual([0, 153, 2])
    expect(parseVersion(' 0.146 ')).toEqual([0, 146, 0])
    expect(parseVersion(0.41)).toEqual([0, 41, 0])
    for (const bad of ['', 'latest', '0.167.0-rc1', '1', '0.1.2.3', null, undefined, {}, true]) {
      expect(parseVersion(bad)).toBeNull()
    }
    expect(normalizeVersion('v0.41')).toBe('0.41.0')
    expect(normalizeVersion('x')).toBeNull()
    expect(formatVersion([1, 2, 3])).toBe('1.2.3')
  })

  it('compares numerically, not as text', () => {
    expect(compareVersions('0.99.0', '0.100.0')).toBeLessThan(0)
    expect(compareVersions('0.158.0', '0.147.7')).toBeGreaterThan(0)
    expect(compareVersions('v0.153.0', '0.153')).toBe(0)
    expect(compareVersions('0.9.10', '0.10.0')).toBeLessThan(0)
    // Unparseable versions sort first.
    expect(compareVersions('nope', '0.1.0')).toBeLessThan(0)
    expect(compareVersions('nope', 'also nope')).toBe(0)
    expect(isOlder('0.147.7', '0.158.0')).toBe(true)
    expect(isOlder('0.158.0', '0.158.0')).toBe(false)
    expect(isOlder('nope', '0.158.0')).toBe(false)
    expect(sameVersion('0.167.0', 'v0.167.0')).toBe(true)
    expect(sameVersion('nope', 'nope')).toBe(false)
  })

  it('sorts newest first and keeps the order of equal versions', () => {
    const list = [
      { version: '0.99.1', tag: 'a' },
      { version: '0.167.0', tag: 'b' },
      { version: '0.160.1', tag: 'c' },
      { version: '0.167.0', tag: 'd' },
    ]
    expect(sortNewestFirst(list).map((r) => r.tag)).toEqual(['b', 'd', 'c', 'a'])
    expect(list[0].tag).toBe('a')
  })

  it('reads the version of a detected Hugo', () => {
    const info = { version: { major: 0, minor: 167, patch: 0 } } as HugoInfo
    expect(hugoVersionString(info)).toBe('0.167.0')
  })

  it('compares paths like the OS does', () => {
    expect(samePath('C:\\Users\\A\\hugo.exe', 'c:/users/a/hugo.exe')).toBe(true)
    expect(samePath('/opt/Hugo/hugo', '/opt/hugo/hugo')).toBe(false)
    expect(samePath('/opt/hugo/', '/opt/hugo')).toBe(true)
    expect(samePath(null, '/opt/hugo')).toBe(false)
  })
})

describe('formatting', () => {
  it('formats sizes and percentages', () => {
    expect(formatBytes(512, 'en')).toBe('512 B')
    expect(formatBytes(1536, 'en')).toBe('1.5 KB')
    expect(formatBytes(30 * 1024 * 1024, 'en')).toBe('30.0 MB')
    expect(formatBytes(150 * 1024 * 1024, 'en')).toBe('150 MB')
    expect(progressPercent(50, 200)).toBe(25)
    expect(progressPercent(50, null)).toBeNull()
    expect(progressPercent(300, 200)).toBe(100)
    expect(formatDate('2026-09-28T14:50:38Z', 'en')).toContain('2026')
    expect(formatDate('garbage', 'en')).toBe('')
  })

  it('explains known version-manager errors', () => {
    expect(errorHintKey({ code: 'invalid', message: 'GitHub rate limit reached (HTTP 403) while x' })).toBe(
      'hugo.errors.rateLimited',
    )
    expect(errorHintKey({ code: 'invalid', message: 'Network error while downloading' })).toBe('hugo.errors.network')
    expect(errorHintKey({ code: 'invalid', message: 'checksum mismatch for x.zip' })).toBe('hugo.errors.checksum')
    expect(errorHintKey({ code: 'io', message: 'disk full' })).toBeNull()
    expect(errorHintKey(new Error('x'))).toBeNull()
  })
})

describe('platform', () => {
  it('detects Windows on ARM from client hints, falling back to the running Hugo', () => {
    expect(isWindowsArm64({ uaPlatform: 'Windows', uaArchitecture: 'arm', uaBitness: '64' })).toBe(true)
    expect(isWindowsArm64({ uaPlatform: 'Windows', uaArchitecture: 'x86', hugoOs: 'windows', hugoArch: 'arm64' })).toBe(
      false,
    )
    expect(isWindowsArm64({ uaPlatform: 'macOS', uaArchitecture: 'arm' })).toBe(false)
    expect(isWindowsArm64({ hugoOs: 'windows', hugoArch: 'arm64' })).toBe(true)
    expect(isWindowsArm64({ hugoOs: 'windows', hugoArch: 'amd64' })).toBe(false)
    expect(isWindowsArm64({})).toBe(false)
  })
})

describe('findInstalledVersion', () => {
  const entry = (version: string, extended: boolean): ManagedHugo => ({
    version,
    extended,
    path: `/hugo/${version}${extended ? '-extended' : ''}/hugo`,
  })
  const installed = [entry('0.167.0', true), entry('0.160.1', false)]

  it('prefers the same edition and accepts extended for standard', () => {
    expect(findInstalledVersion(installed, '0.167.0', true, false)?.extended).toBe(true)
    expect(findInstalledVersion(installed, 'v0.167.0', false, false)?.extended).toBe(true)
    expect(findInstalledVersion(installed, '0.160.1', true, false)).toBeNull()
    // Where no extended build exists, the standard one is what "extended" means.
    expect(findInstalledVersion(installed, '0.160.1', true, true)?.extended).toBe(false)
    expect(findInstalledVersion(null, '0.160.1', false, false)).toBeNull()
  })
})
