import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { parseEnvironmentName } from '../model/validate'
import { FieldError } from './controls/FieldError'
import { INPUT, LINK_BUTTON } from './styles'

interface Props {
  environments: readonly string[]
  /** null = all environments (root + `config/_default`). */
  value: string | null
  onChange(env: string | null): void
  /** Asks to create `config/<name>/hugo.toml`. */
  onCreate(name: string): void
}

export function EnvironmentPicker({ environments, value, onChange, onCreate }: Props) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const parsed = parseEnvironmentName(name, environments)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{t('settings.env.label')}</span>
        <select className={INPUT} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
          <option value="">{t('settings.env.all')}</option>
          {environments.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
      </label>
      {creating ? (
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!parsed.ok) return
            onCreate(parsed.value)
            setCreating(false)
            setName('')
          }}
        >
          <div className="flex flex-col gap-1">
            <input
              autoFocus
              aria-label={t('settings.env.newName')}
              placeholder="production"
              className={`${INPUT} w-36 font-mono`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {name.trim() !== '' && <FieldError id="settings-env-error" error={parsed.ok ? null : parsed.error} />}
          </div>
          <button type="submit" className="btn" disabled={!parsed.ok}>
            {t('settings.env.create')}
          </button>
          <button type="button" className="btn" onClick={() => setCreating(false)}>
            {t('common.cancel')}
          </button>
        </form>
      ) : (
        <button type="button" className={LINK_BUTTON} onClick={() => setCreating(true)}>
          {t('settings.env.new')}
        </button>
      )}
    </div>
  )
}
