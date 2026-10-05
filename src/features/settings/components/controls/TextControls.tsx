import { parseDuration, parseNumber, parseUrl } from '../../model/validate'
import { INPUT, INPUT_INVALID } from '../styles'
import { FieldError } from './FieldError'
import { asStringList, asText, useBufferedText, type ControlProps } from './shared'

interface TextProps extends ControlProps {
  suggestions?: readonly string[]
  monospace?: boolean
  placeholder?: string
}

export function TextControl({ id, label, value, onChange, disabled, suggestions, monospace, placeholder }: TextProps) {
  const listId = suggestions && suggestions.length > 0 ? `${id}-options` : undefined
  return (
    <>
      <input
        id={id}
        aria-label={label}
        className={`${INPUT} w-full ${monospace ? 'font-mono' : ''}`}
        value={asText(value)}
        list={listId}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  )
}

export function UrlControl({ id, label, value, onChange, disabled, trailingSlash = false }: ControlProps & { trailingSlash?: boolean }) {
  const { text, error, change } = useBufferedText(asText(value), (next) => {
    const parsed = parseUrl(next, trailingSlash)
    if (!parsed.ok) return parsed.error
    onChange(parsed.value)
    return null
  })
  return (
    <>
      <input
        id={id}
        aria-label={label}
        type="url"
        inputMode="url"
        className={`${INPUT} w-full font-mono ${error ? INPUT_INVALID : ''}`}
        value={text}
        disabled={disabled}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder="https://example.org/"
        onChange={(e) => change(e.target.value)}
      />
      <FieldError id={`${id}-error`} error={error} />
    </>
  )
}

interface NumberProps extends ControlProps {
  integer?: boolean
  min?: number
  max?: number
  step?: number
}

export function NumberControl({ id, label, value, onChange, disabled, integer, min, max, step }: NumberProps) {
  const { text, error, change } = useBufferedText(asText(value), (next) => {
    const parsed = parseNumber(next, { integer, min, max })
    if (!parsed.ok) return parsed.error
    onChange(parsed.value)
    return null
  })
  return (
    <>
      <input
        id={id}
        aria-label={label}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        className={`${INPUT} w-32 font-mono ${error ? INPUT_INVALID : ''}`}
        value={text}
        disabled={disabled}
        data-step={step}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => change(e.target.value)}
      />
      <FieldError id={`${id}-error`} error={error} />
    </>
  )
}

export function DurationControl({ id, label, value, onChange, disabled }: ControlProps) {
  const { text, error, change } = useBufferedText(asText(value), (next) => {
    const parsed = parseDuration(next)
    if (!parsed.ok) return parsed.error
    onChange(parsed.value)
    return null
  })
  return (
    <>
      <input
        id={id}
        aria-label={label}
        className={`${INPUT} w-40 font-mono ${error ? INPUT_INVALID : ''}`}
        value={text}
        disabled={disabled}
        placeholder="60s"
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => change(e.target.value)}
      />
      <FieldError id={`${id}-error`} error={error} />
    </>
  )
}

/** `#ffffff`, also accepting Hugo's normalized `ffffff`. */
function pickerColor(value: string): string {
  const hex = value.replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${[...hex].map((c) => c + c).join('').toLowerCase()}`
  return '#ffffff'
}

export function ColorControl({ id, label, value, onChange, disabled }: ControlProps) {
  const text = asText(value)
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-white dark:border-zinc-700"
        value={pickerColor(text)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        id={id}
        aria-label={label}
        className={`${INPUT} w-32 font-mono`}
        value={text}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** One string per line (regexes, globs); empty lines are dropped. */
export function LinesControl({ id, label, value, onChange, disabled }: ControlProps) {
  const joined = asStringList(value).join('\n')
  const { text, change } = useBufferedText(joined, (next) => {
    onChange(
      next
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    )
    return null
  })
  return (
    <textarea
      id={id}
      aria-label={label}
      className={`${INPUT} w-full font-mono text-xs`}
      rows={Math.min(8, Math.max(2, text.split('\n').length + 1))}
      value={text}
      spellCheck={false}
      disabled={disabled}
      onChange={(e) => change(e.target.value)}
    />
  )
}
