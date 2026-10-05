// The per-site pin in `.hugo-publisher/site.toml`:
//
//   [hugo]
//   version = "0.167.0"      # the Hugo this site is built with
//   extended = true          # optional
//
//   [hosting]
//   hugoVersion = "0.167.0"  # HUGO_VERSION as configured at the host (e.g. Cloudflare Pages)
//
// Only these keys are touched; everything else in the file (comments included) stays as it is.

import { api, isAppError, type ConfigOp } from '../../lib/api'
import { normalizeVersion } from './versions'

export const SITE_TOML = '.hugo-publisher/site.toml'

export interface SitePins {
  /** Pinned Hugo version for this site (`x.y.z`). */
  hugoVersion: string | null
  /** Pinned edition, when the file says so. */
  hugoExtended: boolean | null
  /** HUGO_VERSION configured at the hosting provider. */
  hostingVersion: string | null
}

export interface SiteTomlFile {
  exists: boolean
  text: string
  /** Version token for a safe write; `''` for a file that does not exist yet. */
  version: string
  pins: SitePins
}

export const EMPTY_PINS: SitePins = { hugoVersion: null, hugoExtended: null, hostingVersion: null }

function table(values: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = values[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Pins from the parsed file. Versions are kept as written (so an invalid one can be shown). */
export function pinsFromValues(values: Record<string, unknown>): SitePins {
  const hugo = table(values, 'hugo')
  const hosting = table(values, 'hosting')
  return {
    hugoVersion: text(hugo.version),
    hugoExtended: typeof hugo.extended === 'boolean' ? hugo.extended : null,
    hostingVersion: text(hosting.hugoVersion),
  }
}

function isMissingFile(error: unknown): boolean {
  return isAppError(error) && error.code === 'io'
}

export async function readSiteToml(): Promise<SiteTomlFile> {
  let file
  try {
    file = await api.readText(SITE_TOML)
  } catch (error) {
    // A missing file is the normal case. The write later passes version '' ("must not exist"),
    // so a file that exists after all is never overwritten blindly.
    if (isMissingFile(error)) return { exists: false, text: '', version: '', pins: EMPTY_PINS }
    throw error
  }
  const { values } = await api.tomlParseText(file.text)
  return { exists: true, text: file.text, version: file.version, pins: pinsFromValues(values) }
}

/** The ops that turn `current` into `next`. Blank values remove their key. */
export function pinOps(current: SitePins, next: SitePins): ConfigOp[] {
  const ops: ConfigOp[] = []
  const field = (path: string[], before: unknown, after: unknown) => {
    if (before === after) return
    if (after === null) ops.push({ op: 'remove', path })
    else ops.push({ op: 'set', path, value: after })
  }
  field(['hugo', 'version'], current.hugoVersion, next.hugoVersion)
  field(['hugo', 'extended'], current.hugoExtended, next.hugoExtended)
  field(['hosting', 'hugoVersion'], current.hostingVersion, next.hostingVersion)
  return ops
}

/** Checks user input; returns the cleaned pins or the fields that are not versions. */
export function validatePins(input: {
  hugoVersion: string
  hostingVersion: string
  hugoExtended: boolean | null
}): { pins: SitePins; invalid: ('hugoVersion' | 'hostingVersion')[] } {
  const invalid: ('hugoVersion' | 'hostingVersion')[] = []
  const clean = (value: string, key: 'hugoVersion' | 'hostingVersion') => {
    if (value.trim() === '') return null
    const normalized = normalizeVersion(value)
    if (!normalized) invalid.push(key)
    return normalized
  }
  return {
    pins: {
      hugoVersion: clean(input.hugoVersion, 'hugoVersion'),
      hugoExtended: input.hugoExtended,
      hostingVersion: clean(input.hostingVersion, 'hostingVersion'),
    },
    invalid,
  }
}

export interface SiteTomlEdit {
  before: string
  after: string
}

/** The new file text (nothing is written). */
export async function planSiteTomlEdit(file: SiteTomlFile, next: SitePins): Promise<SiteTomlEdit> {
  const ops = pinOps(file.pins, next)
  const after = ops.length === 0 ? file.text : await api.tomlEditText(file.text, ops)
  return { before: file.text, after }
}

/** Writes the planned text; fails with a conflict when the file changed since it was read. */
export function writeSiteToml(file: SiteTomlFile, after: string): Promise<string> {
  return api.writeText(SITE_TOML, after, file.exists ? file.version : '')
}
