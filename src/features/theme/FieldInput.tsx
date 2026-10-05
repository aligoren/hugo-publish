import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isRecord } from './discovery'
import type { ItemField, ThemeField } from './merge'
import type { Literal } from './scan/infer'
import { loadSiteAssets, type SiteAsset } from './siteAssets'
import { formatValue, useLoc } from './useLoc'

const INPUT =
  'w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 disabled:opacity-60'
const SMALL_BUTTON =
  'rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800'

interface Props {
  field: Pick<ThemeField, 'key' | 'type' | 'widget' | 'options' | 'optionLabels' | 'allowCustom' | 'itemFields' | 'default' | 'placeholder' | 'minimum' | 'maximum'>
  /** The value written in the site (or pending); undefined when not set. */
  value: unknown
  onChange(value: unknown): void
  /** Accessible name of the control. */
  label: string
  disabled?: boolean
  /** Icon names / options found in the theme, for `iconSelect` items. */
  id?: string
}

function optionKey(value: Literal): string {
  return JSON.stringify(value)
}

/** One editing control for a theme param, chosen by the field's widget. */
export function FieldInput({ field, value, onChange, label, disabled, id }: Props) {
  const { t } = useTranslation()
  const { loc } = useLoc()
  const autoId = useId()
  const inputId = id ?? autoId
  const placeholder = field.placeholder ?? (field.default !== undefined && typeof field.default !== 'object' ? formatValue(field.default) : '')

  switch (field.widget) {
    case 'toggle': {
      const effective = value === undefined ? field.default === true : value === true || value === 'true'
      return (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            id={inputId}
            type="checkbox"
            role="switch"
            className="h-4 w-4 accent-sky-700"
            checked={effective}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="text-zinc-600 dark:text-zinc-400">
            {effective ? t('theme.field.on') : t('theme.field.off')}
            {value === undefined && <span className="ml-1 text-xs text-zinc-400">({t('theme.field.themeDefault')})</span>}
          </span>
        </label>
      )
    }
    case 'select': {
      const options = field.options ?? []
      const known = value === undefined || options.some((o) => optionKey(o) === optionKey(value as Literal))
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select
            id={inputId}
            className={INPUT + ' max-w-xs'}
            aria-label={label}
            disabled={disabled}
            value={value === undefined ? '' : known ? optionKey(value as Literal) : '__custom'}
            onChange={(e) => {
              if (e.target.value === '') onChange(undefined)
              else if (e.target.value === '__custom') onChange(typeof value === 'string' ? value : '')
              else onChange(JSON.parse(e.target.value) as Literal)
            }}
          >
            <option value="">{field.default !== undefined ? t('theme.field.defaultOption', { value: formatValue(field.default) }) : t('theme.field.notSet')}</option>
            {options.map((o) => (
              <option key={optionKey(o)} value={optionKey(o)}>
                {field.optionLabels?.[String(o)] ? `${loc(field.optionLabels[String(o)])} (${String(o)})` : String(o)}
              </option>
            ))}
            {(field.allowCustom || !known) && <option value="__custom">{t('theme.field.custom')}</option>}
          </select>
          {!known && (
            <input className={INPUT + ' max-w-xs'} aria-label={label} value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
          )}
        </div>
      )
    }
    case 'iconSelect':
      return <DatalistInput id={inputId} label={label} value={value} options={field.options ?? []} onChange={onChange} disabled={disabled} />
    case 'number':
      return (
        <NumberInput
          id={inputId}
          label={label}
          placeholder={placeholder}
          min={field.minimum}
          max={field.maximum}
          integer={field.type === 'integer'}
          disabled={disabled}
          value={value}
          onChange={onChange}
        />
      )
    case 'textarea':
    case 'markdown':
    case 'html':
      return (
        <textarea
          id={inputId}
          className={INPUT + (field.widget === 'html' ? ' font-mono' : '')}
          rows={field.widget === 'html' ? 4 : 3}
          aria-label={label}
          placeholder={placeholder}
          disabled={disabled}
          value={typeof value === 'string' ? value : value === undefined ? '' : formatValue(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'color':
      return <ColorInput id={inputId} label={label} value={value} placeholder={placeholder} onChange={onChange} disabled={disabled} />
    case 'image':
    case 'asset':
      return <AssetInput id={inputId} label={label} value={value} placeholder={placeholder} images={field.widget === 'image'} onChange={onChange} disabled={disabled} />
    case 'stringList':
      return <StringListInput label={label} value={value} onChange={onChange} disabled={disabled} />
    case 'multiselect':
      return <MultiSelectInput label={label} value={value} options={field.options ?? []} labels={field.optionLabels} onChange={onChange} disabled={disabled} />
    case 'objectList':
      return <ObjectListInput label={label} value={value} items={field.itemFields ?? []} onChange={onChange} disabled={disabled} />
    case 'keyValue':
      return <KeyValueInput label={label} value={value} onChange={onChange} disabled={disabled} />
    case 'url':
    case 'dateFormat':
    case 'text':
    default:
      return (
        <input
          id={inputId}
          type="text"
          inputMode={field.widget === 'url' ? 'url' : undefined}
          className={INPUT + (field.widget === 'dateFormat' ? ' max-w-xs font-mono' : '')}
          aria-label={label}
          placeholder={placeholder}
          disabled={disabled}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : value === undefined ? '' : formatValue(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}


/**
 * Local editing state for list-like values: rows that are still empty stay on screen while the
 * value passed up leaves them out. The rows follow the value when it changes from outside.
 */
function useRows<T>(value: unknown, read: (value: unknown) => T[], clean: (rows: T[]) => unknown) {
  const [rows, setRows] = useState<T[]>(() => read(value))
  const outside = JSON.stringify(clean(read(value)))
  const [seen, setSeen] = useState(outside)
  if (outside !== seen) {
    setSeen(outside)
    if (outside !== JSON.stringify(clean(rows))) setRows(read(value))
  }
  return [rows, setRows] as const
}

function NumberInput(props: {
  id: string
  label: string
  placeholder: string
  min?: number
  max?: number
  integer: boolean
  value: unknown
  onChange(v: unknown): void
  disabled?: boolean
}) {
  const asText = (v: unknown) => (typeof v === 'number' || typeof v === 'string' ? String(v) : '')
  const [text, setText] = useRows<string>(
    props.value,
    (v) => [asText(v)],
    (rows) => (rows[0] === '' || Number.isNaN(Number(rows[0])) ? null : Number(rows[0])),
  )
  return (
    <input
      id={props.id}
      type="number"
      className={INPUT + ' max-w-40'}
      aria-label={props.label}
      placeholder={props.placeholder}
      min={props.min}
      max={props.max}
      step={props.integer ? 1 : 'any'}
      disabled={props.disabled}
      value={text[0]}
      onChange={(e) => {
        setText([e.target.value])
        const n = Number(e.target.value)
        if (e.target.value === '') props.onChange(undefined)
        else if (!Number.isNaN(n)) props.onChange(n)
      }}
    />
  )
}

function DatalistInput(props: { id: string; label: string; value: unknown; options: Literal[]; onChange(v: unknown): void; disabled?: boolean }) {
  const listId = `${props.id}-options`
  return (
    <>
      <input
        id={props.id}
        className={INPUT}
        list={listId}
        aria-label={props.label}
        disabled={props.disabled}
        value={typeof props.value === 'string' ? props.value : ''}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <datalist id={listId}>
        {props.options.map((o) => (
          <option key={String(o)} value={String(o)} />
        ))}
      </datalist>
    </>
  )
}

function toPickerHex(value: string): string | null {
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('').toLowerCase()
  return null
}

function ColorInput(props: { id: string; label: string; value: unknown; placeholder: string; onChange(v: unknown): void; disabled?: boolean }) {
  const { t } = useTranslation()
  const text = typeof props.value === 'string' ? props.value : ''
  const hex = toPickerHex(text) ?? toPickerHex(props.placeholder) ?? '#000000'
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
        aria-label={t('theme.field.pickColor', { name: props.label })}
        value={hex}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <input
        id={props.id}
        className={INPUT + ' max-w-40 font-mono'}
        aria-label={props.label}
        placeholder={props.placeholder}
        value={text}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  )
}

function AssetInput(props: { id: string; label: string; value: unknown; placeholder: string; images: boolean; onChange(v: unknown): void; disabled?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [assets, setAssets] = useState<SiteAsset[] | null>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => {
    if (!open || assets) return
    let cancelled = false
    void loadSiteAssets(props.images).then((list) => {
      if (!cancelled) setAssets(list)
    })
    return () => {
      cancelled = true
    }
  }, [open, assets, props.images])
  const shown = (assets ?? []).filter((a) => a.value.toLowerCase().includes(filter.toLowerCase())).slice(0, 200)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          id={props.id}
          className={INPUT + ' font-mono'}
          aria-label={props.label}
          placeholder={props.placeholder}
          value={typeof props.value === 'string' ? props.value : ''}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <button type="button" className="btn shrink-0" aria-expanded={open} disabled={props.disabled} onClick={() => setOpen(!open)}>
          {t('theme.field.chooseFile')}
        </button>
      </div>
      {open && (
        <div className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
          <input className={INPUT} placeholder={t('theme.field.filterFiles')} aria-label={t('theme.field.filterFiles')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {assets === null ? (
            <p className="mt-2 text-xs text-zinc-500">{t('common.loading')}</p>
          ) : shown.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">{t('theme.field.noFiles')}</p>
          ) : (
            <ul className="mt-2 max-h-48 overflow-auto text-sm">
              {shown.map((a) => (
                <li key={`${a.root}/${a.value}`}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    onClick={() => {
                      props.onChange(a.value)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate font-mono text-xs">{a.value}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{a.root}/</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-zinc-500">{t('theme.field.assetHint')}</p>
        </div>
      )}
    </div>
  )
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

function StringListInput(props: { label: string; value: unknown; onChange(v: unknown): void; disabled?: boolean }) {
  const { t } = useTranslation()
  const read = (v: unknown) => asList(v).map((x) => (typeof x === 'string' ? x : formatValue(x)))
  const clean = (rows: string[]) => rows.filter((r) => r.trim() !== '')
  const [items, setItems] = useRows(props.value, read, clean)
  const set = (next: string[]) => {
    setItems(next)
    props.onChange(clean(next))
  }
  return (
    <div className="space-y-1" role="group" aria-label={props.label}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            className={INPUT}
            aria-label={t('theme.field.item', { name: props.label, n: i + 1 })}
            value={item}
            disabled={props.disabled}
            onChange={(e) => set(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button type="button" className={SMALL_BUTTON} aria-label={t('theme.field.removeItem', { n: i + 1 })} disabled={props.disabled} onClick={() => set(items.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={SMALL_BUTTON} disabled={props.disabled} onClick={() => set([...items, ''])}>
        + {t('theme.field.addItem')}
      </button>
    </div>
  )
}

function MultiSelectInput(props: {
  label: string
  value: unknown
  options: Literal[]
  labels?: Record<string, { en: string; tr: string }>
  onChange(v: unknown): void
  disabled?: boolean
}) {
  const { loc } = useLoc()
  const selected = asList(props.value).map(String)
  const extra = selected.filter((s) => !props.options.map(String).includes(s))
  const all = [...props.options.map(String), ...extra]
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1" aria-label={props.label}>
      {all.map((option) => (
        <label key={option} className="inline-flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="accent-sky-700"
            checked={selected.includes(option)}
            disabled={props.disabled}
            onChange={(e) => props.onChange(e.target.checked ? [...selected, option] : selected.filter((s) => s !== option))}
          />
          {props.labels?.[option] ? loc(props.labels[option]) : option}
        </label>
      ))}
    </fieldset>
  )
}

function ObjectListInput(props: { label: string; value: unknown; items: ItemField[]; onChange(v: unknown): void; disabled?: boolean }) {
  const { t } = useTranslation()
  const { loc } = useLoc()
  const read = (v: unknown) => asList(v).map((r) => (isRecord(r) ? r : {}))
  const clean = (list: Record<string, unknown>[]) => list.filter((r) => Object.keys(r).length > 0)
  const [rows, setRows] = useRows(props.value, read, clean)
  const set = (next: Record<string, unknown>[]) => {
    setRows(next)
    props.onChange(clean(next))
  }
  const fields: ItemField[] =
    props.items.length > 0 ? props.items : [{ name: 'name', type: 'string', widget: 'text' }, { name: 'url', type: 'url', widget: 'url' }]
  const move = (i: number, d: number) => {
    const next = [...rows]
    const [row] = next.splice(i, 1)
    next.splice(i + d, 0, row)
    set(next)
  }
  return (
    <div className="space-y-2" role="group" aria-label={props.label}>
      {rows.map((row, i) => {
        const extraKeys = Object.keys(row).filter((k) => !fields.some((f) => f.name.toLowerCase() === k.toLowerCase()))
        return (
          <div key={i} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">#{i + 1}</span>
              <span className="flex gap-1">
                <button type="button" className={SMALL_BUTTON} aria-label={t('theme.field.moveUp', { n: i + 1 })} disabled={props.disabled || i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  className={SMALL_BUTTON}
                  aria-label={t('theme.field.moveDown', { n: i + 1 })}
                  disabled={props.disabled || i === rows.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button type="button" className={SMALL_BUTTON} aria-label={t('theme.field.removeItem', { n: i + 1 })} disabled={props.disabled} onClick={() => set(rows.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {fields.map((item) => {
                const key = Object.keys(row).find((k) => k.toLowerCase() === item.name.toLowerCase()) ?? item.name
                const itemLabel = `${item.label ? loc(item.label) : item.name} (#${i + 1})`
                return (
                  <div key={item.name} className="space-y-0.5">
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      {item.label ? loc(item.label) : item.name}
                      {item.required && ' *'}
                    </span>
                    <FieldInput
                      field={{ key: item.name, type: item.type, widget: item.widget === 'objectList' ? 'text' : item.widget, options: item.options, allowCustom: item.allowCustom }}
                      label={itemLabel}
                      value={row[key]}
                      disabled={props.disabled}
                      onChange={(v) => {
                        const next = { ...row }
                        if (v === undefined || v === '') delete next[key]
                        else next[key] = v
                        set(rows.map((r, j) => (j === i ? next : r)))
                      }}
                    />
                  </div>
                )
              })}
            </div>
            {extraKeys.length > 0 && (
              <p className="mt-1 text-xs text-zinc-500">{t('theme.field.keptKeys', { keys: extraKeys.join(', ') })}</p>
            )}
          </div>
        )
      })}
      <button type="button" className={SMALL_BUTTON} disabled={props.disabled} onClick={() => set([...rows, {}])}>
        + {t('theme.field.addItem')}
      </button>
    </div>
  )
}

function KeyValueInput(props: { label: string; value: unknown; onChange(v: unknown): void; disabled?: boolean }) {
  const { t } = useTranslation()
  const record = isRecord(props.value) ? props.value : {}
  const nested = Object.values(record).some((v) => v !== null && typeof v === 'object')
  const read = (v: unknown) => Object.entries(isRecord(v) ? v : {})
  const clean = (rows: [string, unknown][]) => Object.fromEntries(rows.filter(([k]) => k.trim() !== ''))
  const [entries, setEntries] = useRows<[string, unknown]>(props.value, read, clean)
  if (nested) {
    return (
      <div className="space-y-1">
        <pre className="max-h-40 overflow-auto rounded-md bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-800">{JSON.stringify(record, null, 2)}</pre>
        <p className="text-xs text-zinc-500">{t('theme.field.nestedReadOnly')}</p>
      </div>
    )
  }
  const set = (next: [string, unknown][]) => {
    setEntries(next)
    props.onChange(clean(next))
  }
  return (
    <div className="space-y-1" role="group" aria-label={props.label}>
      {entries.map(([key, value], i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            className={INPUT + ' max-w-48 font-mono'}
            aria-label={t('theme.field.key', { n: i + 1 })}
            value={key}
            disabled={props.disabled}
            onChange={(e) => set(entries.map(([k, v], j) => (j === i ? [e.target.value, v] : [k, v])))}
          />
          <input
            className={INPUT}
            aria-label={t('theme.field.value', { n: i + 1 })}
            value={formatValue(value)}
            disabled={props.disabled}
            onChange={(e) => set(entries.map(([k, v], j) => (j === i ? [k, typeof v === 'boolean' ? e.target.value === 'true' : typeof v === 'number' && e.target.value.trim() !== '' && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value] : [k, v])))}
          />
          <button type="button" className={SMALL_BUTTON} aria-label={t('theme.field.removeItem', { n: i + 1 })} disabled={props.disabled} onClick={() => set(entries.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={SMALL_BUTTON} disabled={props.disabled} onClick={() => set([...entries, [`key${entries.length + 1}`, '']])}>
        + {t('theme.field.addItem')}
      </button>
    </div>
  )
}
