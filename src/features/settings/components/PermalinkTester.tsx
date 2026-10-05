import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PageEntry } from '../../../lib/api'
import { isMultilingual, permalinkPage, PERMALINK_TOKENS, previewUrls, unknownTokens, type PageContext } from '../../../lib/permalinks'
import { indexFrontMatter } from '../../document/termIndex'
import { useSite } from '../../site/SiteContext'
import { useSettingsEditor } from '../editor/context'
import { editedRule, mergedFiles, patternWith, permalinkGroups, urlConfigOf, type PermalinkKind } from '../model/urlConfig'
import { BADGE, CARD, DANGER_NOTE, INPUT, LINK_BUTTON, NOTE, SMALL_BUTTON, WARNING_NOTE } from './styles'

const SAMPLE_SIZE = 6

/** Front matter `url` of the given pages, which overrides every pattern. */
function useFrontMatterUrls(paths: readonly string[]): ReadonlyMap<string, string> {
  const { site, files } = useSite()
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())
  const key = paths.join('\n')
  useEffect(() => {
    let cancelled = false
    const wanted = new Set(key.split('\n'))
    void indexFrontMatter(
      site.root,
      files.filter((f) => wanted.has(f.path)),
    ).then((index) => {
      if (cancelled) return
      const found = new Map<string, string>()
      for (const [path, values] of index) {
        const urlKey = values && Object.keys(values).find((k) => k.toLowerCase() === 'url')
        if (values && urlKey && typeof values[urlKey] === 'string' && values[urlKey] !== '') found.set(path, values[urlKey] as string)
      }
      setUrls(found)
    })
    return () => {
      cancelled = true
    }
  }, [files, key, site.root])
  return urls
}

