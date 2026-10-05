import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function Section({
  id,
  title,
  intro,
  actions,
  children,
}: {
  id: string
  title: string
  intro?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={id} className="font-semibold">
            {title}
          </h2>
          {intro && <p className="text-sm text-zinc-500">{intro}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

const BADGE_TONES = {
  neutral: 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400',
  sky: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200',
  emerald: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  amber: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  red: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
}

export type Tone = keyof typeof BADGE_TONES

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

const NOTE_TONES = {
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100',
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
}

export function Note({ tone = 'info', children }: { tone?: keyof typeof NOTE_TONES; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${NOTE_TONES[tone]}`}>
      {children}
    </div>
  )
}

/** A determinate progress bar with "done / total". */
export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{label}</span>
        <span>
          {done} / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800"
      >
        <div className="h-full bg-sky-600 transition-[width] dark:bg-sky-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** A file path that opens the file in the editor. */
export function OpenFileButton({ path, line, onOpen }: { path: string; line?: number; onOpen: (path: string) => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="max-w-full truncate text-left font-mono text-xs text-sky-700 hover:underline dark:text-sky-400"
      title={t('health.openInEditor')}
      onClick={() => onOpen(path)}
    >
      {path.replace(/^content\//, '')}
      {line !== undefined && `:${line}`}
    </button>
  )
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-3 animate-spin rounded-full border-2 border-zinc-300 border-t-sky-600 dark:border-zinc-600 dark:border-t-sky-400"
    />
  )
}
