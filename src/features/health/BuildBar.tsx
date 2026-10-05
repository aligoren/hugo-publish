import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import type { HealthBuild } from './hooks'
import { formatMs } from './lib/format'
import { Spinner } from './ui'

/** State of the shared production build, with Hugo's errors when it failed. */
export function BuildBar({ build }: { build: HealthBuild }) {
  const { t } = useTranslation()
  const { result, building, error } = build
  const problems = result?.messages.filter((m) => m.level !== 'info') ?? []
  return (
    <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
      <div className="flex flex-wrap items-center gap-2">
        {building ? (
          <>
            <Spinner />
            <span>{t('health.build.building')}</span>
          </>
        ) : result ? (
          <span>
            {t(result.ok ? 'health.build.ready' : 'health.build.failed', {
              count: result.files.length,
              duration: formatMs(result.durationMs),
            })}
          </span>
        ) : (
          <span>{t('health.build.none')}</span>
        )}
        <button className="btn ml-auto py-0.5 text-xs" disabled={building} onClick={() => void build.rebuild().catch(() => undefined)}>
          {result ? t('health.build.rebuild') : t('health.build.start')}
        </button>
      </div>
      {error !== null && <ErrorNote error={error} />}
      {problems.length > 0 && (
        <ul className="max-h-32 space-y-0.5 overflow-auto font-mono text-[11px]">
          {problems.map((m, i) => (
            <li key={i} className={m.level === 'error' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
