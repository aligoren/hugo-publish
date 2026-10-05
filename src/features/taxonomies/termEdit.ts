// Renaming, merging and deleting terms in content files.
//
// Only the term values change. YAML goes through the minimal-diff editor of lib/frontmatter, so
// a flow list stays `["a", "b"]`, a block list stays `- a`, and each item keeps its quote style
// and comment. TOML front matter goes through `toml_edit` on the Rust side (injected, so tests can
// mock it). JSON front matter is read-only in the app.

import { isMap, isScalar, isSeq, type Document, type YAMLSeq } from 'yaml'

import type { ConfigOp } from '../../lib/api'
import {
  deleteField,
  editFrontMatter,
  FrontMatterReadOnlyError,
  joinFrontMatter,
  readFrontMatter,
  splitFrontMatter,
  type FrontMatterParts,
} from '../../lib/frontmatter'
import { termText } from './indexer'

/** Rename (one source) or merge (several sources) into `to`, or delete terms. */
export type TermEdit =
  | { kind: 'rename'; from: readonly string[]; to: string }
  | { kind: 'delete'; terms: readonly string[] }

function sources(edit: TermEdit): ReadonlySet<string> {
  return new Set(edit.kind === 'rename' ? edit.from : edit.terms)
}

/**
 * Applies an edit to a list of front matter items. Sources become the target (or are removed);
 * the target is kept once, where it first appears; other items, including non-terms, stay as they
 * are. Returns the index of the original item for every kept item, and the new values.
 */
export function editItems(items: readonly unknown[], edit: TermEdit): { keep: number[]; values: unknown[] } {
  const from = sources(edit)
  const target = edit.kind === 'rename' ? edit.to : null
  let targetSeen = false
  const keep: number[] = []
  const values: unknown[] = []
  items.forEach((item, index) => {
    const term = termText(item)
    if (term !== null && from.has(term)) {
      if (target === null || targetSeen) return
      targetSeen = true
      keep.push(index)
      values.push(term === target ? item : target)
    } else if (target !== null && term === target) {
      if (targetSeen) return
      targetSeen = true
      keep.push(index)
      values.push(item)
    } else {
      keep.push(index)
      values.push(item)
    }
  })
  return { keep, values }
}

/** The edit applied to a list of terms (same rules as front matter lists). */
export function editTermList(terms: readonly string[], edit: TermEdit): string[] {
  return editItems(terms, edit).values as string[]
}

/** Whether the edit changes a front matter value. */
export function editChanges(value: unknown, edit: TermEdit): boolean {
  if (Array.isArray(value)) {
    const { values } = editItems(value, edit)
    return values.length !== value.length || values.some((v, i) => v !== value[i])
  }
  const term = termText(value)
  return term !== null && sources(edit).has(term) && (edit.kind === 'delete' || edit.to !== term)
}

function keysOf(data: Record<string, unknown>, plural: string): string[] {
  const lower = plural.toLowerCase()
  return Object.keys(data).filter((k) => k.toLowerCase() === lower)
}

// ---------------------------------------------------------------------------
// YAML

function editYamlSeq(seq: YAMLSeq, edit: TermEdit): void {
  const values = seq.items.map((item) => (isScalar(item) ? item.value : undefined))
  const result = editItems(values, edit)
  const items = result.keep.map((index, i) => {
    const node = seq.items[index]
    if (isScalar(node) && node.value !== result.values[i]) node.value = result.values[i]
    return node
  })
  seq.items = items
}

/** Rewrites the terms of `plural` in YAML front matter; other lines keep their bytes. */
export function rewriteYamlTerms(parts: FrontMatterParts, plural: string, edit: TermEdit): FrontMatterParts {
  const data = readFrontMatter(parts) ?? {}
  const keys = keysOf(data, plural).filter((key) => editChanges(data[key], edit))
  // A single-value field whose term is deleted loses the whole key (comments above it stay).
  const removed = keys.filter((key) => !Array.isArray(data[key]) && edit.kind === 'delete')
  const edited = new Set(keys.filter((key) => !removed.includes(key)))
  let result = parts
  if (edited.size > 0) {
    result = editFrontMatter(result, (doc: Document) => {
      if (!isMap(doc.contents)) return
      for (const pair of doc.contents.items) {
        const key = isScalar(pair.key) ? pair.key.value : pair.key
        if (typeof key !== 'string' || !edited.has(key)) continue
        const node = pair.value
        if (isSeq(node)) {
          editYamlSeq(node, edit)
        } else if (isScalar(node) && edit.kind === 'rename') {
          node.value = edit.to
        }
      }
    })
  }
  for (const key of removed) result = deleteField(result, [key])
  return result
}

// ---------------------------------------------------------------------------
// TOML

