import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isPlainObject, type Tree } from '../../model/values'
import { INPUT, SMALL_BUTTON } from '../styles'
import { asStringList, moveItem, type ControlProps } from './shared'

/** Ordered strings as chips, with an input to add more. */
export function ListControl({ id, label, value, onChange, disabled, suggestions }: ControlProps & { suggestions?: readonly string[] }) {
  const { t } = useTranslation()
  const items = asStringList(value)
  const [draft, setDraft] = useState('')
  const listId = suggestions && suggestions.length > 0 ? `${id}-options` : undefined
  function add() {
    const item = draft.trim()
    if (item === '') return
    if (!items.includes(item)) onChange([...items, item])
    setDraft('')
  }
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {items.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-2.5 font-mono text-xs dark:bg-zinc-800"
            >
              {item}
              {items.length > 1 && (
                <button
                  type="button"
                  className="rounded px-1 text-zinc-500 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700"
                  disabled={disabled || index === 0}
                  aria-label={t('settings.control.moveEarlier', { item })}
                  onClick={() => onChange(moveItem(items, index, -1))}
                >
                  ←
                </button>
              )}
              <button
                type="button"
                className="rounded px-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                disabled={disabled}
                aria-label={t('settings.control.removeItem', { item })}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          aria-label={t('settings.control.addTo', { label })}
          className={`${INPUT} w-56 font-mono`}
          value={draft}
          list={listId}
          disabled={disabled}
          placeholder={t('settings.control.newItem')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="btn" disabled={disabled || draft.trim() === ''} onClick={add}>
          {t('settings.control.add')}
        </button>
      </div>
      {listId && (
        <datalist id={listId}>
          {suggestions!
            .filter((s) => !items.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  )
}

/** Pairs of strings, e.g. passthrough delimiters `[['$$', '$$']]`. */
export function PairsControl({ id, label, value, onChange, disabled }: ControlProps) {
  const { t } = useTranslation()
  const pairs: [string, string][] = Array.isArray(value)
    ? value.map((p) => (Array.isArray(p) ? [String(p[0] ?? ''), String(p[1] ?? '')] : [String(p), '']))
    : []
  const update = (index: number, side: 0 | 1, text: string) =>
    onChange(pairs.map((p, i) => (i === index ? ((side === 0 ? [text, p[1]] : [p[0], text]) as [string, string]) : p)))
  return (
    <div id={id} role="group" aria-label={label} className="space-y-1.5">
      {pairs.map((pair, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            aria-label={t('settings.control.opening', { index: index + 1 })}
            className={`${INPUT} w-24 font-mono`}
            value={pair[0]}
            disabled={disabled}
            onChange={(e) => update(index, 0, e.target.value)}
          />
          <span className="text-zinc-400">…</span>
          <input
            aria-label={t('settings.control.closing', { index: index + 1 })}
            className={`${INPUT} w-24 font-mono`}
            value={pair[1]}
            disabled={disabled}
            onChange={(e) => update(index, 1, e.target.value)}
          />
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={disabled}
            aria-label={t('settings.control.removeRow', { index: index + 1 })}
            onClick={() => onChange(pairs.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className={SMALL_BUTTON} disabled={disabled} onClick={() => onChange([...pairs, ['', '']])}>
        {t('settings.control.addRow')}
      </button>
    </div>
  )
}

interface KvProps extends ControlProps {
  keyPlaceholder?: string
  valuePlaceholder?: string
}

/** String keys to string values (`taxonomies`, `permalinks`). Nested tables are kept but not edited. */
export function KvControl({ id, label, value, onChange, disabled, keyPlaceholder, valuePlaceholder }: KvProps) {
  const { t } = useTranslation()
  const map: Tree = isPlainObject(value) ? value : {}
  const entries = Object.entries(map)
  // Rows being typed with an empty key are kept here until they get one.
  const [blank, setBlank] = useState<string | null>(null)
  function emit(next: [string, unknown][]) {
    const out: Tree = {}
    for (const [k, v] of next) if (k !== '') out[k] = v
    onChange(out)
  }
  function rename(index: number, key: string) {
    // An emptied key would drop the row while typing; keep the old key until a new one is typed.
    if (key === '') return
    emit(entries.map(([k, v], i) => (i === index ? [key, v] : [k, v])))
  }
  function setValue(index: number, text: string) {
    emit(entries.map(([k, v], i) => (i === index ? [k, text] : [k, v])))
  }
  return (
    <div id={id} role="group" aria-label={label} className="space-y-1.5">
      {entries.map(([k, v], index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            aria-label={t('settings.control.key', { index: index + 1 })}
            className={`${INPUT} w-40 font-mono`}
            value={k}
            disabled={disabled}
            onChange={(e) => rename(index, e.target.value)}
          />
          <span className="text-zinc-400">→</span>
          {isPlainObject(v) || Array.isArray(v) ? (
            <span className="text-xs text-zinc-500">{t('settings.control.nestedTable')}</span>
          ) : (
            <input
              aria-label={t('settings.control.value', { key: k })}
              className={`${INPUT} min-w-0 flex-1 font-mono`}
              value={String(v ?? '')}
              disabled={disabled}
              onChange={(e) => setValue(index, e.target.value)}
            />
          )}
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={disabled}
            aria-label={t('settings.control.removeItem', { item: k })}
            onClick={() => emit(entries.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      {blank !== null ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            aria-label={t('settings.control.newKey')}
            className={`${INPUT} w-40 font-mono`}
            value={blank}
            placeholder={keyPlaceholder}
            onChange={(e) => setBlank(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && blank.trim() !== '') {
                emit([...entries, [blank.trim(), '']])
                setBlank(null)
              } else if (e.key === 'Escape') {
                setBlank(null)
              }
            }}
          />
          <span className="text-xs text-zinc-500">{valuePlaceholder ? `→ ${valuePlaceholder}` : ''}</span>
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={blank.trim() === '' || Object.prototype.hasOwnProperty.call(map, blank.trim())}
            onClick={() => {
              emit([...entries, [blank.trim(), '']])
              setBlank(null)
            }}
          >
            {t('settings.control.add')}
          </button>
        </div>
      ) : (
        <button type="button" className={SMALL_BUTTON} disabled={disabled} onClick={() => setBlank('')}>
          {t('settings.control.addRow')}
        </button>
      )}
    </div>
  )
}
