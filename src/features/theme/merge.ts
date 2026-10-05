// Merging the four layers into one list of fields (research §16): curated schema > theme
// defaults and comments > template scan > generic key/value. Every attribute records where
// it came from, so the UI can say "documented", "found in theme code", "from theme defaults"
// or "not used by the theme".
import type { DefaultEntry, DefaultsLayer } from './defaults'
import { isRecord } from './discovery'
import { coerceDefault, inferType, typeFromValue, type FieldType, type Literal } from './scan/infer'
import type { ParamLocation, ScanResult, ScannedParam, WhereCompare } from './scan/scanner'
import {
  flattenSchema,
  type FeatureDef,
  type Localized,
  type ParamScopeName,
  type SchemaField,
  type ThemeSchema,
  type Widget,
} from './schema'

export type Provenance = 'curated' | 'defaults' | 'example' | 'comment' | 'scan' | 'site'
export type Badge = 'documented' | 'scanned' | 'defaults' | 'unused' | 'siteTemplates'

export interface ItemField {
  name: string
  label?: Localized
  type: FieldType
  widget: Widget
  options?: Literal[]
  allowCustom?: boolean
  required?: boolean
}

export interface ThemeField {
  key: string
  path: string[]
  scope: ParamScopeName
  type: FieldType
  widget: Widget
  label?: Localized
  /** Curated (translated) description, or a comment from the theme (theme's language). */
  description?: Localized | string
  group: string
  default?: unknown
  example?: unknown
  options?: Literal[]
  optionLabels?: Record<string, Localized>
  allowCustom?: boolean
  itemFields?: ItemField[]
  writeFalse?: 'omit'
  stringOrList?: boolean
  productionOnly?: boolean
  deprecated?: Localized
  gotcha?: Localized
  precedence?: 'site-over-page'
  requiresConfig?: SchemaField['x-requiresConfig']
  conflictsWith?: string[]
  optional?: boolean
  experimental?: boolean
  docLink?: string
  placeholder?: string
  minimum?: number
  maximum?: number
  locations: ParamLocation[]
  whereCompares: WhereCompare[]
  sources: Provenance[]
  provenance: Partial<Record<'type' | 'label' | 'description' | 'default' | 'options' | 'scope', Provenance>>
  badge: Badge
}

export interface FieldGroup {
  id: string
  label?: Localized
  /** Generic groups are named after the top-level key. */
  name: string
  fields: ThemeField[]
}

export interface PageParamDoc {
  key: string
  label?: Localized
  type: FieldType
  scope: ParamScopeName
  gotcha?: Localized
  writeFalse?: 'omit'
  precedence?: 'site-over-page'
  locations: ParamLocation[]
  whereCompares: WhereCompare[]
  source: Provenance
}

export interface MergeInput {
  schema: ThemeSchema | null
  scan: ScanResult | null
  defaults: DefaultsLayer
  /** The site's merged params (values with the file casing). */
  siteParams: Record<string, unknown>
  /** Lower-cased keys the site's own templates read (site overrides and additions). */
  siteTemplateKeys?: Set<string>
}

export interface MergedModel {
  fields: ThemeField[]
  groups: FieldGroup[]
  pageParams: PageParamDoc[]
  features: Record<string, FeatureDef>
  /** Site param keys (leaf paths) nothing in the theme reads. */
  unknown: string[]
}

const GENERAL = 'general'
const OTHER = 'other'

// --- Type and widget mapping ------------------------------------------------------------------

