import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Risk } from '../model/risk'
import { shortName } from '../model/sources'
import { formatValue } from '../model/values'
import { BADGE } from './styles'

/** The risky changes with what each one means. */
export function RiskList({ risks, keepFiles }: { risks: readonly Risk[]; keepFiles: boolean }) {
  const { t } = useTranslation()
  const kinds = new Set(risks.map((r) => r.kind))
  return (
    <div className="space-y-2">
      <ul className="space-y-1 text-sm">
        {risks.map((r) => (
          <li key={`${r.file}|${r.key}`} className="flex flex-wrap items-center gap-2">
            <span className={`${BADGE} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300`}>{t(`settings.risk.kind.${r.kind}`)}</span>
            <code className="text-xs">{r.key}</code>
            <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
              {r.value === undefined ? t('settings.risk.removed') : `= ${formatValue(r.value)}`}
            </span>
            <span className="text-xs text-zinc-500">{shortName(r.file)}</span>
          </li>
        ))}
      </ul>
      <ul className="list-disc space-y-1 pl-5 text-xs text-red-900 dark:text-red-100">
        {[...kinds].map((kind) => (
          <li key={kind}>{t(`settings.risk.explain.${kind}`)}</li>
        ))}
        {kinds.has('cleanDestinationDir') && !keepFiles && <li>{t('settings.risk.keepFiles')}</li>}
      </ul>
    </div>
  )
}

interface Props {
  risks: readonly Risk[]
  keepFiles: boolean
  onCancel(): void
  onContinue(): void
}

/** Asks for an explicit "I understand" before risky changes go to the review. */
export function RiskConfirmDialog({ risks, keepFiles, onCancel, onContinue }: Props) {
  const { t } = useTranslation()
  const [understood, setUnderstood] = useState(false)
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="settings-risk-title">
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-auto rounded-lg border border-red-300 bg-white p-5 shadow-xl dark:border-red-800 dark:bg-zinc-900">
        <h2 id="settings-risk-title" className="text-lg font-semibold text-red-800 dark:text-red-300">
          {t('settings.risk.title')}
        </h2>
        <p className="text-sm">{t('settings.risk.intro')}</p>
        <RiskList risks={risks} keepFiles={keepFiles} />
        <label className="flex items-start gap-2 text-sm font-medium">
          <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          {t('settings.risk.understand')}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn border-red-700 bg-red-700 text-white hover:bg-red-800 disabled:opacity-50" disabled={!understood} onClick={onContinue}>
            {t('settings.risk.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
