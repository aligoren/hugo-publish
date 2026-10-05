import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api } from '../../lib/api'
import { joinFrontMatter, readFrontMatter, setField, splitFrontMatter, type FrontMatterParts } from '../../lib/frontmatter'
import { useSite } from '../site/SiteContext'
import {
  fileLanguage,
  groupTranslations,
  languagesFromConfig,
  translationPath,
  type FileLanguage,
  type LanguageInfo,
} from './model'

interface Loaded {
  languages: LanguageInfo[]
  defaultLanguage: string
  translationKeys: Record<string, string | undefined>
}

async function frontMatterValues(parts: FrontMatterParts): Promise<Record<string, unknown> | null> {
  if (parts.format === 'toml') return (await api.tomlParseText(parts.frontMatterText)).values
  return readFrontMatter(parts)
}

/** Marks a copied translation as a draft, whatever its front matter format. */
async function asDraft(text: string): Promise<string> {
  const parts = splitFrontMatter(text)
  if (parts.format === 'toml') {
    const frontMatterText = await api.tomlEditText(parts.frontMatterText, [{ op: 'set', path: ['draft'], value: true }])
    return joinFrontMatter({ ...parts, frontMatterText })
  }
  if (parts.format === 'json') return text
  return joinFrontMatter(setField(parts, 'draft', true))
}

/**
 * Translates the body, title and description of a copied post with the AI assistant.
 * Only plain string fields are translated; YAML through `setField`, TOML through `tomlEditText`.
 */
async function translateDraft(text: string, from: string, to: string): Promise<string> {
  const parts = splitFrontMatter(text)
  const body = parts.body.trim() ? await api.aiTranslate(parts.body, from, to) : parts.body
  if (parts.format !== 'yaml' && parts.format !== 'toml') return joinFrontMatter({ ...parts, body })
  const values = (await frontMatterValues(parts)) ?? {}
  const changes: [string, string][] = []
  for (const key of ['title', 'description']) {
    const value = values[key]
    if (typeof value === 'string' && value.trim()) changes.push([key, await api.aiTranslate(value, from, to)])
  }
  if (parts.format === 'toml') {
    const frontMatterText = await api.tomlEditText(
      parts.frontMatterText,
      changes.map(([key, value]) => ({ op: 'set', path: [key], value })),
    )
    return joinFrontMatter({ ...parts, frontMatterText, body })
  }
  let next = parts
  for (const [key, value] of changes) next = setField(next, key, value)
  return joinFrontMatter({ ...next, body })
}

/** Which posts exist in which language, and creating the missing translations. */
export function TranslationsView() {
  const { t } = useTranslation()
  const { files, reloadFiles, openFile, showView, configVersion } = useSite()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // Offered only when the user turned the assistant on and stored a key (Preferences).
  const [aiReady, setAiReady] = useState(false)
  const [useAi, setUseAi] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .aiStatus()
      .then((status) => !cancelled && setAiReady(status.enabled && status.hasKey))
      .catch(() => !cancelled && setAiReady(false))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const config = await api.configEffective()
        const { languages, defaultLanguage } = languagesFromConfig(config.values)
        const translationKeys: Record<string, string | undefined> = {}
        if (languages.length > 1) {
          for (const file of files) {
            const values = await frontMatterValues(splitFrontMatter((await api.readText(file.path)).text)).catch(() => null)
            const key = values?.translationKey ?? values?.translationkey
            if (typeof key === 'string' && key) translationKeys[file.path] = key
          }
        }
        if (!cancelled) setLoaded({ languages, defaultLanguage, translationKeys })
      } catch (e) {
        if (!cancelled) setError(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [files, configVersion])

  const titles = useMemo(() => new Map(files.map((f) => [f.path, f.title])), [files])

  const groups = useMemo(() => {
    if (!loaded) return []
    const located = files
      .map((f) => fileLanguage(f.path, loaded.languages, loaded.defaultLanguage))
      .filter((f): f is FileLanguage => f !== null)
    const all = groupTranslations(located, loaded.translationKeys)
    return onlyMissing ? all.filter((g) => loaded.languages.some((l) => !g.files[l.code])) : all
  }, [files, loaded, onlyMissing])

  async function create(source: string, language: LanguageInfo) {
    if (!loaded) return
    const located = fileLanguage(source, loaded.languages, loaded.defaultLanguage)
    if (!located) return
    const target = translationPath(located, language, loaded.languages)
    setError(null)
    if (files.some((f) => f.path === target)) {
      setError(new Error(t('translations.exists', { path: target })))
      return
    }
    setBusy(`${source}:${language.code}`)
    try {
      let text = await asDraft((await api.readText(source)).text)
      if (aiReady && useAi) text = await translateDraft(text, located.language, language.code)
      await api.writeText(target, text)
      await reloadFiles()
      openFile(target)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  if (error !== null && !loaded) {
    return (
      <div className="p-6">
        <ErrorNote error={error} />
      </div>
    )
  }
  if (!loaded) return <p className="p-6 text-sm text-zinc-500">{t('common.loading')}</p>

  if (loaded.languages.length < 2) {
    return (
      <div className="max-w-2xl space-y-3 p-6">
        <h1 className="text-xl font-semibold">{t('translations.title')}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('translations.singleLanguage')}</p>
        <button className="btn" onClick={() => showView('settings')}>
          {t('translations.addLanguage')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto text-xl font-semibold">{t('translations.title')}</h1>
        {aiReady && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            {t('translations.useAi')}
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          {t('translations.onlyMissing')}
        </label>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('translations.intro')}</p>
      {error !== null && <ErrorNote error={error} />}
      <div className="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">{t('translations.page')}</th>
              {loaded.languages.map((l) => (
                <th key={l.code} className="px-3 py-2 font-medium">
                  {l.label} <span className="font-mono text-xs text-zinc-500">{l.code}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {groups.map((group) => {
              const source = group.files[loaded.defaultLanguage] ?? Object.values(group.files)[0]
              return (
                <tr key={group.key}>
                  <td className="px-3 py-2">
                    <span className="block">{titles.get(source) || source}</span>
                    <span className="font-mono text-xs text-zinc-500">{source.replace(/^content\//, '')}</span>
                  </td>
                  {loaded.languages.map((language) => {
                    const path = group.files[language.code]
                    return (
                      <td key={language.code} className="px-3 py-2">
                        {path ? (
                          <button className="text-sky-700 hover:underline dark:text-sky-400" onClick={() => openFile(path)}>
                            ✓ {titles.get(path) || t('translations.open')}
                          </button>
                        ) : (
                          <button
                            className="btn px-2 py-0.5 text-xs"
                            disabled={busy !== null}
                            onClick={() => void create(source, language)}
                          >
                            {busy === `${source}:${language.code}` ? t('common.saving') : t('translations.create')}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        {groups.length === 0 && <p className="p-4 text-sm text-zinc-500">{t('translations.none')}</p>}
      </div>
    </div>
  )
}
