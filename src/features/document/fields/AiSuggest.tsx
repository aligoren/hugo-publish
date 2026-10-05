import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../../components/ErrorNote'

interface Props<T> {
  /** What the button is for, e.g. "Suggest a description". */
  label: string
  run(): Promise<T>
  onResult(result: T): void
  disabled?: boolean
}

/** A small "Suggest" button for the AI assistant; errors are shown under it. */
export function AiSuggestButton<T>({ label, run, onResult, disabled }: Props<T>) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  return (
    <>
      <button
        type="button"
        className="btn px-2 py-1 text-xs"
        title={label}
        aria-label={label}
        disabled={disabled || busy}
        onClick={() => {
          setBusy(true)
          setError(null)
          run()
            .then(onResult, setError)
            .finally(() => setBusy(false))
        }}
      >
        {busy ? t('document.aiWorking') : t('document.aiSuggest')}
      </button>
      {error !== null && (
        <div className="basis-full">
          <ErrorNote error={error} />
        </div>
      )}
    </>
  )
}

/** Title suggestions to pick from. */
export function TitleChoices({ titles, onPick, onClose }: { titles: string[]; onPick(title: string): void; onClose(): void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 rounded-md border border-sky-200 bg-sky-50 p-2 text-sm dark:border-sky-900 dark:bg-sky-950">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('document.aiPickTitle')}</p>
      <ul className="space-y-1" aria-label={t('document.aiPickTitle')}>
        {titles.map((title) => (
          <li key={title}>
            <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-sky-100 dark:hover:bg-sky-900" onClick={() => onPick(title)}>
              {title}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="text-xs text-zinc-500 hover:underline" onClick={onClose}>
        {t('common.close')}
      </button>
    </div>
  )
}
