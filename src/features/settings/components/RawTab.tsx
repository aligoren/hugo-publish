import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parse } from 'yaml'

import { ErrorNote } from '../../../components/ErrorNote'
import { api, isAppError, type ConfigValidation } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'
import { useSettingsEditor } from '../editor/context'
import { hasKeepFiles, risksOfValues, type Risk } from '../model/risk'
import { globalTree, shortName, type LoadedSource } from '../model/sources'
import type { Tree } from '../model/values'
import { RiskList } from './RiskConfirm'
import { DANGER_NOTE, WARNING_NOTE } from './styles'

/** Risky differences between the file on disk and the edited text (parse errors are left to Hugo). */
async function risksOfText(source: LoadedSource | undefined, text: string): Promise<Risk[]> {
  if (!source) return []
  try {
    let values: unknown
    if (source.format === 'toml') values = (await api.tomlParseText(text)).values
    else if (source.format === 'yaml') values = parse(text.replace(/^﻿/, ''))
    else values = JSON.parse(text.replace(/^﻿/, ''))
    return values && typeof values === 'object' && !Array.isArray(values) ? risksOfValues(source, values as Tree) : []
  } catch {
    return []
  }
}

interface Buffer {
  text: string
  /** Text as last read or written. */
  original: string
  version: string
}

interface Props {
  file: string
  onFileChange(file: string): void
  /** Called after the file was written. */
  onSaved(file: string): void
}

