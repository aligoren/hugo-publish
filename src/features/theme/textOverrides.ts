// Theme UI strings (i18n) and the site's overrides of them. Hugo merges the site's
// i18n/<lang>.* over the theme's key by key, so only changed keys are written.
import { isMap, isScalar, isSeq, parse as parseYaml, stringify as stringifyYaml, YAMLMap, type Document } from 'yaml'

import type { ConfigOp } from '../../lib/api'
import { editYamlText } from '../../lib/frontmatter'
import { isRecord } from './discovery'

export type I18nFormat = 'yaml' | 'toml' | 'json'
/** A plain string, or plural forms (`one`, `other`, …). */
export type I18nValue = string | Record<string, string>

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other']

export function i18nFormat(path: string): I18nFormat | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  if (lower.endsWith('.toml')) return 'toml'
  if (lower.endsWith('.json')) return 'json'
  return null
}

/** Language code of an i18n file name (`i18n/zh-tw.yaml` → `zh-tw`). */
export function i18nLanguage(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.(ya?ml|toml|json)$/i, '').toLowerCase()
}

function normalizeValue(value: unknown): I18nValue | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (isRecord(value)) {
    if ('translation' in value) return normalizeValue(value.translation)
    const forms: Record<string, string> = {}
    for (const form of PLURAL_FORMS) {
      const key = Object.keys(value).find((k) => k.toLowerCase() === form)
      if (key !== undefined && (typeof value[key] === 'string' || typeof value[key] === 'number')) forms[form] = String(value[key])
    }
    if (Object.keys(forms).length > 0) return forms
  }
  return null
}

/** The theme's file for a language: exact name, then the base language, then English. */
export function themeI18nPath(files: string[], lang: string): string | null {
  const i18n = files.filter((f) => f.startsWith('i18n/') && i18nFormat(f))
  for (const want of [lang, lang.split('-')[0], 'en']) {
    const hit = i18n.find((f) => i18nLanguage(f) === want)
    if (hit) return hit
  }
  return null
}

export interface I18nData {
  /** `list`: go-i18n v1 style `- id: x / translation: y`; `map`: `x: y`. */
  shape: 'list' | 'map'
  entries: Record<string, I18nValue>
}

/** Normalises parsed i18n data (YAML, TOML or JSON) of either shape. */
export function normalizeI18n(values: unknown): I18nData {
  const entries: Record<string, I18nValue> = {}
  if (Array.isArray(values)) {
    for (const item of values) {
      if (!isRecord(item) || typeof item.id !== 'string') continue
      const value = normalizeValue(item.translation)
      if (value !== null) entries[item.id] = value
    }
    return { shape: 'list', entries }
  }
  if (isRecord(values)) {
    for (const [key, raw] of Object.entries(values)) {
      const value = normalizeValue(raw)
      if (value !== null) entries[key] = value
    }
  }
  return { shape: 'map', entries }
}

export function parseI18nText(text: string, format: 'yaml' | 'json'): I18nData {
  const clean = text.replace(/^﻿/, '')
  if (clean.trim() === '') return { shape: 'map', entries: {} }
  return normalizeI18n(format === 'json' ? JSON.parse(clean) : parseYaml(clean))
}

export function sameI18n(a: I18nValue | undefined, b: I18nValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// --- Writing -----------------------------------------------------------------------------------

export interface I18nTarget {
  path: string
  format: I18nFormat
  /** null when the file does not exist yet. */
  text: string | null
  version: string | null
  data: I18nData
  /** Values as parsed (to see whether an entry is a table or a string). */
  raw: unknown
}

/** A new value per key; null removes the override. */
export type I18nChanges = Record<string, I18nValue | null>

export type I18nPlan =
  | { kind: 'ops'; path: string; ops: ConfigOp[] }
  | { kind: 'text'; path: string; before: string | null; after: string; version: string | null }

function eolOf(text: string | null): string {
  return text && text.includes('\r\n') ? '\r\n' : '\n'
}

function tomlString(s: string): string {
  return JSON.stringify(s)
}

/** A new file in map form, in the given format. */
export function newI18nFile(format: I18nFormat, changes: I18nChanges, eol = '\n'): string {
  const entries = Object.entries(changes).filter((e): e is [string, I18nValue] => e[1] !== null)
  if (format === 'json') return JSON.stringify(Object.fromEntries(entries), null, 2).replace(/\n/g, eol) + eol
  if (format === 'toml') {
    const simple = entries.filter(([, v]) => typeof v === 'string')
    const plural = entries.filter(([, v]) => typeof v !== 'string') as [string, Record<string, string>][]
    const key = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k))
    const lines = simple.map(([k, v]) => `${key(k)} = ${tomlString(v as string)}`)
    for (const [k, forms] of plural) {
      if (lines.length > 0) lines.push('')
      lines.push(`[${key(k)}]`, ...Object.entries(forms).map(([form, text]) => `${form} = ${tomlString(text)}`))
    }
    return lines.join(eol) + eol
  }
  return stringifyYaml(Object.fromEntries(entries), { lineWidth: 0 }).replace(/\n/g, eol)
}

