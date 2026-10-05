import { useTranslation } from 'react-i18next'

import type { ConfigOp, HugoMessage } from '../../../lib/api'
import { fixOpsByFile, hugoProblems, sortFindings, type Finding, type Status } from '../model/migration'
import { shortName } from '../model/sources'
import { formatValue } from '../model/values'
import { BADGE, CARD, NOTE } from './styles'

interface Props {
  findings: readonly Finding[]
  /** What Hugo printed while loading the config (null when it did not run). */
  messages: readonly HugoMessage[] | null
  hugoVersion: string | null
  onFix(opsByFile: Record<string, ConfigOp[]>): void
}

const STATUS_STYLE: Record<Status, string> = {
  ignored: 'bg-red-600 text-white',
  error: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  info: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
}

/** Deprecated and silently ignored keys, with one-click fixes that go through the review dialog. */
export function MigrationTab({ findings, messages, hugoVersion, onFix }: Props) {
  const { t } = useTranslation()
  const sorted = sortFindings(findings)
  const fixable = sorted.filter((f) => f.ops.length > 0)
  const problems = messages ? hugoProblems(messages) : []

  return (
    <div className="max-w-4xl space-y-4 px-5 py-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-lg font-semibold">{t('settings.migration.title')}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {hugoVersion ? t('settings.migration.intro', { version: hugoVersion }) : t('settings.migration.introNoHugo')}
          </p>
        </div>
        {fixable.length > 1 && (
          <button type="button" className="btn btn-primary" onClick={() => onFix(fixOpsByFile(fixable))}>
            {t('settings.migration.fixAll', { count: fixable.length })}
          </button>
        )}
      </header>

      {sorted.length === 0 && problems.length === 0 && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          ✓ {t('settings.migration.clean')}
        </p>
      )}

      <ul className="space-y-3">
        {sorted.map((finding, index) => (
          <li
            key={`${finding.source.path}:${finding.oldKey}:${index}`}
            className={`${CARD} ${finding.status === 'ignored' ? 'border-red-400 dark:border-red-700' : ''}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${BADGE} ${STATUS_STYLE[finding.status]}`}>{t(`settings.migration.status.${finding.status}`)}</span>
              {finding.errorNextRelease && (
                <span className={`${BADGE} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300`}>{t('settings.migration.errorNext')}</span>
              )}
              <code className="text-sm font-semibold">{finding.oldKey}</code>
              <span className="text-zinc-400">→</span>
              <code className="text-sm">{finding.replacement}</code>
              <span className={`${BADGE} ml-auto bg-sky-100 font-mono text-sky-800 dark:bg-sky-950 dark:text-sky-300`}>{shortName(finding.source.path)}</span>
            </div>
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{t(`settings.migration.rules.${finding.rule.id}`)}</p>
            {finding.status === 'ignored' && <p className="mt-1 text-sm font-medium text-red-700 dark:text-red-400">{t('settings.migration.ignoredHint')}</p>}
            <p className="mt-1 text-xs text-zinc-500">
              {t('settings.migration.value')}: <span className="font-mono">{formatValue(finding.value)}</span> ·{' '}
              {t('settings.migration.deprecatedIn', { version: finding.rule.deprecatedIn })}
            </p>
            <div className="mt-2">
              {finding.ops.length > 0 ? (
                <button type="button" className="btn" onClick={() => onFix({ [finding.source.path]: finding.ops })}>
                  {t('settings.migration.fix')}
                </button>
              ) : (
                <span className="text-xs text-zinc-500">{t('settings.migration.manual')}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {problems.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('settings.migration.hugoSays')}</h3>
          <ul className={`${NOTE} space-y-1`}>
            {problems.map((m, i) => (
              <li key={i} className={`font-mono text-xs ${m.level === 'error' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                {m.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
