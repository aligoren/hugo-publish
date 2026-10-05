import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { rank } from './match'

export interface PaletteAction {
  id: string
  label: string
  /** Shown on the right, e.g. the group or a file path. */
  hint?: string
  run(): void
}

interface Props {
  actions: PaletteAction[]
  onClose(): void
}

/** Ctrl/Cmd+K: run any action or open any post by typing a few letters. */
export function CommandPalette({ actions, onClose }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const results = useMemo(() => rank(actions, query, (a) => `${a.label} ${a.hint ?? ''}`), [actions, query])
  const current = Math.min(active, Math.max(results.length - 1, 0))

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  function choose(action: PaletteAction | undefined) {
    if (!action) return
    onClose()
    action.run()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current + 1) % Math.max(results.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current - 1 + results.length) % Math.max(results.length, 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[current])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={t('palette.placeholder')}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          className="w-full border-b border-zinc-200 bg-transparent px-4 py-3 text-base outline-none dark:border-zinc-800"
        />
        <ul id="palette-results" ref={list} role="listbox" className="max-h-[50vh] overflow-auto py-1">
          {results.length === 0 && <li className="px-4 py-2 text-sm text-zinc-500">{t('palette.empty')}</li>}
          {results.map((action, index) => (
            <li
              key={action.id}
              role="option"
              aria-selected={index === current}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(action)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${
                index === current ? 'bg-sky-100 dark:bg-sky-900/50' : ''
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
              {action.hint && <span className="max-w-[45%] truncate font-mono text-xs text-zinc-500">{action.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