export interface TomlDeps {
  tomlEditText(text: string, ops: ConfigOp[]): Promise<string>
  tomlParseText(text: string): Promise<Record<string, unknown>>
}

/** The ops that apply `edit` to parsed TOML front matter values. */
export function tomlTermOps(values: Record<string, unknown>, plural: string, edit: TermEdit): ConfigOp[] {
  const ops: ConfigOp[] = []
  for (const key of keysOf(values, plural)) {
    const value = values[key]
    if (!editChanges(value, edit)) continue
    if (Array.isArray(value)) {
      ops.push({ op: 'set', path: [key], value: editItems(value, edit).values })
    } else if (edit.kind === 'rename') {
      ops.push({ op: 'set', path: [key], value: edit.to })
    } else {
      ops.push({ op: 'remove', path: [key] })
    }
  }
  return ops
}

export async function rewriteTomlTerms(
  parts: FrontMatterParts,
  plural: string,
  edit: TermEdit,
  deps: TomlDeps,
): Promise<FrontMatterParts> {
  const values = await deps.tomlParseText(parts.frontMatterText)
  const ops = tomlTermOps(values, plural, edit)
  if (ops.length === 0) return parts
  const text = await deps.tomlEditText(parts.frontMatterText, ops)
  return text === parts.frontMatterText ? parts : { ...parts, frontMatterText: text }
}

// ---------------------------------------------------------------------------
// Whole files

/**
 * The file with `edit` applied to its `plural` front matter key. Returns `text` unchanged when
 * the file does not use the terms. Throws {@link FrontMatterReadOnlyError} for JSON front matter
 * that would change, and `FrontMatterError` for front matter that cannot be parsed.
 */
export async function rewriteTerms(text: string, plural: string, edit: TermEdit, deps: TomlDeps): Promise<string> {
  const parts = splitFrontMatter(text)
  if (parts.format === 'yaml') {
    const next = rewriteYamlTerms(parts, plural, edit)
    return next === parts ? text : joinFrontMatter(next)
  }
  if (parts.format === 'toml') {
    const next = await rewriteTomlTerms(parts, plural, edit, deps)
    return next === parts ? text : joinFrontMatter(next)
  }
  if (parts.format === 'json') {
    const data = readFrontMatter(parts) ?? {}
    if (keysOf(data, plural).some((key) => editChanges(data[key], edit))) throw new FrontMatterReadOnlyError('json')
  }
  return text
}

// ---------------------------------------------------------------------------
// Plans

export interface PlannedFile {
  path: string
  before: string
  after: string
  /** Version read with `before`; the write fails if the file changed since. */
  version: string
}

export interface SkippedFile {
  path: string
  reason: 'readOnly' | 'error'
  error: unknown
}

export interface ChangePlan {
  files: PlannedFile[]
  skipped: SkippedFile[]
}

export interface PlanDeps extends TomlDeps {
  readText(path: string): Promise<{ text: string; version: string }>
}

/** Reads each file fresh and computes its new text. Nothing is written. */
export async function planTermEdit(
  paths: readonly string[],
  plural: string,
  edit: TermEdit,
  deps: PlanDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<ChangePlan> {
  const plan: ChangePlan = { files: [], skipped: [] }
  let done = 0
  for (const path of paths) {
    try {
      const file = await deps.readText(path)
      const after = await rewriteTerms(file.text, plural, edit, deps)
      if (after !== file.text) plan.files.push({ path, before: file.text, after, version: file.version })
    } catch (error) {
      plan.skipped.push({ path, reason: error instanceof FrontMatterReadOnlyError ? 'readOnly' : 'error', error })
    }
    onProgress?.(++done, paths.length)
  }
  return plan
}

export interface WriteDeps {
  writeText(path: string, text: string, expectedVersion: string): Promise<unknown>
  /** Optional snapshot of the old text before it is replaced (local history). */
  snapshot?(path: string, text: string): Promise<unknown>
}

export interface WriteOutcome {
  written: string[]
  failed: { path: string; error: unknown }[]
}

/** Writes every planned file with its expected version. A failure does not stop the others. */
export async function writePlan(files: readonly PlannedFile[], deps: WriteDeps): Promise<WriteOutcome> {
  const outcome: WriteOutcome = { written: [], failed: [] }
  for (const file of files) {
    try {
      // The old text goes to local history first so the change can be undone; best effort.
      await deps.snapshot?.(file.path, file.before)
    } catch {
      // A missing snapshot must not block the write.
    }
    try {
      await deps.writeText(file.path, file.after, file.version)
      outcome.written.push(file.path)
    } catch (error) {
      outcome.failed.push({ path: file.path, error })
    }
  }
  return outcome
}

/** The front matter block of a file with its fences, for showing what an edit changes. */
export function frontMatterBlock(text: string): string {
  const parts = splitFrontMatter(text)
  return parts.open + parts.frontMatterText + parts.close
}
