// Turning a split plan into file changes for the review, and checking it on the parsed files.
import { parse } from 'yaml'

import { api } from '../../../lib/api'
import type { FileChange } from './fileChange'
import { checkSplit, planSplit } from './splitConfig'
import { usesConfigDir, type LoadedSource } from './sources'
import type { Tree } from './values'

export interface SplitDeps {
  readText(path: string): Promise<{ text: string; version: string }>
  tomlParseText(text: string): Promise<{ values: Record<string, unknown> }>
}

/**
 * New category files (created only if they do not exist), then the root file with what is left,
 * moved to config/_default/ once everything was written.
 */
export async function splitChanges(root: LoadedSource, deps: SplitDeps = api): Promise<FileChange[]> {
  const file = await deps.readText(root.path)
  const plan = planSplit(root.path, file.text, root.format)
  if (!plan) return []
  return [
    ...plan.files.map((f): FileChange => ({ path: f.path, before: '', after: f.text, version: '' })),
    { path: root.path, before: file.text, after: plan.remainder, version: file.version, moveTo: plan.movedTo },
  ]
}

async function parseText(text: string, format: LoadedSource['format'], deps: SplitDeps): Promise<Tree> {
  if (text.trim() === '') return {}
  if (format === 'toml') return (await deps.tomlParseText(text)).values
  const value: unknown = format === 'json' ? JSON.parse(text.replace(/^﻿/, '')) : parse(text.replace(/^﻿/, ''))
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Tree) : {}
}

/** Problems with the split: the files must parse and merge back to the same values. */
export async function verifySplit(root: LoadedSource, changes: readonly FileChange[], deps: SplitDeps = api): Promise<string[]> {
  const rootChange = changes.find((c) => c.path === root.path)
  if (!rootChange) return []
  try {
    const original = await parseText(rootChange.before, root.format, deps)
    const remainder = await parseText(rootChange.after, root.format, deps)
    const files = []
    for (const change of changes) {
      if (change === rootChange) continue
      const name = change.path.slice(change.path.lastIndexOf('/') + 1)
      const category = name.slice(0, name.indexOf('.'))
      files.push({ category, values: await parseText(change.after, root.format, deps) })
    }
    return checkSplit(original, { remainder, files })
  } catch (error) {
    return [error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)]
  }
}

/** Whether a site with one root config file can be split into config/_default/ (JSON too, written as text). */
export function canSplit(sources: readonly LoadedSource[]): boolean {
  if (usesConfigDir(sources)) return false
  const root = sources.find((s) => s.layer === 'root' && s.active)
  return !!root && (root.editable || root.format === 'json') && root.error === null && root.text !== null && planSplit(root.path, root.text, root.format) !== null
}

/**
 * The config files as they would be after the split, for `api.configValidateFiles`: new and
 * changed files with their text, a moved file removed from its old place.
 */
export function splitValidationFiles(changes: readonly FileChange[]): { path: string; text: string | null }[] {
  return changes.flatMap((c) =>
    c.moveTo
      ? [
          { path: c.path, text: null },
          { path: c.moveTo, text: c.after },
        ]
      : [{ path: c.path, text: c.after }],
  )
}

/**
 * Other root config files (Hugo ignores them while the active one is there). Once that one moves
 * to config/_default/, Hugo would read the next of them instead, so they must be deleted first;
 * this app does not delete config files.
 */
export function rootFilesInTheWay(sources: readonly LoadedSource[], root: LoadedSource): string[] {
  return sources.filter((s) => s.layer === 'root' && s.path !== root.path).map((s) => s.path)
}
