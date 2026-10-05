import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { errorHintKey, formatBytes, progressPercent } from './format'
import type { HugoInstallProgress } from '../../lib/api'

export function Section({
  id,
  title,
  intro,
  actions,
  children,
}: {
  id: string
  title: string
  intro?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h2 id={id} className="font-semibold">
            {title}
          </h2>
          {intro && <p className="text-sm text-zinc-500">{intro}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

const BADGE_TONES = {
  neutral: 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400',
  sky: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200',
  emerald: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  amber: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
}

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-px text-[11px] font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  )
}

export function EditionBadge({ extended }: { extended: boolean }) {
  const { t } = useTranslation()
  return <Badge tone={extended ? 'sky' : 'neutral'}>{extended ? t('hugo.extended') : t('hugo.standard')}</Badge>
}

/** An error with a plain-language explanation for the known version-manager failures. */
export function HugoError({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const hint = errorHintKey(error)
  return (
    <div className="space-y-1">
      {hint && <p className="text-sm font-medium text-red-800 dark:text-red-300">{t(hint)}</p>}
      <ErrorNote error={error} />
    </div>
  )
}

export function InstallProgressBar({ progress, version }: { progress: HugoInstallProgress | null; version: string }) {
  const { t, i18n } = useTranslation()
  const stage = progress?.stage ?? 'download'
  const percent = stage === 'download' && progress ? progressPercent(progress.received, progress.total) : null
  const label = t(`hugo.progress.${stage}`, { version })
  const bytes =
    stage === 'download' && progress && progress.received > 0
      ? progress.total
        ? t('hugo.progress.bytes', {
            received: formatBytes(progress.received, i18n.language),
            total: formatBytes(progress.total, i18n.language),
          })
        : t('hugo.progress.bytesUnknown', { received: formatBytes(progress.received, i18n.language) })
      : null
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <span>{label}</span>
        {bytes && <span className="tabular-nums">{bytes}</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div
          className={`h-full rounded-full bg-sky-600 transition-[width] ${percent === null ? 'w-full animate-pulse opacity-60' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
