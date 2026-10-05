// Reading and changing config-like files (hugo.toml/yaml/json, config/_default/*, theme defaults)
// without touching anything but the changed lines. TOML goes through toml_edit in Rust,
// YAML through the `yaml` Document API (the same minimal-diff merge as front matter).
import { parseDocument, isMap, isPair, isScalar, isSeq, type Node } from 'yaml'

import { api, type ConfigEdit, type ConfigOp, type KeyPath } from '../../lib/api'
import { detectEol } from '../../lib/eol'
import { deleteField, getField, setField, type FrontMatterParts, type FrontMatterValue } from '../../lib/frontmatter'

export type ConfigFormat = 'toml' | 'yaml' | 'json'

export function configFormat(path: string): ConfigFormat | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.toml')) return 'toml'
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  if (lower.endsWith('.json')) return 'json'
  return null
}

/** Whether ops can be applied to this file. JSON allows no comments and is read-only for now. */
export function isEditableConfig(path: string): boolean {
  const format = configFormat(path)
  return format === 'toml' || format === 'yaml'
}

export interface ConfigFileData {
  path: string
  format: ConfigFormat
  text: string
  version: string
  /** Values with the key casing used in the file. */
  values: Record<string, unknown>
  /** Comments by dotted path (see `TomlReadResult.comments`). */
  comments: Record<string, string>
}

export class UnsupportedConfigError extends Error {
  constructor(path: string) {
    super(`Editing ${path} is not supported yet (only TOML and YAML).`)
    this.name = 'UnsupportedConfigError'
  }
}

export async function readConfigFile(path: string): Promise<ConfigFileData> {
  const format = configFormat(path)
  if (!format) throw new UnsupportedConfigError(path)
  const file = await api.readText(path)
  if (format === 'toml') {
    const { values, comments } = await api.tomlRead(path)
    return { path, format, text: file.text, version: file.version, values, comments }
  }
  if (format === 'yaml') {
    const { values, comments } = readYaml(file.text)
    return { path, format, text: file.text, version: file.version, values, comments }
  }
  const values = JSON.parse(file.text.replace(/^﻿/, '')) as Record<string, unknown>
  return { path, format, text: file.text, version: file.version, values, comments: {} }
}

/** Computes the result of `ops` on the file; nothing is written. */
export async function previewConfigOps(path: string, ops: ConfigOp[]): Promise<ConfigEdit> {
  const format = configFormat(path)
  if (format === 'toml') return api.configPreviewOps(path, ops)
  if (format === 'yaml') {
    const file = await api.readText(path)
    return { path, before: file.text, after: applyYamlOps(file.text, ops), version: file.version }
  }
  throw new UnsupportedConfigError(path)
}

function yamlParts(text: string): FrontMatterParts {
  const bom = text.startsWith('﻿')
  const body = bom ? text.slice(1) : text
  const eol = detectEol(body)
  return { bom, eol, format: 'yaml', open: '', frontMatterText: body, close: '', body: '' }
}

/** Applies ops to a YAML text, changing only the affected lines. */
export function applyYamlOps(text: string, ops: ConfigOp[]): string {
  let parts = yamlParts(text)
  for (const op of ops) {
    if (op.op === 'set') {
      parts = setField(parts, op.path, op.value as FrontMatterValue)
    } else if (op.op === 'remove') {
      parts = deleteField(parts, op.path)
    } else {
      const existing = getField(parts, op.path)
      const list = Array.isArray(existing) ? existing : []
      parts = setField(parts, op.path, [...list, op.entries] as FrontMatterValue)
    }
  }
  return (parts.bom ? '﻿' : '') + parts.frontMatterText
}

function readYaml(text: string): { values: Record<string, unknown>; comments: Record<string, string> } {
  const doc = parseDocument(text.replace(/^﻿/, ''))
  const values = (doc.toJS() ?? {}) as Record<string, unknown>
  const comments: Record<string, string> = {}
  const visit = (node: unknown, path: (string | number)[]) => {
    if (isMap(node)) {
      for (const item of node.items) {
        if (!isPair(item)) continue
        const key = isScalar(item.key) ? String(item.key.value) : String(item.key)
        const keyPath = [...path, key]
        const keyNode = item.key as Node | null
        const valueNode = item.value as Node | null
        const parts = [keyNode?.commentBefore, valueNode?.comment ?? keyNode?.comment]
          .filter((c): c is string => !!c)
          .map((c) => c.trim())
        if (parts.length > 0) comments[keyPath.join('.')] = parts.join('\n')
        visit(item.value, keyPath)
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => visit(item, [...path, index]))
    }
  }
  visit(doc.contents, [])
  return { values, comments }
}

/** Value at a path in parsed config values. */
export function valueAt(values: unknown, path: KeyPath): unknown {
  let current: unknown = values
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

/**
 * Value at a path in `hugo config` output, whose keys Hugo lower-cases.
 * The path may use the documented casing (`baseURL`, `pagerSize`).
 */
export function effectiveValueAt(effective: unknown, path: KeyPath): unknown {
  return valueAt(effective, path.map((k) => (typeof k === 'string' ? k.toLowerCase() : k)))
}

export function pathKey(path: KeyPath): string {
  return path.map(String).join('.')
}
