import { useTranslation } from 'react-i18next'
import type { EditorStats } from './contract'

export interface EditorStatusBarProps {
  /** From `MarkdownEditor`'s `onStats`; nothing is shown while null. */
  stats: EditorStats | null
  className?: string
}

/** Words, characters, reading time and selected words, for below the editor. */
export function EditorStatusBar({ stats, className }: EditorStatusBarProps) {
  const { t } = useTranslation()
  if (!stats) return null
  const items = [
    t('editor.stats.words', { count: stats.words, defaultValue: `${stats.words} words` }),
    t('editor.stats.characters', { count: stats.characters, defaultValue: `${stats.characters} characters` }),
  ]
  if (stats.readingMinutes > 0) {
    items.push(t('editor.stats.readingTime', { count: stats.readingMinutes, defaultValue: `${stats.readingMinutes} min read` }))
  }
  return (
    <div
      role="status"
      aria-label={t('editor.stats.label', { defaultValue: 'Writing statistics' })}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 tabular-nums dark:text-zinc-400 ${className ?? ''}`}
    >
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
      {stats.selectionWords > 0 && (
        <span className="text-zinc-700 dark:text-zinc-200">
          {t('editor.stats.selection', { count: stats.selectionWords, defaultValue: `${stats.selectionWords} words selected` })}
        </span>
      )}
    </div>
  )
}