/**
 * How to write `changes` into the site's i18n file: config ops for an existing map-form YAML or
 * TOML file (reviewed like config), or the new text for a new file, a list-form file or JSON.
 */
export function planI18nWrite(target: I18nTarget, changes: I18nChanges): I18nPlan {
  const eol = eolOf(target.text)
  if (target.text === null) {
    return { kind: 'text', path: target.path, before: null, after: newI18nFile(target.format, changes, eol), version: null }
  }
  if (target.format === 'json') {
    const raw = target.text.trim() ? (JSON.parse(target.text.replace(/^﻿/, '')) as unknown) : {}
    const next = applyToJson(raw, changes)
    const indent = /\n( +|\t)"/.exec(target.text)?.[1] ?? '  '
    const after = JSON.stringify(next, null, indent).replace(/\n/g, eol) + eol
    return { kind: 'text', path: target.path, before: target.text, after, version: target.version }
  }
  if (target.data.shape === 'list') {
    if (target.format !== 'yaml') throw new Error('List-form i18n files are only supported in YAML and JSON')
    const after = editYamlText(target.text, (doc) => applyToYamlList(doc, changes), { eol: eol === '\r\n' ? '\r\n' : '\n' })
    return { kind: 'text', path: target.path, before: target.text, after, version: target.version }
  }
  const ops: ConfigOp[] = []
  const raw = isRecord(target.raw) ? target.raw : {}
  for (const [key, value] of Object.entries(changes)) {
    const existingKey = Object.keys(raw).find((k) => k === key) ?? Object.keys(raw).find((k) => k.toLowerCase() === key.toLowerCase())
    const name = existingKey ?? key
    const existing = existingKey === undefined ? undefined : raw[existingKey]
    if (value === null) {
      if (existingKey !== undefined) ops.push({ op: 'remove', path: [name] })
      continue
    }
    if (typeof value === 'string') {
      // A table (`[key]` with `other = …`) cannot be replaced by a string in place: set its form.
      if (isRecord(existing)) {
        const field = 'translation' in existing ? 'translation' : 'other'
        ops.push({ op: 'set', path: [name, field], value })
      } else ops.push({ op: 'set', path: [name], value })
      continue
    }
    if (isRecord(existing) && !('translation' in existing)) {
      for (const [form, text] of Object.entries(value)) ops.push({ op: 'set', path: [name, form], value: text })
    } else {
      ops.push({ op: 'set', path: [name], value })
    }
  }
  return { kind: 'ops', path: target.path, ops }
}

function applyToJson(raw: unknown, changes: I18nChanges): unknown {
  if (Array.isArray(raw)) {
    const list = raw.filter((item) => !(isRecord(item) && typeof item.id === 'string' && changes[item.id] === null)) as unknown[]
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) continue
      const item = list.find((i) => isRecord(i) && i.id === key) as Record<string, unknown> | undefined
      if (item) item.translation = value
      else list.push({ id: key, translation: value })
    }
    return list
  }
  const out: Record<string, unknown> = isRecord(raw) ? { ...raw } : {}
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete out[key]
    else out[key] = value
  }
  return out
}

function applyToYamlList(doc: Document, changes: I18nChanges) {
  const seq = doc.contents
  if (!isSeq(seq)) return
  for (const [key, value] of Object.entries(changes)) {
    const index = seq.items.findIndex((item) => isMap(item) && item.get('id') === key)
    if (value === null) {
      if (index !== -1) seq.items.splice(index, 1)
      continue
    }
    const node = doc.createNode(value)
    if (index !== -1) {
      const item = seq.items[index] as YAMLMap
      const current = item.get('translation', true)
      if (typeof value === 'string' && isScalar(current)) current.value = value
      else item.set('translation', node)
    } else {
      const map = new YAMLMap(doc.schema)
      map.set('id', key)
      map.set('translation', node)
      // Keep the blank line between entries that list-form files usually have.
      if (seq.items.some((item, i) => i > 0 && (item as YAMLMap).spaceBefore)) map.spaceBefore = true
      seq.items.push(map)
    }
  }
}
