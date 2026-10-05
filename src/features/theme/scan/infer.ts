// Turning usage evidence and key names into a field type (research §16.2 heuristics table).
import type { ScannedParam } from './scanner'

export type FieldType =
  | 'boolean'
  | 'string'
  | 'integer'
  | 'number'
  | 'markdown'
  | 'html'
  | 'url'
  | 'image'
  | 'asset'
  | 'color'
  | 'dateFormat'
  | 'enum'
  | 'stringList'
  | 'enumList'
  | 'objectList'
  | 'object'
  | 'stringOrList'

export type Literal = string | number | boolean | null

export interface Inferred {
  type: FieldType
  options?: Literal[]
  /** Default value from the templates, converted to the type. */
  default?: unknown
  /** usage: from how the value is used; name: from the key name; weak: a guess. */
  confidence: 'usage' | 'name' | 'weak'
}

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$)/i

export function looksLikeColor(value: unknown): boolean {
  return typeof value === 'string' && COLOR_VALUE.test(value.trim())
}

/** Type from the key name alone (CloudCannon-style rules), or null. */
export function typeFromName(key: string, sample?: unknown): FieldType | null {
  const name = key.replace(/\[\]/g, '').split('.').pop() ?? key
  const lower = name.toLowerCase()
  if (/^(enable|disable|show|hide|hidden)/i.test(name) || /^use[A-Z_]/.test(name) || /^(is|has)[A-Z_]/.test(name)) return 'boolean'
  if (/(height|width|limit|size|count|length)$/i.test(name) || /^(max|min)[A-Z_]/.test(name)) return 'integer'
  if (/colou?r/i.test(lower) && (sample === undefined || sample === '' || looksLikeColor(sample))) return 'color'
  if (/(url|link|href)$/i.test(name) || /^(url|link)$/i.test(name)) return 'url'
  if ((/(image|icon|logo|avatar|photo|picture)$/i.test(name) || /^(favicon|logo|avatar)/i.test(name)) && !/svg/i.test(name)) return 'image'
  if (/(dateformat|date_format)$/i.test(lower)) return 'dateFormat'
  if (/(content|markdown|_md)$/i.test(name)) return 'markdown'
  return null
}

/** Type of a value found in a config file. */
export function typeFromValue(value: unknown, key = ''): FieldType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))) return 'objectList'
    return 'stringList'
  }
  if (value !== null && typeof value === 'object') return 'object'
  const byName = typeFromName(key, value)
  if (typeof value === 'string') {
    if (byName === 'color' && looksLikeColor(value)) return 'color'
    if (byName && byName !== 'boolean' && byName !== 'integer' && byName !== 'color') return byName
    if (value.includes('\n')) return 'markdown'
  }
  return 'string'
}

export function coerceDefault(type: FieldType, value: unknown): unknown {
  if ((type === 'integer' || type === 'number') && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value)
  }
  if (type === 'boolean' && typeof value === 'string' && (value === 'true' || value === 'false')) return value === 'true'
  return value
}

export function inferType(p: ScannedParam, opts: { hasChildren: boolean; hasItemChildren: boolean }): Inferred {
  const h = p.hints
  const literalDefaults = p.defaults.filter((d) => d === null || ['string', 'number', 'boolean'].includes(typeof d)) as Literal[]
  const firstDefault = literalDefaults.find((d) => d !== null && d !== '')
  const stringCompared = p.compared.filter((c): c is string => typeof c === 'string')
  const withDefault = (inferred: Inferred): Inferred =>
    firstDefault === undefined ? inferred : { ...inferred, default: coerceDefault(inferred.type, firstDefault) }

  if (opts.hasItemChildren) return { type: 'objectList', confidence: 'usage' }
  if (h.list || p.members.length > 0) {
    const options = unique([...p.members, ...stringCompared])
    if (options.length > 0) return withDefault({ type: 'enumList', options, confidence: 'usage' })
    if (h.printed && !h.list) return { type: 'stringOrList', confidence: 'usage' }
    return { type: 'stringList', confidence: 'usage' }
  }
  if (h.object || opts.hasChildren) return { type: 'object', confidence: 'usage' }
  if (h.html) return withDefault({ type: 'html', confidence: 'usage' })
  if (h.markdown) return withDefault({ type: 'markdown', confidence: 'usage' })
  if (h.asset) {
    const imageLike = typeFromName(p.key) === 'image' || /(image|icon|logo|avatar|photo)/i.test(p.path[p.path.length - 1] ?? '')
    return withDefault({ type: imageLike ? 'image' : 'asset', confidence: 'usage' })
  }
  if (h.dateFormat) return withDefault({ type: 'dateFormat', confidence: 'usage' })
  if (h.integer) return withDefault({ type: 'integer', confidence: 'usage' })
  if (h.number) return withDefault({ type: 'number', confidence: 'usage' })
  if (p.boolCompare || typeof firstDefault === 'boolean' || p.compared.some((c) => typeof c === 'boolean')) {
    return withDefault({ type: 'boolean', confidence: 'usage' })
  }
  if (p.whereCompares.some((w) => w.value === 'true' || w.value === 'false')) return { type: 'boolean', confidence: 'usage' }
  const enumOptions = unique([...stringCompared, ...literalDefaults.filter((d): d is string => typeof d === 'string' && d !== '')])
  if (stringCompared.length > 0 && enumOptions.length >= 2) return withDefault({ type: 'enum', options: enumOptions, confidence: 'usage' })
  if (h.url) {
    const byName = typeFromName(p.key)
    return withDefault({ type: byName === 'image' ? 'image' : 'url', confidence: 'usage' })
  }
  if (typeof firstDefault === 'number') return withDefault({ type: Number.isInteger(firstDefault) ? 'integer' : 'number', confidence: 'usage' })
  const byName = typeFromName(p.key, firstDefault)
  if (byName) return withDefault({ type: byName, confidence: 'name' })
  if ((h.bool || h.maybeBool) && !h.printed) return withDefault({ type: 'boolean', confidence: 'weak' })
  if (h.printed || typeof firstDefault === 'string') return withDefault({ type: 'string', confidence: 'usage' })
  return withDefault({ type: 'string', confidence: 'weak' })
}

function unique<T>(values: T[]): T[] {
  const out: T[] = []
  for (const v of values) if (!out.includes(v)) out.push(v)
  return out
}
