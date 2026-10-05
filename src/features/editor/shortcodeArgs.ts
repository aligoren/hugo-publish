// Parsing the parameters of one shortcode tag and changing them with minimal
// edits: a changed value replaces only that value, a removed parameter takes
// only itself and the space before it, a new one is appended after the last.
// The rest of the tag (spacing, line breaks, quote style) stays as written.

import type { ShortcodeDef, ShortcodeParam } from './contract'

export interface ShortcodeArg {
  /** Parameter name for `name=value`; null for a positional value. */
  name: string | null
  /** The value without quotes; `\"` unescaped in `"…"` values. */
  value: string
  quote: '"' | '`' | null
  /** The whole argument (`name="value"` or `value`), as offsets into the parsed text. */
  from: number
  to: number
  /** The value as written, quotes included. */
  valueFrom: number
  valueTo: number
}

export type ArgStyle = 'positional' | 'named'

export interface ParsedShortcodeTag {
  name: string
  delimiter: '<' | '%'
  kind: 'opening' | 'closing' | 'selfClosing'
  nameFrom: number
  nameTo: number
  args: ShortcodeArg[]
  /** `none` without arguments; `mixed` is invalid in Hugo (it rejects mixing). */
  style: ArgStyle | 'none' | 'mixed'
  /** End of the last argument, or of the name: where new arguments go. */
  argsEnd: number
}

const NAME = /[A-Za-z0-9_][\w.\-/]*/y
const isSpace = (ch: string | undefined) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'

/** Index of the closing `"` for a quoted value starting at `from` (after the opening quote), or -1. */
function closingQuote(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '"') return i
  }
  return -1
}

/**
 * Parses a shortcode tag (`{{< name args >}}`, `{{% … %}}`, closing or
 * self-closing). Offsets are relative to `text` plus `offset`. Null when the
 * text is not a complete tag.
 */
