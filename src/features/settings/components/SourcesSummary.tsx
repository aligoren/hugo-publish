import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'
import { shortName, stackFor, type LoadedSource } from '../model/sources'
import { canSplit } from '../model/splitApply'
import { BADGE, LINK_BUTTON } from './styles'

interface Props {
  sources: readonly LoadedSource[]
  env: string | null
  /** Offers splitting a single root file into config/_default/. */
  onSplit?(): void
  /** The root file has pending changes; they must be saved first. */
  splitBlocked?: boolean
}

/** The files Hugo merges for the chosen environment, in precedence order, plus files that failed to load. */
export function SourcesSummary({ sources, env, onSplit, splitBlocked = false }: Props) {
  const { t } = useTranslation()
  const stack = stackFor(sources, env)
  const inactive = sources.filter((s) => !s.active)
  const broken = sources.filter((s) => s.error !== null)
  return (
    <div className="space-y-2 px-4 pb-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-zinc-500">{t('settings.sources.label')}</span>
        {stack.length === 0 && <span className="text-zinc-500">{t('settings.sources.none')}</span>}
        {stack.map((s, i) => (
          <span key={s.path} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-zinc-400" aria-hidden="true">›</span>}
            <span
              className={`${BADGE} font-mono ${s.layer === 'env' ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'}`}
              title={s.kind === 'category' ? t('settings.sources.category', { category: s.lang ? `languages.${s.lang}.${s.category}` : s.category }) : undefined}
            >
              {shortName(s.path)}
              {!s.editable && ` (${t('settings.sources.readOnly')})`}
            </span>
          </span>
        ))}
        {stack.length > 1 && <span className="text-zinc-400">{t('settings.sources.precedence')}</span>}
        {onSplit && env === null && canSplit(sources) && (
          <button
            type="button"
            className={`${LINK_BUTTON} ml-2 disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={splitBlocked}
            title={splitBlocked ? t('settings.split.saveFirst') : t('settings.split.hint')}
            onClick={onSplit}
          >
            {t('settings.split.action')}
          </button>
        )}
      </div>
      {inactive.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('settings.sources.inactive', { files: inactive.map((s) => s.path).join(', '), active: sources.find((s) => s.layer === 'root' && s.active)?.path ?? '' })}
        </p>
      )}
      {stack.some((s) => s.format === 'json') && <p className="text-xs text-zinc-500">{t('settings.readOnlyJson')}</p>}
      {broken.map((s) => (
        <div key={s.path} className="space-y-1">
          <p className="font-mono text-xs text-red-700 dark:text-red-400">{s.path}</p>
          <ErrorNote error={s.error} />
        </div>
      ))}
    </div>
  )
}
