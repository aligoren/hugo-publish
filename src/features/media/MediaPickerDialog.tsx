import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, type MediaFile } from '../../lib/api'
import { chooseImageFiles, useFileDrop } from './files'
import { ImportForm } from './ImportForm'
import { MediaTile } from './MediaTile'
import { isImagePath } from './reference'

interface Props {
  /**
   * Folder new uploads should go to by default, e.g. the page bundle folder of the post being
   * edited (`content/posts/x`) or `static/images`.
   */
  defaultTargetDir?: string
  /** Called with the chosen image's site-relative path. */
  onPick(path: string): void
  onClose(): void
}

type Tab = 'site' | 'import'

/** Lets the user pick an existing image or import new ones (metadata stripped). */
export function MediaPickerDialog({ defaultTargetDir, onPick, onClose }: Props) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('site')
  const [images, setImages] = useState<MediaFile[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [sources, setSources] = useState<string[] | null>(null)
  const [stripping, setStripping] = useState(false)
  const target = defaultTargetDir?.trim() || 'static/images'

  const load = useCallback(async () => {
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dragging = useFileDrop((dropped) => {
    const accepted = dropped.filter(isImagePath)
    if (accepted.length === 0) {
      setNotice(t('media.noImagesDropped'))
      return
    }
    setNotice(null)
    setSources(accepted)
    setTab('import')
  })

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr')
    const list = images ?? []
    return needle ? list.filter((i) => i.path.toLocaleLowerCase('tr').includes(needle)) : list
  }, [images, query])
  const current = images?.find((i) => i.path === selected) ?? null

  async function choose() {
    try {
      const chosen = await chooseImageFiles(t('media.dialogFilter'))
      if (chosen.length > 0) setSources(chosen)
    } catch (e) {
      setError(e)
    }
  }

  async function imported(paths: string[]) {
    setSources(null)
    if (paths.length === 1) {
      onPick(paths[0])
      return
    }
    setTab('site')
    await load()
    setSelected(paths[0] ?? null)
  }

  async function stripSelected() {
    if (!current) return
    setStripping(true)
    try {
      const updated = await api.mediaStripMetadata(current.path)
      setImages((list) => list?.map((i) => (i.path === updated.path ? updated : i)) ?? null)
    } catch (e) {
      setError(e)
    } finally {
      setStripping(false)
    }
  }

  const tabClass = (value: Tab) =>
    `-mb-px border-b-2 px-3 py-1.5 text-sm ${
      tab === value ? 'border-sky-600 font-medium' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
    }`

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('media.pickerTitle')}>
      <div className="relative flex h-[min(44rem,100%)] w-full max-w-4xl flex-col gap-3 rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <h2 className="mr-auto text-lg font-semibold">{t('media.pickerTitle')}</h2>
          <button className="btn" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          <button role="tab" aria-selected={tab === 'site'} className={tabClass('site')} onClick={() => setTab('site')}>
            {t('media.tabSite')}
          </button>
          <button role="tab" aria-selected={tab === 'import'} className={tabClass('import')} onClick={() => setTab('import')}>
            {t('media.tabImport')}
          </button>
        </div>
        {notice && <p className="text-sm text-amber-700 dark:text-amber-400">{notice}</p>}
        {error !== null && <ErrorNote error={error} />}

        {tab === 'site' ? (
          <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('media.search')}
              aria-label={t('media.search')}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <div className="min-h-0 flex-1 overflow-auto">
              {images === null && error === null && <p className="text-sm text-zinc-500">{t('media.loading')}</p>}
              {images?.length === 0 && <p className="text-sm text-zinc-500">{t('media.empty')}</p>}
              {images !== null && images.length > 0 && visible.length === 0 && (
                <p className="text-sm text-zinc-500">{t('media.noMatch')}</p>
              )}
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
                {visible.map((file) => (
                  <li key={file.path}>
                    <MediaTile
                      file={file}
                      selected={file.path === selected}
                      onSelect={() => setSelected(file.path)}
                      onActivate={() => onPick(file.path)}
                    />
                  </li>
                ))}
              </ul>
            </div>
            {current?.hasGps && (
              <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
                <span className="mr-auto">{t('media.pickerGpsWarning')}</span>
                <button className="btn" disabled={stripping} onClick={() => void stripSelected()}>
                  {stripping ? t('media.stripping') : t('media.strip')}
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="mr-auto truncate font-mono text-xs text-zinc-500">{selected}</span>
              <button className="btn" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" disabled={!selected} onClick={() => selected && onPick(selected)}>
                {t('media.insert')}
              </button>
            </div>
          </div>
        ) : (
          <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-auto">
            {sources ? (
              <ImportForm
                sources={sources}
                defaultTargetDir={target}
                onImported={(paths) => void imported(paths)}
                onCancel={() => setSources(null)}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
                <p>{t('media.pickerDropHint')}</p>
                <button className="btn btn-primary" onClick={() => void choose()}>
                  {t('media.chooseFiles')}
                </button>
              </div>
            )}
          </div>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-4 border-dashed border-sky-500 bg-sky-500/10 text-lg font-medium">
            {t('media.dropHere')}
          </div>
        )}
      </div>
    </div>
  )
}
