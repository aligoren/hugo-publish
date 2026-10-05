import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import type { PageEntry } from '../../lib/api'
import { slugify } from '../../lib/slug'
import { docLocation, pageAlias, predictPagePermalink, predictPermalink, renamePlan, type RenamePlan } from './rename'
import { useUrlModel } from './useRename'

export interface RenameRequest {
  plan: RenamePlan
  /** New `slug` value, or null to leave the field as it is. */
  slug: string | null
  /** The old address to add to `aliases`, or null. */
  alias: string | null
}

interface Props {
  path: string
  title: string
  /** The `slug` field ('' when absent). */
  slug: string
  /** Folders the document can move to. */
  folders: readonly string[]
  /** This page in `hugo list` output. */
  page: PageEntry | undefined
  aliases: readonly string[]
  baseURL: string | null
  dirty: boolean
  busy: boolean
  error: unknown
  onCancel(): void
  onConfirm(request: RenameRequest): void
}

/** Renames or moves the document's file (or page bundle folder), keeping old links working. */
export function RenameDialog({ path, title, slug, folders, page, aliases, baseURL, dirty, busy, error, onCancel, onConfirm }: Props) {
  const { t } = useTranslation()
  const model = useUrlModel()
  const loc = docLocation(path)
  const [name, setName] = useState(loc.name)
  const [folder, setFolder] = useState(loc.parent)
  const [updateSlug, setUpdateSlug] = useState(slug !== '' && slugify(slug) === loc.name)
  const [aliasChoice, setAliasChoice] = useState<boolean | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  const newName = slugify(name)
  const plan = renamePlan(path, name, folder)
  const hasSlug = slug !== ''
  const writesSlug = hasSlug && updateSlug && slug !== newName
  const oldSegment = slug || loc.name
  const newSegment = hasSlug && !updateSlug ? slug : newName
  const folderChanged = folder !== loc.parent
  const permalink = page?.permalink || null
  // With the site settings: the section's real pattern, language prefix and base URL. Without
  // them (no Hugo yet): only an address that ends with the name can be adjusted.
  const predicted =
    !permalink || !page
      ? null
      : model
        ? predictPagePermalink(page, { path: plan?.newPath ?? path, slug: writesSlug ? newName : slug, title }, model)
        : !folderChanged
          ? predictPermalink(permalink, [slug, loc.name], newSegment)
          : null
  const known = predicted !== null
  const published = page !== undefined && !page.draft
  const oldAlias = page ? pageAlias(page, model, baseURL) : null
  const offerAlias = published && oldAlias !== null && !aliases.includes(oldAlias) && !(known && predicted === permalink) && plan !== null
  const addAlias = offerAlias && (aliasChoice ?? (known || folderChanged || newSegment !== oldSegment))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!plan || busy) return
    onConfirm({ plan, slug: writesSlug ? newName : null, alias: addAlias ? oldAlias : null })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
        className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 text-sm shadow-xl dark:bg-zinc-900"
        onSubmit={submit}
      >
        <h2 id="rename-title" className="text-base font-semibold">
          {t('document.renameTitle')}
        </h2>
        {loc.kind === 'section' ? (
          <p>{t('document.renameSection')}</p>
        ) : (
          <>
            <label className="field">
              <span>{loc.kind === 'bundle' ? t('document.renameFolderName') : t('document.renameFileName')}</span>
              <div className="flex items-center gap-2">
                <input className="min-w-0 flex-1 font-mono" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
                <button
                  type="button"
                  className="btn px-2 py-1 text-xs"
                  disabled={!slugify(title) || slugify(title) === newName}
                  onClick={() => setName(slugify(title))}
                >
                  {t('document.slugFromTitle')}
                </button>
              </div>
              {name !== newName && newName && <small className="text-zinc-500">{t('document.renameSlugified', { name: newName })}</small>}
            </label>
            {folders.length > 1 && (
              <label className="field">
                <span>{t('document.renameFolder')}</span>
                <select value={folder} onChange={(e) => setFolder(e.target.value)}>
                  {folders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {plan && (
              <p className="rounded-md bg-zinc-50 p-2 font-mono text-xs break-all dark:bg-zinc-800">
                {plan.from}
                <br />→ {plan.to}
              </p>
            )}
            {hasSlug && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={updateSlug} onChange={(e) => setUpdateSlug(e.target.checked)} />
                <span>
                  {t('document.renameUpdateSlug', { slug: newName })}
                  <small className="block text-xs text-zinc-500">{t('document.renameSlugHint', { slug })}</small>
                </span>
              </label>
            )}
            {permalink && plan && (
              <div className="space-y-1 text-xs text-zinc-500">
                <p className="break-all">
                  {t('document.urlCurrent')} <span className="font-mono">{permalink}</span>
                </p>
                {known ? (
                  predicted !== permalink && (
                    <p className="break-all">
                      {t('document.urlAfter')} <span className="font-mono">{predicted}</span>
                    </p>
                  )
                ) : (
                  <p>{t('document.urlUnknown')}</p>
                )}
              </div>
            )}
            {offerAlias && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={addAlias} onChange={(e) => setAliasChoice(e.target.checked)} />
                <span>
                  {t('document.keepOldUrl', { path: oldAlias })}
                  <small className="block text-xs text-zinc-500">{t('document.keepOldUrlHint')}</small>
                </span>
              </label>
            )}
            {dirty && <p className="text-xs text-amber-700 dark:text-amber-400">{t('document.renameSavesFirst')}</p>}
          </>
        )}
        {error !== null && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          {loc.kind !== 'section' && (
            <button type="submit" className="btn btn-primary" disabled={!plan || busy}>
              {busy ? t('document.renaming') : t('document.rename')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
