import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FrontMatterParts, FrontMatterValue } from '../../../lib/frontmatter'
import { templateFormat } from '../dates'
import { inferFieldKind } from '../fieldKinds'
import type { FieldPath } from '../frontMatterOps'
import { extractSnippet } from '../snippet'
import type { FrontMatterController } from '../useFrontMatter'
import { DateField } from './DateField'
import { ImageField } from './ImageField'
import { ListField } from './ListField'
import { AiSuggestButton } from './AiSuggest'
import { SnippetEditor } from './SnippetEditor'
import { CheckboxField, TextField } from './TextField'

/** What every field control needs from the form. */
export interface FieldEnv {
  fm: FrontMatterController
  parts: FrontMatterParts
  getParts(): FrontMatterParts | null
  disabled: boolean
  /** Opens the media picker in the document's image folder; resolves with what to write. */
  pickImage(): Promise<string | null>
  previewImage(src: string): Promise<string | null>
  /** Whether new TOML dates are written as bare date-times. */
  bareDates: boolean
  /** AI alt text for an image `src` (only when the assistant is on). */
  suggestAlt?: (src: string) => Promise<string>
}

interface Props {
  env: FieldEnv
  path: FieldPath
  label: string
  value: unknown
}

/** The control for one value, chosen by its type. */
export function FieldControl({ env, path, label, value }: Props) {
  const { t } = useTranslation()
  const { fm, disabled } = env
  const key = String(path[path.length - 1])
  const kind = inferFieldKind(key, value)
  const set = (next: FrontMatterValue, datetime?: boolean) => fm.set(path, next, { datetime })

  switch (kind) {
    case 'boolean':
      return <CheckboxField label={label} checked={value === true} disabled={disabled} onChange={(checked) => set(checked)} />
    case 'number':
      return (
        <NumberField label={label} value={value as number} disabled={disabled} onChange={(n) => set(n)} />
      )
    case 'date': {
      const stringPath = path.every((k) => typeof k === 'string') ? (path as string[]) : null
      const raw = stringPath ? fm.raw(stringPath) : null
      return (
        <DateField
          label={label}
          value={value}
          raw={raw?.raw ?? null}
          template={templateFormat([value])}
          disabled={disabled}
          onChange={(next) => set(next, raw ? raw.style === 'datetime' : env.bareDates)}
        />
      )
    }
    case 'image':
      return (
        <ImageField
          label={label}
          value={String(value)}
          disabled={disabled}
          onChange={(next) => set(next)}
          onPick={env.pickImage}
          preview={env.previewImage}
        />
      )
    case 'stringList':
    case 'imageList':
      return (
        <ListField
          label={label}
          values={value as string[]}
          disabled={disabled}
          mono={kind === 'imageList'}
          onPick={kind === 'imageList' ? env.pickImage : undefined}
          onChange={(next) => set(next)}
        />
      )
    case 'group':
      return <GroupField env={env} path={path} label={label} value={value as Record<string, unknown>} />
    case 'snippet':
      return path.length === 1 ? (
        <div className="field">
          <span>{label}</span>
          <SnippetEditor key={extractSnippet(env.parts, key) ?? ''} fieldKey={key} fm={fm} getParts={env.getParts} disabled={disabled} />
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          {label}: {t('document.snippetUnavailable')}
        </p>
      )
    case 'text':
      return <TextField label={label} value={String(value)} multiline rows={4} disabled={disabled} onChange={(next) => set(next)} />
    case 'empty':
    case 'string':
    default:
      return <TextField label={label} value={value == null ? '' : String(value)} disabled={disabled} onChange={(next) => set(next)} />
  }
}

function NumberField({ label, value, onChange, disabled }: { label: string; value: number; onChange(n: number): void; disabled: boolean }) {
  // Keeps what is typed (e.g. "1." or "-") until it is a number.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <TextField
      label={label}
      type="number"
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(text) => {
        const n = Number(text)
        if (text.trim() !== '' && Number.isFinite(n)) {
          setDraft(null)
          onChange(n)
        } else {
          setDraft(text)
        }
      }}
    />
  )
}

/** A map of simple values (`cover: {image, alt, relative}`) as a group of fields. */
function GroupField({ env, path, label, value }: { env: FieldEnv; path: FieldPath; label: string; value: Record<string, unknown> }) {
  const { t } = useTranslation()
  const [asText, setAsText] = useState(false)
  const key = String(path[0])
  return (
    <fieldset className="space-y-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
      <legend className="px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
        {path.length === 1 && (
          <button type="button" className="ml-2 text-xs text-sky-700 hover:underline dark:text-sky-400" onClick={() => setAsText((v) => !v)}>
            {asText ? t('document.editAsFields') : t('document.editAsText', { format: (env.fm.format ?? 'yaml').toUpperCase() })}
          </button>
        )}
      </legend>
      {asText ? (
        <SnippetEditor fieldKey={key} fm={env.fm} getParts={env.getParts} disabled={env.disabled} onDone={() => setAsText(false)} />
      ) : (
        Object.entries(value).map(([sub, subValue]) => {
          const image = Object.entries(value).find(([k, v]) => typeof v === 'string' && v !== '' && inferFieldKind(k, v) === 'image')
          if (/^alt$/i.test(sub) && typeof subValue === 'string' && image && env.suggestAlt && !env.disabled) {
            const suggest = env.suggestAlt
            return (
              <TextField key={sub} label={sub} value={subValue} onChange={(next) => env.fm.set([...path, sub], next)}>
                <AiSuggestButton
                  label={t('document.aiSuggestAlt')}
                  run={() => suggest(image[1] as string)}
                  onResult={(text) => text.trim() && env.fm.set([...path, sub], text.trim())}
                />
              </TextField>
            )
          }
          return <FieldControl key={sub} env={env} path={[...path, sub]} label={sub} value={subValue} />
        })
      )}
    </fieldset>
  )
}
