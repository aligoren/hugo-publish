import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../components/DiffView'
import { ErrorNote } from '../../components/ErrorNote'
import { api } from '../../lib/api'
import { mapLimit, type ThemeData } from './loadTheme'
import { compareTexts, findOverrides, isEmptyHook, OVERRIDE_ROOTS, type Comparison, type OverrideEntry } from './overrides'

interface Props {
  theme: ThemeData
  /** Site files the app generates itself (left out of the list). */
  ignore: string[]
}

interface Texts {
  site: string
  theme: string
  comparison: Comparison
  emptyHook: boolean
}

export function OverridesPanel({ theme, ignore }: Props) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<OverrideEntry[] | null>(null)
  const [texts, setTexts] = useState<Record<string, Texts | 'error'>>({})
  const [error, setError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const ignoreKey = ignore.join('|')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const lists = await Promise.all(OVERRIDE_ROOTS.map((root) => api.listFiles(root).catch(() => [])))
        const siteFiles = lists.flat().map((f) => f.path)
        const found = findOverrides(siteFiles, theme.files, theme.label, ignoreKey ? ignoreKey.split('|') : [])
        if (cancelled) return
        setEntries(found)
        const loaded: Record<string, Texts | 'error'> = {}
        await mapLimit(
          found.filter((e) => e.themeFile),
          4,
          async (entry) => {
            try {
              const [site, original] = await Promise.all([api.readText(entry.sitePath), theme.component.read(entry.themeFile!)])
              loaded[entry.sitePath] = {
                site: site.text,
                theme: original.text,
                comparison: compareTexts(site.text, original.text),
                emptyHook: isEmptyHook(original.text),
              }
            } catch {
              loaded[entry.sitePath] = 'error'
            }
          },
        )
        if (!cancelled) setTexts(loaded)
      } catch (e) {
        if (!cancelled) setError(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [theme.root, theme.label, theme.component, theme.files, ignoreKey, reloadKey])

  if (error !== null) return <ErrorNote error={error} />
  if (!entries) return <p className="text-sm text-zinc-500">{t('common.loading')}</p>
  if (entries.length === 0) return <p className="text-sm text-zinc-500">{t('theme.overrides.none')}</p>

  const sections: { kind: OverrideEntry['kind']; title: string }[] = [
    { kind: 'override', title: t('theme.overrides.overrides') },
    { kind: 'merge', title: t('theme.overrides.merged') },
    { kind: 'addition', title: t('theme.overrides.additions') },
  ]
  const redundant = entries.filter((e) => {
    const x = texts[e.sitePath]
    return e.kind === 'override' && x && x !== 'error' && (x.comparison === 'identical' || x.comparison === 'lineEndings')
  }).length

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('theme.overrides.intro')}</p>
      {redundant > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {t('theme.overrides.redundantSummary', { count: redundant })}
        </p>
      )}
      {sections.map(({ kind, title }) => {
        const list = entries.filter((e) => e.kind === kind)
        if (list.length === 0) return null
        return (
          <section key={kind} aria-label={title} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              {title} ({list.length})
            </h3>
            <ul className="space-y-2">
              {list.map((entry) => (
                <OverrideRow key={entry.sitePath} entry={entry} texts={texts[entry.sitePath]} onDeleted={() => setReloadKey((k) => k + 1)} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function OverrideRow({ entry, texts, onDeleted }: { entry: OverrideEntry; texts: Texts | 'error' | undefined; onDeleted(): void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<unknown>(null)
  const loaded = texts && texts !== 'error' ? texts : null
  const status = loaded
    ? loaded.emptyHook && entry.kind === 'override'
      ? { text: t('theme.overrides.emptyHook'), tone: 'ok' }
      : loaded.comparison === 'identical'
        ? { text: entry.kind === 'merge' ? t('theme.overrides.sameAsTheme') : t('theme.overrides.identical'), tone: 'warn' }
        : loaded.comparison === 'lineEndings'
          ? { text: t('theme.overrides.lineEndings'), tone: 'warn' }
          : loaded.comparison === 'whitespace'
            ? { text: t('theme.overrides.whitespace'), tone: 'warn' }
            : { text: t('theme.overrides.different'), tone: 'info' }
    : texts === 'error'
      ? { text: t('theme.overrides.unreadable'), tone: 'warn' }
      : null
  const redundant = entry.kind === 'override' && loaded !== null && !loaded.emptyHook && (loaded.comparison === 'identical' || loaded.comparison === 'lineEndings')

  async function remove() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.siteDeleteOverride(entry.sitePath)
      onDeleted()
    } catch (e) {
      setDeleteError(e)
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  const tone =
    status?.tone === 'warn'
      ? 'text-amber-700 dark:text-amber-400'
      : status?.tone === 'ok'
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-zinc-600 dark:text-zinc-400'
  return (
    <li className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="text-sm">{entry.sitePath}</code>
        {loaded && loaded.comparison !== 'identical' && (
          <button className="text-xs text-sky-700 hover:underline dark:text-sky-400" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('theme.overrides.hideDiff') : t('theme.overrides.showDiff')}
          </button>
        )}
      </div>
      {entry.themePath && <p className="text-xs text-zinc-500">{t('theme.overrides.themeFile', { file: entry.themePath })}</p>}
      {entry.kind === 'merge' && <p className="text-xs text-zinc-500">{t('theme.overrides.mergeNote')}</p>}
      {entry.legacyPath && <p className="text-xs text-zinc-500">{t('theme.overrides.legacyPath')}</p>}
      {entry.kind === 'addition' && (
        <p className="text-xs text-zinc-500">
          {entry.hookFolder ? t('theme.overrides.hookFolder', { folder: entry.hookFolder }) : t('theme.overrides.siteOnly')}
        </p>
      )}
      {status && <p className={`text-xs ${tone}`}>{status.text}</p>}
      {redundant && !confirming && (
        <button className="mt-1 text-xs text-sky-700 hover:underline dark:text-sky-400" onClick={() => setConfirming(true)}>
          {t('theme.overrides.delete')}
        </button>
      )}
      {confirming && (
        <div role="alertdialog" aria-label={t('theme.overrides.deleteConfirm', { file: entry.sitePath })} className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span>{t('theme.overrides.deleteConfirm', { file: entry.sitePath })}</span>
          <button className="btn btn-primary" disabled={deleting} onClick={() => void remove()}>
            {t('theme.overrides.deleteYes')}
          </button>
          <button className="btn" disabled={deleting} onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {deleteError !== null && <ErrorNote error={deleteError} />}
      {open && loaded && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-zinc-500">{t('theme.overrides.diffLegend')}</p>
          <DiffView before={loaded.theme} after={loaded.site} />
        </div>
      )}
    </li>
  )
}
