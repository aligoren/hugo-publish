import { useTranslation } from 'react-i18next'

interface Props {
  label: string
  values: readonly string[]
  onChange(values: string[]): void
  disabled?: boolean
  placeholder?: string
  mono?: boolean
  /** Adds an item chosen in the media picker (image lists). */
  onPick?: () => Promise<string | null>
  hint?: string
}

/** An editable list of strings (aliases, image lists, any list of text). */
export function ListField({ label, values, onChange, disabled, placeholder, mono, onPick, hint }: Props) {
  const { t } = useTranslation()
  return (
    <fieldset className="field">
      <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</legend>
      {values.length > 0 && (
        <ul className="space-y-1">
          {values.map((value, index) => (
            <li key={index} className="flex items-center gap-2">
              <input
                aria-label={`${label} ${index + 1}`}
                className={`min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 ${mono ? 'font-mono' : ''}`}
                value={value}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(e) => onChange(values.map((v, i) => (i === index ? e.target.value : v)))}
              />
              <button
                type="button"
                className="btn px-2 py-1 text-xs"
                disabled={disabled}
                aria-label={t('document.removeItem', { item: value || index + 1 })}
                onClick={() => onChange(values.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn px-2 py-1 text-xs" disabled={disabled} onClick={() => onChange([...values, ''])}>
          {t('document.addItem')}
        </button>
        {onPick && (
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            disabled={disabled}
            onClick={() => {
              void onPick().then((picked) => {
                if (picked) onChange([...values, picked])
              })
            }}
          >
            {t('document.chooseImage')}
          </button>
        )}
      </div>
      {hint && <small className="text-zinc-500">{hint}</small>}
    </fieldset>
  )
}