export function typeFromSchema(field: SchemaField): FieldType {
  const widget = field['x-widget']
  if (widget === 'toggle') return 'boolean'
  if (widget === 'markdown' || field.format === 'markdown') return 'markdown'
  if (widget === 'html' || field.format === 'html') return 'html'
  if (widget === 'color' || field.format === 'color') return 'color'
  if (widget === 'image' || field.format === 'image') return 'image'
  if (widget === 'asset') return 'asset'
  if (widget === 'dateFormat' || field.format === 'date-format') return 'dateFormat'
  if (widget === 'objectList') return 'objectList'
  if (widget === 'multiselect') return 'enumList'
  if (widget === 'keyValue') return 'object'
  if (widget === 'textarea') return 'string'
  if (field['x-stringOrList'] || (Array.isArray(field.type) && field.type.includes('array') && field.type.includes('string'))) {
    return 'stringOrList'
  }
  const type = Array.isArray(field.type) ? field.type[0] : field.type
  if (field.enum && type !== 'array') return field.enum.every((v) => typeof v === 'boolean') ? 'boolean' : 'enum'
  switch (type) {
    case 'boolean':
      return 'boolean'
    case 'integer':
      return 'integer'
    case 'number':
      return 'number'
    case 'array':
      if (field.items?.enum) return 'enumList'
      if (field.items?.properties || field.items?.type === 'object') return 'objectList'
      return 'stringList'
    case 'object':
      return 'object'
    default:
      if (field.format === 'uri' || field.format === 'uri-reference' || widget === 'url') return 'url'
      return 'string'
  }
}

export function widgetFor(type: FieldType, schemaWidget?: Widget): Widget {
  if (schemaWidget) return schemaWidget
  switch (type) {
    case 'boolean':
      return 'toggle'
    case 'integer':
    case 'number':
      return 'number'
    case 'markdown':
      return 'markdown'
    case 'html':
      return 'html'
    case 'url':
      return 'url'
    case 'image':
      return 'image'
    case 'asset':
      return 'asset'
    case 'color':
      return 'color'
    case 'dateFormat':
      return 'dateFormat'
    case 'enum':
      return 'select'
    case 'enumList':
      return 'multiselect'
    case 'stringList':
    case 'stringOrList':
      return 'stringList'
    case 'objectList':
      return 'objectList'
    case 'object':
      return 'keyValue'
    default:
      return 'text'
  }
}

function scopeFromScan(p: ScannedParam | undefined): ParamScopeName | undefined {
  if (!p) return undefined
  const s = p.scopes
  if (s.includes('both') || (s.includes('site') && s.includes('page'))) return 'both'
  if (s.includes('site')) return 'site'
  if (s.includes('language')) return 'language'
  if (s.includes('page')) return 'page'
  return undefined
}

