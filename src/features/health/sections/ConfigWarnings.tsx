import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import { useSite } from '../../site/SiteContext'
import type { SiteConfigState } from '../hooks'
import { Badge, Note, Section, Spinner } from '../ui'

/** What Hugo says while loading the config: deprecated and ignored keys, errors. */
export function ConfigWarnings({ config }: { config: SiteConfigState }) {
  const { t } = useTranslation()
  const { showView } = useSite()
  const messages = config.config?.messages.filter((m) => m.level !== 'info') ?? []
  return (
    <Section
      id="health-config"
      title={t('health.config.title')}
      intro={t('health.config.intro')}
      actions={
        <>
          <button className="btn" disabled={config.loading} onClick={() => void config.reload()}>
            {t('health.runAgain')}
          </button>
          <button className="btn" onClick={() => showView('settings')}>
            {t('health.openSettings')}
          </button>
        </>
      }
    >
      {config.loading && (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner />
          {t('health.config.loading')}
        </p>
      )}
      {config.error !== null && <ErrorNote error={config.error} />}
      {config.config &&
        !config.loading &&
        (messages.length === 0 ? (
          <Note tone="ok">{t('health.config.clean')}</Note>
        ) : (
          <ul className="space-y-1">
            {messages.map((message, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Badge tone={message.level === 'error' ? 'red' : 'amber'}>{t(`health.severity.${message.level}`)}</Badge>
                <span className="min-w-0 break-words font-mono text-xs">{message.text.replace(/^(ERROR|WARN)\s+/, '')}</span>
              </li>
            ))}
          </ul>
        ))}
    </Section>
  )
}