export function parseShortcodeTag(text: string, offset = 0): ParsedShortcodeTag | null {
  const match = /^\{\{([<%])/.exec(text)
  if (!match) return null
  const delimiter = match[1] as '<' | '%'
  const right = delimiter === '<' ? '>}}' : '%}}'
  if (!text.endsWith(right) || text.length < 3 + right.length) return null
  const end = text.length - right.length
  let pos = 3
  while (pos < end && isSpace(text[pos])) pos++
  let kind: ParsedShortcodeTag['kind'] = 'opening'
  if (text[pos] === '/') {
    kind = 'closing'
    pos++
    while (pos < end && isSpace(text[pos])) pos++
  }
  NAME.lastIndex = pos
  const nameMatch = NAME.exec(text)
  if (!nameMatch) return null
  const name = nameMatch[0].replace(/\/+$/, '')
  const nameFrom = pos
  const nameTo = pos + name.length
  pos = nameTo

  const args: ShortcodeArg[] = []
  /** Self-closing marker: `/` then only spaces up to the right delimiter. */
  const selfCloseAt = (i: number) => text[i] === '/' && text.slice(i + 1, end).trim() === ''
  /** Reads a value at `i`: quoted, raw or bare. */
  const readValue = (i: number): { value: string; quote: ShortcodeArg['quote']; to: number } | null => {
    if (text[i] === '"') {
      const close = closingQuote(text, i + 1)
      if (close === -1 || close >= end) return null
      return { value: text.slice(i + 1, close).replace(/\\"/g, '"'), quote: '"', to: close + 1 }
    }
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1)
      if (close === -1 || close >= end) return null
      return { value: text.slice(i + 1, close), quote: '`', to: close + 1 }
    }
    let j = i
    while (j < end && !isSpace(text[j]) && text[j] !== '=' && !selfCloseAt(j)) j++
    return { value: text.slice(i, j), quote: null, to: j }
  }

  for (;;) {
    while (pos < end && isSpace(text[pos])) pos++
    if (pos >= end) break
    if (selfCloseAt(pos)) {
      if (kind === 'opening') kind = 'selfClosing'
      break
    }
    const start = pos
    const first = readValue(pos)
    if (!first || first.to === pos) return null
    pos = first.to
    // `name = value`?
    let look = pos
    while (look < end && isSpace(text[look])) look++
    if (first.quote === null && text[look] === '=') {
      look++
      while (look < end && isSpace(text[look])) look++
      const value = readValue(look)
      if (!value) return null
      args.push({ name: first.value, value: value.value, quote: value.quote, from: start + offset, to: value.to + offset, valueFrom: look + offset, valueTo: value.to + offset })
      pos = value.to
    } else {
      args.push({ name: null, value: first.value, quote: first.quote, from: start + offset, to: first.to + offset, valueFrom: start + offset, valueTo: first.to + offset })
    }
  }

  const named = args.filter((a) => a.name !== null).length
  const style: ParsedShortcodeTag['style'] =
    args.length === 0 ? 'none' : named === 0 ? 'positional' : named === args.length ? 'named' : 'mixed'
  return {
    name,
    delimiter,
    kind,
    nameFrom: nameFrom + offset,
    nameTo: nameTo + offset,
    args,
    style,
    argsEnd: (args.length > 0 ? args[args.length - 1].to - offset : nameTo) + offset,
  }
}

// ---------------------------------------------------------------------------
// Values

const BARE = /^[\w.\-+:]+$/
const NUMBER = /^-?\d+(?:\.\d+)?$/

/**
 * Writes a value as Hugo reads it. Booleans and numbers of a typed parameter
 * are bare (`autoplay=true`). Otherwise `previous` decides: the quote style
 * the value had (`null` = bare, kept when the value is a simple word), or
 * `'none'` for a new value, which gets double quotes.
 */
export function formatShortcodeValue(value: string, type?: ShortcodeParam['type'], previous?: ShortcodeArg['quote'] | 'none'): string {
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value
  if (type === 'number' && NUMBER.test(value)) return value
  if (previous === null && BARE.test(value)) return value
  if (previous === '`' && !value.includes('`')) return '`' + value + '`'
  return '"' + value.replace(/"/g, '\\"') + '"'
}

/** The parameters to write: positional values by index, or named values in order. `''` means "not given". */
export type ShortcodeValues = { style: 'positional'; values: string[] } | { style: 'named'; values: [string, string][] }

export interface ArgEdit {
  from: number
  to: number
  insert: string
}

function paramType(def: ShortcodeDef | null, name: string | null, index: number): ShortcodeParam['type'] {
  if (!def) return undefined
  const param = name !== null ? def.params.find((p) => p.name === name && !p.positionalOnly) : def.params.find((p) => p.positional === index)
  return param?.type
}

/** Separator before a new argument: a line break with the last argument's indentation when arguments are on their own lines. */
function argSeparator(text: string, tag: ParsedShortcodeTag, offset: number): string {
  const last = tag.args[tag.args.length - 1]
  if (!last) return ' '
  const before = tag.args.length > 1 ? tag.args[tag.args.length - 2].to : tag.nameTo
  const gap = text.slice(before - offset, last.from - offset)
  const newline = gap.lastIndexOf('\n')
  return newline === -1 ? ' ' : '\n' + gap.slice(newline + 1)
}

/**
 * Minimal edits that turn the tag's arguments into `target`. `text` is the
 * tag's text and `offset` its position (as given to {@link parseShortcodeTag}).
 * Edit positions are absolute; inserted text uses `\n` line breaks.
 */
export function shortcodeArgEdits(
  text: string,
  tag: ParsedShortcodeTag,
  target: ShortcodeValues,
  def: ShortcodeDef | null = null,
  offset = 0,
): ArgEdit[] {
  const edits: ArgEdit[] = []
  const sameStyle = tag.style === 'none' || tag.style === target.style
  if (!sameStyle) {
    // Switching between positional and named (or fixing a mixed tag): rewrite the arguments.
    const parts =
      target.style === 'positional'
        ? trimTrailing(target.values).map((v, i) => formatShortcodeValue(v, paramType(def, null, i), null))
        : target.values.filter(([, v]) => v !== '').map(([n, v]) => `${n}=${formatShortcodeValue(v, paramType(def, n, -1))}`)
    const insert = parts.map((part) => ' ' + part).join('')
    return [{ from: tag.nameTo, to: tag.argsEnd, insert }]
  }

  const gapStart = (i: number) => (i > 0 ? tag.args[i - 1].to : tag.nameTo)
  const separator = argSeparator(text, tag, offset)
  let appendAt = tag.argsEnd
  const appended: string[] = []

  if (target.style === 'positional') {
    const values = target.values
    const keep = trimTrailing(values).length
    tag.args.forEach((arg, i) => {
      if (i >= keep) {
        edits.push({ from: gapStart(i), to: arg.to, insert: '' })
        return
      }
      const value = values[i] ?? ''
      if (value === arg.value) return
      edits.push({ from: arg.valueFrom, to: arg.valueTo, insert: formatShortcodeValue(value, paramType(def, null, i), value === '' ? 'none' : arg.quote) })
    })
    // When every existing argument is removed, new ones (none) need no anchor.
    if (keep < tag.args.length) appendAt = keep > 0 ? tag.args[keep - 1].to : tag.nameTo
    for (let i = tag.args.length; i < keep; i++) appended.push(formatShortcodeValue(values[i] ?? '', paramType(def, null, i), null))
  } else {
    const wanted = new Map(target.values)
    const seen = new Set<string>()
    tag.args.forEach((arg, i) => {
      const name = arg.name as string
      if (seen.has(name) || !wanted.has(name)) {
        seen.add(name)
        return // duplicates and parameters the target does not mention stay as written
      }
      seen.add(name)
      const value = wanted.get(name) as string
      if (value === '') edits.push({ from: gapStart(i), to: arg.to, insert: '' })
      else if (value !== arg.value) {
        edits.push({ from: arg.valueFrom, to: arg.valueTo, insert: formatShortcodeValue(value, paramType(def, name, -1), arg.quote) })
      }
    })
    for (const [name, value] of target.values) {
      if (!seen.has(name) && value !== '') appended.push(`${name}=${formatShortcodeValue(value, paramType(def, name, -1))}`)
    }
  }
  if (appended.length > 0) {
    const sep = tag.args.length > 0 ? separator : ' '
    edits.push({ from: appendAt, to: appendAt, insert: appended.map((a) => sep + a).join('') })
  }
  return edits.sort((a, b) => a.from - b.from || a.to - b.to)
}

/** Drops trailing empty values (positional arguments cannot be skipped at the end). */
function trimTrailing(values: readonly string[]): string[] {
  let n = values.length
  while (n > 0 && values[n - 1] === '') n--
  return values.slice(0, n)
}

// ---------------------------------------------------------------------------
// Form values

export interface ShortcodeFieldValue {
  /** The definition's parameter, or null for an argument the definition does not list. */
  param: ShortcodeParam | null
  /** Named key, or `null` for an unlisted positional argument. */
  name: string | null
  /** Position for positional values. */
  index: number | null
  value: string
}

/** Current values of a tag for the parameter form: one entry per defined parameter, then unlisted arguments. */
export function shortcodeFieldValues(tag: ParsedShortcodeTag, def: ShortcodeDef | null): ShortcodeFieldValue[] {
  const fields: ShortcodeFieldValue[] = []
  const used = new Set<ShortcodeArg>()
  const positional = tag.args.filter((a) => a.name === null)
  for (const param of def?.params ?? []) {
    let arg: ShortcodeArg | undefined
    if (!param.positionalOnly) arg = tag.args.find((a) => a.name === param.name && !used.has(a))
    if (!arg && param.positional !== undefined) arg = positional[param.positional]
    if (arg) used.add(arg)
    fields.push({ param, name: param.positionalOnly ? null : param.name, index: param.positional ?? null, value: arg?.value ?? '' })
  }
  positional.forEach((arg, index) => {
    if (!used.has(arg)) fields.push({ param: null, name: null, index, value: arg.value })
  })
  for (const arg of tag.args) {
    if (arg.name !== null && !used.has(arg) && !fields.some((f) => f.param === null && f.name === arg.name)) {
      fields.push({ param: null, name: arg.name, index: null, value: arg.value })
    }
  }
  return fields
}

export interface ResolvedValues {
  values: ShortcodeValues | null
  /** Why the values cannot be written. */
  error: 'mixed' | null
}

/**
 * Decides how to write form values: named or positional. Positional-only
 * values force positional style, named-only values force named style (both:
 * an error). Otherwise the tag's current style is kept; a tag without
 * arguments gets positional style only when the definition has positional
 * parameters and no named-only ones.
 */
export function resolveShortcodeValues(fields: readonly ShortcodeFieldValue[], tag: ParsedShortcodeTag, def: ShortcodeDef | null): ResolvedValues {
  const filled = fields.filter((f) => f.value !== '')
  const needsPositional = filled.some((f) => f.name === null)
  const needsNamed = filled.some((f) => f.index === null)
  if (needsPositional && needsNamed) return { values: null, error: 'mixed' }
  let style: ArgStyle
  if (needsPositional) style = 'positional'
  else if (needsNamed) style = 'named'
  else if (tag.style === 'positional' || tag.style === 'named') style = tag.style
  else {
    const params = def?.params ?? []
    const hasPositional = params.some((p) => p.positional !== undefined)
    const namedOnly = params.some((p) => p.positional === undefined)
    style = hasPositional && !namedOnly ? 'positional' : 'named'
  }
  if (style === 'positional') {
    const values: string[] = []
    for (const field of fields) if (field.index !== null) values[field.index] = field.value
    for (let i = 0; i < values.length; i++) values[i] ??= ''
    return { values: { style, values }, error: null }
  }
  const values: [string, string][] = []
  for (const field of fields) if (field.name !== null) values.push([field.name, field.value])
  return { values: { style, values }, error: null }
}

// ---------------------------------------------------------------------------
// Skeletons

export interface ShortcodeSkeleton {
  /** Lines to insert (joined with the document's line separator). */
  lines: string[]
  /** Cursor position: line index and column. */
  cursorLine: number
  cursorColumn: number
}

/**
 * A new tag for a definition: required parameters as empty values (cursor in
 * the first), and for paired shortcodes an empty line and the closing tag.
 */
export function shortcodeSkeleton(def: ShortcodeDef, delimiter: '<' | '%' = '<'): ShortcodeSkeleton {
  const right = delimiter === '<' ? '>}}' : '%}}'
  const required = def.params.filter((p) => p.required)
  const positional = required.length > 0 && required.every((p) => p.positional !== undefined)
  let head = `{{${delimiter} ${def.name}`
  let cursor = -1
  const ordered = positional ? [...required].sort((a, b) => (a.positional ?? 0) - (b.positional ?? 0)) : required
  for (const param of ordered) {
    head += ' '
    if (!positional) head += `${param.name}=`
    head += '"'
    if (cursor === -1) cursor = head.length
    head += '"'
  }
  head += ` ${right}`
  if (!def.paired) return { lines: [head], cursorLine: 0, cursorColumn: cursor === -1 ? head.length : cursor }
  const close = `{{${delimiter} /${def.name} ${right}`
  return cursor === -1 ? { lines: [head, '', close], cursorLine: 1, cursorColumn: 0 } : { lines: [head, '', close], cursorLine: 0, cursorColumn: cursor }
}
