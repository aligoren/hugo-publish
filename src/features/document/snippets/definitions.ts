// User-defined snippets: repeated, form-driven blocks (a book card, a quote card, an embed…).
// Definitions live in the site at `.hugo-publisher/snippets.toml` so every computer shares them:
//
//   [[snippet]]
//   id = "book"
//   name = "Book card"
//   output = "markdown"            # or "shortcode" (a hint for the list)
//   fields = [{ key = "title", label = "Title", kind = "text", required = true }]
//   template = """
//   > **{{title}}**
//   """

import type { ConfigOp } from '../../../lib/api'
import { slugify } from '../../../lib/slug'
import type { ShortcodeDef } from '../../editor'
import { deepEqual, isRecord } from '../frontMatterOps'
import type { TemplateValue } from './template'

export const SNIPPETS_PATH = '.hugo-publisher/snippets.toml'

export const FIELD_KINDS = ['text', 'multiline', 'url', 'date', 'number', 'select', 'bool', 'image', 'page'] as const
export type SnippetFieldKind = (typeof FIELD_KINDS)[number]

export interface SnippetField {
  key: string
  label: string
  kind: SnippetFieldKind
  /** Choices of a `select` field. */
  options?: string[]
  default?: string | number | boolean
  required?: boolean
}

export interface SnippetDef {
  id: string
  name: string
  description?: string
  output: 'markdown' | 'shortcode'
  fields: SnippetField[]
  template: string
}

export interface ParsedSnippet extends SnippetDef {
  /** Position in the file's `[[snippet]]` list (for edits). */
  index: number
}

export const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

function parseField(raw: unknown): SnippetField | null {
  if (!isRecord(raw)) return null
  const key = str(raw.key)?.trim()
  if (!key || !FIELD_KEY.test(key)) return null
  const kind = (FIELD_KINDS as readonly string[]).includes(str(raw.kind) ?? '') ? (raw.kind as SnippetFieldKind) : 'text'
  const field: SnippetField = { key, label: str(raw.label)?.trim() || key, kind }
  if (Array.isArray(raw.options)) field.options = raw.options.map(String)
  if (['string', 'number', 'boolean'].includes(typeof raw.default)) field.default = raw.default as string | number | boolean
  if (raw.required === true) field.required = true
  return field
}

/** Snippets from the parsed file; entries without a template are reported, not dropped silently. */
export function parseSnippets(values: Record<string, unknown>): { snippets: ParsedSnippet[]; problems: string[] } {
  const list = Array.isArray(values.snippet) ? values.snippet : []
  const snippets: ParsedSnippet[] = []
  const problems: string[] = []
  const ids = new Set<string>()
  list.forEach((raw, index) => {
    if (!isRecord(raw) || typeof raw.template !== 'string') {
      problems.push(`#${index + 1}: template`)
      return
    }
    const name = str(raw.name)?.trim() || str(raw.id) || `Snippet ${index + 1}`
    let id = slugify(str(raw.id) ?? '') || slugify(name) || `snippet-${index + 1}`
    while (ids.has(id)) id += '-2'
    ids.add(id)
    const fields = Array.isArray(raw.fields) ? raw.fields.map(parseField) : []
    if (fields.some((f) => f === null)) problems.push(`${name}: fields`)
    snippets.push({
      index,
      id,
      name,
      description: str(raw.description)?.trim() || undefined,
      output: raw.output === 'shortcode' ? 'shortcode' : 'markdown',
      fields: fields.filter((f): f is SnippetField => f !== null),
      template: raw.template,
    })
  })
  return { snippets, problems }
}

function fieldEntry(field: SnippetField): Record<string, unknown> {
  const entry: Record<string, unknown> = { key: field.key, label: field.label, kind: field.kind }
  if (field.options && field.options.length > 0) entry.options = field.options
  if (field.default !== undefined && field.default !== '') entry.default = field.default
  if (field.required) entry.required = true
  return entry
}

