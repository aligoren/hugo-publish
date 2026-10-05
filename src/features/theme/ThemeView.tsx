import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { useConfigDraft } from '../config-edit'
import { useSite } from '../site/SiteContext'
import { ColorsPanel } from './ColorsPanel'
import { cssHookFor, hookTarget } from './colorsModel'
import { caseDuplicates, mergeParams, paramsSources, siteLanguages, versionAtLeast } from './discovery'
import { detectedFeatures, type FeatureContext } from './features'
import { FeaturesPanel } from './FeaturesPanel'
import { contentLayouts, loadSiteConfigs, loadTheme, locateThemes, siteTemplateKeys, type SiteConfigs, type ThemeCandidate, type ThemeData } from './loadTheme'
import { mergeLayers } from './merge'
import { OverridesPanel } from './OverridesPanel'
import { ParamsPanel } from './ParamsPanel'
import { resetAssetCache } from './siteAssets'
import { TextsPanel } from './TextsPanel'
import { unknownParams } from './unknown'
import { GalleryPanel } from './update/GalleryPanel'
import { UpdatePanel } from './update/UpdatePanel'
import { useLoc } from './useLoc'

type Tab = 'settings' | 'features' | 'colors' | 'texts' | 'overrides' | 'update' | 'gallery'
const TABS: Tab[] = ['settings', 'features', 'colors', 'texts', 'overrides', 'update', 'gallery']

function sameCandidate(a: ThemeCandidate, b: ThemeCandidate): boolean {
  return a.name === b.name && a.root === b.root && a.component?.label === b.component?.label && a.component?.location === b.component?.location
}

