// Reads the front matter of every content file and groups the posts by term.
//
// Files are read through injected functions so the logic runs in tests without Tauri. Parsed
// records are cached by path and modification time: re-indexing after a save or a config change
// only reads the files that changed.

import { readFrontMatter, splitFrontMatter, type FrontMatterFormat } from '../../lib/frontmatter'
import type { Eol } from '../../lib/eol'
import { configValue } from './config'
import { termSegment, type PathOptions } from './urlize'

export interface IndexedFile {
  path: string
  modifiedMs: number
  /** Title from the file list, used when the front matter has none. */
  title?: string | null
}

export interface FileRecord {
  path: string
  modifiedMs: number
  format: FrontMatterFormat | null
  /** Parsed front matter (empty when there is none or it could not be parsed). */
  data: Record<string, unknown>
  eol: Eol
  /** Why the front matter could not be read. */
  error: string | null
  fallbackTitle: string | null
}

export type TomlParse = (text: string) => Promise<Record<string, unknown>>

export async function parseRecord(file: IndexedFile, text: string, tomlParse: TomlParse): Promise<FileRecord> {
  const parts = splitFrontMatter(text)
  const base = {
    path: file.path,
    modifiedMs: file.modifiedMs,
    format: parts.format,
    eol: parts.eol,
    fallbackTitle: file.title ?? null,
  }
  try {
    const data = parts.format === 'toml' ? await tomlParse(parts.frontMatterText) : readFrontMatter(parts)
    return { ...base, data: data ?? {}, error: null }
  } catch (error) {
    return { ...base, data: {}, error: describeError(error) }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}

export interface LoadDeps {
  readText(path: string): Promise<{ text: string }>
  tomlParse: TomlParse
}

export interface LoadOptions {
  /** Files read at the same time. */
  concurrency?: number
  onProgress?(done: number, total: number): void
  /** Set `cancelled` to stop early; the partial result is returned. */
  signal?: { cancelled: boolean }
}

/**
 * Records for `files`, reusing entries of `previous` whose modification time did not change.
 * A file that cannot be read becomes a record with an `error`.
 */
export async function loadRecords(
  files: readonly IndexedFile[],
  previous: ReadonlyMap<string, FileRecord>,
  deps: LoadDeps,
  options: LoadOptions = {},
): Promise<Map<string, FileRecord>> {
  const result = new Map<string, FileRecord>()
  const pending: IndexedFile[] = []
  for (const file of files) {
    const cached = previous.get(file.path)
    if (cached && cached.modifiedMs === file.modifiedMs && cached.error === null) {
      result.set(file.path, { ...cached, fallbackTitle: file.title ?? cached.fallbackTitle })
    } else {
      pending.push(file)
    }
  }
  const total = files.length
  let done = result.size
  options.onProgress?.(done, total)
  let next = 0
  const worker = async () => {
    while (next < pending.length && !options.signal?.cancelled) {
      const file = pending[next++]
      let record: FileRecord
      try {
        const { text } = await deps.readText(file.path)
        record = await parseRecord(file, text, deps.tomlParse)
      } catch (error) {
        record = {
          path: file.path,
          modifiedMs: file.modifiedMs,
          format: null,
          data: {},
          eol: 'none',
          error: describeError(error),
          fallbackTitle: file.title ?? null,
        }
      }
      result.set(file.path, record)
      done++
      options.onProgress?.(done, total)
    }
  }
  const workers = Math.max(1, Math.min(options.concurrency ?? 8, pending.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return result
}

// ---------------------------------------------------------------------------
// Terms

/** Front matter key matching `key` without regard to case (Hugo lower-cases keys). */
export function findKey(data: Record<string, unknown>, key: string): string | undefined {
  if (key in data) return key
  const lower = key.toLowerCase()
  return Object.keys(data).find((k) => k.toLowerCase() === lower)
}

/** A list item or single value as a term, or `null` for anything that is not a term. */
export function termText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return null
}

/**
 * Terms of a front matter value: a single string counts as one term (Hugo does not split
 * on commas), a list gives its items. Empty strings are skipped and repeats counted once.
 */
export function termsOf(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value]
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const term = termText(item)
    if (term === null || term.trim() === '' || seen.has(term)) continue
    seen.add(term)
    result.push(term)
  }
  return result
}

