import { useTranslation } from 'react-i18next'

import { shortName } from '../model/sources'
import { BADGE } from './styles'

export type Origin = { kind: 'file'; path: string; inherited: boolean } | { kind: 'default' } | { kind: 'external' }

/** Where a value comes from: a file, Hugo's default, or a theme/environment variable. */
export function SourceBadge({ origin }: { origin: Origin }) {
  const { t } = useTranslation()
  if (origin.kind === 'default') {
    return <span className={`${BADGE} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400`}>{t('settings.origin.default')}</span>
  }
  if (origin.kind === 'external') {
    return (
      <span className={`${BADGE} bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300`} title={t('settings.origin.externalHint')}>
        {t('settings.origin.external')}
      </span>
    )
  }
  return (
    <span
      className={`${BADGE} font-mono ${origin.inherited ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'}`}
      title={t(origin.inherited ? 'settings.origin.inheritedHint' : 'settings.origin.fileHint', { file: origin.path })}
    >
      {shortName(origin.path)}
    </span>
  )
}
