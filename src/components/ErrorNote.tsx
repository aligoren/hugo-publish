import { errorMessage } from '../i18n'

export function ErrorNote({ error }: { error: unknown }) {
  const { summary, detail } = errorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
      <p className="font-medium">{summary}</p>
      {detail && detail !== summary && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs opacity-80">{detail}</pre>
      )}
    </div>
  )
}
