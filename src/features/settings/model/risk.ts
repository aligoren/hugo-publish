// Changes that need an explicit "yes" before they are written: raw HTML in Markdown, security
// policy, `_merge` rules, and options that delete files from the publish folder.
import type { ConfigOp } from '../../../lib/api'
import { findSetting } from '../schema'
import { globalTree, type LoadedSource } from './sources'
import { applyOps, deepEqual, isPlainObject, type Tree } from './values'

export type RiskKind = 'unsafe' | 'security' | 'merge' | 'cleanDestinationDir' | 'confirm'

export interface Risk {
  /** Site-relative config file. */
  file: string
  kind: RiskKind
  /** Dotted path in the merged config, with the casing written in the file. */
  key: string
  /** The new value; undefined when the key is removed. */
  value: unknown
}

interface Leaf {
  path: string[]
  before: unknown
  after: unknown
}

/** Changed leaves between two trees; keys match without regard to case, like Hugo. */
function changedLeaves(before: unknown, after: unknown, path: string[] = [], out: Leaf[] = []): Leaf[] {
  if (isPlainObject(before) || isPlainObject(after)) {
    const a = isPlainObject(before) ? before : {}
    const b = isPlainObject(after) ? after : {}
    if (!isPlainObject(before) && before !== undefined) out.push({ path, before, after: undefined })
    if (!isPlainObject(after) && after !== undefined) out.push({ path, before: undefined, after })
    const keys = new Map<string, string>()
    for (const k of [...Object.keys(a), ...Object.keys(b)]) if (!keys.has(k.toLowerCase())) keys.set(k.toLowerCase(), k)
    for (const [lower, written] of keys) {
      const ka = Object.keys(a).find((k) => k.toLowerCase() === lower)
      const kb = Object.keys(b).find((k) => k.toLowerCase() === lower)
      changedLeaves(ka === undefined ? undefined : a[ka], kb === undefined ? undefined : b[kb], [...path, kb ?? written], out)
    }
    return out
  }
  if (!deepEqual(before, after)) out.push({ path, before, after })
  return out
}

function is(path: readonly string[], ...expected: string[]): boolean {
  return path.length === expected.length && path.every((k, i) => k.toLowerCase() === expected[i].toLowerCase())
}

function kindOf(leaf: Leaf): RiskKind | null {
  const { path, after } = leaf
  if (path.length === 0) return null
  if (path.some((k) => k.toLowerCase() === '_merge')) return 'merge'
  if (path[0].toLowerCase() === 'security') return 'security'
  if (is(path, 'markup', 'goldmark', 'renderer', 'unsafe')) return after === true ? 'unsafe' : null
  if (is(path, 'cleanDestinationDir') || is(path, 'build', 'cleanDestinationDir', 'enable')) return after === true ? 'cleanDestinationDir' : null
  const setting = findSetting(path)
  return setting?.requiresConfirm ? 'confirm' : null
}

/** Risky differences between two merged-config trees (one file's view). */
export function riskyChanges(before: Tree, after: Tree): Omit<Risk, 'file'>[] {
  const out: Omit<Risk, 'file'>[] = []
  for (const leaf of changedLeaves(before, after)) {
    const kind = kindOf(leaf)
    if (kind) out.push({ kind, key: leaf.path.join('.'), value: leaf.after })
  }
  return out
}

/** Risky changes in pending ops, per file. */
export function risksOfOps(sources: readonly LoadedSource[], opsByFile: Record<string, ConfigOp[]>): Risk[] {
  const out: Risk[] = []
  for (const [file, ops] of Object.entries(opsByFile)) {
    const source = sources.find((s) => s.path === file)
    if (!source || ops.length === 0) continue
    const after = applyOps(source.values, ops)
    for (const risk of riskyChanges(globalTree(source), globalTree(source, after))) out.push({ file, ...risk })
  }
  return out
}

/** Risky changes when a file's values become `values` (raw editing). */
export function risksOfValues(source: LoadedSource, values: Tree): Risk[] {
  return riskyChanges(globalTree(source), globalTree(source, values)).map((r) => ({ file: source.path, ...r }))
}

/** Whether the merged config keeps extra files when cleanDestinationDir is on (CNAME, .well-known…). */
export function hasKeepFiles(tree: Tree): boolean {
  const build = Object.entries(tree).find(([k]) => k.toLowerCase() === 'build')?.[1]
  const clean = isPlainObject(build) ? Object.entries(build).find(([k]) => k.toLowerCase() === 'cleandestinationdir')?.[1] : undefined
  const keep = isPlainObject(clean) ? Object.entries(clean).find(([k]) => k.toLowerCase() === 'keepfiles')?.[1] : undefined
  return Array.isArray(keep) && keep.length > 0
}
