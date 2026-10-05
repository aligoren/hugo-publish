import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { parseUnifiedDiff, type DiffLine } from './unifiedDiff'

const LINE_STYLE: Record<DiffLine['type'], string> = {
  add: 'bg-emerald-50 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100',
  del: 'bg-red-50 text-red-950 dark:bg-red-950/60 dark:text-red-100',
  context: '',
  note: 'text-zinc-500 italic',
}

const SIGN: Record<DiffLine['type'], string> = { add: '+', del: '−', context: ' ', note: ' ' }

/** Renders `git diff` output with line numbers and +/− colouring. */
export function UnifiedDiffView({ text }: { text: string }) {
  const { t } = useTranslation()
  const files = useMemo(() => parseUnifiedDiff(text), [text])
  const hasContent = files.some((f) => f.hunks.length > 0 || f.binary || f.status === 'renamed')

  if (!hasContent) return <p className="text-xs text-zinc-500">{t('publish.diff.empty')}</p>

  return (
    <div className="space-y-2">
      {files.map((file, fileIndex) => (
        <div key={fileIndex} className="space-y-1">
          {file.status === 'renamed' && file.oldPath && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {t('publish.diff.renamed', { from: file.oldPath })}{' '}
              {file.similarity !== null && t('publish.diff.similarity', { similarity: file.similarity })}
            </p>
          )}
          {file.binary && <p className="text-xs text-zinc-500">{t('publish.diff.binary')}</p>}
          {file.hunks.length > 0 && (
            <div
              role="table"
              className="max-h-96 overflow-auto rounded-md border border-zinc-200 font-mono text-xs leading-5 dark:border-zinc-700"
            >
              {file.hunks.map((hunk, hunkIndex) => (
                <div key={hunkIndex} role="rowgroup">
                  <div role="row" className="sticky top-0 bg-zinc-100 px-2 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <span role="cell" className="whitespace-pre">
                      {hunk.header}
                    </span>
                  </div>
                  {hunk.lines.map((line, lineIndex) => (
                    <div key={lineIndex} role="row" data-type={line.type} className={`flex min-w-max ${LINE_STYLE[line.type]}`}>
                      <span role="cell" className="w-10 shrink-0 pr-1 text-right text-zinc-400 select-none">
                        {line.oldLine ?? ''}
                      </span>
                      <span role="cell" className="w-10 shrink-0 pr-1 text-right text-zinc-400 select-none">
                        {line.newLine ?? ''}
                      </span>
                      <span role="cell" className="w-4 shrink-0 text-center select-none" aria-hidden="true">
                        {SIGN[line.type]}
                      </span>
                      <span role="cell" className="pr-3 whitespace-pre">
                        {line.text}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {file.notes.map((note, noteIndex) => (
            <p key={noteIndex} className="text-xs text-zinc-500 italic">
              {note}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}
