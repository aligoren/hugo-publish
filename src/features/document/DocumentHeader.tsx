import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { PostStatus } from './postStatus'
import type { SaveState } from './useDocument'
import { OverflowMenu, type MenuItem } from './workspace/OverflowMenu'
import { shortcutLabel, type PaneTab } from './workspace/panePrefs'

interface Props {
  path: string
  /** Null when the front matter cannot be read or edited (no pill then). */
  status: PostStatus | null
  statusDisabled: boolean
  onToggleDraft(): void
  unsaved: boolean
  saveState: SaveState
  onSave(): void
  /** The open side pane tab, or null when it is closed. */
  paneTab: PaneTab | null
  onToggleSettings(): void
  onTogglePreview?: () => void
  /** Warnings and errors from the checks. */
  problems: number
  menu: readonly MenuItem[]
  focusMode: boolean
  onExitFocus(): void
}

const STATUS_STYLE: Record<PostStatus, string> = {
  draft: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
  scheduled: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200',
  published: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
}

const DOT: Record<PostStatus, string> = {
  draft: 'bg-amber-500',
  scheduled: 'bg-sky-500',
  published: 'bg-emerald-500',
}

const toggleClass =
  'btn px-2.5 py-1 text-xs aria-pressed:border-sky-300 aria-pressed:bg-sky-50 aria-pressed:text-sky-900 dark:aria-pressed:border-sky-700 dark:aria-pressed:bg-sky-950 dark:aria-pressed:text-sky-100'

/** One slim row above the writing column. */
export function DocumentHeader(props: Props) {
  const { t } = useTranslation()
  const { status, unsaved, saveState, focusMode } = props
  const problemsId = useId()
  const saveText =
    saveState === 'saving' ? t('common.saving') : unsaved ? t('document.unsaved') : t('common.saved')

  return (
    <header className="flex min-h-12 items-center gap-2 border-b border-zinc-200 bg-[#fffefb] px-4 py-1.5 dark:border-zinc-800 dark:bg-[#1b1d21]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {!focusMode && (
          <p className="min-w-0 truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500" title={props.path}>
            {props.path}
          </p>
        )}
        {status && !focusMode && (
          <button
            type="button"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${STATUS_STYLE[status]}`}
            aria-label={t(`document.statusAction_${status}`)}
            title={t(`document.statusAction_${status}`)}
            disabled={props.statusDisabled}
            onClick={props.onToggleDraft}
          >
            <span className={`size-1.5 rounded-full ${DOT[status]}`} aria-hidden="true" />
            {t(`document.status_${status}`)}
          </button>
        )}
        <span
          role="status"
          className={`shrink-0 text-xs ${unsaved ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500'}`}
        >
          {saveText}
        </span>
      </div>

      {focusMode ? (
        <button type="button" className="btn px-2.5 py-1 text-xs" aria-pressed="true" title={t('document.focusModeHint')} onClick={props.onExitFocus}>
          {t('document.exitFocus')}
        </button>
      ) : (
        <>
          {props.onTogglePreview && (
            <button
              type="button"
              className={toggleClass}
              aria-pressed={props.paneTab === 'preview'}
              title={`${t('document.togglePreview')} (${shortcutLabel('P', true)})`}
              onClick={props.onTogglePreview}
            >
              {t('preview.title')}
            </button>
          )}
          <button
            type="button"
            className={toggleClass}
            aria-label={t('document.settingsToggle')}
            aria-pressed={props.paneTab === 'settings'}
            aria-describedby={props.problems > 0 ? problemsId : undefined}
            title={`${t('document.toggleSettings')} (${shortcutLabel('.')})`}
            onClick={props.onToggleSettings}
          >
            {t('document.settingsToggle')}
            {props.problems > 0 && (
              <span
                id={problemsId}
                className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] leading-4 font-semibold text-white dark:bg-amber-600"
              >
                <span aria-hidden="true">{props.problems}</span>
                <span className="sr-only">{t('document.problemsHint', { count: props.problems })}</span>
              </span>
            )}
          </button>
          <OverflowMenu label={t('document.moreActions')} items={props.menu} />
        </>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={!unsaved || saveState === 'saving'}
        title={`${t('common.save')} (${shortcutLabel('S')})`}
        onClick={props.onSave}
      >
        {saveState === 'saving' ? t('common.saving') : t('common.save')}
      </button>
    </header>
  )
}