/** The keys written for a snippet, in file order. Empty optional keys are left out. */
export function snippetEntries(def: SnippetDef): Record<string, unknown> {
  const entries: Record<string, unknown> = { id: def.id, name: def.name }
  if (def.description) entries.description = def.description
  entries.output = def.output
  entries.fields = def.fields.map(fieldEntry)
  entries.template = def.template
  return entries
}

/**
 * Config ops that turn the file's snippets into `next`: changed keys of edited entries are set
 * (so comments and untouched keys stay), new ones appended, removed ones deleted (last first,
 * so indexes stay valid).
 */
export function snippetOps(current: readonly ParsedSnippet[], next: readonly (SnippetDef & { index?: number })[]): ConfigOp[] {
  const ops: ConfigOp[] = []
  const kept = new Set<number>()
  for (const def of next) {
    const before = def.index === undefined ? undefined : current.find((s) => s.index === def.index)
    if (!before) {
      ops.push({ op: 'appendTable', path: ['snippet'], entries: snippetEntries(def) })
      continue
    }
    kept.add(before.index)
    const a = snippetEntries(before)
    const b = snippetEntries(def)
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (deepEqual(a[key], b[key])) continue
      ops.push(key in b ? { op: 'set', path: ['snippet', before.index, key], value: b[key] } : { op: 'remove', path: ['snippet', before.index, key] })
    }
  }
  const removed = current.filter((s) => !kept.has(s.index)).map((s) => s.index)
  for (const index of removed.sort((x, y) => y - x)) ops.push({ op: 'remove', path: ['snippet', index] })
  return ops
}

export type SnippetProblem = 'name' | 'idTaken' | 'template' | 'fieldKey' | 'fieldDuplicate' | 'options'

/** What keeps a definition from being saved. */
export function validateSnippet(def: SnippetDef, others: readonly SnippetDef[]): SnippetProblem[] {
  const problems: SnippetProblem[] = []
  if (!def.name.trim()) problems.push('name')
  if (others.some((o) => o.id === def.id)) problems.push('idTaken')
  if (!def.template.trim()) problems.push('template')
  if (def.fields.some((f) => !FIELD_KEY.test(f.key))) problems.push('fieldKey')
  if (new Set(def.fields.map((f) => f.key)).size !== def.fields.length) problems.push('fieldDuplicate')
  if (def.fields.some((f) => f.kind === 'select' && (f.options ?? []).length === 0)) problems.push('options')
  return problems
}

/** A free id based on `name`. */
export function uniqueId(name: string, taken: readonly string[]): string {
  const base = slugify(name) || 'snippet'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

/** Starting values of a snippet form. */
export function initialValues(def: SnippetDef): Record<string, TemplateValue> {
  const values: Record<string, TemplateValue> = {}
  for (const field of def.fields) {
    values[field.key] = field.default ?? (field.kind === 'bool' ? false : field.kind === 'select' ? (field.options?.[0] ?? '') : '')
  }
  return values
}

/** Required fields that are still empty. */
export function missingRequired(def: SnippetDef, values: Readonly<Record<string, TemplateValue>>): string[] {
  return def.fields
    .filter((f) => f.required && (values[f.key] === undefined || values[f.key] === null || String(values[f.key]).trim() === ''))
    .map((f) => f.key)
}

/** A snippet that writes a shortcode, with one field per parameter (`{{< name key="…" >}}`). */
export function snippetFromShortcode(shortcode: ShortcodeDef, taken: readonly string[]): SnippetDef {
  const fields: SnippetField[] = []
  const args: string[] = []
  const positional = shortcode.params.filter((p) => p.positional !== undefined).sort((a, b) => (a.positional ?? 0) - (b.positional ?? 0))
  const named = shortcode.params.filter((p) => p.positional === undefined)
  for (const param of [...positional, ...named]) {
    const key = param.name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^(?=[^A-Za-z_])/, '_')
    if (fields.some((f) => f.key === key)) continue
    fields.push({ key, label: param.name, kind: 'text', ...(param.required ? { required: true } : {}) })
    const value = `"{{${key}|attr}}"`
    const arg = param.positional !== undefined ? ` ${value}` : ` ${param.name}=${value}`
    args.push(param.required || param.positional !== undefined ? arg : `{{#${key}}}${arg}{{/${key}}}`)
  }
  const [open, close] = shortcode.markdown ? ['{{%', '%}}'] : ['{{<', '>}}']
  let template = `${open} ${shortcode.name}${args.join('')} ${close}`
  if (shortcode.paired) {
    fields.push({ key: 'inner', label: 'Content', kind: 'multiline' })
    template += `\n{{inner}}\n${open} /${shortcode.name} ${close}`
  }
  return {
    id: uniqueId(shortcode.name, taken),
    name: shortcode.name,
    description: shortcode.description,
    output: 'shortcode',
    fields,
    template,
  }
}

