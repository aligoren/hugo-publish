import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConfigOp } from '../../lib/api'
import { ReviewChangesDialog, type ConfigDraft, type ConfigFileData } from '../config-edit'
import { useSite } from '../site/SiteContext'
import { defaultParamsTarget, lookupCi, ownerOf, writePath, type ParamsSource } from './discovery'
import { FieldInput } from './FieldInput'
import type { Badge, MergedModel, PageParamDoc, ThemeField } from './merge'
import { changeFor, expandOps } from './paramsWrite'
import type { UnknownParam } from './unknown'
import { formatValue, useLoc } from './useLoc'

interface Props {
  model: MergedModel
  sources: ParamsSource[]
  configs: ConfigFileData[]
  draft: ConfigDraft
  unknown: UnknownParam[]
  duplicates: string[][]
}

const BADGE_STYLE: Record<Badge, string> = {
  documented: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  defaults: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  scanned: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  unused: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  siteTemplates: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Where a field is read from and written to. */
function locate(sources: ParamsSource[], path: string[]) {
  const owner = ownerOf(sources, path)
  const target = owner?.source ?? defaultParamsTarget(sources)
  return {
    owner,
    target,
    writePath: target ? writePath(target, path) : null,
    siteValue: owner ? lookupCi(owner.source.values, path)?.value : undefined,
  }
}

export function ParamsPanel({ model, sources, configs, draft, unknown, duplicates }: Props) {
  const { t } = useTranslation()
  const { loc } = useLoc()
  const { notifyConfigChanged } = useSite()
  const [filter, setFilter] = useState('')
  const [onlySet, setOnlySet] = useState(false)
  const [review, setReview] = useState<Record<string, ConfigOp[]> | null>(null)
  const [written, setWritten] = useState(false)

  const query = filter.trim().toLowerCase()
  const groups = model.groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => {
        if (onlySet && locate(sources, field.path).owner === null) return false
        if (!query) return true
        const text = [field.key, loc(field.label), loc(field.description)].join(' ').toLowerCase()
        return text.includes(query)
      }),
    }))
    .filter((g) => g.fields.length > 0)

  function openReview() {
    const byFile: Record<string, ConfigOp[]> = {}
    for (const file of draft.files) {
      const config = configs.find((c) => c.path === file)
      const ops = draft.opsByFile[file] ?? []
      byFile[file] = config && config.format !== 'json' ? expandOps({ path: file, format: config.format, text: config.text, values: config.values }, ops) : ops
    }
    setReview(byFile)
  }

  const target = defaultParamsTarget(sources)

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="w-full max-w-sm rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          placeholder={t('theme.params.filter')}
          aria-label={t('theme.params.filter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="accent-sky-700" checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} />
          {t('theme.params.onlySet')}
        </label>
        {target && (
          <span className="text-xs text-zinc-500">
            {target.editable ? t('theme.params.newKeysGoTo', { file: target.file }) : t('theme.params.readOnlyFile', { file: target.file })}
          </span>
        )}
      </div>

      {written && draft.count === 0 && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          ✓ {t('theme.params.written')}
        </p>
      )}

      {duplicates.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {duplicates.map((group) => (
            <p key={group.join()}>{t('theme.params.duplicates', { keys: group.join(', ') })}</p>
          ))}
        </div>
      )}

      {unknown.length > 0 && <UnknownCard unknown={unknown} sources={sources} draft={draft} />}

      {model.fields.length === 0 && <p className="text-sm text-zinc-500">{t('theme.params.empty')}</p>}
      {model.fields.length > 0 && groups.length === 0 && <p className="text-sm text-zinc-500">{t('theme.params.noMatches')}</p>}

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`} className="space-y-3">
          <h3 id={`group-${group.id}`} className="border-b border-zinc-200 pb-1 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            {group.label ? loc(group.label) : group.id === 'other' ? t('theme.params.groupOther') : group.id === 'general' ? t('theme.params.groupGeneral') : group.name}
          </h3>
          <div className="space-y-4">
            {group.fields.map((field) => (
              <FieldRow key={field.key} field={field} sources={sources} draft={draft} />
            ))}
          </div>
        </section>
      ))}

      {model.pageParams.length > 0 && !query && !onlySet && <PageParams docs={model.pageParams} />}

      {draft.count > 0 && (
        <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t border-zinc-200 bg-white/95 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <button className="btn" onClick={() => draft.clear()}>
            {t('theme.params.discard')}
          </button>
          <button className="btn btn-primary" onClick={openReview}>
            {t('theme.params.review', { count: draft.count })}
          </button>
        </div>
      )}

      {review && (
        <ReviewChangesDialog
          opsByFile={review}
          onClose={() => setReview(null)}
          onWritten={() => {
            setReview(null)
            draft.clear()
            setWritten(true)
            notifyConfigChanged()
          }}
        />
      )}
    </div>
  )
}

function SourceBadge({ badge }: { badge: Badge }) {
  const { t } = useTranslation()
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${BADGE_STYLE[badge]}`} title={t(`theme.badge.${badge}Title`)}>
      {t(`theme.badge.${badge}`)}
    </span>
  )
}

