import type { ReactNode } from 'react'

interface Props {
  label: string
  value: string
  onChange(value: string): void
  multiline?: boolean
  rows?: number
  mono?: boolean
  placeholder?: string
  disabled?: boolean
  hint?: ReactNode
  /** Shows the hint as a warning. */
  warn?: boolean
  type?: 'text' | 'number'
  /** Extra controls after the input (buttons). */
  children?: ReactNode
}

export function TextField({ label, value, onChange, multiline, rows = 2, mono, placeholder, disabled, hint, warn, type = 'text', children }: Props) {
  const className = mono ? 'font-mono' : undefined
  const input = multiline ? (
    <textarea
      className={className}
      rows={rows}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <input
      className={`${className ?? ''} min-w-0 flex-1`}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  )
  return (
    <label className="field">
      <span>{label}</span>
      {children ? (
        <div className="flex items-center gap-2">
          {input}
          {children}
        </div>
      ) : (
        input
      )}
      {hint !== undefined && (
        <small className={warn ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500'}>{hint}</small>
      )}
    </label>
  )
}

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small className="block text-xs text-zinc-500">{hint}</small>}
      </span>
    </label>
  )
}
