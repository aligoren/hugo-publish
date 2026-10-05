import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { nowInFormat, type DateFormat } from '../dates'
import { emptyValue } from '../fieldKinds'
import { findKey } from '../frontMatterOps'
import { FieldControl, type FieldEnv } from './FieldControl'

interface Props {
  env: FieldEnv
  keys: readonly string[]
  values: Record<string, unknown>
  /** Format for a new date field. */
  dateTemplate: DateFormat
}

/** Every front matter key without a field of its own, plus adding and removing fields. */
export function OtherFields({ env, keys, values, dateTemplate }: Props) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      {keys.length === 0 && <p className="text-xs text-zinc-500">{t('document.noOtherFields')}</p>}
      {keys.map((key) => (
        <div key={key} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <FieldControl env={env} path={[key]} label={key} value={values[key]} />
          </div>
          <button
            type="button"
            className="btn mt-5 px-2 py-1 text-xs"
            disabled={env.disabled}
            aria-label={t('document.removeField', { field: key })}
            title={t('document.removeField', { field: key })}
            onClick={() => env.fm.remove([key])}
          >
            ×
          </button>
        </div>
      ))}
      {!env.disabled && (
        <AddField
          values={values}
          onAdd={(key, kind) => {
            if (kind === 'date') env.fm.set([key], nowInFormat(dateTemplate), { datetime: env.bareDates })
            else env.fm.set([key], emptyValue(kind))
          }}
        />
      )}
    </div>
  )
}

type NewKind = 'string' | 'number' | 'boolean' | 'stringList' | 'date'

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/

function AddField({ values, onAdd }: { values: Record<string, unknown>; onAdd(key: string, kind: NewKind): void }) {
  const { t } = useTranslation()
  const [key, setKey] = useState('')
  const [kind, setKind] = useState<NewKind>('string')
  const trimmed = key.trim()
  const exists = trimmed !== '' && findKey(values, trimmed) !== undefined
  const invalid = trimmed !== '' && !KEY_RE.test(trimmed)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || exists || invalid) return
    onAdd(trimmed, kind)
    setKey('')
  }

  return (
    <form className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800" onSubmit={submit}>
      <label className="field">
        <span>{t('document.newFieldName')}</span>
        <input className="font-mono" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('document.newFieldType')}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as NewKind)}>
          <option value="string">{t('document.typeText')}</option>
          <option value="number">{t('document.typeNumber')}</option>
          <option value="boolean">{t('document.typeBoolean')}</option>
          <option value="stringList">{t('document.typeList')}</option>
          <option value="date">{t('document.typeDate')}</option>
        </select>
      </label>
      <button type="submit" className="btn" disabled={!trimmed || exists || invalid}>
        {t('document.addField')}
      </button>
      {exists && <small className="w-full text-amber-700 dark:text-amber-400">{t('document.fieldExists', { field: trimmed })}</small>}
      {invalid && <small className="w-full text-amber-700 dark:text-amber-400">{t('document.fieldNameInvalid')}</small>}
    </form>
  )
}
