import { useTranslation } from 'react-i18next'

import { useSettingsEditor } from '../editor/context'
import { planPreset, PRESETS, type Preset, type PresetPlan } from '../model/presets'
import { shortName } from '../model/sources'
import { BADGE, CARD } from './styles'

interface Props {
  onApply(plan: PresetPlan): void
}

/** Ready-made bundles of settings; each opens the usual review with its changes. */
export function PresetsTab({ onApply }: Props) {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  const header = t('settings.newFile.header').split('\n')

  function plan(preset: Preset): PresetPlan {
    // Hugo's view only matches the files a preset writes when both target the same environment.
    const sameEnv = (preset.environment ?? null) === editor.env
    return planPreset(preset, { sources: editor.sources, effective: sameEnv ? editor.effective : null, newFileHeader: header })
  }

  return (
    <div className="max-w-4xl space-y-4 px-5 py-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t('settings.presets.title')}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('settings.presets.intro')}</p>
      </header>
      <ul className="grid gap-3 md:grid-cols-2">
        {PRESETS.map((preset) => (
          <PresetCard key={preset.id} preset={preset} plan={plan(preset)} onApply={onApply} />
        ))}
      </ul>
    </div>
  )
}

function PresetCard({ preset, plan, onApply }: { preset: Preset; plan: PresetPlan; onApply(plan: PresetPlan): void }) {
  const { t } = useTranslation()
  const files = [...Object.keys(plan.opsByFile), ...Object.keys(plan.newFiles)]
  return (
    <li className={`${CARD} flex flex-col gap-2`}>
      <div className="flex items-start gap-2">
        <h3 className="flex-1 font-medium">{t(`settings.presets.${preset.id}.title`)}</h3>
        {plan.applied && (
          <span className={`${BADGE} bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300`}>{t('settings.presets.applied')}</span>
        )}
      </div>
      <p className="flex-1 text-sm text-zinc-600 dark:text-zinc-400">{t(`settings.presets.${preset.id}.description`)}</p>
      {!plan.applied && (
        <p className="text-xs text-zinc-500">
          {t('settings.presets.files', { files: files.map(shortName).join(', ') })}
          {Object.keys(plan.newFiles).length > 0 && ` · ${t('settings.presets.newFile')}`}
        </p>
      )}
      <div>
        <button type="button" className="btn" disabled={plan.applied} onClick={() => onApply(plan)}>
          {t('settings.presets.review')}
        </button>
      </div>
    </li>
  )
}
