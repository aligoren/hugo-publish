// Curated theme schemas (layer (a)): JSON-Schema-like data with `x-` extensions for the UI and
// Hugo semantics (research §15). Schemas are data, not code, so new themes are added without
// touching the form engine.
import type { Literal } from './scan/infer'

export interface Localized {
  en: string
  tr: string
}

export type SchemaType = 'string' | 'boolean' | 'integer' | 'number' | 'array' | 'object'

export type Widget =
  | 'toggle'
  | 'select'
  | 'text'
  | 'textarea'
  | 'markdown'
  | 'html'
  | 'url'
  | 'number'
  | 'color'
  | 'image'
  | 'asset'
  | 'dateFormat'
  | 'stringList'
  | 'multiselect'
  | 'objectList'
  | 'keyValue'
  | 'iconSelect'

export type ParamScopeName = 'site' | 'page' | 'both' | 'language'

export interface SchemaField {
  type?: SchemaType | SchemaType[]
  enum?: Literal[]
  default?: unknown
  format?: 'uri' | 'uri-reference' | 'color' | 'markdown' | 'html' | 'date-format' | 'image'
  minimum?: number
  maximum?: number
  items?: SchemaField
  properties?: Record<string, SchemaField>
  required?: string[]
  'x-label'?: Localized
  'x-description'?: Localized
  'x-group'?: string
  'x-scope'?: ParamScopeName
  'x-widget'?: Widget
  /** `omit`: unchecking deletes the key instead of writing `false`. */
  'x-writeFalse'?: 'omit'
  'x-productionOnly'?: boolean
  'x-deprecated'?: Localized
  'x-gotcha'?: Localized
  'x-precedence'?: 'site-over-page'
  'x-requires'?: string[]
  'x-requiresConfig'?: { path: string; value: unknown; note: Localized }
  'x-assetRoots'?: string[]
  /** Options come from the scanned comparisons of another key (e.g. icon names in svg.html). */
  'x-optionsFrom'?: string
  'x-allowCustom'?: boolean
  'x-optionLabels'?: Record<string, Localized>
  /** Keep an object as one key/value field instead of one field per property. */
  'x-flatten'?: false
  'x-conflictsWith'?: string[]
  'x-placeholder'?: string
  /** Writes a single string when the list has one item (string-or-list keys such as `author`). */
  'x-stringOrList'?: boolean
}

export interface CssHookDir {
  kind: 'dir'
  /** Site folder whose CSS files the theme bundles, e.g. `assets/css/extended/`. */
  path: string
  /** The app's own file in it. */
  fileName: string
}

export interface CssHookFile {
  kind: 'file'
  /** A single file the theme includes; the app manages a marked block inside it. */
  path: string
}

export interface ThemeMeta {
  id: string
  name: string
  repos: string[]
  themeTomlNames: string[]
  folderNames: string[]
  /** Theme files that identify it (layout paths are compared in their Hugo ≥0.146 form). */
  fingerprint: string[]
  docs?: string
  cssHook?: CssHookDir | CssHookFile
  /** CSS files with the colour variables; `{params.x|fallback}` is replaced by the site value. */
  cssVarsFiles?: string[]
  darkSelector?: string
}

export type FeatureStep =
  /** Adds `value` to a list in the main config (e.g. JSON to outputs.home). */
  | { op: 'ensureListContains'; path: string[]; value: string; defaultList: string[] }
  /** Sets a site param. */
  | { op: 'setParam'; key: string; value: unknown }
  /** Creates a content file unless a page with the layout already exists. */
  | {
      op: 'ensureContentFile'
      path: string
      title: Localized
      frontMatter: Record<string, unknown>
      layout: string
    }
  /** Optionally adds a menu entry. */
  | { op: 'menuItem'; menu: string; name: Localized; url: string; weight: number }

export interface FeatureDef {
  label: Localized
  description: Localized
  steps: FeatureStep[]
}

export interface ThemeSchema {
  $schema?: string
  'x-theme': ThemeMeta
  'x-groups': { id: string; label: Localized }[]
  type: 'object'
  properties: Record<string, SchemaField>
  'x-pageParams'?: Record<string, SchemaField>
  'x-features'?: Record<string, FeatureDef>
  'x-i18n'?: string[]
}

export const L = (en: string, tr: string): Localized => ({ en, tr })

/** A field of a schema with its full dotted key (`profileMode.buttons`). */
export interface FlatSchemaField {
  key: string
  field: SchemaField
}

/**
 * Flattens nested object properties into dotted keys. Arrays and objects marked
 * `x-flatten: false` (or without properties) stay one field.
 */
export function flattenSchema(properties: Record<string, SchemaField>, prefix = ''): FlatSchemaField[] {
  const out: FlatSchemaField[] = []
  for (const [name, field] of Object.entries(properties)) {
    const key = prefix ? `${prefix}.${name}` : name
    const isObject = field.type === 'object' || (field.properties !== undefined && field.type === undefined)
    if (isObject && field.properties && field['x-flatten'] !== false) {
      const children = flattenSchema(field.properties, key).map((child) => ({
        key: child.key,
        field: {
          ...child.field,
          'x-group': child.field['x-group'] ?? field['x-group'],
          'x-scope': child.field['x-scope'] ?? field['x-scope'],
        },
      }))
      out.push(...children)
    } else {
      out.push({ key, field })
    }
  }
  return out
}