function FieldRow({ field, sources, draft }: { field: ThemeField; sources: ParamsSource[]; draft: ConfigDraft }) {
  const { t } = useTranslation()
  const { loc } = useLoc()
  const where = locate(sources, field.path)
  const file = where.target?.file ?? null
  const path = where.writePath
  const pending = file && path ? draft.pending(file, path) : null
  const value = pending ? (pending.kind === 'set' ? pending.value : undefined) : where.siteValue
  const editable = !!where.target?.editable && !!path
  const label = field.label ? loc(field.label) : field.key
  const inputId = `param-${field.key.replace(/[^\w-]/g, '_')}`

  function change(next: unknown) {
    if (!file || !path) return
    const result = changeFor(field, next)
    if (result.kind === 'set') {
      const unchanged = where.siteValue !== undefined ? same(result.value, where.siteValue) : same(result.value, field.default)
      // Back to what is in the file (or, for an unset key, to the theme default): nothing to write.
      if (unchanged) draft.revert(file, path)
      else draft.set(file, path, result.value)
    } else if (where.siteValue === undefined) {
      draft.revert(file, path)
    } else {
      draft.remove(file, path)
    }
  }

  const whereGotcha = field.whereCompares.find((w) => typeof w.value === 'string')
  return (
    <div className="space-y-1.5" data-field={field.key}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {label}
        </label>
        {field.label && <code className="text-xs text-zinc-500">{field.key}</code>}
        <SourceBadge badge={field.badge} />
        {field.scope === 'both' && <span className="text-xs text-zinc-500">· {t('theme.params.scopeBoth')}</span>}
        {field.scope === 'language' && <span className="text-xs text-zinc-500">· {t('theme.params.scopeLanguage')}</span>}
        {field.productionOnly && <span className="text-xs text-zinc-500">· {t('theme.params.productionOnly')}</span>}
        {field.optional && <span className="text-xs text-zinc-500">· {t('theme.params.optional')}</span>}
        {field.experimental && <span className="text-xs text-amber-700 dark:text-amber-400">· {t('theme.params.experimental')}</span>}
      </div>
      {field.description && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {loc(field.description)}
          {typeof field.description === 'string' && <span className="ml-1 italic text-zinc-400">({t('theme.params.fromThemeComment')})</span>}
        </p>
      )}
      {field.deprecated && <p className="text-xs text-amber-700 dark:text-amber-400">{t('theme.params.deprecated', { reason: loc(field.deprecated) })}</p>}
      {field.gotcha && <p className="text-xs text-amber-700 dark:text-amber-400">⚠ {loc(field.gotcha)}</p>}
      {!field.gotcha && whereGotcha && (
        <p className="text-xs text-amber-700 dark:text-amber-400">⚠ {t('theme.params.whereGotcha', { value: String(whereGotcha.value) })}</p>
      )}
      {field.requiresConfig && <p className="text-xs text-zinc-600 dark:text-zinc-400">ℹ {loc(field.requiresConfig.note)}</p>}
      {field.conflictsWith && <p className="text-xs text-zinc-500">{t('theme.params.conflictsWith', { keys: field.conflictsWith.join(', ') })}</p>}
      <div className="max-w-2xl">
        <FieldInput field={field} value={value} onChange={change} label={label} disabled={!editable} id={inputId} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        {field.default !== undefined && <span>{t('theme.params.themeDefault', { value: formatValue(field.default) })}</span>}
        {field.example !== undefined && <span>{t('theme.params.example', { value: formatValue(field.example) })}</span>}
        {where.owner === null && !pending && <span>{t('theme.params.notSet')}</span>}
        {where.owner && !pending && <span>{t('theme.params.setIn', { file: where.owner.source.file })}</span>}
        {pending && (
          <span className="font-medium text-sky-700 dark:text-sky-400">
            {pending.kind === 'remove' ? t('theme.params.willRemove', { file }) : t('theme.params.pending', { file })}
          </span>
        )}
        {pending && file && path && (
          <button className="text-sky-700 hover:underline dark:text-sky-400" onClick={() => draft.revert(file, path)}>
            {t('theme.params.undo')}
          </button>
        )}
        {where.siteValue !== undefined && pending?.kind !== 'remove' && editable && file && path && (
          <button className="text-sky-700 hover:underline dark:text-sky-400" title={t('theme.params.resetTitle')} onClick={() => draft.remove(file, path)}>
            {t('theme.params.reset')}
          </button>
        )}
        {!editable && where.target && <span>{t('theme.params.readOnlyFile', { file: where.target.file })}</span>}
        {field.docLink && <span className="truncate">{field.docLink}</span>}
        {field.locations.length > 0 && (
          <details>
            <summary className="cursor-pointer">{t('theme.params.usedIn', { count: field.locations.length })}</summary>
            <ul className="mt-1 font-mono">
              {field.locations.slice(0, 8).map((l) => (
                <li key={`${l.file}:${l.line}`}>
                  {l.file}:{l.line}
                </li>
              ))}
              {field.locations.length > 8 && <li>…</li>}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

function UnknownCard({ unknown, sources, draft }: { unknown: UnknownParam[]; sources: ParamsSource[]; draft: ConfigDraft }) {
  const { t } = useTranslation()
  function rename(key: string, to: string) {
    const from = locate(sources, key.split('.'))
    if (!from.owner || !from.writePath) return
    const file = from.owner.source.file
    const prefix = from.owner.source.prefix
    draft.remove(file, from.writePath)
    draft.set(file, [...prefix, ...to.split('.')], from.siteValue)
  }
  function remove(key: string) {
    const from = locate(sources, key.split('.'))
    if (from.owner && from.writePath) draft.remove(from.owner.source.file, from.writePath)
  }
  return (
    <section aria-labelledby="unknown-title" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
      <h3 id="unknown-title" className="font-medium">
        {t('theme.params.unknownTitle', { count: unknown.length })}
      </h3>
      <p className="mb-2 text-xs">{t('theme.params.unknownIntro')}</p>
      <ul className="space-y-1">
        {unknown.map((u) => {
          const from = locate(sources, u.key.split('.'))
          const pending = from.owner && from.writePath ? draft.pending(from.owner.source.file, from.writePath) : null
          return (
            <li key={u.key} className="flex flex-wrap items-center gap-2">
              <code className={pending?.kind === 'remove' ? 'line-through' : ''}>{u.key}</code>
              {u.pageOnly && <span className="text-xs">{t('theme.params.unknownPageOnly')}</span>}
              {u.suggestions.length > 0 && <span className="text-xs">{t('theme.params.unknownSuggestion', { keys: u.suggestions.join(', ') })}</span>}
              {from.owner?.source.editable && !pending && (
                <>
                  {u.suggestions.slice(0, 1).map((s) => (
                    <button key={s} className="text-xs text-sky-800 underline dark:text-sky-300" onClick={() => rename(u.key, s)}>
                      {t('theme.params.renameTo', { key: s })}
                    </button>
                  ))}
                  <button className="text-xs text-sky-800 underline dark:text-sky-300" onClick={() => remove(u.key)}>
                    {t('theme.params.remove')}
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PageParams({ docs }: { docs: PageParamDoc[] }) {
  const { t } = useTranslation()
  const { loc } = useLoc()
  return (
    <section aria-labelledby="page-params" className="space-y-2">
      <h3 id="page-params" className="border-b border-zinc-200 pb-1 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        {t('theme.params.pageTitle')}
      </h3>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('theme.params.pageIntro')}</p>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1 pr-3 font-medium">{t('theme.params.pageKey')}</th>
            <th className="py-1 pr-3 font-medium">{t('theme.params.pageMeaning')}</th>
            <th className="py-1 font-medium">{t('theme.params.pageType')}</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => {
            const whereGotcha = doc.whereCompares.find((w) => typeof w.value === 'string')
            return (
              <tr key={doc.key} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1 pr-3 font-mono text-xs">{doc.key}</td>
                <td className="py-1 pr-3 text-xs">
                  {doc.label ? loc(doc.label) : <span className="text-zinc-400">{t('theme.params.pageFoundInCode')}</span>}
                  {doc.scope === 'both' && <span className="ml-1 text-zinc-500">· {t('theme.params.pageAlsoSite')}</span>}
                  {(doc.gotcha || whereGotcha || doc.writeFalse) && (
                    <span className="block text-amber-700 dark:text-amber-400">
                      ⚠ {doc.gotcha ? loc(doc.gotcha) : doc.writeFalse ? t('theme.params.pageWriteFalse') : t('theme.params.whereGotcha', { value: String(whereGotcha?.value) })}
                    </span>
                  )}
                </td>
                <td className="py-1 text-xs text-zinc-500">{t(`theme.type.${doc.type}`)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
