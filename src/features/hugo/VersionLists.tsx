import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type HugoRelease } from '../../lib/api'
import { formatDate } from './format'
import { Badge, EditionBadge, HugoError, Section } from './ui'
import type { HugoManager } from './useHugoManager'
import { sortNewestFirst } from './versions'

/** Rows shown before "show all". */
const COLLAPSED_ROWS = 8

const rowClass =
  'flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 py-2 first:border-t-0 dark:border-zinc-800'

export function InstalledVersions({ manager }: { manager: HugoManager }) {
  const { t } = useTranslation()
  const disabled = manager.busy || manager.installing !== null
  return (
    <Section id="hugo-installed" title={t('hugo.installed.heading')} intro={t('hugo.installed.intro')}>
      {manager.installed === null ? (
        <p className="text-sm text-zinc-500">{t('common.loading')}</p>
      ) : manager.installed.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('hugo.installed.empty')}</p>
      ) : (
        <ul aria-label={t('hugo.installed.heading')}>
          {manager.installed.map((entry) => {
            const inUse = manager.isInUse(entry)
            return (
              <li key={entry.path} className={rowClass}>
                <span className="font-medium tabular-nums">{entry.version}</span>
                <EditionBadge extended={entry.extended} />
                {inUse && <Badge tone="emerald">{t('hugo.installed.inUse')}</Badge>}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500" title={entry.path}>
                  {entry.path}
                </span>
                <span className="flex gap-2">
                  {!inUse && (
                    <button className="btn" disabled={disabled} onClick={() => void manager.use(entry.path)}>
                      {t('hugo.installed.use')}
                    </button>
                  )}
                  <button
                    className="btn"
                    disabled={disabled}
                    onClick={() => void manager.uninstall(entry)}
                    aria-label={`${t('hugo.installed.uninstall')} ${entry.version}`}
                  >
                    {t('hugo.installed.uninstall')}
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

export function ReleaseList({
  manager,
  extended,
  onExtendedChange,
  noExtendedBuild,
}: {
  manager: HugoManager
  /** The extended toggle as the user set it. */
  extended: boolean
  onExtendedChange(extended: boolean): void
  noExtendedBuild: boolean
}) {
  const { t, i18n } = useTranslation()
  const [releases, setReleases] = useState<HugoRelease[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [showPrereleases, setShowPrereleases] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const wantExtended = extended && !noExtendedBuild

  const load = useCallback(async () => {
    setError(null)
    try {
      setReleases(sortNewestFirst(await api.hugoReleases()))
    } catch (e) {
      setReleases([])
      setError(e)
    }
  }, [])

  useEffect(() => {
    // Fetch on mount; state only changes after the command resolves.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  const visible = (releases ?? []).filter((r) => showPrereleases || !r.prerelease)
  const latestStable = (releases ?? []).find((r) => !r.prerelease)?.version
  const shown = showAll ? visible : visible.slice(0, COLLAPSED_ROWS)
  const busy = manager.busy || manager.installing !== null

  return (
    <Section
      id="hugo-releases"
      title={t('hugo.releases.heading')}
      intro={t('hugo.releases.intro')}
      actions={
        <button className="btn" disabled={releases === null} onClick={() => void load()}>
          {t('hugo.releases.reload')}
        </button>
      }
    >
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={wantExtended}
            disabled={noExtendedBuild}
            onChange={(e) => onExtendedChange(e.target.checked)}
          />
          <span>
            <span className="font-medium">{t('hugo.releases.extended')}</span>
            <span className="block text-xs text-zinc-500">
              {noExtendedBuild ? t('hugo.releases.extendedUnavailable') : t('hugo.releases.extendedHint')}
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2 self-start">
          <input type="checkbox" checked={showPrereleases} onChange={(e) => setShowPrereleases(e.target.checked)} />
          {t('hugo.releases.showPrereleases')}
        </label>
      </div>

      {error !== null && <HugoError error={error} />}
      {releases === null ? (
        <p className="text-sm text-zinc-500">{t('hugo.releases.loading')}</p>
      ) : visible.length === 0 ? (
        error === null && <p className="text-sm text-zinc-500">{t('hugo.releases.empty')}</p>
      ) : (
        <ul aria-label={t('hugo.releases.heading')}>
          {shown.map((release) => {
            const installed = manager.findInstalled(release.version, wantExtended)
            const exact = installed !== null && installed.extended === wantExtended
            const installingThis = manager.installing?.version === release.version
            return (
              <li key={release.version} className={rowClass}>
                <span className="w-20 font-medium tabular-nums">{release.version}</span>
                <span className="w-28 text-xs text-zinc-500">{formatDate(release.publishedAt, i18n.language)}</span>
                <span className="flex flex-1 gap-1">
                  {release.version === latestStable && <Badge tone="emerald">{t('hugo.releases.latest')}</Badge>}
                  {release.prerelease && <Badge tone="amber">{t('hugo.releases.prerelease')}</Badge>}
                  {installed && exact && <Badge>{t('hugo.releases.installed')}</Badge>}
                </span>
                {installed && exact ? (
                  !manager.isInUse(installed) && (
                    <button className="btn" disabled={busy} onClick={() => void manager.use(installed.path)}>
                      {t('hugo.installed.use')}
                    </button>
                  )
                ) : (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => void manager.install(release.version, wantExtended)}
                    aria-label={`${t('hugo.releases.install')} ${release.version}`}
                  >
                    {installingThis ? t('hugo.releases.installing') : t('hugo.releases.install')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {visible.length > COLLAPSED_ROWS && (
        <button className="text-sm text-sky-700 hover:underline dark:text-sky-400" onClick={() => setShowAll((v) => !v)}>
          {showAll ? t('hugo.releases.showFewer') : t('hugo.releases.showAll', { count: visible.length })}
        </button>
      )}
    </Section>
  )
}
