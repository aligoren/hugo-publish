import type { ValidationError } from '../../model/validate'
import { useValidationMessage } from './shared'

export function FieldError({ id, error }: { id: string; error: ValidationError | null }) {
  const message = useValidationMessage()(error)
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-xs text-red-700 dark:text-red-400">
      {message}
    </p>
  )
}
