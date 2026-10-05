import { useTranslation } from 'react-i18next'

import { INPUT, SMALL_BUTTON } from '../styles'
import { asStringList, moveItem, type ControlProps } from './shared'

export function ToggleControl({ id, label, value, onChange, disabled }: ControlProps) {
  const checked = value === true || value === 'true'
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 rounded-full bg-zinc-300 transition-colors peer-checked:bg-sky-600 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 peer-disabled:opacity-50 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4 dark:bg-zinc-700"
      />
    </label>
  )
}

type Option = string | boolean

function sameOption(a: unknown, b: Option): boolean {
  return String(a).toLowerCase() === String(b).toLowerCase()
}

export function SelectControl({ id, label, value, onChange, disabled, options }: ControlProps & { options: readonly Option[] }) {
  const { t } = useTranslation()
  const current = options.find((o) => sameOption(value, o))
  const custom = current === undefined && value !== undefined && value !== null && value !== ''
  const optionLabel = (o: Option) => (o === '' ? t('settings.control.notSet') : String(o))
  return (
    <select
      id={id}
      aria-label={label}
      className={`${INPUT} max-w-full`}
      value={custom ? '\u0000custom' : String(current ?? '')}
      disabled={disabled}
      onChange={(e) => {
        const picked = options.find((o) => String(o) === e.target.value)
        if (picked !== undefined) onChange(picked)
      }}
    >
      {custom && <option value={'\u0000custom'}>{t('settings.control.currentValue', { value: String(value) })}</option>}
      {current === undefined && !custom && !options.includes('') && <option value="">{t('settings.control.notSet')}</option>}
      {options.map((o) => (
        <option key={String(o)} value={String(o)}>
          {optionLabel(o)}
        </option>
      ))}
    </select>
  )
}

interface MultiProps extends ControlProps {
  options: readonly string[]
  /** Keeps the chosen order and lets the user change it (first = primary). */
  ordered?: boolean
}

export function MultiControl({ id, label, value, onChange, disabled, options, ordered }: MultiProps) {
  const { t } = useTranslation()
  const selected = asStringList(value)
  const isOn = (option: string) => selected.some((s) => s.toLowerCase() === option.toLowerCase())
  const extra = selected.filter((s) => !options.some((o) => o.toLowerCase() === s.toLowerCase()))
  const all = [...options, ...extra]
  function toggle(option: string, on: boolean) {
    onChange(on ? [...selected, option] : selected.filter((s) => s.toLowerCase() !== option.toLowerCase()))
  }
  return (
    <div id={id} role="group" aria-label={label} className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {all.map((option) => (
          <label key={option} className="inline-flex items-center gap-1.5 font-mono text-sm">
            <input type="checkbox" checked={isOn(option)} disabled={disabled} onChange={(e) => toggle(option, e.target.checked)} />
            {option}
          </label>
        ))}
      </div>
      {ordered && selected.length > 1 && (
        <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label={t('settings.control.order')}>
          {selected.map((item, index) => (
            <li key={`${item}-${index}`} className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
              {index === 0 && <span className="text-[10px] text-sky-700 uppercase dark:text-sky-400">{t('settings.control.primary')}</span>}
              {item}
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={disabled || index === 0}
                aria-label={t('settings.control.moveEarlier', { item })}
                onClick={() => onChange(moveItem(selected, index, -1))}
              >
                ←
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
