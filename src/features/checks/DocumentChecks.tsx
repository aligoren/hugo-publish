import { useTranslation } from 'react-i18next'

import { IssueList } from './IssueList'
import type { CheckIssue } from './runChecks'
import { useDocumentChecks } from './useDocumentChecks'

interface Props {
  /** Site-relative path of the document. */
  path: string
  /** Current (unsaved) text of the whole file. */
  text: string
}

/** Pre-publish checks for one document, as a collapsible list. */
export function DocumentChecks({ path, text }: Props) {
  const { t } = useTranslation()
  const issues = useDocumentChecks(path, text)
  const problems = issues.filter((i) => i.severity !== 'info').length
  return (
    <details open={problems > 0} className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
      <summary className="cursor-pointer text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        {t('checks.title')}{' '}
        <span className="font-normal tracking-normal normal-case">
          {issues.length === 0 ? t('checks.allGood') : t('checks.count', { count: issues.length })}
        </span>
      </summary>
      {issues.length > 0 && <IssueList issues={issues} className="mt-2" />}
    </details>
  )
}

/** The checks as the side pane's tab: every issue leads to its line or field. */
export function ChecksPanel({ issues, onSelect }: { issues: CheckIssue[]; onSelect(issue: CheckIssue): void }) {
  const { t } = useTranslation()
  if (issues.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-zinc-500">
        <p className="text-base text-emerald-700 dark:text-emerald-400" aria-hidden="true">
          ✓
        </p>
        <p className="mt-1">{t('document.checksAllGood')}</p>
      </div>
    )
  }
  return (
    <div className="px-2 py-3">
      <p className="px-2 pb-2 text-xs text-zinc-500">{t('document.checksHint')}</p>
      <IssueList issues={issues} onSelect={onSelect} className="text-sm" />
    </div>
  )
}
