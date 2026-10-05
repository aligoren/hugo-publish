// Deprecated and silently ignored config keys (catalog §4), with one-click fixes as ops.
import type { ConfigOp, HugoMessage, HugoVersion, KeyPath } from '../../../lib/api'
import { globalTree, toFilePath, type LoadedSource } from './sources'
import { findKey, isPlainObject, lookup, subtreeOps, writePath, type Tree } from './values'

export type Severity = 'info' | 'warn' | 'error'
/** `ignored`: Hugo drops the key without any message, so the setting silently has no effect. */
export type Status = Severity | 'ignored'

export interface Version {
  major: number
  minor: number
  patch: number
}

/** The Hugo version the catalog was written for; used when Hugo is not installed. */
export const CATALOG_VERSION: Version = { major: 0, minor: 167, patch: 0 }

export function parseVersion(text: string): Version {
  const [major = 0, minor = 0, patch = 0] = text.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  return { major, minor, patch }
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/**
 * Hugo's deprecation rule (common/hugo/hugo.go): INFO for the first 3 minor releases after the
 * deprecation, WARN until 15 minor releases, then ERROR (the build fails).
 */
export function deprecationSeverity(deprecatedIn: Version, current: Version): Severity {
  const minors = current.major !== deprecatedIn.major ? Number.POSITIVE_INFINITY : current.minor - deprecatedIn.minor
  if (minors < 3) return 'info'
  if (minors < 15) return 'warn'
  return 'error'
}

type Change = { set: KeyPath; value: unknown } | { remove: KeyPath }

interface Match {
  /** Old key, global path with the file's casing. */
  old: KeyPath
  value: unknown
  /** New key(s), for display. */
  replacement: string
  changes: Change[]
}

export interface MigrationRule {
  id: string
  deprecatedIn: string
  /** Since this version Hugo ignores the key without a message. */
  ignoredSince?: string
  /** Hugo no longer reports it, though the old form still works. */
  quiet?: boolean
  /** Hugo maps the old value and logs at this level, whatever its age. */
  level?: Severity
  find(tree: Tree): Match[]
}

export interface Finding {
  rule: MigrationRule
  source: LoadedSource
  status: Status
  /** WARN today, ERROR from the next minor release. */
  errorNextRelease: boolean
  /** Dotted old key as written in the merged config (`languages.tr.languageName`). */
  oldKey: string
  replacement: string
  value: unknown
  /** Fix for this file: set the new key(s), remove the old one. */
  ops: ConfigOp[]
}

// ---- Helpers building matches -----------------------------------------------------------------

function at(tree: unknown, path: KeyPath) {
  return lookup(tree, path)
}

/** `old` → `next` inside the table at `base`; keeps an already set `next`. */
function rename(tree: Tree, base: KeyPath, old: string, next: string, convert: (v: unknown) => unknown = (v) => v): Match[] {
  const table = base.length === 0 ? { value: tree, actual: [] as KeyPath } : at(tree, base)
  if (!table || !isPlainObject(table.value)) return []
  const oldKey = findKey(table.value, old)
  if (oldKey === undefined) return []
  const value = table.value[oldKey]
  const oldPath = [...table.actual, oldKey]
  const changes: Change[] = []
  if (findKey(table.value, next) === undefined) changes.push({ set: [...table.actual, next], value: convert(value) })
  changes.push({ remove: oldPath })
  return [{ old: oldPath, value, replacement: [...base, next].join('.'), changes }]
}

/** Moves a value to a new path (`paginate` → `pagination.pagerSize`). */
function move(tree: Tree, from: KeyPath, to: KeyPath[], convert: (v: unknown) => unknown = (v) => v): Match[] {
  const found = at(tree, from)
  if (!found) return []
  const changes: Change[] = []
  for (const target of to) if (!at(tree, target)) changes.push({ set: target, value: convert(found.value) })
  changes.push({ remove: found.actual })
  return [{ old: found.actual, value: found.value, replacement: to.map((p) => p.join('.')).join(' + '), changes }]
}

function remove(tree: Tree, path: KeyPath, replacement = '—'): Match[] {
  const found = at(tree, path)
  return found ? [{ old: found.actual, value: found.value, replacement, changes: [{ remove: found.actual }] }] : []
}

/** Calls `fn` for the root and every `languages.<lang>` table. */
function perLanguage(tree: Tree, fn: (base: KeyPath) => Match[]): Match[] {
  const out = fn([])
  const languages = at(tree, ['languages'])
  if (languages && isPlainObject(languages.value)) {
    for (const lang of Object.keys(languages.value)) out.push(...fn([...languages.actual, lang]))
  }
  return out
}

function languagesOnly(tree: Tree, fn: (base: KeyPath) => Match[]): Match[] {
  const languages = at(tree, ['languages'])
  if (!languages || !isPlainObject(languages.value)) return []
  return Object.keys(languages.value).flatMap((lang) => fn([...languages.actual, lang]))
}

/** Every string under `path` (maps and arrays), with its path. */
function strings(value: unknown, path: KeyPath): { path: KeyPath; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }]
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, [...path, i]))
  if (isPlainObject(value)) return Object.entries(value).flatMap(([k, v]) => strings(v, [...path, k]))
  return []
}

