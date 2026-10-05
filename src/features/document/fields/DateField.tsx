import { useTranslation } from 'react-i18next'

import {
  fromInputValue,
  inputType,
  nowInFormat,
  parseDate,
  toInputValue,
  zoneLabel,
  type DateFormat,
  type ParsedDate,
} from '../dates'

interface Props {
  label: string
  /** The value in the front matter (a string as written), or undefined when the key is absent. */
  value: unknown
  /** How the value is written when that differs from `value` (TOML date-times). */
  raw?: string | null
  /** Format for a value set from scratch (copied from the document's other dates). */
  template: DateFormat
  onChange(value: string): void
  /** Removes the key; when given, a clear button is shown. */
  onClear?: () => void
  disabled?: boolean
}

const EMPTY_WALL = { year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0, fraction: '' }

/**
 * A date picker that writes the value back in the file's own format: date-only stays date-only,
 * an offset such as `+03:00` is kept, seconds stay when they were written.
 */
export function DateField({ label, value, raw, template, onChange, onClear, disabled }: Props) {
  const { t } = useTranslation()
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  const parsed: ParsedDate | null = text ? (parseDate(raw ?? text) ?? parseDate(text)) : null
  const format = parsed?.format ?? template
  const zone = zoneLabel(format.zone)

  if (text && !parsed) {
    // Not a date the picker understands (e.g. `{{ .Date }}` or "3 Oct 2026"): edit it as text.
    return (
      <label className="field">
        <span>{label}</span>
        <input className="font-mono" value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        <small className="text-zinc-500">{t('document.dateUnknownFormat')}</small>
      </label>
    )
  }

  return (
    <div className="field">
      <span>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={label}
          type={inputType(format)}
          step={format.hasTime && format.seconds ? 1 : undefined}
          value={parsed ? toInputValue(parsed) : ''}
          disabled={disabled}
          onChange={(e) => {
            const next = fromInputValue(e.target.value, parsed ?? { format, wall: EMPTY_WALL })
            if (next !== null) onChange(next)
            else if (e.target.value === '' && onClear) onClear()
          }}
        />
        <button type="button" className="btn px-2 py-1 text-xs" disabled={disabled} onClick={() => onChange(nowInFormat(format))}>
          {format.hasTime ? t('document.dateNow') : t('document.dateToday')}
        </button>
        {onClear && text && (
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            disabled={disabled}
            aria-label={t('document.clearField', { field: label })}
            onClick={onClear}
          >
            ×
          </button>
        )}
      </div>
      {format.hasTime && (
        <small className="text-zinc-500">
          {zone ? t('document.dateZone', { zone }) : t('document.dateNoZone')}
          {parsed && <span className="ml-2 font-mono">{raw ?? text}</span>}
        </small>
      )}
    </div>
  )
}
