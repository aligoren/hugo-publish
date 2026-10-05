import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSettingsEditor } from '../editor/context'
import type { ListRow } from '../model/lists'
import { isPlainObject, type Tree } from '../model/values'
import type { Control, OptionSource, SettingDef } from '../schema'
import { ColorControl, DurationControl, LinesControl, NumberControl, TextControl, UrlControl } from './controls/TextControls'
import { MultiControl, SelectControl, ToggleControl } from './controls/ChoiceControls'
import { KvControl, ListControl, PairsControl } from './controls/ListControls'
import { TableControl } from './controls/TableControl'
import { INPUT, SMALL_BUTTON } from './styles'

interface Props {
  id: string
  label: string
  setting: SettingDef
  value: unknown
  onChange(value: unknown): void
  /** Rows with their disk indexes, for arrays of tables. */
  rows?: readonly ListRow[]
  onRowsChange?(rows: ListRow[]): void
  disabled?: boolean
}

function useOptions(source: OptionSource | readonly string[] | undefined): readonly string[] | undefined {
  const { options } = useSettingsEditor()
  if (source === undefined) return undefined
  return typeof source === 'string' ? options[source as OptionSource] : (source as readonly string[])
}

/** The input for one setting, chosen by its control kind. */
export function FieldControl({ id, label, setting, value, onChange, rows, onRowsChange, disabled }: Props) {
  const control: Control = setting.control
  const suggestions = useOptions('suggestions' in control ? control.suggestions : control.kind === 'multi' ? control.options : undefined)
  const common = { id, label, value, onChange, disabled }
  switch (control.kind) {
    case 'toggle':
      return <ToggleControl {...common} />
    case 'select':
      return <SelectControl {...common} options={control.options} />
    case 'text':
      return <TextControl {...common} suggestions={suggestions} monospace={control.monospace} placeholder={control.placeholder} />
    case 'url':
      return <UrlControl {...common} trailingSlash={control.trailingSlash} />
    case 'number':
      return <NumberControl {...common} integer={setting.type === 'integer'} min={control.min} max={control.max} step={control.step} />
    case 'duration':
      return <DurationControl {...common} />
    case 'color':
      return <ColorControl {...common} />
    case 'list':
      return <ListControl {...common} suggestions={suggestions} />
    case 'multi':
      return <MultiControl {...common} options={suggestions ?? []} ordered={control.ordered} />
    case 'lines':
      return <LinesControl {...common} />
    case 'pairs':
      return <PairsControl {...common} />
    case 'kv':
      return <KvControl {...common} keyPlaceholder={control.keyPlaceholder} valuePlaceholder={control.valuePlaceholder} />
    case 'table':
      if (control.keyColumn) return <ObjectMapControl {...common} control={control} />
      return (
        <TableControl id={id} label={label} columns={control.columns} rows={rows ?? []} onChange={(r) => onRowsChange?.(r)} disabled={disabled} />
      )
    default:
      return (
        <pre className="max-h-48 overflow-auto rounded-md bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-800">
          {value === undefined ? '—' : JSON.stringify(value, null, 2)}
        </pre>
      )
  }
}

/** Named tables (`[outputFormats.llms]`): one card per name, plus a form to add a name. */
function ObjectMapControl({
  id,
  label,
  value,
  onChange,
  disabled,
  control,
}: {
  id: string
  label: string
  value: unknown
  onChange(value: unknown): void
  disabled?: boolean
  control: Extract<Control, { kind: 'table' }>
}) {
  const { t } = useTranslation()
  const keyColumn = control.keyColumn!
  const map: Tree = isPlainObject(value) ? value : {}
  const rows: ListRow[] = Object.entries(map).map(([name, v]) => ({ orig: null, values: { ...(isPlainObject(v) ? v : {}), [keyColumn]: name } }))
  const [name, setName] = useState('')

  function emit(next: ListRow[]) {
    const out: Tree = {}
    next.forEach((row, i) => {
      const { [keyColumn]: rawName, ...rest } = row.values
      // An emptied name keeps the old one rather than dropping the entry.
      const entryName = String(rawName ?? '') || rows[i]?.values[keyColumn]
      if (typeof entryName === 'string' && entryName !== '') out[entryName] = rest
    })
    onChange(out)
  }

  const trimmed = name.trim()
  const exists = Object.keys(map).some((k) => k.toLowerCase() === trimmed.toLowerCase())
  return (
    <div className="space-y-2">
      <TableControl id={id} label={label} columns={control.columns} keyColumn={keyColumn} rows={rows} onChange={emit} disabled={disabled} allowAdd={false} />
      <div className="flex items-center gap-2">
        <input
          aria-label={t('settings.control.newName')}
          className={`${INPUT} w-48 font-mono`}
          placeholder={t('settings.control.newName')}
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={disabled || trimmed === '' || exists}
          onClick={() => {
            onChange({ ...map, [trimmed]: {} })
            setName('')
          }}
        >
          {t('settings.control.add')}
        </button>
      </div>
    </div>
  )
}
