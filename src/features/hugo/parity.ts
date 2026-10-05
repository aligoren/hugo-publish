// Hugo version parity: the Hugo on this computer, the version pinned for the site, the
// HUGO_VERSION at the host and what the theme and the config need should agree. A site that
// builds locally can otherwise fail (or silently differ) when the host builds it.

import { compareVersions, isOlder, normalizeVersion, sameVersion } from './versions'

/** Hugo in Cloudflare Pages' v3 build image when HUGO_VERSION is not set. */
export const CLOUDFLARE_DEFAULT_HUGO = '0.147.7'

/** Config keys that only newer Hugo versions understand. `*` matches any key (e.g. a language). */
export const CONFIG_FEATURES: { key: string; path: string[]; minVersion: string }[] = [
  { key: 'locale', path: ['locale'], minVersion: '0.158.0' },
  { key: 'locale', path: ['languages', '*', 'locale'], minVersion: '0.158.0' },
  { key: 'pagination', path: ['pagination'], minVersion: '0.128.0' },
  { key: 'segments', path: ['segments'], minVersion: '0.124.0' },
  { key: 'markup.goldmark.extensions.extras', path: ['markup', 'goldmark', 'extensions', 'extras'], minVersion: '0.126.0' },
  {
    key: 'markup.goldmark.extensions.passthrough',
    path: ['markup', 'goldmark', 'extensions', 'passthrough'],
    minVersion: '0.122.0',
  },
]