function isContainerType(type: FieldType): boolean {
  return type === 'objectList' || type === 'object' || type === 'stringList' || type === 'enumList' || type === 'stringOrList'
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// --- Merge ------------------------------------------------------------------------------------

interface Candidate {
  key: string
  curated?: SchemaField
  defaults?: DefaultEntry
  example?: DefaultEntry
  scanned?: ScannedParam
}

export function mergeLayers(input: MergeInput): MergedModel {
  const { schema, scan, defaults } = input
  const candidates = new Map<string, Candidate>()
  const touch = (key: string): Candidate => {
    const lower = key.toLowerCase()
    let c = candidates.get(lower)
    if (!c) {
      c = { key }
      candidates.set(lower, c)
    }
    return c
  }

  const curatedFields = schema ? flattenSchema(schema.properties) : []
  for (const { key, field } of curatedFields) {
    const c = touch(key)
    c.key = key
    c.curated = field
  }
  for (const entry of defaults.defaults.values()) {
    const c = touch(entry.key)
    c.defaults = entry
    if (!c.curated && !c.defaults?.commentedOut) c.key = entry.key
  }
  for (const entry of defaults.examples.values()) {
    const c = touch(entry.key)
    c.example = entry
  }
  const scanParams = scan ? [...scan.params.values()] : []
  const scanByLower = new Map(scanParams.map((p) => [p.key.toLowerCase(), p]))
  for (const p of scanParams) {
    if (p.key.includes('[]')) continue
    const siteRelevant = p.scopes.some((s) => s !== 'page')
    if (!siteRelevant) continue
    const c = touch(p.key)
    c.scanned = p
    if (!c.curated && !c.defaults) c.key = p.key
  }

  // Scanned containers with children are groups of fields, not fields (unless something else says so).
  const allLower = [...candidates.keys()]
  const hasChildren = (lower: string) => allLower.some((k) => k.startsWith(lower + '.'))
  const hasItemChildren = (lower: string) => scanParams.some((p) => p.key.toLowerCase().startsWith(lower + '[].'))

  const fields: ThemeField[] = []
  const leafContainers: string[] = []
  const sorted = [...candidates.entries()].sort((a, b) => a[0].split('.').length - b[0].split('.').length)
  for (const [lower, c] of sorted) {
    // Absorbed by an ancestor that is one field (a list, a key/value object, or a curated leaf).
    if (leafContainers.some((parent) => lower.startsWith(parent + '.'))) continue
    const onlyScanned = !c.curated && !c.defaults && !c.example
    if (onlyScanned && hasChildren(lower) && !hasItemChildren(lower)) continue
    const field = buildField(c, { hasChildren: hasChildren(lower), hasItemChildren: hasItemChildren(lower) }, schema, input.siteParams)
    if (!c.curated && (c.defaults?.hasValue || c.example?.hasValue) && hasChildren(lower) && !isContainerType(field.type)) continue
    if (c.curated || isContainerType(field.type)) leafContainers.push(lower)
    fields.push(field)
  }

  // Site-only keys: editable as generic fields, and reported as not used by the theme.
  const known = (lower: string) =>
    candidates.has(lower) || leafContainers.some((parent) => lower.startsWith(parent + '.')) || fields.some((f) => f.key.toLowerCase() === lower)
  const siteLeaves = siteParamLeaves(input.siteParams)
  const unknown: string[] = []
  for (const leaf of siteLeaves) {
    const lower = leaf.key.toLowerCase()
    if (known(lower)) continue
    // A site key under a scanned object the theme passes around whole (`with site.Params.x`).
    const ancestorScanned = leaf.path.some((_, i) => {
      const prefix = leaf.path.slice(0, i + 1).join('.').toLowerCase()
      const p = scanByLower.get(prefix)
      return p !== undefined && i < leaf.path.length - 1 && !hasChildren(prefix)
    })
    const usedBySite = input.siteTemplateKeys?.has(lower) ?? false
    const type = typeFromValue(leaf.value, leaf.key)
    fields.push({
      key: leaf.key,
      path: leaf.path,
      scope: 'site',
      type,
      widget: widgetFor(type),
      group: OTHER,
      locations: [],
      whereCompares: [],
      sources: ['site'],
      provenance: { type: 'site' },
      badge: usedBySite ? 'siteTemplates' : ancestorScanned ? 'scanned' : 'unused',
    })
    if (!usedBySite && !ancestorScanned) unknown.push(leaf.key)
  }

  // Item fields for lists of objects, and icon options from the scan.
  for (const field of fields) {
    if (field.type !== 'objectList') continue
    field.itemFields = itemFieldsFor(field, schema, scanParams, input.siteParams)
  }

  return {
    fields,
    groups: groupFields(fields, schema),
    pageParams: pageParamDocs(schema, scanParams),
    features: schema?.['x-features'] ?? {},
    unknown,
  }
}

function buildField(
  c: Candidate,
  shape: { hasChildren: boolean; hasItemChildren: boolean },
  schema: ThemeSchema | null,
  siteParams: Record<string, unknown>,
): ThemeField {
  const provenance: ThemeField['provenance'] = {}
  const sources: Provenance[] = []
  if (c.curated) sources.push('curated')
  if (c.defaults) sources.push(c.defaults.commentedOut ? 'comment' : 'defaults')
  if (c.example) sources.push('example')
  if (c.scanned) sources.push('scan')

  const comment = c.defaults?.comment ?? c.example?.comment
  const commentSource: Provenance = c.defaults?.comment ? (c.defaults.commentedOut ? 'comment' : 'defaults') : 'example'
  const inferred = c.scanned ? inferType(c.scanned, shape) : null
  const themeValue = c.defaults?.hasValue ? c.defaults.value : undefined
  const themeSample = themeValue ?? c.defaults?.example ?? (c.example?.hasValue ? c.example.value : c.example?.example)
  // With nothing better than a guess from the templates, the site's own value shows the shape.
  const siteSample = themeSample === undefined && (!inferred || inferred.confidence === 'weak') ? valueAtCi(siteParams, c.key.split('.')) : undefined
  const sampleValue = themeSample ?? siteSample

  // Type
  let type: FieldType
  if (c.curated) {
    type = typeFromSchema(c.curated)
    provenance.type = 'curated'
  } else {
    const commentOptions = validOptions(comment?.options, sampleValue)
    const valueType = sampleValue !== undefined ? typeFromValue(sampleValue, c.key) : null
    if (commentOptions && (valueType === null || valueType === 'string' || valueType === 'boolean')) {
      type = commentOptions.every((o) => typeof o === 'boolean') ? 'boolean' : 'enum'
      provenance.type = commentSource
    } else if (valueType && valueType !== 'string') {
      type = valueType === 'stringList' && inferred?.type === 'enumList' ? 'enumList' : valueType
      provenance.type = siteSample !== undefined ? 'site' : c.defaults?.hasValue ? 'defaults' : 'example'
    } else if (inferred && (valueType === null || inferred.type !== 'string')) {
      const specific = ['enum', 'markdown', 'html', 'url', 'image', 'asset', 'color', 'dateFormat'].includes(inferred.type)
      type = valueType === 'string' && !specific ? 'string' : inferred.type
      provenance.type = 'scan'
    } else {
      type = valueType ?? 'string'
      if (valueType) provenance.type = c.defaults?.hasValue ? 'defaults' : 'example'
    }
  }

  // Options
  let options: Literal[] | undefined
  if (c.curated?.enum) {
    options = c.curated.enum
    provenance.options = 'curated'
  } else if (c.curated?.items?.enum) {
    options = c.curated.items.enum
    provenance.options = 'curated'
  } else {
    const fromComment = validOptions(comment?.options, sampleValue)
    if (fromComment && (type === 'enum' || type === 'enumList' || type === 'boolean')) {
      options = fromComment
      provenance.options = commentSource
    } else if (inferred?.options && (type === 'enum' || type === 'enumList')) {
      options = inferred.options
      provenance.options = 'scan'
    }
  }
  if (type === 'boolean' && options?.every((o) => typeof o === 'boolean')) options = undefined
  if ((type === 'enum' || type === 'enumList') && !options) type = type === 'enum' ? 'string' : 'stringList'

  // Default
  let def: unknown
  if (c.curated && 'default' in c.curated) {
    def = c.curated.default
    provenance.default = 'curated'
  } else if (themeValue !== undefined) {
    def = themeValue
    provenance.default = 'defaults'
  } else if (comment?.default !== undefined) {
    def = coerceDefault(type, comment.default)
    provenance.default = commentSource === 'defaults' ? 'comment' : commentSource
  } else if (inferred?.default !== undefined) {
    def = inferred.default
    provenance.default = 'scan'
  }
  if (type === 'enum' && def !== undefined && options && !options.some((o) => sameValue(o, def))) options = [...options, def as Literal]

  // Scope
  let scope: ParamScopeName = 'site'
  if (c.curated?.['x-scope']) {
    scope = c.curated['x-scope']
    provenance.scope = 'curated'
  } else if (scopeFromScan(c.scanned)) {
    scope = scopeFromScan(c.scanned)!
    provenance.scope = 'scan'
  } else if (comment?.pageOverridable) {
    scope = 'both'
    provenance.scope = commentSource
  }
  if (scope === 'site' && comment?.pageOverridable) scope = 'both'

  // Labels and descriptions
  let description: ThemeField['description']
  if (c.curated?.['x-description']) {
    description = c.curated['x-description']
    provenance.description = 'curated'
  } else if (comment?.description) {
    description = comment.description
    provenance.description = commentSource
  }
  if (c.curated?.['x-label']) provenance.label = 'curated'

  const group = c.curated?.['x-group'] ?? (schema ? OTHER : genericGroup(c.key))
  const field: ThemeField = {
    key: c.key,
    path: c.key.split('.'),
    scope,
    type,
    widget: widgetFor(type, c.curated?.['x-widget']),
    group,
    locations: c.scanned?.locations ?? [],
    whereCompares: c.scanned?.whereCompares ?? [],
    sources,
    provenance,
    badge: c.curated ? 'documented' : c.defaults || c.example ? 'defaults' : 'scanned',
  }
  if (c.curated?.['x-label']) field.label = c.curated['x-label']
  if (description) field.description = description
  if (def !== undefined) field.default = def
  const example = c.example?.hasValue ? c.example.value : (c.defaults?.example ?? c.example?.example)
  if (example !== undefined && !sameValue(example, def)) field.example = example
  if (options) field.options = options
  const curated = c.curated
  if (curated) {
    if (curated['x-optionLabels']) field.optionLabels = curated['x-optionLabels']
    if (curated['x-allowCustom']) field.allowCustom = true
    if (curated['x-writeFalse']) field.writeFalse = curated['x-writeFalse']
    if (curated['x-stringOrList']) field.stringOrList = true
    if (curated['x-deprecated']) field.deprecated = curated['x-deprecated']
    if (curated['x-gotcha']) field.gotcha = curated['x-gotcha']
    if (curated['x-precedence']) field.precedence = curated['x-precedence']
    if (curated['x-requiresConfig']) field.requiresConfig = curated['x-requiresConfig']
    if (curated['x-conflictsWith']) field.conflictsWith = curated['x-conflictsWith']
    if (curated['x-placeholder']) field.placeholder = curated['x-placeholder']
    if (curated.minimum !== undefined) field.minimum = curated.minimum
    if (curated.maximum !== undefined) field.maximum = curated.maximum
  }
  if (type === 'stringOrList') field.stringOrList = true
  const productionOnly = curated?.['x-productionOnly'] ?? (c.scanned && c.scanned.locations.length > 0 ? c.scanned.productionOnly : undefined)
  if (productionOnly) field.productionOnly = true
  if (comment?.optional) field.optional = true
  if (comment?.experimental) field.experimental = true
  if (comment?.docLink) field.docLink = comment.docLink
  return field
}

/** Comment options are trusted only when the theme's own value is one of them. */
function validOptions(options: Literal[] | undefined, value: unknown): Literal[] | undefined {
  if (!options || options.length < 2) return undefined
  if (value === undefined || value === '') return options
  const values = Array.isArray(value) ? value : [value]
  return values.every((v) => options.some((o) => String(o).toLowerCase() === String(v).toLowerCase())) ? options : undefined
}

function genericGroup(key: string): string {
  const parts = key.split('.')
  return parts.length > 1 ? `params.${parts[0]}` : GENERAL
}

function itemFieldsFor(field: ThemeField, schema: ThemeSchema | null, scanParams: ScannedParam[], siteParams: Record<string, unknown>): ItemField[] {
  const curated = schema ? flattenSchema(schema.properties).find((f) => f.key.toLowerCase() === field.key.toLowerCase())?.field : undefined
  const out: ItemField[] = []
  const lower = field.key.toLowerCase()
  const scanned = new Map(
    scanParams
      .filter((p) => p.key.toLowerCase().startsWith(lower + '[].') && !p.key.slice(lower.length + 3).includes('.'))
      .map((p) => [p.key.slice(lower.length + 3).toLowerCase(), p]),
  )
  const props = curated?.items?.properties
  if (props) {
    for (const [name, sub] of Object.entries(props)) {
      const type = typeFromSchema(sub)
      const item: ItemField = { name, type, widget: widgetFor(type, sub['x-widget']) }
      if (sub['x-label']) item.label = sub['x-label']
      if (curated?.items?.required?.includes(name)) item.required = true
      if (sub.enum) item.options = sub.enum
      const from = sub['x-optionsFrom']
      if (from) {
        const p = scanParams.find((s) => s.key.toLowerCase() === from.toLowerCase())
        const names = p?.compared.filter((v): v is string => typeof v === 'string') ?? []
        if (names.length > 0) item.options = names
      }
      if (sub['x-allowCustom']) item.allowCustom = true
      out.push(item)
    }
    return out
  }
  for (const p of scanned.values()) {
    const inferred = inferType(p, { hasChildren: false, hasItemChildren: false })
    const item: ItemField = { name: p.key.slice(lower.length + 3), type: inferred.type, widget: widgetFor(inferred.type) }
    if (inferred.options) item.options = inferred.options
    if (inferred.type === 'enum') item.allowCustom = true
    out.push(item)
  }
  // Keys present in the default or the site's value that the scan did not see.
  const samples = [field.default, valueAtCi(siteParams, field.path)].filter(Array.isArray).flat()
  for (const sample of samples) {
    if (!isRecord(sample)) continue
    for (const [name, value] of Object.entries(sample)) {
      if (out.some((i) => i.name.toLowerCase() === name.toLowerCase())) continue
      const type = typeFromValue(value, name)
      out.push({ name, type, widget: widgetFor(type) })
    }
  }
  return out
}

export function valueAtCi(values: unknown, path: string[]): unknown {
  let current: unknown = values
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    const key = Object.keys(current).find((k) => k.toLowerCase() === segment.toLowerCase())
    if (key === undefined) return undefined
    current = current[key]
  }
  return current
}

