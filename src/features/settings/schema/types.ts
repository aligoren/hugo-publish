// The shape of the settings catalog: which keys the form shows and how.

export type Level = 'basic' | 'advanced'

export type GroupId =
  | 'identity'
  | 'urls'
  | 'content'
  | 'taxonomies'
  | 'markdown'
  | 'highlight'
  | 'toc'
  | 'seo'
  | 'outputs'
  | 'pagination'
  | 'images'
  | 'privacy'
  | 'services'
  | 'languages'
  | 'build'
  | 'server'
  | 'security'
  | 'caches'

export interface GroupDef {
  id: GroupId
  /** Shown with a red warning frame. */
  danger?: boolean
}

/** What a value is, used to check defaults and to write the right TOML/YAML type. */
export type ValueType =
  | 'boolean'
  | 'string'
  | 'integer'
  | 'number'
  /** A bool or one of a few strings (`markup.highlight.lineNos`). */
  | 'boolOrString'
  /** Go duration (`60s`) or a number of seconds. */
  | 'duration'
  | 'stringList'
  /** A string or a list of strings (`theme`, `mainSections`). */
  | 'stringOrList'
  /** Pairs of strings (`[['$$', '$$']]`). */
  | 'pairList'
  /** String keys to string values (`taxonomies`). */
  | 'stringMap'
  /** An array of tables (`related.indices`, `server.redirects`). */
  | 'objectList'
  /** Named tables (`outputFormats.<name>`). */
  | 'objectMap'
  /** Shown, not edited. */
  | 'any'

/** Where a select or list takes its suggestions from. */
export type OptionSource = 'outputFormats' | 'sections' | 'languages' | 'menus' | 'locales' | 'timeZones'

export type ColumnType = 'text' | 'number' | 'toggle' | 'select' | 'list' | 'map'

export interface Column {
  key: string
  type: ColumnType
  options?: readonly string[]
}

export type Control =
  | { kind: 'toggle' }
  | { kind: 'select'; options: readonly (string | boolean)[] }
  | { kind: 'text'; suggestions?: OptionSource | readonly string[]; monospace?: boolean; placeholder?: string }
  | { kind: 'url'; trailingSlash?: boolean }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | { kind: 'duration' }
  | { kind: 'color' }
  /** Ordered strings as removable chips. */
  | { kind: 'list'; suggestions?: OptionSource | readonly string[] }
  /** Checkboxes; `ordered` keeps the chosen order (first = primary output format). */
  | { kind: 'multi'; options: OptionSource | readonly string[]; ordered?: boolean }
  /** One string per line (regexes, globs). */
  | { kind: 'lines' }
  | { kind: 'pairs' }
  | { kind: 'kv'; keyPlaceholder?: string; valuePlaceholder?: string }
  /** `objectList` rows or `objectMap` entries (named by `keyColumn`). */
  | { kind: 'table'; columns: readonly Column[]; keyColumn?: string }
  | { kind: 'readonly' }

export interface SettingDef {
  /**
   * Documented key casing. `*` stands for a language key (`languages.*.label`).
   * Messages live under `settings.keys.<path joined with />`.
   */
  path: readonly string[]
  group: GroupId
  type: ValueType
  control: Control
  /** Hugo's default; `undefined` when unset means "not configured". */
  default?: unknown
  level: Level
  docs: string
  /** Changing it needs an explicit confirmation (security impact or deletes files). */
  requiresConfirm?: boolean
  deprecated?: { since: string; replacement?: string }
  /** Hugo version that added the key, e.g. `0.167.0`. */
  since?: string
}