export interface UsedFeature {
  key: string
  minVersion: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasPath(values: unknown, path: string[]): boolean {
  if (path.length === 0) return values !== undefined && values !== null
  if (!isRecord(values)) return false
  const [head, ...rest] = path
  if (head === '*') return Object.values(values).some((child) => hasPath(child, rest))
  const key = Object.keys(values).find((k) => k.toLowerCase() === head.toLowerCase())
  return key !== undefined && hasPath(values[key], rest)
}

/**
 * Values of a config file placed at the config root: `hugo.toml` is the root itself,
 * `config/_default/languages.toml` holds the `languages` table, and so on.
 */
export function rootValues(file: string, values: Record<string, unknown>): Record<string, unknown> {
  const name = file.split('/').pop() ?? file
  const base = name.replace(/\.(toml|ya?ml|json)$/i, '')
  if (!file.includes('/') || base === 'hugo' || base === 'config') return values
  return { [base]: values }
}

/** Version-dependent config keys used by the site, each with the newest requirement. */
export function usedFeatures(configs: { file: string; values: Record<string, unknown> }[]): UsedFeature[] {
  const found = new Map<string, string>()
  for (const { file, values } of configs) {
    const root = rootValues(file, values)
    for (const feature of CONFIG_FEATURES) {
      if (!hasPath(root, feature.path)) continue
      const previous = found.get(feature.key)
      if (!previous || compareVersions(feature.minVersion, previous) > 0) found.set(feature.key, feature.minVersion)
    }
  }
  return [...found].map(([key, minVersion]) => ({ key, minVersion }))
}

/** The theme name from the site config (`theme = "x"` or `theme = ["x", "y"]`: the first). */
export function themeName(configs: { file: string; values: Record<string, unknown> }[]): string | null {
  for (const { file, values } of configs) {
    const root = rootValues(file, values)
    const theme = root.theme
    const name = Array.isArray(theme) ? theme[0] : theme
    if (typeof name === 'string' && name.trim() !== '') return name.trim()
  }
  return null
}

/** A theme that lives in `themes/<name>` (not a Hugo module path such as `github.com/x/y`). */
export function isLocalTheme(name: string): boolean {
  return /^[\w.-]+$/.test(name) && name !== '.' && name !== '..'
}

export interface ThemeRequirement {
  name: string
  /** `min_version` from theme.toml or `module.hugoVersion.min`. */
  minVersion: string | null
  /** `module.hugoVersion.extended`. */
  extended: boolean
}

/** Reads the requirement out of a theme's theme.toml and config values. */
export function themeRequirement(
  name: string,
  themeToml: Record<string, unknown> | null,
  themeConfig: Record<string, unknown> | null,
): ThemeRequirement {
  const module = isRecord(themeConfig?.module) ? themeConfig.module : {}
  const hugoVersion = isRecord(module.hugoVersion) ? module.hugoVersion : {}
  const candidates = [themeToml?.min_version, hugoVersion.min].map(normalizeVersion).filter((v): v is string => !!v)
  const minVersion = candidates.sort((a, b) => compareVersions(b, a))[0] ?? null
  return { name, minVersion, extended: hugoVersion.extended === true }
}

export interface ParityInput {
  /** The Hugo the app uses right now. */
  active: { version: string; extended: boolean } | null
  pinned: string | null
  hosting: string | null
  theme: ThemeRequirement | null
  features: UsedFeature[]
}

export type VersionTarget = 'active' | 'pinned' | 'hosting'

export type ParityWarning =
  | { kind: 'noActive' }
  | { kind: 'invalidPin'; field: 'pinned' | 'hosting'; value: string }
  | { kind: 'activeNotPinned'; active: string; pinned: string }
  | { kind: 'themeTooNew'; target: VersionTarget; theme: string; required: string; actual: string; assumed: boolean }
  | { kind: 'themeNeedsExtended'; theme: string }
  | { kind: 'featureTooNew'; target: VersionTarget; feature: string; required: string; actual: string; assumed: boolean }
  | { kind: 'hostingMissing'; assumed: string }
  | { kind: 'hostingDiffers'; hosting: string; local: string; localKind: 'pinned' | 'active' }

export type Severity = 'error' | 'warn' | 'info'

export function severity(warning: ParityWarning): Severity {
  switch (warning.kind) {
    case 'noActive':
    case 'invalidPin':
      return 'error'
    case 'hostingMissing':
      return 'info'
    case 'themeTooNew':
    case 'featureTooNew':
      return warning.assumed ? 'warn' : warning.target === 'pinned' ? 'warn' : 'error'
    default:
      return 'warn'
  }
}

/** Everything that does not line up, most important first. */
export function parityWarnings(input: ParityInput): ParityWarning[] {
  const warnings: ParityWarning[] = []
  const pinned = input.pinned ? normalizeVersion(input.pinned) : null
  const hosting = input.hosting ? normalizeVersion(input.hosting) : null
  const active = input.active?.version ?? null

  if (!input.active) warnings.push({ kind: 'noActive' })
  if (input.pinned && !pinned) warnings.push({ kind: 'invalidPin', field: 'pinned', value: input.pinned })
  if (input.hosting && !hosting) warnings.push({ kind: 'invalidPin', field: 'hosting', value: input.hosting })

  if (active && pinned && !sameVersion(active, pinned)) warnings.push({ kind: 'activeNotPinned', active, pinned })

  // Versions to check requirements against; a missing host version means the host's default.
  const targets: { target: VersionTarget; version: string; assumed: boolean }[] = []
  if (active) targets.push({ target: 'active', version: active, assumed: false })
  if (pinned && !sameVersion(pinned, active)) targets.push({ target: 'pinned', version: pinned, assumed: false })
  targets.push(
    hosting
      ? { target: 'hosting', version: hosting, assumed: false }
      : { target: 'hosting', version: CLOUDFLARE_DEFAULT_HUGO, assumed: true },
  )

  const theme = input.theme
  if (theme?.minVersion) {
    for (const t of targets) {
      if (isOlder(t.version, theme.minVersion)) {
        warnings.push({
          kind: 'themeTooNew',
          target: t.target,
          theme: theme.name,
          required: theme.minVersion,
          actual: t.version,
          assumed: t.assumed,
        })
      }
    }
  }
  if (theme?.extended && input.active && !input.active.extended) {
    warnings.push({ kind: 'themeNeedsExtended', theme: theme.name })
  }

  for (const feature of input.features) {
    for (const t of targets) {
      if (isOlder(t.version, feature.minVersion)) {
        warnings.push({
          kind: 'featureTooNew',
          target: t.target,
          feature: feature.key,
          required: feature.minVersion,
          actual: t.version,
          assumed: t.assumed,
        })
      }
    }
  }

  if (!hosting) {
    warnings.push({ kind: 'hostingMissing', assumed: CLOUDFLARE_DEFAULT_HUGO })
  } else {
    const local = pinned ?? active
    if (local && !sameVersion(hosting, local)) {
      warnings.push({ kind: 'hostingDiffers', hosting, local, localKind: pinned ? 'pinned' : 'active' })
    }
  }

  const order: Record<Severity, number> = { error: 0, warn: 1, info: 2 }
  return warnings
    .map((warning, index) => ({ warning, index }))
    .sort((a, b) => order[severity(a.warning)] - order[severity(b.warning)] || a.index - b.index)
    .map((entry) => entry.warning)
}
