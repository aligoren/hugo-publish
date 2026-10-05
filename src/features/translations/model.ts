// How Hugo assigns content files to languages, and grouping files into translations.
// A file's language comes from its name (`post.en.md`), else from the content folder of a
// language (`languages.en.contentDir`), else it is the default language. Translations are linked
// by `translationKey` in front matter, else by having the same path within their content folder.

export interface LanguageInfo {
  code: string
  label: string
  weight: number
  /** Site-relative content folder for this language. */
  contentDir: string
}

export interface FileLanguage {
  path: string
  language: string
  /** Path relative to the language's content folder, without the language suffix. */
  key: string
}

export interface TranslationGroup {
  key: string
  /** Language code → site-relative file path. */
  files: Record<string, string>
}

/** Languages from `hugo config` output (lower-cased keys). */
export function languagesFromConfig(values: Record<string, unknown>): { languages: LanguageInfo[]; defaultLanguage: string } {
  const defaultLanguage = String(values.defaultcontentlanguage ?? 'en').toLowerCase()
  const rootContentDir = String(values.contentdir ?? 'content')
  const raw = (values.languages ?? {}) as Record<string, Record<string, unknown>>
  const languages = Object.entries(raw)
    .filter(([, settings]) => !settings?.disabled)
    .map(([code, settings]) => ({
      code: code.toLowerCase(),
      label: String(settings?.label ?? settings?.languagename ?? code),
      weight: Number(settings?.weight ?? 0),
      contentDir: String(settings?.contentdir || rootContentDir).replace(/\\/g, '/').replace(/\/+$/, ''),
    }))
    .sort((a, b) => (a.weight || Infinity) - (b.weight || Infinity) || a.code.localeCompare(b.code))
  if (languages.length === 0) {
    languages.push({ code: defaultLanguage, label: defaultLanguage, weight: 0, contentDir: rootContentDir })
  }
  return { languages, defaultLanguage }
}

const SUFFIX = /^(.*)\.([a-z]{2,3}(?:-[a-z0-9]+)?)\.(md|markdown|mdown|html)$/i

/** The language of one content file, or null when it lies outside every content folder. */
export function fileLanguage(path: string, languages: LanguageInfo[], defaultLanguage: string): FileLanguage | null {
  const codes = new Set(languages.map((l) => l.code))
  // Most specific content folder first (`content/en` before `content`).
  const byFolder = [...languages].sort((a, b) => b.contentDir.length - a.contentDir.length)
  const owner = byFolder.find((l) => path === l.contentDir || path.startsWith(`${l.contentDir}/`))
  if (!owner) return null
  const relative = path.slice(owner.contentDir.length + 1)
  const dedicatedFolder = languages.filter((l) => l.contentDir === owner.contentDir).length === 1
  const match = SUFFIX.exec(relative)
  if (match && codes.has(match[2].toLowerCase())) {
    return { path, language: match[2].toLowerCase(), key: `${match[1]}.${match[3]}` }
  }
  return { path, language: dedicatedFolder ? owner.code : defaultLanguage, key: relative }
}

/** Groups files into translations; `translationKeys` maps a path to its front matter key. */
export function groupTranslations(
  files: FileLanguage[],
  translationKeys: Record<string, string | undefined> = {},
): TranslationGroup[] {
  const groups = new Map<string, TranslationGroup>()
  for (const file of files) {
    const explicit = translationKeys[file.path]
    const key = explicit ? `key:${explicit}` : `path:${file.key}`
    const group = groups.get(key) ?? { key, files: {} }
    group.files[file.language] ??= file.path
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Where a new translation of `source` into `language` should be created. */
export function translationPath(source: FileLanguage, language: LanguageInfo, languages: LanguageInfo[]): string {
  const sameFolder = languages.filter((l) => l.contentDir === language.contentDir).length > 1
  if (!sameFolder) return `${language.contentDir}/${source.key}`
  const dot = source.key.lastIndexOf('.')
  return `${language.contentDir}/${source.key.slice(0, dot)}.${language.code}${source.key.slice(dot)}`
}
