import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, type Archetype } from '../../lib/api'
import { slugify } from '../../lib/slug'
import { useSite } from '../site/SiteContext'
import { loadNewPostDefaults, saveNewPostDefaults } from './defaults'
import {
  automaticArchetype,
  buildPostPath,
  contentSections,
  findDuplicate,
  normalizeSection,
  setTitle as setTitleInText,
} from './paths'

interface Props {
  /** Called with the site-relative path of the created file. */
  onCreated(path: string): void
  onClose(): void
}

/** Select value for "new section"; never a real folder path (those are relative). */
const NEW_SECTION = '//new'

/**
 * Creates a post from an archetype with a language-aware slug. Only the title is needed: the
 * folder and type default to the last ones used on this site, and Enter creates the post.
 */
export function NewPostDialog({ onCreated, onClose }: Props) {
  const { t } = useTranslation()
  const { site, files } = useSite()
  const headingId = useId()
  const sections = useMemo(() => contentSections(files, site.contentDir), [files, site.contentDir])
  const [defaults] = useState(() => loadNewPostDefaults(site.root))
  const [archetypes, setArchetypes] = useState<Archetype[] | null>(null)
  const [kind, setKind] = useState(defaults.kind ?? '')
  const [title, setTitle] = useState('')
  const [section, setSection] = useState(() =>
    defaults.section !== undefined && sections.some((s) => s.path === defaults.section) ? defaults.section : (sections[0]?.path ?? NEW_SECTION),
  )
  const [newSectionName, setNewSectionName] = useState(sections.length === 0 ? 'posts' : '')
  const [editedSlug, setEditedSlug] = useState<string | null>(null)
  const [bundleChoice, setBundleChoice] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  // Set when the post exists but its title could not be written.
  const [createdPath, setCreatedPath] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .listArchetypes()
      .then((list) => {
        if (alive) setArchetypes(list)
      })
      .catch(() => {
        // Without the list, "automatic" (Hugo's own choice) still works.
        if (alive) setArchetypes([])
      })
    return () => {
      alive = false
    }
  }, [])

  const archetypeList = archetypes ?? []
  // A remembered type the site no longer has falls back to the automatic choice.
  const chosenKind = archetypes !== null && kind !== '' && !archetypes.some((a) => a.name === kind) ? '' : kind
  const sectionPath = section === NEW_SECTION ? normalizeSection(newSectionName) : section
  const sectionInfo = sections.find((s) => s.path === section)
  const chosenArchetype = archetypeList.find((a) => a.name === chosenKind)
  const folderArchetype = chosenArchetype !== undefined && !/\.md$/i.test(chosenArchetype.path)
  const sectionPrefersBundles = sectionInfo !== undefined && sectionInfo.bundles * 2 > sectionInfo.posts
  const bundle = folderArchetype || (bundleChoice ?? sectionPrefersBundles)
  // What the user typed stays in the box; the path uses its slugified form.
  const slug = slugify(editedSlug ?? title)
  const path = buildPostPath({ contentDir: site.contentDir, section: sectionPath, slug, bundle })
  const duplicate = slug ? findDuplicate(path, files) : null
  const automatic = automaticArchetype(
    sectionPath,
    archetypeList.map((a) => a.name),
  )
  const problem =
    title.trim() === ''
      ? 'needTitle'
      : slug === ''
        ? 'needSlug'
        : section === NEW_SECTION && sectionPath === ''
          ? 'needSection'
          : null
  const canCreate = problem === null && duplicate === null && !busy && createdPath === null

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!canCreate) return
    setBusy(true)
    setError(null)
    let created: string
    try {
      created = await api.newContent(path, chosenKind || undefined)
    } catch (e) {
      setError(e)
      setBusy(false)
      return
    }
    saveNewPostDefaults(site.root, { section: section === NEW_SECTION ? sectionPath : section, kind: chosenKind })
    // Archetypes make titles from file names ("Ilk Yazi"); write the real one.
    try {
      const file = await api.readText(created)
      const text = setTitleInText(file.text, title.trim())
      if (text !== file.text) await api.writeText(created, text, file.version)
      onCreated(created)
    } catch (e) {
      setError(e)
      setCreatedPath(created)
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center overflow-auto bg-black/40 p-4 sm:pt-[12vh]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onSubmit={(e) => void create(e)}
        className="w-full max-w-lg space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2 id={headingId} className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          {t('newPost.title')}
        </h2>

        <label className="field">
          <span className="sr-only">{t('newPost.postTitle')}</span>
          <input
            autoFocus
            aria-label={t('newPost.postTitle')}
            value={title}
            placeholder={t('newPost.postTitlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
            className="border-0 bg-transparent px-0 text-2xl font-semibold focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
          <label className="field min-w-0 flex-1">
            <span>{t('newPost.section')}</span>
            <select value={section} onChange={(e) => setSection(e.target.value)} className="py-1 text-xs">
              {sections.map((s) => (
                <option key={s.path} value={s.path}>
                  {s.path || t('newPost.topLevel')} · {t('newPost.postsInSection', { count: s.posts })}
                </option>
              ))}
              <option value={NEW_SECTION}>{t('newPost.newSection')}</option>
            </select>
          </label>
          <label className="field min-w-0 flex-1">
            <span>{t('newPost.archetype')}</span>
            <select value={chosenKind} onChange={(e) => setKind(e.target.value)} className="py-1 text-xs">
              <option value="">
                {automatic ? t('newPost.automaticUses', { name: automatic }) : t('newPost.automaticBuiltIn')}
              </option>
              {archetypeList.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.source === 'theme' ? t('newPost.fromTheme', { name: a.name }) : a.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {section === NEW_SECTION && (
          <label className="field text-xs">
            <span>{t('newPost.newSectionName')}</span>
            <input value={newSectionName} onChange={(e) => setNewSectionName(e.target.value)} className="py-1 text-xs" />
          </label>
        )}

        <details className="group text-xs">
          <summary className="flex cursor-pointer list-none items-baseline gap-2 text-zinc-500">
            <span className="shrink-0">{t('newPost.path')}</span>
            <span data-testid="path-preview" className="min-w-0 flex-1 font-mono break-all text-zinc-700 dark:text-zinc-300">
              {path}
            </span>
            <span className="shrink-0 text-sky-700 group-open:hidden dark:text-sky-400">{t('newPost.changeAddress')}</span>
          </summary>
          <div className="mt-3 space-y-3">
            <label className="field">
              <span>{t('newPost.slug')}</span>
              <input className="font-mono" value={editedSlug ?? slug} onChange={(e) => setEditedSlug(e.target.value)} />
              <small className="flex flex-wrap gap-2 text-zinc-500">
                {t('newPost.slugHint')}
                {editedSlug !== null && (
                  <button type="button" className="text-sky-700 hover:underline dark:text-sky-400" onClick={() => setEditedSlug(null)}>
                    {t('newPost.slugReset')}
                  </button>
                )}
              </small>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={bundle}
                disabled={folderArchetype}
                onChange={(e) => setBundleChoice(e.target.checked)}
              />
              <span>
                {t('newPost.bundle')}
                {folderArchetype && <small className="block text-zinc-500">{t('newPost.bundleForced')}</small>}
              </span>
            </label>
          </div>
        </details>

        {duplicate && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-400">
            {t('newPost.duplicate', { path: duplicate })}
          </p>
        )}
        {!duplicate && problem && title !== '' && <p className="text-xs text-amber-700 dark:text-amber-400">{t(`newPost.${problem}`)}</p>}

        {error !== null && <ErrorNote error={error} />}
        {createdPath && <p className="text-sm text-amber-800 dark:text-amber-300">{t('newPost.titleNotSet')}</p>}

        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-zinc-400">{t('newPost.enterHint')}</span>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {createdPath ? (
            <button type="button" className="btn btn-primary" onClick={() => onCreated(createdPath)}>
              {t('newPost.openAnyway')}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!canCreate}>
              {busy ? t('newPost.creating') : t('newPost.create')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
