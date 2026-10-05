import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { BuildBar } from './BuildBar'
import { useEffectiveConfig, useHealthBuild, useSessionState } from './hooks'
import { Changes } from './sections/Changes'
import { ConfigWarnings } from './sections/ConfigWarnings'
import { ContentChecks } from './sections/ContentChecks'
import { ExternalLinks } from './sections/ExternalLinks'
import { Feeds } from './sections/Feeds'
import { InternalLinks } from './sections/InternalLinks'
import { LiveSite } from './sections/LiveSite'
import { Privacy } from './sections/Privacy'
import { SocialPreview } from './sections/SocialPreview'

const TABS = ['checks', 'internal', 'external', 'privacy', 'social', 'feeds', 'changes', 'config', 'live'] as const
type Tab = (typeof TABS)[number]

/** Tabs that read the shared production build. */
const USES_BUILD: Tab[] = ['internal', 'privacy', 'social', 'feeds']

/** Site health: content checks, links, privacy, share cards, pending changes, config and the live site. */
export function HealthView() {
  const { t } = useTranslation()
  const build = useHealthBuild()
  const config = useEffectiveConfig()
  const [tab, setTab] = useSessionState<Tab>('tab', 'checks')
  const warnings = config.config?.messages.filter((m) => m.level !== 'info').length ?? 0

  // Every section stays mounted (hidden when not shown), so results survive switching tabs.
  const panel = (id: Tab, content: ReactNode) => (
    <div role="tabpanel" id={`health-panel-${id}`} aria-labelledby={`health-tab-${id}`} hidden={tab !== id} className="space-y-4">
      {content}
    </div>
  )

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t('health.title')}</h1>
        <p className="text-sm text-zinc-500">{t('health.intro')}</p>
      </header>
      <div role="tablist" aria-label={t('health.title')} className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((id) => (
          <button
            key={id}
            id={`health-tab-${id}`}
            role="tab"
            type="button"
            aria-selected={tab === id}
            aria-controls={`health-panel-${id}`}
            onClick={() => setTab(id)}
            className={`-mb-px rounded-t-md border px-3 py-1.5 text-sm ${
              tab === id
                ? 'border-zinc-200 border-b-white bg-white font-medium dark:border-zinc-800 dark:border-b-zinc-950 dark:bg-zinc-950'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {t(`health.tabs.${id}`)}
            {id === 'config' && warnings > 0 && (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">{warnings}</span>
            )}
          </button>
        ))}
      </div>
      {USES_BUILD.includes(tab) && <BuildBar build={build} />}
      {panel('checks', <ContentChecks />)}
      {panel('internal', <InternalLinks build={build} baseUrl={config.baseUrl} />)}
      {panel('external', <ExternalLinks baseUrl={config.baseUrl} />)}
      {panel('privacy', <Privacy build={build} baseUrl={config.baseUrl} values={config.config?.values ?? null} />)}
      {panel('social', <SocialPreview build={build} baseUrl={config.baseUrl} />)}
      {panel('feeds', <Feeds build={build} baseUrl={config.baseUrl} values={config.config?.values ?? null} />)}
      {panel('changes', <Changes />)}
      {panel('config', <ConfigWarnings config={config} />)}
      {panel('live', <LiveSite build={build} baseUrl={config.baseUrl} />)}
    </div>
  )
}
