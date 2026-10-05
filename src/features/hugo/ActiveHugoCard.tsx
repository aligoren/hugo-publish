import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'

import { useSite } from '../site/SiteContext'
import { EditionBadge, Section } from './ui'
import type { HugoManager } from './useHugoManager'
import { hugoVersionString } from './versions'

export function ActiveHugoCard({ manager, windowsHost }: { manager: HugoManager; windowsHost: boolean }) {
  const { t } = useTranslation()
  const { hugo } = useSite()
  const disabled = manager.busy || manager.installing !== null

  async function chooseBinary() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: t('hugo.active.chooseBinaryTitle'),
      filters: windowsHost ? [{ name: 'Hugo', extensions: ['exe'] }] : undefined,
    })
    if (typeof selected === 'string') await manager.use(selected)
  }

  return (
    <Section
      id="hugo-active"
      title={t('hugo.active.heading')}
      actions={
        <>
          <button className="btn" disabled={disabled} onClick={() => void manager.use(null)}>
            {t('hugo.active.detectAuto')}
          </button>
          <button className="btn" disabled={disabled} onClick={() => void chooseBinary()}>
            {t('hugo.active.chooseBinary')}
          </button>
        </>
      }
    >
      {manager.busy ? (
        <p className="text-sm text-zinc-500">{t('hugo.active.refreshing')}</p>
      ) : hugo ? (
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-semibold" data-testid="active-version">
              Hugo {hugoVersionString(hugo)}
            </span>
            <EditionBadge extended={hugo.version.extended} />
            <span className="text-xs text-zinc-500">
              {hugo.version.os}/{hugo.version.arch}
            </span>
          </p>
          <p className="break-all font-mono text-xs text-zinc-500">{hugo.path}</p>
        </div>
      ) : (
        <p className="text-sm text-amber-800 dark:text-amber-300">{t('hugo.active.notFound')}</p>
      )}
      {manager.preferred !== undefined && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {manager.preferred ? (
            <>
              {t('hugo.active.custom')} <code className="break-all font-mono text-xs">{manager.preferred}</code>
            </>
          ) : (
            t('hugo.active.automatic')
          )}
        </p>
      )}
    </Section>
  )
}
