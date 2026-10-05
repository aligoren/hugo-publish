import { useTranslation } from 'react-i18next'

import type { DuplicateGroup } from './duplicates'

interface Props {
  groups: readonly DuplicateGroup[]
  counts: ReadonlyMap<string, number>
  onMerge(group: DuplicateGroup): void
}

/** Suggested merges for terms that look like the same term written differently. */
export function SimilarTerms({ groups, counts, onMerge }: Props) {
  const { t } = useTranslation()
  if (groups.length === 0) return <p className="p-4 text-sm text-zinc-500">{t('taxonomies.noSimilar')}</p>
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('taxonomies.similarIntro')}</p>
      <ul className="space-y-2">
        {groups.map((group) => (
          <li
            key={group.terms.join('\n')}
            className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {group.terms.map((term) => (
                <span
                  key={term}
                  className={`rounded-full border px-2 py-0.5 text-sm ${
                    term === group.suggested
                      ? 'border-sky-300 bg-sky-50 font-medium dark:border-sky-800 dark:bg-sky-950'
                      : 'border-zinc-300 dark:border-zinc-700'
                  }`}
                >
                  {term} <span className="text-xs text-zinc-500">{counts.get(term) ?? 0}</span>
                </span>
              ))}
              <span className="ml-1 text-xs text-zinc-500">
                {group.reasons.map((reason) => t(`taxonomies.reason.${reason}`)).join(' · ')}
              </span>
            </div>
            <button className="btn" onClick={() => onMerge(group)}>
              {t('taxonomies.mergeSuggested', { term: group.suggested })}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
