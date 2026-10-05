import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  readText: vi.fn(),
  tomlParseText: vi.fn(),
  tomlEditText: vi.fn(),
  writeText: vi.fn(),
  tomlRead: vi.fn(),
}))

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api,
}))

import { loadSiteHugoData } from './siteData'
import {
  EMPTY_PINS,
  pinOps,
  pinsFromValues,
  planSiteTomlEdit,
  readSiteToml,
  SITE_TOML,
  validatePins,
  writeSiteToml,
} from './siteToml'

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
})

describe('site.toml', () => {
  it('reads pins from the parsed file', () => {
    expect(pinsFromValues({ hugo: { version: '0.167.0', extended: true }, hosting: { hugoVersion: ' 0.160.1 ' } })).toEqual({
      hugoVersion: '0.167.0',
      hugoExtended: true,
      hostingVersion: '0.160.1',
    })
    expect(pinsFromValues({ hugo: 'not a table', hosting: { hugoVersion: '' } })).toEqual(EMPTY_PINS)
  })

  it('treats a missing file as empty and other errors as errors', async () => {
    api.readText.mockRejectedValueOnce({ code: 'io', message: 'I/O error: not found' })
    await expect(readSiteToml()).resolves.toEqual({ exists: false, text: '', version: '', pins: EMPTY_PINS })
    expect(api.readText).toHaveBeenCalledWith(SITE_TOML)

    api.readText.mockRejectedValueOnce({ code: 'not_utf8', message: 'x' })
    await expect(readSiteToml()).rejects.toMatchObject({ code: 'not_utf8' })
  })

  it('reads an existing file', async () => {
    const text = '# pins\n[hugo]\nversion = "0.167.0"\n'
    api.readText.mockResolvedValueOnce({ text, version: 'v1' })
    api.tomlParseText.mockResolvedValueOnce({ values: { hugo: { version: '0.167.0' } }, comments: {} })
    const file = await readSiteToml()
    expect(api.tomlParseText).toHaveBeenCalledWith(text)
    expect(file).toEqual({
      exists: true,
      text,
      version: 'v1',
      pins: { hugoVersion: '0.167.0', hugoExtended: null, hostingVersion: null },
    })
  })

  it('turns pin changes into set and remove ops', () => {
    const current = { hugoVersion: '0.160.1', hugoExtended: true, hostingVersion: '0.147.7' }
    expect(pinOps(current, current)).toEqual([])
    expect(pinOps(current, { hugoVersion: '0.167.0', hugoExtended: true, hostingVersion: null })).toEqual([
      { op: 'set', path: ['hugo', 'version'], value: '0.167.0' },
      { op: 'remove', path: ['hosting', 'hugoVersion'] },
    ])
    expect(pinOps(EMPTY_PINS, { ...EMPTY_PINS, hostingVersion: '0.167.0' })).toEqual([
      { op: 'set', path: ['hosting', 'hugoVersion'], value: '0.167.0' },
    ])
  })

  it('validates and normalizes user input', () => {
    expect(validatePins({ hugoVersion: 'v0.167.0', hostingVersion: '  ', hugoExtended: null })).toEqual({
      pins: { hugoVersion: '0.167.0', hugoExtended: null, hostingVersion: null },
      invalid: [],
    })
    expect(validatePins({ hugoVersion: 'latest', hostingVersion: '0.147', hugoExtended: true }).invalid).toEqual([
      'hugoVersion',
    ])
  })

  it('plans a new file and writes it only if it still does not exist', async () => {
    const missing = { exists: false, text: '', version: '', pins: EMPTY_PINS }
    api.tomlEditText.mockResolvedValueOnce('[hugo]\nversion = "0.167.0"\n')
    const plan = await planSiteTomlEdit(missing, { ...EMPTY_PINS, hugoVersion: '0.167.0' })
    expect(api.tomlEditText).toHaveBeenCalledWith('', [{ op: 'set', path: ['hugo', 'version'], value: '0.167.0' }])
    expect(plan).toEqual({ before: '', after: '[hugo]\nversion = "0.167.0"\n' })

    api.writeText.mockResolvedValueOnce('v2')
    await writeSiteToml(missing, plan.after)
    expect(api.writeText).toHaveBeenCalledWith(SITE_TOML, plan.after, '')
  })

  it('edits an existing file with its version token, skipping no-op edits', async () => {
    const file = { exists: true, text: 'a = 1\n', version: 'v7', pins: EMPTY_PINS }
    await expect(planSiteTomlEdit(file, EMPTY_PINS)).resolves.toEqual({ before: 'a = 1\n', after: 'a = 1\n' })
    expect(api.tomlEditText).not.toHaveBeenCalled()
    await writeSiteToml(file, 'a = 1\n[hosting]\n')
    expect(api.writeText).toHaveBeenCalledWith(SITE_TOML, 'a = 1\n[hosting]\n', 'v7')
  })
})

describe('loadSiteHugoData', () => {
  it('collects the pin, the theme requirement and config features', async () => {
    const files: Record<string, string> = {
      'hugo.toml': 'theme = "PaperMod"\n',
      'config/_default/languages.toml': '[tr]\nlocale = "tr-TR"\n',
    }
    const values: Record<string, Record<string, unknown>> = {
      'hugo.toml': { theme: 'PaperMod' },
      'config/_default/languages.toml': { tr: { locale: 'tr-TR' } },
      'themes/PaperMod/theme.toml': { name: 'PaperMod', min_version: '0.146.0' },
    }
    api.readText.mockImplementation(async (path: string) => {
      if (path in files) return { text: files[path], version: 'v' }
      throw { code: 'io', message: 'not found' }
    })
    api.tomlRead.mockImplementation(async (path: string) => {
      if (path in values) return { values: values[path], comments: {} }
      throw { code: 'io', message: 'not found' }
    })
    const data = await loadSiteHugoData(['hugo.toml', 'config/_default/languages.toml', 'config/_default/broken.json'])
    expect(data.file.exists).toBe(false)
    expect(data.theme).toEqual({ name: 'PaperMod', minVersion: '0.146.0', extended: false })
    expect(data.features).toEqual([{ key: 'locale', minVersion: '0.158.0' }])
    expect(api.tomlRead).toHaveBeenCalledWith('themes/PaperMod/theme.toml')
  })

  it('does not look for module themes in the themes folder', async () => {
    api.readText.mockImplementation(async (path: string) => {
      if (path === 'hugo.toml') return { text: '', version: 'v' }
      throw { code: 'io', message: 'not found' }
    })
    api.tomlRead.mockResolvedValue({ values: { theme: ['github.com/x/theme'] }, comments: {} })
    const data = await loadSiteHugoData(['hugo.toml'])
    expect(data.theme).toEqual({ name: 'github.com/x/theme', minVersion: null, extended: false })
    expect(api.tomlRead).toHaveBeenCalledTimes(1)
  })
})