const PERMALINK_TOKENS: [RegExp, string][] = [
  [/:slugorfilename\b/g, ':slugorcontentbasename'],
  [/:filename\b/g, ':contentbasename'],
]

// ---- Rules ------------------------------------------------------------------------------------

export const MIGRATION_RULES: readonly MigrationRule[] = [
  {
    id: 'languageCode',
    deprecatedIn: '0.158.0',
    find: (tree) => perLanguage(tree, (base) => rename(tree, base, 'languageCode', 'locale')),
  },
  {
    id: 'languageName',
    deprecatedIn: '0.158.0',
    find: (tree) => languagesOnly(tree, (base) => rename(tree, base, 'languageName', 'label')),
  },
  {
    id: 'languageDirection',
    deprecatedIn: '0.158.0',
    find: (tree) => languagesOnly(tree, (base) => rename(tree, base, 'languageDirection', 'direction')),
  },
  {
    id: 'paginate',
    deprecatedIn: '0.128.0',
    ignoredSince: '0.156.0',
    find: (tree) => perLanguage(tree, (base) => move(tree, [...base, 'paginate'], [[...base, 'pagination', 'pagerSize']])),
  },
  {
    id: 'paginatePath',
    deprecatedIn: '0.128.0',
    ignoredSince: '0.156.0',
    find: (tree) => perLanguage(tree, (base) => move(tree, [...base, 'paginatePath'], [[...base, 'pagination', 'path']])),
  },
  {
    id: 'privacyTwitter',
    deprecatedIn: '0.141.0',
    ignoredSince: '0.165.0',
    find: (tree) => moveTable(tree, ['privacy', 'twitter'], ['privacy', 'x']),
  },
  {
    id: 'servicesTwitter',
    deprecatedIn: '0.141.0',
    ignoredSince: '0.165.0',
    find: (tree) => moveTable(tree, ['services', 'twitter'], ['services', 'x']),
  },
  {
    id: 'renderHooksEnableDefault',
    deprecatedIn: '0.148.0',
    find: (tree) =>
      ['image', 'link'].flatMap((hook) =>
        rename(tree, ['markup', 'goldmark', 'renderHooks', hook], 'enableDefault', 'useEmbedded', (v) => (v === true ? 'fallback' : 'never')),
      ),
  },
  {
    id: 'imagingQuality',
    deprecatedIn: '0.163.0',
    find: (tree) =>
      move(tree, ['imaging', 'quality'], [
        ['imaging', 'jpeg', 'quality'],
        ['imaging', 'webp', 'quality'],
      ]),
  },
  {
    id: 'imagingCompression',
    deprecatedIn: '0.163.0',
    find: (tree) =>
      move(tree, ['imaging', 'compression'], [
        ['imaging', 'webp', 'compression'],
        ['imaging', 'avif', 'compression'],
      ]),
  },
  {
    id: 'imagingHint',
    deprecatedIn: '0.163.0',
    find: (tree) =>
      move(tree, ['imaging', 'hint'], [
        ['imaging', 'webp', 'hint'],
        ['imaging', 'avif', 'hint'],
      ]),
  },
  {
    id: 'cleanDestinationDir',
    deprecatedIn: '0.167.0',
    find: (tree) => move(tree, ['cleanDestinationDir'], [['build', 'cleanDestinationDir', 'enable']]),
  },
  {
    id: 'author',
    deprecatedIn: '0.156.0',
    ignoredSince: '0.156.0',
    find: (tree) => moveTable(tree, ['author'], ['params', 'author']),
  },
  {
    id: 'social',
    deprecatedIn: '0.156.0',
    ignoredSince: '0.156.0',
    find: (tree) => moveTable(tree, ['social'], ['params', 'social']),
  },
  {
    id: 'taxonomyTerm',
    deprecatedIn: '0.73.0',
    level: 'warn',
    find: (tree) => [
      ...perLanguage(tree, (base) => replaceInList(tree, [...base, 'disableKinds'], 'taxonomyTerm', 'taxonomy')),
      ...rename(tree, ['outputs'], 'taxonomyTerm', 'taxonomy'),
    ],
  },
  {
    id: 'permalinkFilename',
    deprecatedIn: '0.144.0',
    quiet: true,
    find: (tree) =>
      perLanguage(tree, (base) => {
        const found = at(tree, [...base, 'permalinks'])
        if (!found) return []
        return strings(found.value, found.actual).flatMap(({ path, text }) => {
          const next = PERMALINK_TOKENS.reduce((s, [re, to]) => s.replace(re, to), text)
          return next === text ? [] : [{ old: path, value: text, replacement: next, changes: [{ set: path, value: next }] }]
        })
      }),
  },
  {
    id: 'highlightNoHl',
    deprecatedIn: '0.141.0',
    ignoredSince: '0.141.0',
    find: (tree) => remove(tree, ['markup', 'highlight', 'noHl']),
  },
  {
    id: 'minifyLegacy',
    deprecatedIn: '0.150.0',
    find: (tree) => [
      ...rename(tree, ['minify', 'tdewolff', 'css'], 'decimals', 'precision'),
      ...rename(tree, ['minify', 'tdewolff', 'svg'], 'decimals', 'precision'),
      ...rename(tree, ['minify', 'tdewolff', 'html'], 'keepConditionalComments', 'keepSpecialComments'),
      ...keepCss2(tree),
    ],
  },
  {
    id: 'removedCaches',
    deprecatedIn: '0.156.0',
    ignoredSince: '0.156.0',
    find: (tree) => [...remove(tree, ['caches', 'getjson'], 'caches.getresource'), ...remove(tree, ['caches', 'getcsv'], 'caches.getresource')],
  },
  {
    id: 'writeStats',
    deprecatedIn: '0.115.0',
    level: 'warn',
    find: (tree) => move(tree, ['build', 'writeStats'], [['build', 'buildStats', 'enable']]),
  },
  {
    id: 'hugoVersionExtended',
    deprecatedIn: '0.153.0',
    find: (tree) => remove(tree, ['module', 'hugoVersion', 'extended']),
  },
  {
    id: 'mountLang',
    deprecatedIn: '0.153.0',
    find: (tree) => mounts(tree),
  },
  {
    id: 'cascadeTarget',
    deprecatedIn: '0.156.0',
    find: (tree) => {
      const cascade = at(tree, ['cascade'])
      if (!cascade) return []
      if (Array.isArray(cascade.value)) return cascade.value.flatMap((_, i) => rename(tree, [...cascade.actual, i], '_target', 'target'))
      return rename(tree, cascade.actual, '_target', 'target')
    },
  },
]

