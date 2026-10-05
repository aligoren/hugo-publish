// Which file defines a key, and which file a change to it should go to (catalog §1.6).
import type { KeyPath } from '../../../lib/api'
import { canHold, globalTree, layerFor, stackFor, toFilePath, type LoadedSource } from './sources'
import { lookup, writePath, type Tree } from './values'

export interface KeyLocation {
  source: LoadedSource
  /** Path in the merged config, with the file's key casing. */
  actual: KeyPath
  /** Path inside the file (wrapper key and language prefix applied). */
  filePath: KeyPath
  value: unknown
}

export interface WriteTarget {
  source: LoadedSource
  filePath: KeyPath
}

export interface KeyResolution {
  /** Every active file that defines the key (all environments), lowest precedence first. */
  locations: KeyLocation[]
  /** The definition Hugo uses for the chosen environment. */
  owner: KeyLocation | null
  /** Definitions in the files being edited (root + `_default`, or one environment folder). */
  layerLocations: KeyLocation[]
  /** In the all-environments view: environment folders that override the key. */
  overriddenIn: KeyLocation[]
  /** Where a changed value is written; null when no editable file can hold it. */
  target: WriteTarget | null
}

export type ValuesOf = (source: LoadedSource) => Tree

const diskValues: ValuesOf = (source) => source.values

export function locate(source: LoadedSource, path: KeyPath, values: Tree = source.values): KeyLocation | null {
  const found = lookup(globalTree(source, values), path)
  if (!found) return null
  const filePath = toFilePath(source, found.actual)
  return filePath ? { source, actual: found.actual, filePath, value: found.value } : null
}

/**
 * Resolves `path` (documented casing) for `env` (null = all environments: root + `_default`).
 * The write target is the owning file in the edited layer; else that layer's category file
 * (`config/_default/markup.toml`, `menus.tr.toml` for `languages.tr.menus`); else its root file.
 */
export function resolveKey(
  sources: readonly LoadedSource[],
  env: string | null,
  path: KeyPath,
  valuesOf: ValuesOf = diskValues,
): KeyResolution {
  const active = sources.filter((s) => s.active)
  const locations = active.map((s) => locate(s, path, valuesOf(s))).filter((l): l is KeyLocation => l !== null)
  const stack = new Set(stackFor(active, env))
  const layer = layerFor(active, env)
  const layerSet = new Set(layer)
  const inStack = locations.filter((l) => stack.has(l.source))
  const layerLocations = locations.filter((l) => layerSet.has(l.source))
  const owner = inStack[inStack.length - 1] ?? null
  const overriddenIn = env === null ? locations.filter((l) => l.source.layer === 'env') : []
  return { locations, owner, layerLocations, overriddenIn, target: writeTarget(layer, layerLocations, path, valuesOf) }
}

function writeTarget(
  layer: readonly LoadedSource[],
  layerLocations: readonly KeyLocation[],
  path: KeyPath,
  valuesOf: ValuesOf,
): WriteTarget | null {
  const owned = layerLocations[layerLocations.length - 1]
  if (owned) return owned.source.editable ? { source: owned.source, filePath: owned.filePath } : null
  const category = layer
    .filter((s) => s.kind === 'category' && s.editable && s.error === null && canHold(s, path))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]
  const file = category ?? rootFileOf(layer)
  if (!file) return null
  const filePath = toFilePath(file, writePath(globalTree(file, valuesOf(file)), path))
  return filePath ? { source: file, filePath } : null
}

/** The editable file for root keys in a layer: the project root file first, then `config/<dir>/hugo.*`. */
export function rootFileOf(layer: readonly LoadedSource[]): LoadedSource | null {
  const roots = layer.filter((s) => s.kind === 'root' && s.editable && s.error === null)
  return roots.find((s) => s.layer === 'root') ?? roots[0] ?? null
}
