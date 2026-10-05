import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import { api, type ConfigOp, type HugoInfo, type ThemeSource } from '../../../lib/api'
import { THEME_CATALOG } from '../../../lib/themeCatalog'
import type { ConfigFileData } from '../../config-edit'
import { ChangesDialog, type TextChange } from '../ChangesDialog'
import { setThemeOps } from '../features'
import { loadTheme, mapLimit } from '../loadTheme'
import { useLoc } from '../useLoc'
import { hashThemeFolder, LOCK_PATH, lockText, makeLock, parseGithubRepo } from './lock'
import { unusedWith } from './prepare'
import { lookupRepo, useRepoTags } from './repoInfo'

interface Props {
  configs: ConfigFileData[]
  /** The theme the site uses now (first one), if any. */
  current: string | null
  siteParams: Record<string, unknown>
  siteTemplateKeys: Set<string>
  hugo: HugoInfo | null
  onChanged(): void
}

interface Candidate {
  source: ThemeSource
  /** Commit that was installed (resolved just before downloading; null offline). */
  commit: string | null
  unused: string[]
  params: number
}

const FOLDER_NAME = /^[\w.-]+$/

export function GalleryPanel({ configs, current, siteParams, siteTemplateKeys, hugo, onChanged }: Props) {
  const { t } = useTranslation()
  const { loc } = useLoc()
  const [installed, setInstalled] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [repo, setRepo] = useState('')
  const [folder, setFolder] = useState('')
  const [reference, setReference] = useState('')
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [change, setChange] = useState<{ ops: Record<string, ConfigOp[]>; texts: TextChange[] } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const parsed = parseGithubRepo(repo)
  const repoTags = useRepoTags(parsed)

  useEffect(() => {
    let cancelled = false
    void mapLimit(THEME_CATALOG, 4, async (theme) => ((await api.listFiles(`themes/${theme.name}`).catch(() => [])).length > 0 ? theme.name : null)).then((names) => {
      if (!cancelled) setInstalled(new Set(names.filter((n): n is string => n !== null)))
    })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  async function inspect(source: ThemeSource, install: boolean) {
    setBusy(source.name)
    setError(null)
    setCandidate(null)
    try {
      let commit: string | null = null
      if (install) {
        const lookup = await lookupRepo(source.owner, source.repo, source.reference)
        commit = lookup.ok ? lookup.info.commit : null
        await api.themeInstall(source)
        setReloadKey((k) => k + 1)
        onChanged()
      }
      const theme = await loadTheme(source.name, `themes/${source.name}`)
      setCandidate({ source, commit, unused: unusedWith(theme, siteParams, siteTemplateKeys), params: theme.scan.params.size })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  async function switchTo(source: ThemeSource, commit: string | null) {
    const plan = setThemeOps(configs, source.name)
    if (!plan) return
    setBusy(source.name)
    try {
      const existing = await api.readText(LOCK_PATH).catch(() => null)
      const files = await hashThemeFolder(`themes/${source.name}`)
      setChange({
        ops: { [plan.file]: plan.ops },
        texts: [{ path: LOCK_PATH, before: existing?.text ?? null, after: lockText(makeLock(source.name, source, files, new Date(), commit)), version: existing?.version ?? null }],
      })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const customName = folder.trim() || parsed?.repo.replace(/^(go)?hugo-theme-|^hugo-/i, '') || ''
  const custom: ThemeSource | null = parsed && FOLDER_NAME.test(customName) ? { ...parsed, name: customName, ...(reference.trim() ? { reference: reference.trim() } : {}) } : null

  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('theme.gallery.intro')}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {THEME_CATALOG.map((theme) => {
          const isInstalled = installed?.has(theme.name) ?? false
          const isCurrent = current === theme.name
          return (
            <li key={theme.name} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{theme.name}</h3>
                {isCurrent ? (
                  <span className="text-xs text-emerald-700 dark:text-emerald-400">{t('theme.gallery.current')}</span>
                ) : isInstalled ? (
                  <span className="text-xs text-zinc-500">{t('theme.gallery.installed')}</span>
                ) : null}
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{loc(theme.description)}</p>
              {theme.needsExtended && !hugo?.version.extended && <p className="text-xs text-amber-700 dark:text-amber-400">{t('theme.gallery.needsExtended')}</p>}
              <div className="flex flex-wrap gap-2">
                <button className="text-xs text-sky-700 hover:underline dark:text-sky-400" onClick={() => void openUrl(theme.homepage)}>
                  {t('theme.info.homepage')}
                </button>
                {!isCurrent && (
                  <button className="btn" disabled={busy !== null || installed === null} onClick={() => void inspect(theme, !isInstalled)}>
                    {busy === theme.name ? t('theme.gallery.working') : isInstalled ? t('theme.gallery.consider') : t('theme.gallery.install')}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <section aria-labelledby="gallery-custom" className="space-y-2">
        <h3 id="gallery-custom" className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          {t('theme.gallery.other')}
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="field min-w-72 flex-1">
            <span>{t('theme.update.repo')}</span>
            <input value={repo} placeholder="https://github.com/owner/repo" onChange={(e) => setRepo(e.target.value)} />
          </label>
          <label className="field w-40">
            <span>{t('theme.gallery.folder')}</span>
            <input value={folder} placeholder={customName} onChange={(e) => setFolder(e.target.value)} />
          </label>
          <label className="field w-40">
            <span>{t('theme.update.reference')}</span>
            <input
              value={reference}
              list="theme-gallery-tags"
              placeholder={repoTags.defaultBranch ?? t('theme.update.defaultBranch')}
              onChange={(e) => setReference(e.target.value)}
            />
            <datalist id="theme-gallery-tags">
              {repoTags.tags.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          </label>
          <button className="btn" disabled={!custom || busy !== null} onClick={() => custom && void inspect(custom, true)}>
            {t('theme.gallery.install')}
          </button>
        </div>
      </section>

      {repoTags.failed && <p className="text-xs text-zinc-500">{t('theme.update.offline')}</p>}
      {error !== null && <ErrorNote error={error} />}

      {candidate && (
        <section aria-labelledby="gallery-switch" className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950">
          <h3 id="gallery-switch" className="font-medium">
            {t('theme.gallery.switchTitle', { name: candidate.source.name })}
          </h3>
          <p className="text-sm">{t('theme.gallery.switchWarning', { count: candidate.params })}</p>
          {candidate.unused.length > 0 ? (
            <p className="text-sm text-amber-800 dark:text-amber-300">{t('theme.gallery.unused', { keys: candidate.unused.join(', ') })}</p>
          ) : (
            <p className="text-sm">{t('theme.gallery.noUnused')}</p>
          )}
          <button className="btn btn-primary" disabled={busy !== null || !setThemeOps(configs, candidate.source.name)} onClick={() => void switchTo(candidate.source, candidate.commit)}>
            {t('theme.gallery.switch')}
          </button>
        </section>
      )}

      {change && (
        <ChangesDialog
          title={t('theme.gallery.switchDialog')}
          opsByFile={change.ops}
          texts={change.texts}
          onClose={() => setChange(null)}
          onWritten={() => {
            setChange(null)
            setCandidate(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