/** Moves a whole table (`privacy.twitter` → `privacy.x`), key by key, keeping set new keys. */
function moveTable(tree: Tree, from: KeyPath, to: KeyPath): Match[] {
  const found = at(tree, from)
  if (!found) return []
  const existing = at(tree, to)
  const changes: Change[] = []
  if (isPlainObject(found.value)) {
    for (const [k, v] of Object.entries(found.value)) {
      if (!existing || !isPlainObject(existing.value) || findKey(existing.value, k) === undefined) changes.push({ set: [...to, k], value: v })
    }
  } else if (!existing) {
    changes.push({ set: to, value: found.value })
  }
  changes.push({ remove: found.actual })
  return [{ old: found.actual, value: found.value, replacement: to.join('.'), changes }]
}

function replaceInList(tree: Tree, path: KeyPath, old: string, next: string): Match[] {
  const found = at(tree, path)
  if (!found || !Array.isArray(found.value)) return []
  const list = found.value as unknown[]
  if (!list.some((v) => typeof v === 'string' && v.toLowerCase() === old.toLowerCase())) return []
  const replaced = list.map((v) => (typeof v === 'string' && v.toLowerCase() === old.toLowerCase() ? next : v))
  const unique = replaced.filter((v, i) => replaced.findIndex((w) => String(w).toLowerCase() === String(v).toLowerCase()) === i)
  return [{ old: found.actual, value: list, replacement: `${path.join('.')} = ${JSON.stringify(unique)}`, changes: [{ set: found.actual, value: unique }] }]
}

function keepCss2(tree: Tree): Match[] {
  const found = at(tree, ['minify', 'tdewolff', 'css', 'keepCSS2'])
  if (!found) return []
  const css = found.actual.slice(0, -1)
  const changes: Change[] = []
  if (found.value === true && !at(tree, [...css, 'version'])) changes.push({ set: [...css, 'version'], value: 2 })
  changes.push({ remove: found.actual })
  return [{ old: found.actual, value: found.value, replacement: 'minify.tdewolff.css.version', changes }]
}

