import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  label: string
  value: string
  onChange(value: string): void
  /** Opens the media picker; resolves with what to write, or null when closed. */
  onPick(): Promise<string | null>
  /** A `data:` URL preview for the value, or null. */
  preview(src: string): Promise<string | null>
  disabled?: boolean
}

/** An image path (cover, thumbnail, …) with a picker and a small preview. */
export function ImageField({ label, value, onChange, onPick, preview, disabled }: Props) {
  const { t } = useTranslation()
  const [thumb, setThumb] = useState<{ src: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!value) return
    let cancelled = false
    void preview(value).then((url) => {
      if (!cancelled) setThumb({ src: value, url })
    })
    return () => {
      cancelled = true
    }
  }, [preview, value])

  const url = thumb?.src === value ? thumb.url : null

  return (
    <div className="field">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        {url && <img src={url} alt="" className="h-10 w-14 shrink-0 rounded border border-zinc-200 object-cover dark:border-zinc-700" />}
        <input
          aria-label={label}
          className="min-w-0 flex-1 font-mono"
          value={value}
          disabled={disabled}
          placeholder={t('document.imagePlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn px-2 py-1 text-xs"
          disabled={disabled}
          onClick={() => {
            void onPick().then((picked) => {
              if (picked) onChange(picked)
            })
          }}
        >
          {t('document.chooseImage')}
        </button>
      </div>
    </div>
  )
}
