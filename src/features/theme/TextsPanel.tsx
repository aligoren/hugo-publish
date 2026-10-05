import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, type ConfigOp } from '../../lib/api'
import { ReviewChangesDialog } from '../config-edit'
import { ChangesDialog, type TextChange } from './ChangesDialog'
import { readComponentI18n, readI18nFile, type I18nFileData, type ThemeData } from './loadTheme'
import { i18nFormat, i18nLanguage, planI18nWrite, sameI18n, themeI18nPath, type I18nChanges, type I18nFormat, type I18nValue } from './textOverrides'

interface Props {
  theme: ThemeData
  languages: string[]
  /** i18n keys found in the theme's templates and the profile's key list. */
  usedKeys: Map<string, number>
  onWritten(): void
}

interface Loaded {
  /** Language and reload count the data belongs to. */
  key: string
  themeFile: I18nFileData | null
  siteFile: I18nFileData | null
  /** Path of the site file to write (existing or new). */
  sitePath: string
  siteFormat: I18nFormat
}

export function TextsPanel({ theme, languages, usedKeys, onWritten }: Props) {
  const { t } = useTranslation()
  const [lang, setLang] = useState(languages[0] ?? 'en')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [edits, setEdits] = useState<I18nChanges>({})
  const [reloadKey, setReloadKey] = useState(0)
  const [review, setReview] = useState<{ ops: Record<string, ConfigOp[]> } | { texts: TextChange[] } | null>(null)
  const [filter, setFilter] = useState('')

  const loadKey = `${lang}|${reloadKey}`
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const themePath = themeI18nPath(theme.files, lang)
        const themeFile = themePath ? await readComponentI18n(theme.component, themePath) : null
        const siteList = (await api.listFiles('i18n').catch(() => [])).map((f) => f.path).filter((p) => i18nFormat(p))
        const existing = siteList.find((p) => i18nLanguage(p) === lang)
        const siteFile = existing ? await readI18nFile(existing) : null
        const siteFormat: I18nFormat = existing ? i18nFormat(existing)! : siteList.length > 0 ? i18nFormat(siteList[0])! : 'yaml'
        const ext = siteFormat === 'yaml' ? (siteList[0]?.endsWith('.yml') ? 'yml' : 'yaml') : siteFormat
        if (!cancelled) setLoaded({ key: `${lang}|${reloadKey}`, themeFile, siteFile, sitePath: existing ?? `i18n/${lang}.${ext}`, siteFormat })
      } catch (e) {
        if (!cancelled) setError(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [theme.root, theme.component, theme.files, lang, reloadKey])

  if (error !== null) return <ErrorNote error={error} />
  if (!loaded || loaded.key !== loadKey) return <p className="text-sm text-zinc-500">{t('common.loading')}</p>

  const themeEntries = loaded.themeFile?.data.entries ?? {}
  const siteEntries = loaded.siteFile?.data.entries ?? {}
  const keys = [...new Set([...Object.keys(themeEntries), ...usedKeys.keys(), ...Object.keys(siteEntries)])].sort()
  const shown = keys.filter((k) => !filter || k.toLowerCase().includes(filter.toLowerCase()) || JSON.stringify(themeEntries[k] ?? '').toLowerCase().includes(filter.toLowerCase()))
  const changes: I18nChanges = Object.fromEntries(Object.entries(edits).filter(([key, value]) => !sameI18n(value ?? undefined, siteEntries[key])))
  const changeCount = Object.keys(changes).length

  function edit(key: string, value: I18nValue | null) {
    setEdits({ ...edits, [key]: value })
  }

  function openReview() {
    if (!loaded) return
    const plan = planI18nWrite(
      {
        path: loaded.sitePath,
        format: loaded.siteFormat,
        text: loaded.siteFile?.text ?? null,
        version: loaded.siteFile?.version ?? null,
        data: loaded.siteFile?.data ?? { shape: 'map', entries: {} },
        raw: loaded.siteFile?.raw ?? {},
      },
      changes,
    )
    if (plan.kind === 'ops') setReview({ ops: { [plan.path]: plan.ops } })
    else setReview({ texts: [{ path: plan.path, before: plan.before, after: plan.after, version: plan.version }] })
  }

  function written() {
    setReview(null)
    setEdits({})
    setReloadKey((k) => k + 1)
    onWritten()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('theme.texts.intro')}</p>
      <div className="flex flex-wrap items-center gap-3">
        {languages.length > 1 && (
          <label className="field">
            <span>{t('theme.texts.language')}</span>
            <select
              value={lang}
              onChange={(e) => {
                setLang(e.target.value)
                setEdits({})
              }}
            >
              {languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        <input
          type="search"
          className="w-full max-w-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          placeholder={t('theme.texts.filter')}
          aria-label={t('theme.texts.filter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <p className="text-xs text-zinc-500">
        {loaded.themeFile ? t('theme.texts.themeFile', { file: loaded.themeFile.path }) : t('theme.texts.noThemeFile', { lang })}
        {' · '}
        {loaded.siteFile ? t('theme.texts.siteFile', { file: loaded.sitePath }) : t('theme.texts.siteFileNew', { file: loaded.sitePath })}
      </p>
      {keys.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('theme.texts.none')}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">{t('theme.texts.key')}</th>
              <th className="py-1 pr-3 font-medium">{t('theme.texts.themeText')}</th>
              <th className="py-1 font-medium">{t('theme.texts.yourText')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((key) => (
              <TextRow
                key={key}
                id={key}
                themeValue={themeEntries[key]}
                siteValue={siteEntries[key]}
                edit={key in edits ? edits[key] : undefined}
                uses={usedKeys.get(key) ?? 0}
                onEdit={(value) => edit(key, value)}
              />
            ))}
          </tbody>
        </table>
      )}
      <div className="flex justify-end gap-2">
        {changeCount > 0 && (
          <button className="btn" onClick={() => setEdits({})}>
            {t('theme.params.discard')}
          </button>
        )}
        <button className="btn btn-primary" disabled={changeCount === 0} onClick={openReview}>
          {t('theme.texts.review', { count: changeCount })}
        </button>
      </div>
      {review && 'ops' in review && <ReviewChangesDialog opsByFile={review.ops} skipValidation onClose={() => setReview(null)} onWritten={written} />}
      {review && 'texts' in review && (
        <ChangesDialog title={t('theme.texts.dialogTitle')} texts={review.texts} skipValidation onClose={() => setReview(null)} onWritten={written} />
      )}
    </div>
  )
}

function TextRow(props: {
  id: string
  themeValue: I18nValue | undefined
  siteValue: I18nValue | undefined
  /** undefined: not edited; null: override removed. */
  edit: I18nValue | null | undefined
  uses: number
  onEdit(value: I18nValue | null): void
}) {
  const { t } = useTranslation()
  const current = props.edit === undefined ? props.siteValue : (props.edit ?? undefined)
  const plural = typeof props.themeValue === 'object' || typeof current === 'object'
  const forms = plural
    ? [...new Set([...Object.keys(typeof props.themeValue === 'object' ? props.themeValue : {}), ...Object.keys(typeof current === 'object' ? current : {}), 'other'])]
    : []
  const themeText = (form?: string) =>
    props.themeValue === undefined ? '' : typeof props.themeValue === 'string' ? props.themeValue : form ? (props.themeValue[form] ?? '') : Object.values(props.themeValue).join(' / ')
  const currentText = (form?: string) => (current === undefined ? '' : typeof current === 'string' ? (form ? (form === 'other' ? current : '') : current) : form ? (current[form] ?? '') : '')

  function setForm(form: string, text: string) {
    const base: Record<string, string> = typeof current === 'object' ? { ...current } : typeof current === 'string' ? { other: current } : {}
    if (text === '') delete base[form]
    else base[form] = text
    props.onEdit(Object.keys(base).length === 0 ? null : base)
  }

  return (
    <tr className="border-t border-zinc-100 align-top dark:border-zinc-800">
      <td className="py-2 pr-3">
        <code className="text-xs">{props.id}</code>
        {props.themeValue === undefined && props.uses > 0 && <span className="block text-[11px] text-amber-700 dark:text-amber-400">{t('theme.texts.missingInTheme')}</span>}
        {props.uses > 0 && <span className="block text-[11px] text-zinc-400">{t('theme.texts.uses', { count: props.uses })}</span>}
      </td>
      <td className="py-2 pr-3 text-xs text-zinc-600 dark:text-zinc-400">
        {plural ? (
          forms.map((form) => (
            <span key={form} className="block">
              <span className="text-zinc-400">{t(`theme.texts.form.${form}`)}:</span> {themeText(form)}
            </span>
          ))
        ) : (
          themeText()
        )}
      </td>
      <td className="py-2">
        <div className="space-y-1">
          {plural ? (
            forms.map((form) => (
              <input
                key={form}
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                aria-label={t('theme.texts.inputForm', { key: props.id, form: t(`theme.texts.form.${form}`) })}
                placeholder={themeText(form)}
                value={currentText(form)}
                onChange={(e) => setForm(form, e.target.value)}
              />
            ))
          ) : (
            <input
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              aria-label={t('theme.texts.input', { key: props.id })}
              placeholder={themeText()}
              value={currentText()}
              onChange={(e) => props.onEdit(e.target.value === '' ? null : e.target.value)}
            />
          )}
          {current !== undefined && (
            <button className="text-xs text-sky-700 hover:underline dark:text-sky-400" onClick={() => props.onEdit(null)}>
              {t('theme.params.reset')}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
