import { useTranslation } from 'react-i18next'

import type { CheckIssue, CheckSeverity } from './runChecks'

const STYLE: Record<CheckSeverity, { dot: string; text: string }> = {
  error: { dot: 'bg-red-600 dark:bg-red-500', text: 'text-red-900 dark:text-red-200' },
  warn: { dot: 'bg-amber-500 dark:bg-amber-400', text: 'text-amber-950 dark:text-amber-100' },
  info: { dot: 'bg-sky-500 dark:bg-sky-400', text: 'text-zinc-700 dark:text-zinc-300' },
}

interface Props {
  issues: CheckIssue[]
  className?: string
  /** When given, each issue is a button that shows where it is (the line, or the field). */
  onSelect?: (issue: CheckIssue) => void
}

/** A compact list of check results. */
export function IssueList({ issues, className = '', onSelect }: Props) {
  const { t } = useTranslation()
  return (
    <ul className={`space-y-1 text-xs ${className}`}>
      {issues.map((issue, index) => {
        const content = (
          <>
            <span
              className={`mt-1 size-2 shrink-0 rounded-full ${STYLE[issue.severity].dot}`}
              role="img"
              aria-label={t(`checks.severity.${issue.severity}`)}
            />
            <span className="min-w-0 flex-1 break-words">{t(`checks.${issue.messageKey}`, issue.params)}</span>
            {issue.line !== undefined && (
              <span className="shrink-0 font-mono text-zinc-500">{t('checks.line', { line: issue.line })}</span>
            )}
          </>
        )
        return (
          <li key={`${issue.rule}-${issue.line ?? ''}-${index}`} className={onSelect ? undefined : `flex items-start gap-2 ${STYLE[issue.severity].text}`}>
            {onSelect ? (
              <button
                type="button"
                className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-500 dark:hover:bg-zinc-800 ${STYLE[issue.severity].text}`}
                title={issue.line !== undefined ? t('document.checksGoToLine', { line: issue.line }) : t('document.checksGoToField')}
                onClick={() => onSelect(issue)}
              >
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        )
      })}
    </ul>
  )
}