export function termsInRecord(record: FileRecord, plural: string): string[] {
  const key = findKey(record.data, plural)
  return key === undefined ? [] : termsOf(record.data[key])
}

function fileName(path: string): string {
  const parts = path.split('/')
  let name = parts[parts.length - 1]
  if (/^_?index(\.[^.]+)*$/i.test(name) && parts.length > 1) name = parts[parts.length - 2]
  return name.replace(/\.(md|markdown|mdown)$/i, '')
}

export function recordTitle(record: FileRecord): string {
  const key = findKey(record.data, 'title')
  const title = key === undefined ? undefined : record.data[key]
  if (typeof title === 'string' && title.trim() !== '') return title
  if (record.fallbackTitle && record.fallbackTitle.trim() !== '') return record.fallbackTitle
  return fileName(record.path)
}

export function recordDraft(record: FileRecord): boolean {
  const value = configValue(record.data, 'draft')
  return value === true || value === 'true'
}

export interface PostRef {
  path: string
  title: string
  draft: boolean
}

export interface TermInfo {
  /** The term as written in front matter. */
  name: string
  /** Hugo's path segment for the term (see {@link termSegment}). */
  segment: string
  posts: PostRef[]
}

/** `content/<plural>/…` holds the taxonomy's own pages, not posts. */
export function isTaxonomyPage(path: string, contentDir: string, plurals: readonly string[]): boolean {
  const lower = path.toLowerCase()
  const prefix = `${contentDir}/`.toLowerCase()
  if (!lower.startsWith(prefix)) return false
  const rest = lower.slice(prefix.length)
  return plurals.some((plural) => rest.startsWith(`${plural.toLowerCase()}/`))
}

const collator = new Intl.Collator('tr')

/**
 * Terms of one taxonomy with the posts that use them, in Turkish alphabetical order.
 * Terms are kept as written: `Kitap` and `kitap` are separate entries (they share a segment).
 */
export function buildTermIndex(
  records: Iterable<FileRecord>,
  plural: string,
  options: PathOptions,
  exclude: (path: string) => boolean = () => false,
): TermInfo[] {
  const byName = new Map<string, TermInfo>()
  for (const record of records) {
    if (exclude(record.path)) continue
    const terms = termsInRecord(record, plural)
    if (terms.length === 0) continue
    const post: PostRef = { path: record.path, title: recordTitle(record), draft: recordDraft(record) }
    for (const name of terms) {
      let info = byName.get(name)
      if (!info) {
        info = { name, segment: termSegment(name, options), posts: [] }
        byName.set(name, info)
      }
      info.posts.push(post)
    }
  }
  const terms = [...byName.values()]
  for (const term of terms) term.posts.sort((a, b) => collator.compare(a.title, b.title) || a.path.localeCompare(b.path))
  return terms.sort((a, b) => collator.compare(a.name, b.name))
}

/** Paths of files that use any of `terms` in `plural`. */
export function filesUsingTerms(records: Iterable<FileRecord>, plural: string, terms: readonly string[]): string[] {
  const wanted = new Set(terms)
  const result: string[] = []
  for (const record of records) {
    if (termsInRecord(record, plural).some((t) => wanted.has(t))) result.push(record.path)
  }
  return result.sort()
}

/** The line ending most indexed files use, for new files. */
export function preferredEol(records: Iterable<FileRecord>): '\n' | '\r\n' {
  let lf = 0
  let crlf = 0
  for (const record of records) {
    if (record.eol === 'lf') lf++
    else if (record.eol === 'crlf') crlf++
  }
  return crlf > lf ? '\r\n' : '\n'
}
