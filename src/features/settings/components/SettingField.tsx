import { openUrl } from '@tauri-apps/plugin-opener'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { effectiveValueAt } from '../../config-edit'
import { useSettingsEditor } from '../editor/context'
import { columnCasing } from '../model/edits'
import { listMode, rowsOf, type ListRow } from '../model/lists'
import { resolveKey } from '../model/owner'
import { shortName } from '../model/sources'
import { deepEqual, formatValue, isEmptyValue, isPlainObject, looseEqual, type Tree } from '../model/values'
import { messageId, type SettingDef } from '../schema'
import { ChromaSample } from './ChromaSample'
import { FieldControl } from './FieldControl'
import { SourceBadge, type Origin } from './SourceBadge'
import { BADGE, LINK_BUTTON } from './styles'

interface Props {
  setting: SettingDef
  /** Concrete path (language filled in for `languages.*` keys). */
  path: string[]
}

/** Hugo prints unset keys as null, "" or []; those mean "Hugo's default". */
function present(value: unknown): boolean {
  return !isEmptyValue(value)
}

/** One setting: label, origin badge, input, Hugo's effective value, reset. */
export function SettingField({ setting, path }: Props) {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  const id = useId()
  const [proposed, setProposed] = useState<{ value: unknown } | null>(null)

  const disk = resolveKey(editor.sources, editor.env, path)
  const pending = resolveKey(editor.sources, editor.env, path, editor.valuesOf)
  const effective = editor.effective ? effectiveValueAt(editor.effective, path) : undefined
  // In the all-environments view Hugo's output includes production overrides; don't show those as inherited.
  const fromHugo = editor.env === null && disk.overriddenIn.length > 0 ? undefined : effective
  // Named tables merge with Hugo's built-ins (all 15 output formats…), so only file entries are edited.
  const inherited = setting.type === 'objectMap' ? undefined : present(fromHugo) ? fromHugo : (setting.default ?? fromHugo)
  const diskValue = disk.owner ? disk.owner.value : inherited
  const shown = pending.owner ? pending.owner.value : inherited
  const isPending = disk.owner?.source.path !== pending.owner?.source.path || !deepEqual(disk.owner?.value, pending.owner?.value)
  const target = disk.target
  const readOnly = setting.control.kind === 'readonly' || target === null
  const id18 = messageId(setting.path)
  const label = t(`settings.keys.${id18}.label`)
  const help = t(`settings.keys.${id18}.help`)

  const origin: Origin = pending.owner
    ? { kind: 'file', path: pending.owner.source.path, inherited: editor.env !== null && pending.owner.source.layer !== 'env' }
    : editor.hugoAvailable && present(effective) && !looseEqual(effective, setting.default)
      ? { kind: 'external' }
      : { kind: 'default' }

  function commit(value: unknown) {
    if (setting.requiresConfirm && !deepEqual(value, diskValue)) setProposed({ value })
    else editor.editValue(path, writeValue(setting, value, disk.owner?.value), diskValue)
  }

  // Arrays of tables are edited as rows that remember their index in the file.
  const before = target ? disk.layerLocations.find((l) => l.source === target.source)?.value : undefined
  const listDraft = target && setting.type === 'objectList' ? editor.lists.get(target.source.path, target.filePath) : undefined
  const rows: ListRow[] | undefined =
    setting.type !== 'objectList'
      ? undefined
      : (listDraft?.rows ??
        (Array.isArray(before)
          ? rowsOf(before.filter(isPlainObject))
          : // Not in the edited file yet: start from what Hugo uses now (an override copies the whole list).
            asTables(disk.owner?.value ?? inherited).map((values) => ({
              orig: null,
              values: columnCasing(values, setting.control.kind === 'table' ? setting.control.columns : []),
            }))))
  function changeRows(next: ListRow[]) {
    if (!target) return
    editor.lists.update({
      file: target.source.path,
      path: target.filePath,
      mode: listMode(target.source, target.filePath, before !== undefined),
      disk: Array.isArray(before) ? before.filter(isPlainObject) : null,
      rows: next,
    })
  }

  // Something to remove in the edited files that is not already being removed.
  const canReset = disk.layerLocations.some((l) => l.source.editable) && pending.layerLocations.length > 0
  const showEffective = editor.hugoAvailable && effective !== undefined && effective !== null && !['table', 'readonly'].includes(setting.control.kind)

  return (
    <div
      className={`space-y-1.5 border-b border-zinc-100 py-3 last:border-b-0 dark:border-zinc-800 ${isPending ? 'border-l-2 border-l-amber-400 pl-3' : ''}`}
      data-setting={path.join('.')}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <code className="text-[11px] text-zinc-500">{path.join('.')}</code>
        <SourceBadge origin={origin} />
        {isPending && <span className={`${BADGE} bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200`}>{t('settings.field.pending')}</span>}
        {setting.requiresConfirm && (
          <span className={`${BADGE} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300`}>{t('settings.field.risky')}</span>
        )}
        {setting.level === 'advanced' && (
          <span className={`${BADGE} bg-zinc-100 text-zinc-500 dark:bg-zinc-800`}>{t('settings.field.advanced')}</span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <button type="button" className={LINK_BUTTON} onClick={() => void openUrl(setting.docs)} aria-label={t('settings.field.docsFor', { label })}>
            {t('settings.field.docs')} ↗
          </button>
          {isPending && (
            <button type="button" className={LINK_BUTTON} onClick={() => editor.revertPath(path)}>
              {t('settings.field.undo')}
            </button>
          )}
          {canReset && (
            <button type="button" className={LINK_BUTTON} onClick={() => editor.resetPath(path)}>
              {editor.env === null ? t('settings.field.reset') : t('settings.field.removeOverride')}
            </button>
          )}
        </span>
      </div>

      <FieldControl
        id={id}
        label={label}
        setting={setting}
        value={proposed ? proposed.value : shown}
        onChange={commit}
        rows={rows}
        onRowsChange={changeRows}
        disabled={readOnly || proposed !== null}
      />

      {path.join('.').toLowerCase() === 'markup.highlight.style' && <ChromaSample style={String((proposed ? proposed.value : shown) ?? '')} />}

      {proposed && (
        <div role="alertdialog" aria-label={t('settings.field.confirmTitle')} className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
          <p className="font-medium text-red-900 dark:text-red-100">{t('settings.field.confirmTitle')}</p>
          <p className="text-red-900 dark:text-red-100">{help}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn border-red-700 bg-red-700 text-white hover:bg-red-800"
              onClick={() => {
                editor.editValue(path, writeValue(setting, proposed.value, disk.owner?.value), diskValue)
                setProposed(null)
              }}
            >
              {t('settings.field.confirmApply')}
            </button>
            <button type="button" className="btn" onClick={() => setProposed(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-600 dark:text-zinc-400">{help}</p>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-zinc-500">
        {showEffective && (
          <span>
            {t('settings.field.effective')}: <span className="font-mono">{truncate(formatValue(effective))}</span>
          </span>
        )}
        {setting.default !== undefined && !['table'].includes(setting.control.kind) && (
          <span>
            {t('settings.field.default')}: <span className="font-mono">{truncate(formatValue(setting.default))}</span>
          </span>
        )}
      </div>

      {setting.deprecated && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('settings.field.deprecated', { since: setting.deprecated.since, replacement: setting.deprecated.replacement ?? '—' })}
        </p>
      )}
      {disk.overriddenIn.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('settings.field.overriddenIn', { files: disk.overriddenIn.map((l) => shortName(l.source.path)).join(', ') })}
        </p>
      )}
      {disk.layerLocations.length > 1 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('settings.field.definedTwice', {
            files: disk.layerLocations.map((l) => shortName(l.source.path)).join(', '),
            winner: shortName(disk.layerLocations[disk.layerLocations.length - 1].source.path),
          })}
        </p>
      )}
      {target === null && setting.control.kind !== 'readonly' && (
        <p className="text-xs text-zinc-500">
          {disk.owner && !disk.owner.source.editable
            ? t('settings.field.readOnlyFile', { file: shortName(disk.owner.source.path) })
            : t('settings.field.noTarget')}
        </p>
      )}
    </div>
  )
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function asTables(value: unknown): Tree[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : []
}


/** `theme = 'x'` stays a string when it was one; one-item lists of string-or-list keys become strings. */
function writeValue(setting: SettingDef, value: unknown, current: unknown): unknown {
  if (setting.type !== 'stringOrList' || !Array.isArray(value)) return value
  const preferString = typeof current === 'string' || (current === undefined && setting.path[0] === 'theme')
  return preferString && value.length === 1 ? value[0] : value
}