/** Leaf keys of the site's params; lists and empty objects are leaves. */
export function siteParamLeaves(values: Record<string, unknown>, prefix: string[] = []): { key: string; path: string[]; value: unknown }[] {
  const out: { key: string; path: string[]; value: unknown }[] = []
  for (const [key, value] of Object.entries(values)) {
    const path = [...prefix, key]
    if (isRecord(value) && Object.keys(value).length > 0) out.push(...siteParamLeaves(value, path))
    else out.push({ key: path.join('.'), path, value })
  }
  return out
}

function groupFields(fields: ThemeField[], schema: ThemeSchema | null): FieldGroup[] {
  const groups: FieldGroup[] = []
  const byId = new Map<string, FieldGroup>()
  for (const g of schema?.['x-groups'] ?? []) {
    const group: FieldGroup = { id: g.id, label: g.label, name: g.id, fields: [] }
    groups.push(group)
    byId.set(g.id, group)
  }
  const ensure = (id: string): FieldGroup => {
    let group = byId.get(id)
    if (!group) {
      group = { id, name: id.startsWith('params.') ? id.slice('params.'.length) : id, fields: [] }
      byId.set(id, group)
      groups.push(group)
    }
    return group
  }
  for (const field of fields) ensure(field.group).fields.push(field)
  const nonEmpty = groups.filter((g) => g.fields.length > 0)
  // Generic groups: "general" first, the "other" bucket last, the rest alphabetically.
  if (!schema) nonEmpty.sort((a, b) => (a.id === GENERAL ? -1 : b.id === GENERAL ? 1 : a.id === OTHER ? 1 : b.id === OTHER ? -1 : a.name.localeCompare(b.name)))
  else nonEmpty.sort((a, b) => (a.id === OTHER ? 1 : b.id === OTHER ? -1 : 0))
  return nonEmpty
}

