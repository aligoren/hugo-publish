// Layer (c): the theme's own defaults (`hugo.toml`, `config/_default/params.*`) and its
// exampleSite config, with descriptions, enums and optional keys read from comments.
import { commentedTomlKeys, commentedYamlKeys, parseComment, type CommentInfo } from './comments'
import { isRecord, lookupCi } from './discovery'

export interface ThemeConfigSource {
  /** Path relative to the theme root. */
  path: string
  role: 'defaults' | 'example'
  /** Where the params table is in this file: ['params'] or [] for params.toml. */
  prefix: string[]
  values: Record<string, unknown>
  /** Comments by dotted path, as returned by `tomlRead` / `readConfigFile`. */
  comments: Record<string, string>
  text: string
  format: 'toml' | 'yaml' | 'json'
}

export interface DefaultEntry {
  key: string
  path: string[]
  /** The value written in the file (a default for role `defaults`, an example otherwise). */
  value?: unknown
  hasValue: boolean
  /** Example value of a commented-out key. */
  example?: unknown
  comment?: CommentInfo
  commentedOut: boolean
  file: string
  role: 'defaults' | 'example'
}

export interface DefaultsLayer {
  /** By lower-cased key. */
  defaults: Map<string, DefaultEntry>
  examples: Map<string, DefaultEntry>
}

/** Prefix for a theme config file: params.* files hold params at the top (unless wrapped). */
export function paramsPrefix(path: string, values: Record<string, unknown>): string[] {
  if (/(^|\/)params(\.[a-z]+)?\.(toml|ya?ml|json)$/i.test(path)) {
    const keys = Object.keys(values)
    if (keys.length === 1 && keys[0].toLowerCase() === 'params' && isRecord(values[keys[0]])) return [keys[0]]
    return []
  }
  const key = Object.keys(values).find((k) => k.toLowerCase() === 'params')
  return [key ?? 'params']
}

function flattenLeaves(value: unknown, path: string[], out: { path: string[]; value: unknown }[]) {
  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return
    for (const [key, child] of entries) flattenLeaves(child, [...path, key], out)
    return
  }
  out.push({ path, value })
}

function startsWithCi(path: string[], prefix: string[]): boolean {
  return prefix.every((p, i) => path[i]?.toLowerCase() === p.toLowerCase())
}

export function buildDefaultsLayer(sources: ThemeConfigSource[]): DefaultsLayer {
  const layer: DefaultsLayer = { defaults: new Map(), examples: new Map() }
  for (const source of sources) {
    const target = source.role === 'defaults' ? layer.defaults : layer.examples
    const params = source.prefix.length === 0 ? source.values : lookupCi(source.values, source.prefix)?.value
    const prefixKey = source.prefix.join('.')
    const leaves: { path: string[]; value: unknown }[] = []
    if (isRecord(params)) flattenLeaves(params, [], leaves)
    for (const leaf of leaves) {
      const key = leaf.path.join('.')
      const lower = key.toLowerCase()
      if (target.has(lower)) continue
      const raw = source.comments[prefixKey ? `${prefixKey}.${key}` : key]
      target.set(lower, {
        key,
        path: leaf.path,
        value: leaf.value,
        hasValue: true,
        ...(raw ? { comment: parseComment(raw) } : {}),
        commentedOut: false,
        file: source.path,
        role: source.role,
      })
    }
    const commented = source.format === 'toml' ? commentedTomlKeys(source.text) : source.format === 'yaml' ? commentedYamlKeys(source.text) : []
    for (const entry of commented) {
      if (!startsWithCi(entry.path, source.prefix)) continue
      const path = entry.path.slice(source.prefix.length)
      if (path.length === 0) continue
      const key = path.join('.')
      const lower = key.toLowerCase()
      const existing = target.get(lower)
      if (existing && !existing.commentedOut) {
        if (existing.example === undefined && entry.value !== undefined) existing.example = entry.value
        continue
      }
      if (existing) continue
      target.set(lower, {
        key,
        path,
        hasValue: false,
        ...(entry.value === undefined ? {} : { example: entry.value }),
        ...(entry.comment ? { comment: parseComment(entry.comment) } : {}),
        commentedOut: true,
        file: source.path,
        role: source.role,
      })
    }
  }
  return layer
}
