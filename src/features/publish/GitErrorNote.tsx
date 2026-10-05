import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { gitError } from './gitErrors'

/** A git failure explained in the UI language, with git's own output below; other errors as usual. */
export function GitErrorNote({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const git = gitError(error)
  if (!git) return <ErrorNote error={error} />
  return (
    <div
      role="alert"
      data-code={git.code}
      className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
    >
      <p className="font-medium">{t(`publish.gitErrors.${git.code}`)}</p>
      {git.detail.trim() !== '' && (
        <pre className="mt-1 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap opacity-80">{git.detail.trim()}</pre>
      )}
    </div>
  )
}
