import { useTranslation } from 'react-i18next'

import type { PageEntry } from '../../../lib/api'
import { slugify } from '../../../lib/slug'
import { pageAlias, predictPagePermalink, predictPermalink } from '../rename'
import { useUrlModel } from '../useRename'
import { CheckboxField } from './TextField'

interface Props {
  /** Current `slug` value ('' when absent). */
  value: string
  /** `slug` in the file as loaded ('' when absent). */
  originalSlug: string
  title: string
  /** The page in `hugo list` output (absent for new files or without Hugo). */
  page: PageEntry | undefined
  /** File name without extension, or the bundle folder name. */
  fileName: string
  aliases: readonly string[]
  baseURL: string | null
  onChange(slug: string): void
  onAliasesChange(aliases: string[]): void
  disabled?: boolean
}

/** The URL slug, with the address it gives and an offer to keep the old address working. */
export function SlugField({ value, originalSlug, title, page, fileName, aliases, baseURL, onChange, onAliasesChange, disabled }: Props) {
  const { t } = useTranslation()
  const model = useUrlModel()
  const changed = value.trim() !== originalSlug.trim()
  const permalink = page?.permalink || null
  const newName = value.trim() || fileName
  // With the site settings: the section's real pattern (slug, title, date and section tokens),
  // the language prefix and the base URL. Without them, only an address ending with the slug.
  const predicted =
    !permalink || !page || !changed
      ? null
      : model
        ? predictPagePermalink(page, { slug: value.trim(), title }, model)
        : predictPermalink(permalink, [originalSlug, fileName, slugify(title)], newName)
  const published = page !== undefined && !page.draft
  const oldAlias = page ? pageAlias(page, model, baseURL) : null
  const urlChanges = changed && (predicted === null || predicted !== permalink)
  const hasAlias = oldAlias !== null && aliases.includes(oldAlias)
  const suggestion = slugify(title)
  const notSlug = value !== '' && slugify(value) !== value

  return (
    <div className="field">
      <label className="field">
        <span>{t('document.fieldSlug')}</span>
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 font-mono"
            value={value}
            placeholder={fileName}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            disabled={disabled || !suggestion || suggestion === value}
            onClick={() => onChange(suggestion)}
          >
            {t('document.slugFromTitle')}
          </button>
        </div>
      </label>
      {notSlug && <small className="text-amber-700 dark:text-amber-400">{t('document.slugNotClean', { slug: slugify(value) })}</small>}
      {permalink && (
        <div className="space-y-1 text-xs text-zinc-500">
          <p className="truncate">
            {t('document.urlCurrent')} <span className="font-mono text-zinc-700 dark:text-zinc-300">{permalink}</span>
          </p>
          {changed &&
            (predicted ? (
              predicted !== permalink && (
                <p className="truncate">
                  {t('document.urlAfter')} <span className="font-mono text-sky-800 dark:text-sky-300">{predicted}</span>
                </p>
              )
            ) : (
              <p>{t('document.urlUnknown')}</p>
            ))}
        </div>
      )}
      {published && urlChanges && oldAlias && (
        <CheckboxField
          label={t('document.keepOldUrl', { path: oldAlias })}
          hint={t('document.keepOldUrlHint')}
          checked={hasAlias}
          disabled={disabled}
          onChange={(checked) =>
            onAliasesChange(checked ? [...aliases, oldAlias] : aliases.filter((alias) => alias !== oldAlias))
          }
        />
      )}
    </div>
  )
}
