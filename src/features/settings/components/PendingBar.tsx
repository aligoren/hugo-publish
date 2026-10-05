import { useTranslation } from 'react-i18next'

import { shortName } from '../model/sources'

interface Props {
  count: number
  files: readonly string[]
  onReview(): void
  onDiscard(): void
}

/** Sticky footer with the number of unsaved changes. */
export function PendingBar({ count, files, onReview, onDiscard }: Props) {
  const { t } = useTranslation()
  if (count === 0) return null
  return (
    <div
      role="region"
      aria-label={t('settings.pending.label')}
      className="flex flex-wrap items-center gap-3 border-t border-amber-300 bg-amber-50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950"
    >
      <p className="text-sm font-medium text-amber-950 dark:text-amber-100">{t('settings.pending.count', { count })}</p>
      <p className="min-w-0 flex-1 truncate font-mono text-xs text-amber-800 dark:text-amber-300">{files.map(shortName).join(', ')}</p>
      <button type="button" className="btn" onClick={onDiscard}>
        {t('settings.pending.discard')}
      </button>
      <button type="button" className="btn btn-primary" onClick={onReview}>
        {t('settings.pending.review')}
      </button>
    </div>
  )
}
