// Turning a field change or a reset into ops for the right file.
import type { ConfigOp, KeyPath } from '../../../lib/api'
import type { KeyResolution } from './owner'
import type { Column } from '../schema/types'
import { deepEqual, isEmptyValue, isPlainObject, subtreeOps, type Tree } from './values'

export interface FileOps {
  file: string
  /** Every op is at or below this path; pending ops below it are replaced. */
  base: KeyPath
  ops: ConfigOp[]
}

/**
 * Ops that make `value` the key's value in its write target. `inherited` is what Hugo uses when
 * the edited files do not set the key; choosing it again leaves the files alone.
 */
export function editOps(resolution: KeyResolution, value: unknown, inherited: unknown): FileOps | null {
  const { target } = resolution
  if (!target) return null
  const file = target.source.path
  const before = resolution.layerLocations.find((l) => l.source === target.source)?.value
  if (before === undefined && deepEqual(value, inherited)) return { file, base: target.filePath, ops: [] }
  // A whole unwrapped category file has no path of its own; only its keys can be set.
  const ops = subtreeOps(target.filePath, before, value).filter((op) => op.op === 'appendTable' || op.path.length > 0)
  return { file, base: target.filePath, ops }
}

/** Ops that remove the key from every edited file that sets it (back to the default or the base value). */
export function resetOps(resolution: KeyResolution): FileOps[] {
  return resolution.layerLocations
    .filter((l) => l.source.editable)
    .map((l) => ({
      file: l.source.path,
      base: l.filePath,
      // A whole unwrapped category file (taxonomies.toml with `tag = 'tags'`): remove each key.
      ops:
        l.filePath.length > 0
          ? [{ op: 'remove', path: l.filePath }]
          : Object.keys(isPlainObject(l.value) ? l.value : {}).map((k): ConfigOp => ({ op: 'remove', path: [k] })),
    }))
}

export function countOps(opsByFile: Record<string, ConfigOp[]>): number {
  return Object.values(opsByFile).reduce((n, ops) => n + ops.length, 0)
}

/**
 * A table row as Hugo prints it (lower-cased keys, every zero value) in the documented casing of
 * the columns and without zero values, so copying it into a file writes only what matters.
 */
export function columnCasing(row: Tree, columns: readonly Column[]): Tree {
  const out: Tree = {}
  for (const [key, value] of Object.entries(row)) {
    if (value === false || value === 0 || isEmptyValue(value)) continue
    out[columns.find((c) => c.key.toLowerCase() === key.toLowerCase())?.key ?? key] = value
  }
  return out
}
