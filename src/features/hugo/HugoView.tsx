import { confirm } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ManagedHugo } from '../../lib/api'
import { useSite } from '../site/SiteContext'
import { ActiveHugoCard } from './ActiveHugoCard'
import { isWindowsArm64, isWindowsHost, platformHints } from './platform'
import { SiteParity } from './SiteParity'
import { HugoError, InstallProgressBar } from './ui'
import { useHugoManager } from './useHugoManager'
import { InstalledVersions, ReleaseList } from './VersionLists'

/** Which Hugo builds the site: the active binary, app-managed versions, and the per-site pin. */
export function HugoView() {
  const { t } = useTranslation()
  const { hugo } = useSite()
  const [noExtendedBuild, setNoExtendedBuild] = useState(false)
  const [extended, setExtended] = useState(true)

  useEffect(() => {
    let cancelled = false
    void platformHints(hugo).then((hints) => {
      if (!cancelled) setNoExtendedBuild(isWindowsArm64(hints))
    })
    return () => {
      cancelled = true
    }
  }, [hugo])

  const ask = useCallback((message: string) => confirm(message, { kind: 'warning', title: t('hugo.title') }), [t])
  const uninstallMessage = useCallback(
    (entry: ManagedHugo, inUse: boolean) =>
      t(inUse ? 'hugo.installed.uninstallActiveConfirm' : 'hugo.installed.uninstallConfirm', {
        version: entry.version,
        edition: entry.extended ? t('hugo.extended') : t('hugo.standard'),
      }),
    [t],
  )
  const manager = useHugoManager({ confirm: ask, uninstallMessage, noExtendedBuild })
  const { notice } = manager

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t('hugo.title')}</h1>
        <p className="text-sm text-zinc-500">{t('hugo.intro')}</p>
      </header>

      {manager.installing && (
        <InstallProgressBar version={manager.installing.version} progress={manager.installing.progress} />
      )}
      {manager.error !== null && <HugoError error={manager.error} />}
      {notice && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
        >
          <span>
            {t(notice.kind === 'standardInstead' ? 'hugo.releases.standardInstead' : 'hugo.releases.installedNotice', {
              version: notice.result.version,
            })}
          </span>
          {!manager.isInUse(notice.result) && (
            <button className="btn" disabled={manager.busy} onClick={() => void manager.use(notice.result.path)}>
              {t('hugo.releases.useNow')}
            </button>
          )}
        </div>
      )}

      <ActiveHugoCard manager={manager} windowsHost={isWindowsHost(hugo)} />
      <SiteParity manager={manager} extended={extended && !noExtendedBuild} />
      <InstalledVersions manager={manager} />
      <ReleaseList
        manager={manager}
        extended={extended}
        onExtendedChange={setExtended}
        noExtendedBuild={noExtendedBuild}
      />
    </div>
  )
}