/** Labels for the starter examples, in the user's language. */
export interface StarterLabels {
  book: string
  bookDescription: string
  quote: string
  quoteDescription: string
  product: string
  productDescription: string
  title: string
  author: string
  publisher: string
  year: string
  isbn: string
  link: string
  text: string
  source: string
  name: string
  image: string
  price: string
  description: string
}

/** Examples the user can add with one click. */
export function starterSnippets(l: StarterLabels): SnippetDef[] {
  return [
    {
      id: 'book',
      name: l.book,
      description: l.bookDescription,
      output: 'markdown',
      fields: [
        { key: 'title', label: l.title, kind: 'text', required: true },
        { key: 'author', label: l.author, kind: 'text' },
        { key: 'publisher', label: l.publisher, kind: 'text' },
        { key: 'year', label: l.year, kind: 'number' },
        { key: 'isbn', label: l.isbn, kind: 'text' },
        { key: 'url', label: l.link, kind: 'url' },
      ],
      template: [
        '> **{{title}}**{{#author}} · {{author}}{{/author}}',
        '{{#publisher}}',
        '> {{publisher}}{{#year}}, {{year}}{{/year}}',
        '{{/publisher}}',
        '{{#isbn}}',
        '> ISBN {{isbn}}',
        '{{/isbn}}',
        '{{#url}}',
        '> <{{url}}>',
        '{{/url}}',
      ].join('\n'),
    },
    {
      id: 'quote',
      name: l.quote,
      description: l.quoteDescription,
      output: 'markdown',
      fields: [
        { key: 'text', label: l.text, kind: 'multiline', required: true },
        { key: 'author', label: l.author, kind: 'text' },
        { key: 'source', label: l.source, kind: 'text' },
      ],
      template: ['> {{text|blockquote}}', '{{#author}}', '>', '> — {{author}}{{#source}}, *{{source}}*{{/source}}', '{{/author}}'].join('\n'),
    },
    {
      id: 'product',
      name: l.product,
      description: l.productDescription,
      output: 'markdown',
      fields: [
        { key: 'name', label: l.name, kind: 'text', required: true },
        { key: 'image', label: l.image, kind: 'image' },
        { key: 'price', label: l.price, kind: 'text' },
        { key: 'description', label: l.description, kind: 'multiline' },
        { key: 'url', label: l.link, kind: 'url' },
      ],
      template: [
        '{{#image}}',
        '![{{name}}]({{image}})',
        '',
        '{{/image}}',
        '**{{name}}**{{#price}} · {{price}}{{/price}}',
        '{{#description}}',
        '',
        '{{description}}',
        '{{/description}}',
        '{{#url}}',
        '',
        '[{{name}}]({{url}})',
        '{{/url}}',
      ].join('\n'),
    },
  ]
}

/** Whether two definitions are the same (for unsaved-change checks). */
export function sameSnippet(a: SnippetDef, b: SnippetDef): boolean {
  return deepEqual(snippetEntries(a), snippetEntries(b))
}

/** The first line of a new snippets file. */
export const SNIPPETS_FILE_HEADER =
  '# Snippets for Hugo Publisher: [[snippet]] entries with fields and a template.\n' +
  '# Placeholders: {{key}}, {{key|slug}}, {{#key}}shown when filled{{/key}}.\n'

/** The path `ref` / `relref` expect for a page: relative to the content folder. */
export function contentRelative(path: string, contentDir: string): string {
  const prefix = (contentDir.replace(/\/+$/, '') || 'content') + '/'
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}