/** `module.mounts[].lang` → `sites.matrix.languages`, `includeFiles`/`excludeFiles` → `files`. */
function mounts(tree: Tree): Match[] {
  const found = at(tree, ['module', 'mounts'])
  if (!found || !Array.isArray(found.value)) return []
  const out: Match[] = []
  found.value.forEach((mount, i) => {
    if (!isPlainObject(mount)) return
    const base = [...found.actual, i]
    const lang = findKey(mount, 'lang')
    if (lang !== undefined) {
      out.push({
        old: [...base, lang],
        value: mount[lang],
        replacement: 'sites.matrix.languages',
        changes: [
          { set: [...base, 'sites', 'matrix', 'languages'], value: [mount[lang]].flat() },
          { remove: [...base, lang] },
        ],
      })
    }
    const include = findKey(mount, 'includeFiles')
    const exclude = findKey(mount, 'excludeFiles')
    if (include !== undefined || exclude !== undefined) {
      const files = [
        ...[include === undefined ? [] : mount[include]].flat().map(String),
        ...[exclude === undefined ? [] : mount[exclude]].flat().map((g) => `! ${String(g)}`),
      ]
      const old = [...base, (include ?? exclude)!]
      const changes: Change[] = [{ set: [...base, 'files'], value: files }]
      if (include !== undefined) changes.push({ remove: [...base, include] })
      if (exclude !== undefined) changes.push({ remove: [...base, exclude] })
      out.push({ old, value: files, replacement: 'files', changes })
    }
  })
  return out
}

// ---- Findings ---------------------------------------------------------------------------------

export function ruleStatus(rule: MigrationRule, current: Version): Status {
  if (rule.ignoredSince && compareVersions(current, parseVersion(rule.ignoredSince)) >= 0) return 'ignored'
  if (rule.level) return rule.level
  if (rule.quiet) return 'info'
  return deprecationSeverity(parseVersion(rule.deprecatedIn), current)
}

export function toVersion(hugo: HugoVersion | null | undefined): Version {
  return hugo ? { major: hugo.major, minor: hugo.minor, patch: hugo.patch } : CATALOG_VERSION
}

/** Deprecated keys in every config file (all environments), with a fix per finding. */
export function findMigrations(sources: readonly LoadedSource[], current: Version): Finding[] {
  const findings: Finding[] = []
  for (const source of sources) {
    if (!source.active || source.error !== null) continue
    const tree = globalTree(source)
    for (const rule of MIGRATION_RULES) {
      // The replacement does not exist in older Hugo versions.
      if (compareVersions(current, parseVersion(rule.deprecatedIn)) < 0) continue
      const status = ruleStatus(rule, current)
      const next = { ...current, minor: current.minor + 1 }
      for (const match of rule.find(tree)) {
        findings.push({
          rule,
          source,
          status,
          errorNextRelease: status === 'warn' && !rule.level && deprecationSeverity(parseVersion(rule.deprecatedIn), next) === 'error',
          oldKey: match.old.map(String).join('.'),
          replacement: match.replacement,
          value: match.value,
          ops: source.editable ? fixOps(source, tree, match.changes) : [],
        })
      }
    }
  }
  return findings
}

function fixOps(source: LoadedSource, tree: Tree, changes: Change[]): ConfigOp[] {
  const ops: ConfigOp[] = []
  for (const change of changes) {
    if ('remove' in change) {
      const path = toFilePath(source, change.remove)
      if (path && path.length > 0) ops.push({ op: 'remove', path })
      continue
    }
    const path = toFilePath(source, writePath(tree, change.set))
    if (!path || path.length === 0) continue
    const before = lookup(tree, change.set)?.value
    ops.push(...subtreeOps(path, before, change.value))
  }
  return ops
}

/** All fixes grouped by file, in finding order. */
export function fixOpsByFile(findings: readonly Finding[]): Record<string, ConfigOp[]> {
  const out: Record<string, ConfigOp[]> = {}
  for (const f of findings) if (f.ops.length > 0) out[f.source.path] = [...(out[f.source.path] ?? []), ...f.ops]
  return out
}

/** Hugo's own WARN/ERROR lines while loading the config. */
export function hugoProblems(messages: readonly HugoMessage[]): HugoMessage[] {
  return messages.filter((m) => m.level === 'warn' || m.level === 'error')
}

const ORDER: Record<Status, number> = { ignored: 0, error: 1, warn: 2, info: 3 }

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => ORDER[a.status] - ORDER[b.status] || Number(b.errorNextRelease) - Number(a.errorNextRelease))
}
