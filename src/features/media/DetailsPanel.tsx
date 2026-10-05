import { confirm } from '@tauri-apps/plugin-dialog'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, type MediaDetails, type MediaFile } from '../../lib/api'
import { formatBytes, formatCoordinate } from './format'
import { folderOf, imageReference } from './reference'
import { Thumbnail } from './Thumbnail'

interface Props {
  file: MediaFile
  /** null while usage is unknown. */
  unused: boolean | null
  onChanged(file: MediaFile): void
  onDeleted(path: string): void
  onClose(): void
}

/** Preview, facts, metadata and privacy actions for one image. */
export function DetailsPanel({ file, unused, onChanged, onDeleted, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.mediaDetails(file.path).then(
      (result) => {
        if (cancelled) return
        setDetails(result)
        setError(null)
      },
      (e) => !cancelled && setError(e),
    )
    return () => {
      cancelled = true
    }
  }, [file.path, file.modifiedMs])

  const inBundle = file.path.startsWith('content/')
  const reference = inBundle
    ? imageReference(file.path, `${folderOf(file.path)}/index.md`)
    : imageReference(file.path, '')
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; value: string }[]>()
    for (const entry of details?.entries ?? []) {
      const list = map.get(entry.group) ?? []
      list.push(entry)
      map.set(entry.group, list)
    }
    return [...map.entries()]
  }, [details])
  const gps = details?.gps ?? null
  const removable = file.hasMetadata || file.hasGps

  async function strip() {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.mediaStripMetadata(file.path)
      onChanged(updated)
      setMessage(t('media.stripped'))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await confirm(t('media.deleteConfirm', { path: file.path }), {
      title: t('media.confirmTitle'),
      kind: 'warning',
    })
    if (!ok) return
    try {
      await api.mediaDelete(file.path)
      onDeleted(file.path)
    } catch (e) {
      setError(e)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable; the path is selectable anyway.
    }
  }

  const facts: [string, string][] = [
    [t('media.dimensions'), file.width !== null && file.height !== null ? `${file.width} × ${file.height}` : '—'],
    [t('media.size'), formatBytes(file.size, i18n.resolvedLanguage)],
    [t('media.format'), (file.format ?? '—').toUpperCase()],
    [
      t('media.modified'),
      file.modifiedMs
        ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(file.modifiedMs)
        : '—',
    ],
  ]
  if (details?.camera) facts.push([t('media.camera'), details.camera])
  if (details?.takenAt) facts.push([t('media.takenAt'), details.takenAt])

  return (
    <aside
      aria-label={file.path}
      className="flex min-h-0 w-80 shrink-0 flex-col gap-3 overflow-auto border-l border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex items-start gap-2">
        <p className="mr-auto font-mono text-xs break-all">{file.path}</p>
        <button className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={onClose} aria-label={t('media.closeDetails')}>
          ×
        </button>
      </div>
      <Thumbnail
        key={`${file.path}:${file.modifiedMs}`}
        path={file.path}
        modifiedMs={file.modifiedMs}
        size={640}
        fallback={file.format ?? undefined}
        className="h-48 w-full rounded-md"
      />

      {gps && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          <p className="font-semibold">{t('media.gpsWarning')}</p>
          <p className="mt-1">
            {t('media.gpsWarningBody', { lat: formatCoordinate(gps.lat), lon: formatCoordinate(gps.lon) })}
          </p>
        </div>
      )}
      {removable && (
        <button className={`btn justify-center ${gps ? 'btn-primary' : ''}`} disabled={busy} onClick={() => void strip()}>
          {busy ? t('media.stripping') : t('media.strip')}
        </button>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      )}
      {error !== null && <ErrorNote error={error} />}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="field">
        <span>{inBundle ? t('media.markdownPathBundle') : t('media.markdownPath')}</span>
        <div className="flex gap-1">
          <input readOnly value={reference} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={() => void copy()}>
            {copied ? t('media.copied') : t('media.copy')}
          </button>
        </div>
      </div>

      {unused && <p className="rounded-md bg-zinc-100 p-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t('media.unusedHint')}</p>}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t('media.metadataTitle')}</h3>
        {details && !removable && <p className="text-sm text-emerald-700 dark:text-emerald-400">{t('media.noMetadata')}</p>}
        {groups.map(([group, entries]) => (
          <div key={group}>
            <h4 className="text-xs font-medium">{t(`media.groups.${group}`, { defaultValue: group })}</h4>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
              {entries.map((entry, i) => (
                <div key={`${entry.key}-${i}`} className="contents">
                  <dt className="text-zinc-500">{entry.key}</dt>
                  <dd className="break-all">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        {groups.some(([group]) => group === 'ICC') && <p className="text-xs text-zinc-500">{t('media.iccNote')}</p>}
      </section>

      <p className="text-xs text-zinc-500">{t('media.gitNote')}</p>
      <button className="btn justify-center text-red-700 dark:text-red-400" onClick={() => void remove()}>
        {t('media.delete')}
      </button>
    </aside>
  )
}
