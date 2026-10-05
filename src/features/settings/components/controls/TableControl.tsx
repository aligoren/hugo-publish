import { useTranslation } from 'react-i18next'

import type { ListRow } from '../../model/lists'
import { isPlainObject, type Tree } from '../../model/values'
import type { Column } from '../../schema'
import { INPUT, SMALL_BUTTON } from '../styles'
import { asStringList } from './shared'

interface Props {
  id: string
  label: string
  columns: readonly Column[]
  /** For named tables (`outputFormats.<name>`): the pseudo-column holding the name. */
  keyColumn?: string
  rows: readonly ListRow[]
  onChange(rows: ListRow[]): void
  disabled?: boolean
  /** Shows the "add row" button (named tables add rows by name instead). */
  allowAdd?: boolean
}

/** `Header: value` lines for map cells such as `server.headers[].values`. */
function mapToText(value: unknown): string {
  return isPlainObject(value)
    ? Object.entries(value)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('\n')
    : ''
}

function textToMap(text: string): Tree {
  const out: Tree = {}
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

/** Rows of a small table as cards; clearing a cell removes that key from the row. */
export function TableControl({ id, label, columns, keyColumn, rows, onChange, disabled, allowAdd = true }: Props) {
  const { t } = useTranslation()
  const allColumns: Column[] = keyColumn ? [{ key: keyColumn, type: 'text' }, ...columns] : [...columns]

  function setCell(index: number, key: string, value: unknown) {
    onChange(
      rows.map((row, i) => {
        if (i !== index) return row
        const values = { ...row.values }
        const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
        if (empty) delete values[key]
        else values[key] = value
        return { ...row, values }
      }),
    )
  }

  function cell(row: ListRow, index: number, column: Column) {
    const value = row.values[column.key]
    const cellId = `${id}-${index}-${column.key}`
    const common = { id: cellId, disabled }
    switch (column.type) {
      case 'toggle':
        return (
          <input {...common} type="checkbox" checked={value === true} onChange={(e) => setCell(index, column.key, e.target.checked || undefined)} />
        )
      case 'number':
        return (
          <input
            {...common}
            inputMode="numeric"
            className={`${INPUT} w-24 font-mono`}
            value={value === undefined ? '' : String(value)}
            onChange={(e) => {
              const text = e.target.value.trim()
              const n = Number(text)
              setCell(index, column.key, text === '' ? undefined : Number.isFinite(n) ? n : value)
            }}
          />
        )
      case 'select':
        return (
          <select {...common} className={INPUT} value={String(value ?? '')} onChange={(e) => setCell(index, column.key, e.target.value)}>
            <option value="">{t('settings.control.notSet')}</option>
            {(column.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )
      case 'list':
        return (
          <input
            {...common}
            className={`${INPUT} w-full font-mono`}
            value={asStringList(value).join(', ')}
            onChange={(e) =>
              setCell(
                index,
                column.key,
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s !== ''),
              )
            }
          />
        )
      case 'map':
        return (
          <textarea
            {...common}
            rows={Math.max(2, mapToText(value).split('\n').length + 1)}
            spellCheck={false}
            className={`${INPUT} w-full font-mono text-xs`}
            value={mapToText(value)}
            placeholder="X-Frame-Options: DENY"
            onChange={(e) => setCell(index, column.key, textToMap(e.target.value))}
          />
        )
      default:
        return (
          <input
            {...common}
            className={`${INPUT} w-full font-mono`}
            value={value === undefined ? '' : String(value)}
            onChange={(e) => setCell(index, column.key, e.target.value)}
          />
        )
    }
  }

  return (
    <div id={id} role="group" aria-label={label} className="space-y-2">
      {rows.length === 0 && <p className="text-xs text-zinc-500">{t('settings.control.noRows')}</p>}
      {rows.map((row, index) => (
        <fieldset key={index} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
          <legend className="px-1 text-xs text-zinc-500">
            {keyColumn ? String(row.values[keyColumn] ?? '') || t('settings.control.row', { index: index + 1 }) : t('settings.control.row', { index: index + 1 })}
          </legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
            {allColumns.map((column) => (
              <label
                key={column.key}
                htmlFor={`${id}-${index}-${column.key}`}
                className={`flex flex-col gap-0.5 text-[11px] text-zinc-500 ${column.type === 'map' ? 'col-span-full' : ''} ${column.type === 'toggle' ? 'flex-row-reverse items-center justify-end gap-2' : ''}`}
              >
                <span className="font-mono">{column.key}</span>
                {cell(row, index, column)}
              </label>
            ))}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className={SMALL_BUTTON}
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              {t('settings.control.removeRow', { index: index + 1 })}
            </button>
          </div>
        </fieldset>
      ))}
      {allowAdd && (
        <button type="button" className={SMALL_BUTTON} disabled={disabled} onClick={() => onChange([...rows, { orig: null, values: {} }])}>
          {t('settings.control.addRow')}
        </button>
      )}
    </div>
  )
}