/** The config file as text: an always-available escape hatch, checked by Hugo before saving. */
export function RawTab({ file, onFileChange, onSaved }: Props) {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  const { configVersion } = useSite()
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({})
  const [seenVersion, setSeenVersion] = useState(configVersion)
  if (configVersion !== seenVersion) {
    // A config file was written somewhere: re-read every file without unsaved text here.
    setSeenVersion(configVersion)
    setBuffers((b) => Object.fromEntries(Object.entries(b).filter(([, buffer]) => buffer.text !== buffer.original)))
  }
  const [validation, setValidation] = useState<ConfigValidation | null>(null)
  const [busy, setBusy] = useState<'validate' | 'save' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState(false)
  const [risks, setRisks] = useState<Risk[] | null>(null)
  const buffer = buffers[file]
  const source = editor.sources.find((s) => s.path === file)
  const pendingOps = (editor.draft.opsByFile[file]?.length ?? 0) + (editor.lists.opsByFile[file]?.length ?? 0)

  const load = useCallback(async (path: string) => {
    try {
      const read = await api.readText(path)
      setBuffers((b) => ({ ...b, [path]: { text: read.text, original: read.text, version: read.version } }))
      setConflict(false)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [])

  useEffect(() => {
    // Read once per file; edits stay in the buffer when switching files.
    // oxlint-disable-next-line react/set-state-in-effect
    if (file && !buffers[file]) void load(file)
  }, [buffers, file, load])

  function edit(text: string) {
    setBuffers((b) => ({ ...b, [file]: { ...b[file], text } }))
    setValidation(null)
    setSaved(false)
    setRisks(null)
  }

  async function validate(): Promise<ConfigValidation | null> {
    if (!buffer || !editor.hugoAvailable) return null
    setBusy('validate')
    setError(null)
    try {
      const result = await api.configValidate(file, buffer.text)
      setValidation(result)
      return result
    } catch (e) {
      setError(e)
      return { ok: false, messages: [] }
    } finally {
      setBusy(null)
    }
  }

  async function save(riskConfirmed = false) {
    if (!buffer) return
    const checked = await validate()
    if (checked && !checked.ok) return
    if (!riskConfirmed) {
      const found = await risksOfText(source, buffer.text)
      if (found.length > 0) {
        setRisks(found)
        return
      }
    }
    setRisks(null)
    setBusy('save')
    try {
      const version = await api.writeText(file, buffer.text, buffer.version)
      setBuffers((b) => ({ ...b, [file]: { text: buffer.text, original: buffer.text, version } }))
      setSaved(true)
      onSaved(file)
    } catch (e) {
      if (isAppError(e) && e.code === 'conflict') setConflict(true)
      else setError(e)
    } finally {
      setBusy(null)
    }
  }

  const dirty = buffer !== undefined && buffer.text !== buffer.original
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          {t('settings.raw.file')}
          <select className="rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" value={file} onChange={(e) => onFileChange(e.target.value)}>
            {editor.sources.map((s) => (
              <option key={s.path} value={s.path}>
                {shortName(s.path)}
                {s.active ? '' : ` (${t('settings.raw.notLoaded')})`}
                {buffers[s.path] && buffers[s.path].text !== buffers[s.path].original ? ' •' : ''}
              </option>
            ))}
          </select>
        </label>
        {dirty && <span className="text-xs text-amber-700 dark:text-amber-400">{t('document.unsaved')}</span>}
        {saved && !dirty && <span className="text-xs text-emerald-700 dark:text-emerald-400">{t('common.saved')}</span>}
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn" disabled={!buffer || !editor.hugoAvailable || busy !== null} onClick={() => void validate()}>
            {busy === 'validate' ? t('settings.raw.validating') : t('settings.raw.validate')}
          </button>
          <button type="button" className="btn btn-primary" disabled={!dirty || busy !== null} onClick={() => void save()}>
            {busy === 'save' ? t('common.saving') : t('common.save')}
          </button>
        </span>
      </div>

      {source && !source.active && <p className={WARNING_NOTE}>{t('settings.raw.inactive')}</p>}
      {pendingOps > 0 && <p className={WARNING_NOTE}>{t('settings.raw.pendingOps', { count: pendingOps })}</p>}
      {!editor.hugoAvailable && <p className="text-xs text-zinc-500">{t('settings.raw.noHugo')}</p>}
      {conflict && (
        <div role="alert" className={`${WARNING_NOTE} space-y-2`}>
          <p>{t('settings.raw.conflict')}</p>
          <button type="button" className="btn" onClick={() => void load(file)}>
            {t('document.reload')}
          </button>
        </div>
      )}
      {error !== null && <ErrorNote error={error} />}
      {risks && (
        <div role="alertdialog" aria-label={t('settings.risk.title')} className={`${DANGER_NOTE} space-y-2`}>
          <p className="font-medium">{t('settings.risk.title')}</p>
          <RiskList risks={risks} keepFiles={source ? hasKeepFiles(globalTree(source)) : false} />
          <div className="flex gap-2">
            <button type="button" className="btn border-red-700 bg-red-700 text-white hover:bg-red-800" onClick={() => void save(true)}>
              {t('settings.risk.saveAnyway')}
            </button>
            <button type="button" className="btn" onClick={() => setRisks(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {validation && (
        <div className="space-y-1 text-sm">
          {validation.ok ? (
            <p className="text-emerald-700 dark:text-emerald-400">✓ {t('review.valid')}</p>
          ) : (
            <p className="font-medium text-red-700 dark:text-red-400">{t('review.invalid')}</p>
          )}
          {validation.messages.map((m, i) => (
            <p key={i} className={`font-mono text-xs ${m.level === 'error' ? 'text-red-700 dark:text-red-400' : m.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500'}`}>
              {m.text}
            </p>
          ))}
        </div>
      )}

      <textarea
        aria-label={t('settings.raw.editorLabel', { file })}
        className="min-h-80 flex-1 resize-none rounded-md border border-zinc-300 bg-white p-3 font-mono text-[13px] leading-relaxed whitespace-pre dark:border-zinc-700 dark:bg-zinc-900"
        spellCheck={false}
        wrap="off"
        value={buffer?.text ?? ''}
        disabled={!buffer}
        onChange={(e) => edit(e.target.value)}
      />
    </div>
  )
}
