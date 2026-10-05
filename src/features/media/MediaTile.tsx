import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { MediaFile } from '../../lib/api'
import { fileNameOf } from './reference'
import { Thumbnail } from './Thumbnail'

const TONES = {
  red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  zinc: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
}

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={`rounded px-1 text-[10px] font-medium ${TONES[tone]}`}>{children}</span>
}

interface Props {
  file: MediaFile
  selected: boolean
  unused?: boolean
  onSelect(): void
  /** Double click. */
  onActivate?(): void
}

/** One image in a grid: preview, name and privacy badges. */
export function MediaTile({ file, selected, unused = false, onSelect, onActivate }: Props) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onActivate}
      aria-pressed={selected}
      title={file.path}
      className={`flex w-full flex-col overflow-hidden rounded-lg border bg-white text-left dark:bg-zinc-900 ${
        selected
          ? 'border-sky-500 ring-2 ring-sky-500/40'
          : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'
      }`}
    >
      <Thumbnail
        key={`${file.path}:${file.modifiedMs}`}
        path={file.path}
        modifiedMs={file.modifiedMs}
        fallback={file.format ?? undefined}
        className="aspect-square w-full"
      />
      <span className="flex min-w-0 flex-col gap-1 px-2 py-1.5">
        <span className="truncate text-xs font-medium">{fileNameOf(file.path)}</span>
        <span className="flex flex-wrap items-center gap-1">
          {file.hasGps && <Badge tone="red">{t('media.badgeLocation')}</Badge>}
          {!file.hasGps && file.hasMetadata && <Badge tone="amber">{t('media.badgeMetadata')}</Badge>}
          {unused && <Badge tone="zinc">{t('media.badgeUnused')}</Badge>}
          {file.width !== null && file.height !== null && (
            <span className="ml-auto text-[10px] text-zinc-500 tabular-nums">
              {file.width}×{file.height}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}
