import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api } from '../../lib/api'
import { ChangesDialog, type TextChange } from './ChangesDialog'
import {
  applyManagedBlock,
  detectDarkSelector,
  fromHex,
  generateOverrideFile,
  parseCssVariables,
  readOverrides,
  toHex,
  type CssFile,
  type CssOverrides,
  type CssVar,
} from './css'
import { cssHookFor, cssVarFiles, hookTarget } from './colorsModel'
import { mapLimit, type ThemeData } from './loadTheme'
import type { ThemeMeta } from './schema'

interface Props {
  theme: ThemeData
  meta: ThemeMeta | null
  siteParams: Record<string, unknown>
  onWritten(): void
}

interface Loaded {
  vars: CssVar[]
  files: CssFile[]
  existing: { text: string; version: string } | null
}

export function ColorsPanel({ theme, meta, siteParams, onWritten }: Props) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [overrides, setOverrides] = useState<CssOverrides>({ light: {}, dark: {} })
  const [showAll, setShowAll] = useState(false)
  const [change, setChange] = useState<TextChange | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const hook = cssHookFor(theme, meta)
  const target = hook ? hookTarget(hook) : null
  const paths = cssVarFiles(theme, meta, siteParams)
  const pathsKey = paths.join('|')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const files = (
          await mapLimit(pathsKey ? pathsKey.split('|') : [], 6, async (path) => {
            try {
              return { path, text: (await theme.component.read(path)).text }
            } catch {
              return null
            }
          })
        ).filter((f): f is CssFile => f !== null)
        const existing = target ? await api.readText(target).catch(() => null) : null
        if (cancelled) return
        const vars = parseCssVariables(files)
        const dark = meta?.darkSelector ?? detectDarkSelector(files)
        setLoaded({ vars, files, existing })
        setOverrides(existing ? readOverrides(existing.text, dark) : { light: {}, dark: {} })
      } catch (e) {
        if (!cancelled) setError(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [theme.root, theme.component, pathsKey, target, meta?.darkSelector, reloadKey])

  if (error !== null) return <ErrorNote error={error} />
  if (!loaded) return <p className="text-sm text-zinc-500">{t('common.loading')}</p>
  if (loaded.vars.length === 0) return <p className="text-sm text-zinc-500">{t('theme.colors.none')}</p>

  const darkSelector = meta?.darkSelector ?? detectDarkSelector(loaded.files)
  const hasDark = loaded.vars.some((v) => v.dark !== undefined)
  const shown = loaded.vars.filter((v) => showAll || v.kind === 'color' || v.kind === 'triplet')
  const changedCount = Object.keys(overrides.light).length + Object.keys(overrides.dark).length

  function setValue(context: 'light' | 'dark', name: string, value: string) {
    const next = { ...overrides[context] }
    if (value.trim() === '') delete next[name]
    else next[name] = value.trim()
    setOverrides({ ...overrides, [context]: next })
  }

  function review() {
    if (!hook || !target || !loaded) return
    const before = loaded.existing?.text ?? null
    const eol = before?.includes('\r\n') ? '\r\n' : '\n'
    const after = hook.kind === 'dir' ? generateOverrideFile(overrides, darkSelector, loaded.vars, eol) : applyManagedBlock(before, overrides, darkSelector, loaded.vars)
    setChange({ path: target, before, after, version: loaded.existing?.version ?? null })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('theme.colors.intro')}</p>
      {hook && target ? (
        <p className="text-xs text-zinc-500">{hook.kind === 'dir' ? t('theme.colors.hookDir', { file: target }) : t('theme.colors.hookFile', { file: target })}</p>
      ) : (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">{t('theme.colors.noHook')}</p>
      )}
      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="accent-sky-700" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {t('theme.colors.showAll')}
        </label>
        <span className="text-xs text-zinc-500">{t('theme.colors.files', { count: loaded.files.length })}</span>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1 pr-3 font-medium">{t('theme.colors.variable')}</th>
            <th className="py-1 pr-3 font-medium">{t('theme.colors.light')}</th>
            {hasDark && <th className="py-1 font-medium">{t('theme.colors.dark')}</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((v) => (
            <tr key={v.name} className="border-t border-zinc-100 align-top dark:border-zinc-800">
              <td className="py-2 pr-3">
                <code className="text-xs">{v.name}</code>
                <span className="block text-[11px] text-zinc-400">{v.file}</span>
              </td>
              <td className="py-2 pr-3">
                {v.light !== undefined && (
                  <VarCell name={v.name} context="light" themeValue={v.light} value={overrides.light[v.name]} disabled={!hook} onChange={(value) => setValue('light', v.name, value)} />
                )}
              </td>
              {hasDark && (
                <td className="py-2">
                  {v.dark !== undefined && (
                    <VarCell name={v.name} context="dark" themeValue={v.dark} value={overrides.dark[v.name]} disabled={!hook} onChange={(value) => setValue('dark', v.name, value)} />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {hook && (
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={review}>
            {t('theme.colors.review', { count: changedCount })}
          </button>
        </div>
      )}
      {change && (
        <ChangesDialog
          title={t('theme.colors.dialogTitle')}
          texts={[change]}
          skipValidation
          onClose={() => setChange(null)}
          onWritten={() => {
            setChange(null)
            setReloadKey((k) => k + 1)
            onWritten()
          }}
        />
      )}
    </div>
  )
}

function VarCell(props: { name: string; context: 'light' | 'dark'; themeValue: string; value: string | undefined; disabled: boolean; onChange(value: string): void }) {
  const { t } = useTranslation()
  const current = props.value ?? props.themeValue
  const hex = toHex(current)
  const label = t(`theme.colors.${props.context}Of`, { name: props.name })
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {hex ? (
          <input
            type="color"
            className="h-7 w-9 cursor-pointer rounded border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label={t('theme.field.pickColor', { name: label })}
            value={hex}
            disabled={props.disabled}
            onChange={(e) => props.onChange(fromHex(e.target.value, current))}
          />
        ) : (
          <span className="inline-block h-7 w-9" aria-hidden="true" />
        )}
        <input
          className="w-full min-w-0 max-w-56 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
          aria-label={label}
          placeholder={props.themeValue}
          value={props.value ?? ''}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
        />
        {props.value !== undefined && (
          <button className="text-xs text-sky-700 hover:underline dark:text-sky-400" disabled={props.disabled} onClick={() => props.onChange('')}>
            {t('theme.params.reset')}
          </button>
        )}
      </div>
      {props.value !== undefined && <p className="text-[11px] text-zinc-500">{t('theme.colors.themeValue', { value: props.themeValue })}</p>}
    </div>
  )
}