// --- Matching ---------------------------------------------------------------------------------

export interface ThemeIdentity {
  /** Folder name under themes/. */
  folderName: string
  /** `name` in theme.toml. */
  themeTomlName?: string
  /** Module path (go.mod) and homepage from theme.toml. */
  urls: string[]
  /** Theme file paths (relative to the theme root). */
  files: Set<string>
}

export interface SchemaMatch {
  schema: ThemeSchema
  reason: 'themeToml' | 'repo' | 'folder' | 'fingerprint'
}

/** Normalises theme names: `hugo-theme-stack` → `stack`, `hugo-PaperMod` → `papermod`. */
export function normalizeThemeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(go)?hugo[-_]?theme[-_]/, '')
    .replace(/^hugo[-_]/, '')
    .replace(/[-_]hugo[-_]theme$/, '')
    .replace(/[-_](theme|hugo)$/, '')
    .replace(/[^a-z0-9]/g, '')
}

function hasAll(files: Set<string>, paths: string[]): boolean {
  if (paths.length === 0) return false
  const canonical = new Set([...files].map(canonicalThemePath))
  return paths.every((p) => canonical.has(canonicalThemePath(p)))
}

/** Hugo ≥0.146 layout path: `partials/` → `_partials/`, `shortcodes/` → `_shortcodes/`, `_default/x` → `x`. */
export function canonicalThemePath(path: string): string {
  if (!path.startsWith('layouts/')) return path
  let rest = path.slice('layouts/'.length)
  if (rest.startsWith('partials/')) rest = '_partials/' + rest.slice('partials/'.length)
  else if (rest.startsWith('shortcodes/')) rest = '_shortcodes/' + rest.slice('shortcodes/'.length)
  else if (rest.startsWith('_default/')) rest = rest.slice('_default/'.length)
  return 'layouts/' + rest
}

export function matchSchema(schemas: ThemeSchema[], identity: ThemeIdentity): SchemaMatch | null {
  const urls = identity.urls.map((u) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
  for (const schema of schemas) {
    const meta = schema['x-theme']
    if (identity.themeTomlName && meta.themeTomlNames.some((n) => n.toLowerCase() === identity.themeTomlName!.toLowerCase())) {
      return { schema, reason: 'themeToml' }
    }
  }
  for (const schema of schemas) {
    const repos = schema['x-theme'].repos.map((r) => r.toLowerCase())
    if (urls.some((u) => repos.some((r) => u === r || u.startsWith(r + '/') || u.endsWith('/' + r)))) return { schema, reason: 'repo' }
  }
  const folder = normalizeThemeName(identity.folderName)
  for (const schema of schemas) {
    if (schema['x-theme'].folderNames.some((n) => normalizeThemeName(n) === folder)) return { schema, reason: 'folder' }
  }
  for (const schema of schemas) {
    if (hasAll(identity.files, schema['x-theme'].fingerprint)) return { schema, reason: 'fingerprint' }
  }
  return null
}

// --- Integrity (used by tests and when loading registry schemas) -------------------------------

/** Problems in a schema: duplicate keys (case-insensitive), missing labels, unknown groups. */
export function schemaProblems(schema: ThemeSchema): string[] {
  const problems: string[] = []
  const groups = new Set(schema['x-groups'].map((g) => g.id))
  const check = (fields: FlatSchemaField[], where: string) => {
    const seen = new Map<string, string>()
    for (const { key, field } of fields) {
      const lower = key.toLowerCase()
      if (seen.has(lower)) problems.push(`${where}: duplicate key ${key} (${seen.get(lower)})`)
      seen.set(lower, key)
      const label = field['x-label']
      if (!label || !label.en.trim() || !label.tr.trim()) problems.push(`${where}: ${key} needs en and tr labels`)
      const group = field['x-group']
      if (where === 'site' && (!group || !groups.has(group))) problems.push(`${where}: ${key} has unknown group ${group}`)
      for (const text of [field['x-description'], field['x-gotcha'], field['x-deprecated']]) {
        if (text && (!text.en.trim() || !text.tr.trim())) problems.push(`${where}: ${key} has a text without en/tr`)
      }
      if (field.enum && field.default !== undefined && !Array.isArray(field.default) && !field.enum.includes(field.default as Literal)) {
        problems.push(`${where}: ${key} default ${String(field.default)} is not in its enum`)
      }
      if (field.items?.properties) {
        for (const [name, sub] of Object.entries(field.items.properties)) {
          if (!sub['x-label']?.en || !sub['x-label']?.tr) problems.push(`${where}: ${key}[].${name} needs en and tr labels`)
        }
      }
    }
  }
  check(flattenSchema(schema.properties), 'site')
  check(flattenSchema(schema['x-pageParams'] ?? {}), 'page')
  for (const group of schema['x-groups']) {
    if (!group.label.en || !group.label.tr) problems.push(`group ${group.id} needs en and tr labels`)
  }
  for (const [id, feature] of Object.entries(schema['x-features'] ?? {})) {
    if (!feature.label.en || !feature.label.tr || !feature.description.en || !feature.description.tr) {
      problems.push(`feature ${id} needs en and tr texts`)
    }
  }
  return problems
}