function pageParamDocs(schema: ThemeSchema | null, scanParams: ScannedParam[]): PageParamDoc[] {
  const out: PageParamDoc[] = []
  const seen = new Set<string>()
  const scanned = new Map(scanParams.map((p) => [p.key.toLowerCase(), p]))
  const add = (doc: PageParamDoc) => {
    const lower = doc.key.toLowerCase()
    if (seen.has(lower)) return
    seen.add(lower)
    out.push(doc)
  }
  for (const { key, field } of flattenSchema(schema?.['x-pageParams'] ?? {})) {
    const p = scanned.get(key.toLowerCase())
    const doc: PageParamDoc = {
      key,
      type: typeFromSchema(field),
      scope: scopeFromScan(p) ?? 'page',
      locations: p?.locations ?? [],
      whereCompares: p?.whereCompares ?? [],
      source: 'curated',
    }
    if (field['x-label']) doc.label = field['x-label']
    if (field['x-gotcha']) doc.gotcha = field['x-gotcha']
    if (field['x-writeFalse']) doc.writeFalse = field['x-writeFalse']
    if (field['x-precedence']) doc.precedence = field['x-precedence']
    add(doc)
  }
  for (const p of scanParams) {
    if (p.key.includes('[]')) continue
    const scope = scopeFromScan(p)
    if (scope !== 'page' && scope !== 'both') continue
    const keys = scanParams.map((s) => s.key.toLowerCase())
    const lower = p.key.toLowerCase()
    if (keys.some((k) => k.startsWith(lower + '.'))) continue
    const inferred = inferType(p, { hasChildren: false, hasItemChildren: false })
    add({ key: p.key, type: inferred.type, scope, locations: p.locations, whereCompares: p.whereCompares, source: 'scan' })
  }
  return out
}