/** Theme settings for any theme: curated profile, the theme's own defaults, template scan, generic editor. */
export function ThemeView() {
  const { t } = useTranslation()
  const { lang } = useLoc()
  const { site, hugo, configVersion, notifyConfigChanged, files, reloadFiles } = useSite()
  const [configs, setConfigs] = useState<SiteConfigs | null>(null)
  const [candidates, setCandidates] = useState<ThemeCandidate[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [loadedTheme, setLoadedTheme] = useState<(ThemeData & { loadId: number }) | null>(null)
  const [themeError, setThemeError] = useState<{ root: string; error: unknown } | null>(null)
  const [siteKeys, setSiteKeys] = useState<Set<string>>(new Set())
  const [layouts, setLayouts] = useState<Set<string>>(new Set())
  const [error, setError] = useState<unknown>(null)
  const [tab, setTab] = useState<Tab>('settings')
  const [themeReload, setThemeReload] = useState(0)
  const draft = useConfigDraft()

  // Site config and theme discovery: again after every config write.
  useEffect(() => {
    let cancelled = false
    resetAssetCache()
    void (async () => {
      try {
        const loaded = await loadSiteConfigs(site.configFiles)
        const found = await locateThemes(loaded.configs)
        if (cancelled) return
        setConfigs(loaded)
        // Keep the same objects for unchanged themes, so a config write does not reload the theme.
        setCandidates((previous) => found.map((c) => previous?.find((p) => sameCandidate(p, c)) ?? c))
      } catch (e) {
        if (!cancelled) setError(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [site.root, site.configFiles, configVersion])

  useEffect(() => {
    let cancelled = false
    void siteTemplateKeys()
      .then((keys) => {
        if (!cancelled) setSiteKeys(keys)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [site.root])

  const candidate = candidates?.[Math.min(selected, candidates.length - 1)] ?? null
  const root = candidate?.root ?? null
  const themeName = candidate?.name ?? null
  const component = candidate?.component ?? null
  // The theme folder does not change when config changes; reload only for another theme.
  useEffect(() => {
    if (!root || !themeName || !component) return
    let cancelled = false
    const loadId = themeReload
    void loadTheme(themeName, component)
      .then((data) => {
        if (!cancelled) setLoadedTheme({ ...data, loadId })
      })
      .catch((e) => {
        if (!cancelled) setThemeError({ root, error: e })
      })
    return () => {
      cancelled = true
    }
  }, [root, themeName, component, themeReload])
  const theme = loadedTheme && loadedTheme.root === root && loadedTheme.name === themeName && loadedTheme.loadId === themeReload ? loadedTheme : null
  const loadError = themeError && themeError.root === root && !theme ? themeError.error : null

  const contentPaths = useMemo(() => files.map((f) => f.path), [files])
  const layoutNames = useMemo(() => (theme ? [...theme.scan.layouts.keys(), 'search', 'archives'] : []), [theme])
  useEffect(() => {
    let cancelled = false
    void contentLayouts(contentPaths, layoutNames).then((found) => {
      if (!cancelled) setLayouts(found)
    })
    return () => {
      cancelled = true
    }
  }, [contentPaths, layoutNames, configVersion])

  const sources = useMemo(() => paramsSources(configs?.configs ?? []), [configs])
  const siteParams = useMemo(() => mergeParams(sources), [sources])
  const schema = theme?.match?.schema ?? null
  const model = useMemo(
    () => (theme ? mergeLayers({ schema, scan: theme.scan, defaults: theme.defaults, siteParams, siteTemplateKeys: siteKeys }) : null),
    [theme, schema, siteParams, siteKeys],
  )
  const unknown = useMemo(() => {
    if (!model) return []
    const known = model.fields.filter((f) => f.badge !== 'unused' && f.badge !== 'siteTemplates').map((f) => f.key)
    return unknownParams(
      model.unknown,
      known,
      model.pageParams.filter((p) => p.scope === 'page').map((p) => p.key),
    )
  }, [model])
  const duplicates = useMemo(
    () => sources.flatMap((s) => caseDuplicates(s.values).map((group) => group.map((key) => `${s.file}: ${key}`))),
    [sources],
  )
  const languages = useMemo(() => siteLanguages(configs?.configs ?? []), [configs])
  const features = useMemo(
    () => (theme && model ? detectedFeatures(model.features, [...theme.scan.layouts.keys()], theme.files) : []),
    [theme, model],
  )
  const featureContext: FeatureContext = useMemo(
    () => ({
      configs: configs?.configs ?? [],
      paramsSources: sources,
      contentDir: site.contentDir,
      language: lang,
      existingLayouts: layouts,
      existingFiles: new Set(contentPaths),
    }),
    [configs, sources, site.contentDir, lang, layouts, contentPaths],
  )
  const usedI18n = useMemo(() => {
    const map = new Map<string, number>()
    for (const [key, locations] of theme?.scan.i18nKeys ?? []) map.set(key, locations.length)
    for (const key of schema?.['x-i18n'] ?? []) if (!map.has(key)) map.set(key, 0)
    return map
  }, [theme, schema])

  const generated = useMemo(() => {
    const hook = theme ? cssHookFor(theme, schema?.['x-theme'] ?? null) : null
    return hook?.kind === 'dir' ? [hookTarget(hook)] : []
  }, [theme, schema])

  function afterWrite() {
    notifyConfigChanged()
    void reloadFiles()
  }

  const gallery = configs ? (
    <GalleryPanel
      configs={configs.configs}
      current={candidates?.[0]?.name ?? null}
      siteParams={siteParams}
      siteTemplateKeys={siteKeys}
      hugo={hugo}
      onChanged={afterWrite}
    />
  ) : null

  if (error !== null) {
    return (
      <div className="p-6">
        <ErrorNote error={error} />
      </div>
    )
  }
  if (!configs || !candidates) return <p className="p-6 text-sm text-zinc-500">{t('theme.loading')}</p>

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{t('theme.title')}</h1>
          {candidates.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">{t('theme.select')}</span>
              <select
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                value={Math.min(selected, candidates.length - 1)}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {candidates.map((c, i) => (
                  <option key={`${c.root ?? c.name}|${i}`} value={i}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {candidates.length > 1 && <p className="text-xs text-zinc-500">{t('theme.components')}</p>}
        {configs.errors.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm text-amber-700 dark:text-amber-400">{t('theme.configErrors')}</p>
            {configs.errors.map((e) => (
              <div key={e.path}>
                <p className="font-mono text-xs">{e.path}</p>
                <ErrorNote error={e.error} />
              </div>
            ))}
          </div>
        )}
      </header>

      {candidates.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('theme.noTheme')}</p>}
      {(candidates.length === 0 || (candidate && !candidate.root)) && gallery}
      {candidate && !candidate.root && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {candidate.outside
            ? t('theme.outsideSite', { name: candidate.name })
            : candidate.module
              ? t('theme.moduleNotSupported', { name: candidate.name })
              : t('theme.folderMissing', { name: candidate.name })}
        </p>
      )}
      {candidate && !candidate.root && candidate.error !== null && candidate.error !== undefined && <ErrorNote error={candidate.error} />}
      {candidate?.root && !theme && loadError === null && <p className="text-sm text-zinc-500">{t('theme.loadingTheme', { name: candidate.name })}</p>}
      {loadError !== null && <ErrorNote error={loadError} />}

      {theme && model && (
        <>
          <ThemeInfo theme={theme} hugoVersion={hugo?.version ?? null} />
          <div role="tablist" aria-label={t('theme.title')} className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
            {TABS.map((id) => (
              <button
                key={id}
                role="tab"
                id={`theme-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`theme-panel-${id}`}
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === id ? 'border-sky-700 font-medium text-sky-800 dark:border-sky-400 dark:text-sky-300' : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                onClick={() => setTab(id)}
              >
                {t(`theme.tabs.${id}`)}
                {id === 'settings' && draft.count > 0 && <span className="ml-1 rounded-full bg-sky-700 px-1.5 text-xs text-white">{draft.count}</span>}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`theme-panel-${tab}`} aria-labelledby={`theme-tab-${tab}`}>
            {tab === 'settings' && (
              <ParamsPanel model={model} sources={sources} configs={configs.configs} draft={draft} unknown={unknown} duplicates={duplicates} />
            )}
            {tab === 'features' && <FeaturesPanel features={features} context={featureContext} onWritten={afterWrite} />}
            {tab === 'colors' && <ColorsPanel theme={theme} meta={schema?.['x-theme'] ?? null} siteParams={siteParams} onWritten={afterWrite} />}
            {tab === 'texts' && <TextsPanel theme={theme} languages={languages} usedKeys={usedI18n} onWritten={afterWrite} />}
            {tab === 'overrides' && <OverridesPanel theme={theme} ignore={generated} />}
            {tab === 'update' && (
              <UpdatePanel
                theme={theme}
                siteParams={siteParams}
                siteTemplateKeys={siteKeys}
                hugoVersion={hugo?.version ?? null}
                ignore={generated}
                onUpdated={() => {
                  setThemeReload((n) => n + 1)
                  afterWrite()
                }}
              />
            )}
            {tab === 'gallery' && gallery}
          </div>
        </>
      )}
    </div>
  )
}

function ThemeInfo({ theme, hugoVersion }: { theme: ThemeData; hugoVersion: { major: number; minor: number; patch: number } | null }) {
  const { t } = useTranslation()
  const values = theme.themeToml?.values ?? {}
  const str = (key: string) => (typeof values[key] === 'string' ? (values[key] as string) : null)
  const list = (key: string) => (Array.isArray(values[key]) ? (values[key] as unknown[]).filter((v): v is string => typeof v === 'string') : [])
  const author = values.author && typeof values.author === 'object' && !Array.isArray(values.author) ? (values.author as Record<string, unknown>).name : null
  const ok = versionAtLeast(hugoVersion, theme.minVersion ?? undefined)
  const have = hugoVersion ? `${hugoVersion.major}.${hugoVersion.minor}.${hugoVersion.patch}` : ''
  const homepage = str('homepage')
  const demo = str('demosite')
  const match = theme.match
  const features = list('features')
  return (
    <section aria-label={t('theme.info.title')} className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">{str('name') ?? theme.name}</h2>
        <code className="text-xs text-zinc-500">{theme.label}</code>
        {str('license') && <span className="text-xs text-zinc-500">{t('theme.info.license', { license: str('license') })}</span>}
        {typeof author === 'string' && <span className="text-xs text-zinc-500">{t('theme.info.author', { name: author })}</span>}
      </div>
      {str('description') && <p className="text-sm text-zinc-600 dark:text-zinc-400">{str('description')}</p>}
      <div className="flex flex-wrap gap-3 text-xs">
        {homepage && (
          <button className="text-sky-700 hover:underline dark:text-sky-400" onClick={() => void openUrl(homepage)}>
            {t('theme.info.homepage')}
          </button>
        )}
        {demo && (
          <button className="text-sky-700 hover:underline dark:text-sky-400" onClick={() => void openUrl(demo)}>
            {t('theme.info.demo')}
          </button>
        )}
        {match?.schema['x-theme'].docs && (
          <button className="text-sky-700 hover:underline dark:text-sky-400" onClick={() => void openUrl(match.schema['x-theme'].docs!)}>
            {t('theme.info.docs')}
          </button>
        )}
      </div>
      {theme.minVersion && (
        <p className={`text-sm ${ok === false ? 'font-medium text-red-700 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400'}`}>
          {ok === false
            ? t('theme.info.versionTooOld', { want: theme.minVersion, have })
            : ok === true
              ? t('theme.info.versionOk', { want: theme.minVersion, have })
              : t('theme.info.minVersion', { want: theme.minVersion })}
        </p>
      )}
      <p className="text-xs text-zinc-500">
        {match ? t(`theme.info.profile.${match.reason}`, { name: match.schema['x-theme'].name }) : t('theme.info.noProfile')}
        {' · '}
        {t('theme.info.scanned', { params: theme.scan.params.size, files: theme.files.filter((f) => f.startsWith('layouts/')).length })}
        {theme.configSources.length > 0 && <> · {t('theme.info.defaultsFrom', { files: theme.configSources.join(', ') })}</>}
      </p>
      {features.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t('theme.info.features')}>
          {features.map((f) => (
            <li key={f} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {f}
            </li>
          ))}
        </ul>
      )}
      {theme.unreadable.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{t('theme.info.unreadable', { files: theme.unreadable.join(', ') })}</p>}
    </section>
  )
}
