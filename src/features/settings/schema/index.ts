import { SETTINGS } from './keys'
import type { GroupDef, GroupId, SettingDef } from './types'

export { SETTINGS } from './keys'
export { CHROMA_STYLES, CHROMA_STYLE_NAMES } from './chroma'
export * from './types'

export const GROUPS: readonly GroupDef[] = [
  { id: 'identity' },
  { id: 'urls' },
  { id: 'content' },
  { id: 'taxonomies' },
  { id: 'markdown' },
  { id: 'highlight' },
  { id: 'toc' },
  { id: 'seo' },
  { id: 'outputs' },
  { id: 'pagination' },
  { id: 'images' },
  { id: 'privacy' },
  { id: 'services' },
  { id: 'languages' },
  { id: 'build' },
  { id: 'server' },
  { id: 'security', danger: true },
  { id: 'caches' },
]

/** Language placeholder in `languages.*.label`. */
export const ANY_LANGUAGE = '*'

/** Message id of a key: `settings.keys.<id>.label` / `.help`. Dots would nest in i18next. */
export function messageId(path: readonly string[]): string {
  return path.join('/')
}

/** Keys rendered once per language (`languages.*.x`). */
export function isLanguageTemplate(setting: SettingDef): boolean {
  return setting.path.includes(ANY_LANGUAGE)
}

/** The concrete path of a key, with `*` replaced by a language key. */
export function concretePath(setting: SettingDef, language?: string): string[] {
  return setting.path.map((k) => (k === ANY_LANGUAGE ? (language ?? k) : k))
}

export function settingsOfGroup(group: GroupId): SettingDef[] {
  return SETTINGS.filter((s) => s.group === group)
}

export function findSetting(path: readonly string[]): SettingDef | undefined {
  const wanted = path.join('.').toLowerCase()
  return SETTINGS.find((s) => s.path.join('.').toLowerCase() === wanted)
}
