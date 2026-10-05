// One-click setting bundles. Each preset is plain data; `planPreset` turns it into ops for existing
// files (or the text of a new file), which go through the normal review dialog.
import type { ConfigOp, KeyPath } from '../../../lib/api'
import { effectiveValueAt } from '../../config-edit'
import { listMode } from './lists'
import { locate, resolveKey, type WriteTarget } from './owner'
import { categoryKey, usesConfigDir, type LoadedSource } from './sources'
import { tomlDocument } from './toml'
import { findKey, isPlainObject, looseEqual, subtreeOps, type Tree } from './values'

export type PresetId = 'llms' | 'privacy' | 'turkishUrls' | 'math' | 'devHeaders'

export type PresetChange =
  | { kind: 'set'; path: string[]; value: unknown }
  /** Adds strings to a list that may not exist yet (`fallback` is Hugo's default). */
  | { kind: 'addToList'; path: string[]; values: string[]; fallback: string[] }
  /** Adds a table to an array of tables, or updates the one whose `match` field is equal. */
  | { kind: 'upsertRow'; path: string[]; match: string; row: Tree }

export interface Preset {
  id: PresetId
  changes: PresetChange[]
  /**
   * Environment folder to write to. Without a file there for a key, a category file is created
   * when the site uses `config/`, otherwise the root file is used.
   */
  environment?: string
}

const set = (path: string, value: unknown): PresetChange => ({ kind: 'set', path: path.split('.'), value })

export const PRESETS: readonly Preset[] = [
  {
    id: 'llms',
    changes: [
      set('outputFormats.llms', { mediaType: 'text/plain', baseName: 'llms', isPlainText: true, notAlternative: true }),
      { kind: 'addToList', path: ['outputs', 'home'], values: ['llms'], fallback: ['html', 'rss'] },
    ],
  },
  {
    id: 'privacy',
    changes: [
      set('privacy.disqus.disable', true),
      set('privacy.googleAnalytics.disable', true),
      set('privacy.googleAnalytics.respectDoNotTrack', true),
      set('privacy.instagram.disable', true),
      set('privacy.vimeo.disable', true),
      set('privacy.vimeo.enableDNT', true),
      set('privacy.x.disable', true),
      set('privacy.x.enableDNT', true),
      set('privacy.youTube.disable', true),
      set('privacy.youTube.privacyEnhanced', true),
    ],
  },
  {
    id: 'turkishUrls',
    changes: [set('removePathAccents', true), set('pagination.path', 'sayfa')],
  },
  {
    id: 'math',
    changes: [
      set('markup.goldmark.extensions.passthrough.enable', true),
      set('markup.goldmark.extensions.passthrough.delimiters.block', [
        ['\\[', '\\]'],
        ['$$', '$$'],
      ]),
      set('markup.goldmark.extensions.passthrough.delimiters.inline', [['\\(', '\\)']]),
    ],
  },
  {
    id: 'devHeaders',
    environment: 'development',
    changes: [
      {
        kind: 'upsertRow',
        path: ['server', 'headers'],
        match: 'for',
        row: {
          for: '/**',
          values: {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Content-Security-Policy': 'script-src localhost:1313',
          },
        },
      },
    ],
  },
]

export interface PresetPlan {
  opsByFile: Record<string, ConfigOp[]>
  /** New files with their full text. */
  newFiles: Record<string, string>
  /** The site already has every setting of the preset. */
  applied: boolean
}

export interface PlanContext {
  sources: readonly LoadedSource[]
  /** `hugo config` output for the preset's environment, when Hugo is available. */
  effective: Tree | null
  /** Comment lines for a new file. */
  newFileHeader?: readonly string[]
}

/** Whether `current` already has everything in `wanted` (extra keys are fine). */
export function satisfies(current: unknown, wanted: unknown): boolean {
  if (isPlainObject(wanted)) {
    if (!isPlainObject(current)) return false
    return Object.entries(wanted).every(([k, v]) => {
      const key = findKey(current, k)
      return key !== undefined && satisfies(current[key], v)
    })
  }
  return looseEqual(current, wanted)
}

/** `base` with `extra` merged in, keeping `base`'s key casing. */
export function mergeInto(base: unknown, extra: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(extra)) return extra
  const out: Tree = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    const key = findKey(out, k) ?? k
    out[key] = mergeInto(out[key], v)
  }
  return out
}

