import { confirm } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, type MediaFile } from '../../lib/api'
import { useSite } from '../site/SiteContext'
import { DetailsPanel } from './DetailsPanel'
import { chooseImageFiles, useFileDrop } from './files'
import { ImportForm } from './ImportForm'
import { MediaTile } from './MediaTile'
import { fileNameOf, isImagePath } from './reference'
import { useUnusedImages } from './usage'

type Folder = 'all' | 'static' | 'assets' | 'content'
type Sort = 'name' | 'size' | 'date'

const DEFAULT_TARGET = 'static/images'

function Toggle({ pressed, onChange, children }: { pressed: boolean; onChange(value: boolean): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${
        pressed
          ? 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500'
          : 'border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  )
}

/** The site's image library: previews, privacy checks, cleaning, importing and unused images. */
export function MediaView() {
  const { t, i18n } = useTranslation()
  const { site, files, configVersion } = useSite()
  const [images, setImages] = useState<MediaFile[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState<Folder>('all')
  const [onlyLocation, setOnlyLocation] = useState(false)
  const [onlyMetadata, setOnlyMetadata] = useState(false)
  const [onlyUnused, setOnlyUnused] = useState(false)
  const [sort, setSort] = useState<Sort>('name')
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState<string[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setImages(await api.mediaList())
    } catch (e) {
      setError(e)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.mediaList().then(
      (list) => !cancelled && setImages(list),
      (e) => !cancelled && setError(e),
    )
    return () => {
      cancelled = true
    }
  }, [])

  const paths = useMemo(() => images?.map((i) => i.path) ?? null, [images])
  const usage = useUnusedImages(paths, site, files, configVersion)

  const dragging = useFileDrop((dropped) => {
    const accepted = dropped.filter(isImagePath)
    if (accepted.length === 0) {
      setNotice(t('media.noImagesDropped'))
      return
    }
    setPending((current) => [...new Set([...(current ?? []), ...accepted])])
  })

  const collator = useMemo(() => new Intl.Collator(i18n.resolvedLanguage, { numeric: true }), [i18n.resolvedLanguage])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr')
    const matching = (images ?? []).filter(
      (image) =>
        (folder === 'all' || image.path.startsWith(`${folder}/`)) &&
        (!onlyLocation || image.hasGps) &&
        (!onlyMetadata || image.hasMetadata || image.hasGps) &&
        (!onlyUnused || usage.unused?.has(image.path) === true) &&
        (!needle || image.path.toLocaleLowerCase('tr').includes(needle)),
    )
    return matching.sort((a, b) => {
      if (sort === 'size') return b.size - a.size
      if (sort === 'date') return b.modifiedMs - a.modifiedMs
      return collator.compare(fileNameOf(a.path), fileNameOf(b.path)) || collator.compare(a.path, b.path)
    })
  }, [images, query, folder, onlyLocation, onlyMetadata, onlyUnused, usage.unused, sort, collator])

  const located = useMemo(() => images?.filter((i) => i.hasGps) ?? [], [images])
  const current = images?.find((i) => i.path === selected) ?? null

  function replace(updated: MediaFile) {
    setImages((list) => list?.map((i) => (i.path === updated.path ? updated : i)) ?? null)
  }

  async function cleanAll() {
    const targets = located
    if (targets.length === 0) return
    const ok = await confirm(t('media.cleanAllConfirm', { count: targets.length }), {
      title: t('media.confirmTitle'),
      kind: 'warning',
    })
    if (!ok) return
    setError(null)
    setNotice(null)
    let done = 0
    setProgress({ done, total: targets.length })
    try {
      for (const target of targets) {
        replace(await api.mediaStripMetadata(target.path))
        done++
        setProgress({ done, total: targets.length })
      }
      setNotice(t('media.cleanedAll', { count: done }))
    } catch (e) {
      setError(e)
    } finally {
      setProgress(null)
    }
  }

  async function chooseFiles() {
    try {
      const chosen = await chooseImageFiles(t('media.dialogFilter'))
      if (chosen.length > 0) setPending(chosen)
    } catch (e) {
      setError(e)
    }
  }

  async function imported(paths: string[]) {
    setPending(null)
    setNotice(t('media.imported', { paths: paths.join(', ') }))
    await load()
    if (paths[0]) setSelected(paths[0])
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">{t('media.title')}</h1>
        {images && <span className="mr-auto text-sm text-zinc-500">{t('media.count', { count: images.length })}</span>}
        {!images && <span className="mr-auto" />}
        <button className="btn" onClick={() => void load()}>
          {t('media.reload')}
        </button>
        <button className="btn btn-primary" onClick={() => void chooseFiles()}>
          {t('media.import')}
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('media.search')}
          aria-label={t('media.search')}
          className="w-48 rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select
          value={folder}
          onChange={(e) => setFolder(e.target.value as Folder)}
          aria-label={t('media.folder')}
          className="rounded-md border border-zinc-300 bg-white px-1 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="all">{t('media.folderAll')}</option>
          <option value="static">{t('media.folderStatic')}</option>
          <option value="assets">{t('media.folderAssets')}</option>
          <option value="content">{t('media.folderContent')}</option>
        </select>
        <div role="group" aria-label={t('media.filters')} className="flex flex-wrap gap-1">
          <Toggle pressed={onlyLocation} onChange={setOnlyLocation}>
            {t('media.filterLocation')}
          </Toggle>
          <Toggle pressed={onlyMetadata} onChange={setOnlyMetadata}>
            {t('media.filterMetadata')}
          </Toggle>
          <Toggle pressed={onlyUnused} onChange={setOnlyUnused}>
            {t('media.filterUnused')}
          </Toggle>
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label={t('media.sort')}
          className="ml-auto rounded-md border border-zinc-300 bg-white px-1 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="name">{t('media.sortName')}</option>
          <option value="size">{t('media.sortSize')}</option>
          <option value="date">{t('media.sortDate')}</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-zinc-500">
        <p className="mr-auto max-w-2xl">{t('media.gitNote')}</p>
        {usage.unused === null && images !== null && images.length > 0 && <span>{t('media.scanning')}</span>}
        {located.length > 0 && (
          <button className="btn btn-primary" disabled={progress !== null} onClick={() => void cleanAll()}>
            {progress ? t('media.cleaning', progress) : t('media.cleanAll', { count: located.length })}
          </button>
        )}
      </div>

      <div className="space-y-2 px-4">
        {notice && (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            {notice}
          </p>
        )}
        {error !== null && <ErrorNote error={error} />}
      </div>

      <div className="flex min-h-0 flex-1">
        <section className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
          {images === null && error === null && <p className="text-sm text-zinc-500">{t('media.loading')}</p>}
          {images?.length === 0 && <p className="text-sm text-zinc-500">{t('media.empty')}</p>}
          {images !== null && images.length > 0 && visible.length === 0 && (
            <p className="text-sm text-zinc-500">{t('media.noMatch')}</p>
          )}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {visible.map((file) => (
              <li key={file.path}>
                <MediaTile
                  file={file}
                  selected={file.path === selected}
                  unused={usage.unused?.has(file.path) ?? false}
                  onSelect={() => setSelected(file.path === selected ? null : file.path)}
                />
              </li>
            ))}
          </ul>
        </section>
        {current && (
          <DetailsPanel
            key={current.path}
            file={current}
            unused={usage.unused ? usage.unused.has(current.path) : null}
            onChanged={replace}
            onDeleted={(path) => {
              setSelected(null)
              setImages((list) => list?.filter((i) => i.path !== path) ?? null)
            }}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-4 border-dashed border-sky-500 bg-sky-500/10 text-lg font-medium text-sky-900 dark:text-sky-100">
          {t('media.dropHere')}
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('media.importTitle')}>
          <div className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-auto rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
            <h2 className="text-lg font-semibold">{t('media.importTitle')}</h2>
            <ImportForm
              sources={pending}
              defaultTargetDir={DEFAULT_TARGET}
              onImported={(paths) => void imported(paths)}
              onCancel={() => setPending(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