/** Try a permalink pattern on real pages of a section before saving it. */
export function PermalinkTester() {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  const { pages, hugo, site } = useSite()
  const { sources, env, valuesOf, effective } = editor
  const groups = permalinkGroups(pages)
  const kinds = [...groups.keys()]
  const [kindChoice, setKind] = useState<PermalinkKind>('page')
  const kind = groups.has(kindChoice) ? kindChoice : (kinds[0] ?? 'page')
  const sections = groups.get(kind) ?? []
  const [sectionChoice, setSection] = useState('')
  const active = sections.includes(sectionChoice) ? sectionChoice : (sections[0] ?? '')
  const groupKey = `${kind}|${active}`
  const groupPages = pages.filter((p) => p.kind === kind && p.section === active)
  const [picked, setPicked] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(false)
  const urls = useFrontMatterUrls(groupPages.map((p) => p.path))

  const version = hugo?.version ?? null
  const pendingFiles = mergedFiles(sources, env, valuesOf)
  const diskConfig = urlConfigOf(mergedFiles(sources, env), effective, version, site.root)
  const config = urlConfigOf(pendingFiles, effective, version, site.root)
  const context: PageContext = { config, pages, urls }

  const pickedEntry: PageEntry | undefined = groupPages.find((p) => p.path === picked) ?? groupPages[0]
  const pickedPage = pickedEntry ? permalinkPage(pickedEntry, context) : null
  const edit = pickedPage ? editedRule(pickedPage, config, pendingFiles, kind, active, env) : null
  const pending = edit?.rule ?? null
  const pattern = drafts[groupKey] ?? pending?.pattern ?? ''
  const unknown = unknownTokens(pattern)
  const nextPattern = pattern.trim() === '' ? null : pattern.trim()
  const changes =
    active === '' || !edit
      ? []
      : previewUrls({
          pages: groupPages,
          allPages: pages,
          currentPattern: patternWith(diskConfig, null, null, { kind, section: active }, env),
          nextPattern: patternWith(config, edit.rule, nextPattern, { kind, section: active }, env),
          context,
          config,
          currentConfig: diskConfig,
        })

  if (kinds.length === 0) {
    return (
      <section className={CARD} aria-labelledby="permalink-tester-title">
        <h3 id="permalink-tester-title" className="text-sm font-semibold">
          {t('settings.permalinks.title')}
        </h3>
        <p className="mt-1 text-sm text-zinc-500">{t('settings.permalinks.noPages')}</p>
      </section>
    )
  }

  const pickedPath = pickedEntry?.path ?? ''
  const ordered = [...changes].sort((a, b) => Number(b.entry.path === pickedPath) - Number(a.entry.path === pickedPath))
  const shown = showAll ? ordered : ordered.slice(0, SAMPLE_SIZE)
  const changedCount = changes.filter((c) => c.changed).length
  const collisions = changes.filter((c) => c.collidesWith.length > 0)
  const mismatches = changes.filter((c) => c.mismatch).length
  const writePath = edit?.writePath ?? null
  const dirty = drafts[groupKey] !== undefined && drafts[groupKey] !== (pending?.pattern ?? '')
  // An array entry without its pattern would break the site; there the default needs the entry removed.
  const emptyArrayPattern = pending?.form === 'array' && nextPattern === null
  const multilingual = isMultilingual(config)

  function clearDraft() {
    setDrafts((d) => {
      const next = { ...d }
      delete next[groupKey]
      return next
    })
  }

  function apply() {
    if (!writePath) return
    if (nextPattern === null) editor.resetPath(writePath)
    else editor.editValue(writePath, nextPattern, undefined)
    clearDraft()
  }

  function insert(token: string) {
    const base = pattern === '' ? '/' : pattern.endsWith('/') ? pattern : `${pattern}/`
    setDrafts((d) => ({ ...d, [groupKey]: `${base}:${token}/` }))
  }

  const ruleNote =
    pending?.form === 'legacy'
      ? t('settings.permalinks.legacy')
      : pending?.form === 'array'
        ? t('settings.permalinks.arrayRule', { index: Number(pending.keyPath[0]) + 1 })
        : null

  return (
    <section className={CARD} aria-labelledby="permalink-tester-title">
      <header className="mb-2 space-y-1">
        <h3 id="permalink-tester-title" className="text-sm font-semibold">
          {t('settings.permalinks.title')}
        </h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('settings.permalinks.intro')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        {kinds.length > 1 && (
          <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
            {t('settings.permalinks.kind')}
            <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as PermalinkKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`settings.permalinks.kinds.${k}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
          {kind === 'taxonomy' || kind === 'term' ? t('settings.permalinks.taxonomy') : t('settings.permalinks.section')}
          <select className={INPUT} value={active} onChange={(e) => setSection(e.target.value)}>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] text-zinc-500">
          {t('settings.permalinks.page')}
          <select className={`${INPUT} min-w-0`} value={pickedPath} onChange={(e) => setPicked(e.target.value)}>
            {groupPages.map((p) => (
              <option key={p.path} value={p.path}>
                {p.title || p.path}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-0.5 text-[11px] text-zinc-500">
        <span>
          {t('settings.permalinks.pattern')} {writePath && <code className="text-zinc-400">{writePath.join('.')}</code>}
          {ruleNote && <span className="ml-1 text-zinc-400">({ruleNote})</span>}
        </span>
        <input
          className={`${INPUT} font-mono`}
          value={pattern}
          placeholder={t('settings.permalinks.defaultPlaceholder')}
          spellCheck={false}
          onChange={(e) => setDrafts((d) => ({ ...d, [groupKey]: e.target.value }))}
        />
      </label>
      <div className="mt-1 flex flex-wrap gap-1" aria-label={t('settings.permalinks.tokens')}>
        {PERMALINK_TOKENS.filter((tok) => tok !== 'filename' && tok !== 'slugorfilename').map((tok) => (
          <button key={tok} type="button" className={`${SMALL_BUTTON} font-mono`} onClick={() => insert(tok)}>
            :{tok}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">{t('settings.permalinks.dateHint')}</p>

      {unknown.length > 0 && <p className={`${DANGER_NOTE} mt-2`}>{t('settings.permalinks.unknown', { tokens: unknown.join(', ') })}</p>}
      {edit && !writePath && <p className={`${NOTE} mt-2`}>{t('settings.permalinks.noArrayRule')}</p>}
      {emptyArrayPattern && dirty && <p className={`${WARNING_NOTE} mt-2`}>{t('settings.permalinks.arrayEmpty')}</p>}

      <table className="mt-3 w-full table-fixed text-left text-xs">
        <thead className="text-zinc-500">
          <tr>
            <th className="w-1/4 py-1 font-medium">{t('settings.permalinks.colPage')}</th>
            <th className="py-1 font-medium">{t('settings.permalinks.colCurrent')}</th>
            <th className="py-1 font-medium">{t('settings.permalinks.colNew')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => {
            const lang = multilingual ? permalinkPage(c.entry, context).lang : undefined
            return (
              <tr key={c.entry.path} className={`border-t border-zinc-100 align-top dark:border-zinc-800 ${c.entry.path === pickedPath ? 'bg-sky-50 dark:bg-sky-950/40' : ''}`}>
                <td className="truncate py-1 pr-2" title={c.entry.path}>
                  {c.entry.title || c.entry.path}
                  {lang && <span className={`${BADGE} ml-1 bg-zinc-100 font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>{lang}</span>}
                  {urls.has(c.entry.path) && <span className={`${BADGE} ml-1 bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>url</span>}
                </td>
                <td className="py-1 pr-2 font-mono break-all text-zinc-600 dark:text-zinc-400">
                  {c.current ?? '—'}
                  {c.mismatch && (
                    <span className="ml-1 font-sans text-amber-700 dark:text-amber-400" title={t('settings.permalinks.mismatchOne')}>
                      ≠
                    </span>
                  )}
                </td>
                <td className={`py-1 font-mono break-all ${c.collidesWith.length > 0 ? 'text-red-700 dark:text-red-400' : c.changed ? 'text-amber-800 dark:text-amber-300' : ''}`}>
                  {c.next ?? '—'}
                  {c.collidesWith.length > 0 && <span className="block font-sans text-[11px]">{t('settings.permalinks.collidesWith', { pages: c.collidesWith.join(', ') })}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {changes.length > SAMPLE_SIZE && (
        <button type="button" className={`${LINK_BUTTON} mt-1`} onClick={() => setShowAll((v) => !v)}>
          {showAll ? t('settings.permalinks.showFewer') : t('settings.permalinks.showAll', { count: changes.length })}
        </button>
      )}

      <div className="mt-3 space-y-2">
        {collisions.length > 0 && <p className={DANGER_NOTE}>{t('settings.permalinks.collisions', { count: collisions.length })}</p>}
        {changedCount > 0 && <p className={WARNING_NOTE}>{t('settings.permalinks.willChange', { count: changedCount })}</p>}
        {mismatches > 0 && <p className={WARNING_NOTE}>{t('settings.permalinks.mismatch', { count: mismatches })}</p>}
        {urls.size > 0 && <p className="text-[11px] text-zinc-500">{t('settings.permalinks.urlNote')}</p>}
        <p className="text-[11px] text-zinc-500">{t('settings.permalinks.approximate')}</p>
        <div className="flex gap-2">
          <button type="button" className="btn" disabled={!dirty || unknown.length > 0 || !writePath || emptyArrayPattern} onClick={apply}>
            {t('settings.permalinks.apply')}
          </button>
          {dirty && (
            <button type="button" className="btn" onClick={clearDraft}>
              {t('settings.field.undo')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