function sameMatch(row: unknown, match: string, value: unknown): boolean {
  if (!isPlainObject(row)) return false
  const key = findKey(row, match)
  return key !== undefined && row[key] === value
}

/** The value the change wants, given what Hugo uses now; null when nothing needs to change. */
function wantedValue(change: PresetChange, current: unknown): unknown {
  if (change.kind === 'set') return satisfies(current, change.value) ? null : change.value
  if (change.kind === 'addToList') {
    const list = Array.isArray(current) ? current.map(String) : change.fallback
    const lower = new Set(list.map((v) => v.toLowerCase()))
    const missing = change.values.filter((v) => !lower.has(v.toLowerCase()))
    return missing.length === 0 ? null : [...list, ...missing]
  }
  const rows: unknown[] = Array.isArray(current) ? current : []
  const index = rows.findIndex((r) => sameMatch(r, change.match, change.row[change.match]))
  if (index >= 0 && satisfies(rows[index], change.row)) return null
  return index >= 0 ? rows.map((r, i) => (i === index ? mergeInto(r, change.row) : r)) : [...rows, change.row]
}

export function planPreset(preset: Preset, ctx: PlanContext): PresetPlan {
  const env = preset.environment ?? null
  const opsByFile: Record<string, ConfigOp[]> = {}
  const newFileValues: Record<string, Tree> = {}
  for (const change of preset.changes) {
    const resolution = resolveKey(ctx.sources, env, change.path)
    const current = resolution.owner?.value ?? (ctx.effective ? effectiveValueAt(ctx.effective, change.path) : undefined)
    const wanted = wantedValue(change, current)
    if (wanted === null) continue
    let target = resolution.target
    if (!target && env !== null) {
      if (usesConfigDir(ctx.sources)) {
        addToNewFile(newFileValues, env, change.path, wanted)
        continue
      }
      target = resolveKey(ctx.sources, null, change.path).target
    }
    if (!target) continue
    const ops = changeOps(change, target, wanted)
    if (ops.length > 0) opsByFile[target.source.path] = [...(opsByFile[target.source.path] ?? []), ...ops]
  }
  const newFiles = Object.fromEntries(
    Object.entries(newFileValues).map(([path, values]) => [path, tomlDocument(values, ctx.newFileHeader ?? [])]),
  )
  return { opsByFile, newFiles, applied: Object.keys(opsByFile).length === 0 && Object.keys(newFiles).length === 0 }
}

function changeOps(change: PresetChange, target: WriteTarget, wanted: unknown): ConfigOp[] {
  const before = locate(target.source, change.path)?.value
  if (change.kind !== 'upsertRow') {
    if (target.filePath.length === 0) return []
    return subtreeOps(target.filePath, before, change.kind === 'set' ? mergeInto(before, wanted) : wanted)
  }
  const rows = wanted as unknown[]
  const mode = listMode(target.source, target.filePath, before !== undefined)
  if (mode === 'value') return [{ op: 'set', path: target.filePath, value: rows }]
  const path = target.filePath.map(String)
  if (mode === 'append') return rows.filter(isPlainObject).map((entries) => ({ op: 'appendTable', path, entries }))
  // An array of tables in the file: update the matching entry in place, or append one.
  const disk = Array.isArray(before) ? before : []
  const index = disk.findIndex((r) => sameMatch(r, change.match, change.row[change.match]))
  if (index >= 0) return subtreeOps([...target.filePath, index], disk[index], mergeInto(disk[index], change.row))
  return [{ op: 'appendTable', path, entries: change.row }]
}

/** Values for `config/<env>/<category>.toml` (keys unwrapped), or `config/<env>/hugo.toml`. */
function addToNewFile(files: Record<string, Tree>, env: string, path: KeyPath, value: unknown) {
  const category = categoryKey(String(path[0]))
  const file = `config/${env}/${category ?? 'hugo'}.toml`
  const inner = category ? path.slice(1) : path
  const values = (files[file] ??= {})
  let table = values
  inner.slice(0, -1).forEach((k) => {
    const key = String(k)
    if (!isPlainObject(table[key])) table[key] = {}
    table = table[key] as Tree
  })
  table[String(inner[inner.length - 1])] = value
}
