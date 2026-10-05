import { diffLines, withContext } from '../lib/diff'

export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = withContext(diffLines(before, after))
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-zinc-200 font-mono text-xs dark:border-zinc-700">
      {lines.map((line, index) =>
        line === null ? (
          <div key={index} className="bg-zinc-100 px-2 text-zinc-500 dark:bg-zinc-800">
            ⋯
          </div>
        ) : (
          <div
            key={index}
            className={
              line.kind === 'added'
                ? 'flex bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                : line.kind === 'removed'
                  ? 'flex bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200'
                  : 'flex'
            }
          >
            <span className="w-10 shrink-0 select-none pr-2 text-right text-zinc-400">
              {line.kind === 'removed' ? line.oldNumber : line.newNumber}
            </span>
            <span className="w-4 shrink-0 select-none">
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
            </span>
            <span className="whitespace-pre">{line.text}</span>
          </div>
        ),
      )}
    </div>
  )
}
