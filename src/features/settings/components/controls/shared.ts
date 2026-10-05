import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ValidationError } from '../../model/validate'

export interface ControlProps<T = unknown> {
  /** Id of the main input, for the field's `<label htmlFor>`. */
  id: string
  /** Accessible name for inputs without a visible label. */
  label: string
  value: T
  onChange(value: unknown): void
  disabled?: boolean
}

/**
 * Text that follows `value` from outside (reset, discard) but keeps what the user typed while it
 * is not valid yet. `commit` returns an error to keep the text local.
 */
export function useBufferedText(value: string, commit: (text: string) => ValidationError | null) {
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)
  const [error, setError] = useState<ValidationError | null>(null)
  if (value !== synced) {
    setSynced(value)
    setText(value)
    setError(null)
  }
  function change(next: string) {
    setText(next)
    setError(commit(next))
  }
  return { text, error, change }
}

export function useValidationMessage() {
  const { t } = useTranslation()
  return (error: ValidationError | null) => (error ? t(`settings.validation.${error.key}`, error) : null)
}

export function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
  if (typeof value === 'string' && value !== '') return [value]
  return []
}

export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = index + delta
  if (to < 0 || to >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}
