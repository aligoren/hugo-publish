import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChangesDialog, type TextChange } from './ChangesDialog'
import { planFeature, type DetectedFeature, type FeatureContext, type StepStatus } from './features'
import type { ConfigOp } from '../../lib/api'
import { formatValue, useLoc } from './useLoc'

interface Props {
  features: DetectedFeature[]
  context: FeatureContext
  onWritten(): void
}

interface PendingAction {
  title: string
  opsByFile: Record<string, ConfigOp[]>
  texts: TextChange[]
}

export function FeaturesPanel({ features, context, onWritten }: Props) {
  const { t } = useTranslation()
  const [addMenu, setAddMenu] = useState<Record<string, boolean>>({})
  const [action, setAction] = useState<PendingAction | null>(null)

  if (features.length === 0) return <p className="text-sm text-zinc-500">{t('theme.features.none')}</p>

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('theme.features.intro')}</p>
      {features.map((feature) => (
        <FeatureCard
          key={feature.id}
          feature={feature}
          context={context}
          addMenu={addMenu[feature.id] ?? false}
          onAddMenu={(value) => setAddMenu({ ...addMenu, [feature.id]: value })}
          onSetUp={(title, plan) =>
            setAction({
              title,
              opsByFile: plan.configOps,
              texts: plan.newFiles.map((f) => ({ path: f.path, before: null, after: f.text, version: null })),
            })
          }
        />
      ))}
      {action && (
        <ChangesDialog
          title={action.title}
          opsByFile={action.opsByFile}
          texts={action.texts}
          onClose={() => setAction(null)}
          onWritten={() => {
            setAction(null)
            onWritten()
          }}
        />
      )}
    </div>
  )
}

function FeatureCard(props: {
  feature: DetectedFeature
  context: FeatureContext
  addMenu: boolean
  onAddMenu(value: boolean): void
  onSetUp(title: string, plan: ReturnType<typeof planFeature>): void
}) {
  const { t } = useTranslation()
  const { loc } = useLoc()
  const { feature, context } = props
  const plan = planFeature(feature.def, context, { addMenu: props.addMenu })
  const label = feature.genericLayout ? t('theme.features.genericLabel', { layout: feature.genericLayout }) : loc(feature.def.label)
  const description = feature.genericLayout ? t('theme.features.genericDescription', { layout: feature.genericLayout }) : loc(feature.def.description)
  const blocked = plan.steps.some((s) => !s.optional && s.state === 'blocked')
  const menuStep = plan.steps.find((s) => s.step.op === 'menuItem' && s.state === 'todo')
  const nothingToDo = Object.keys(plan.configOps).length === 0 && plan.newFiles.length === 0
  const headingId = `feature-${feature.id}`
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="font-medium">
          {label}
        </h3>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${plan.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'}`}
        >
          {plan.enabled ? t('theme.features.enabled') : t('theme.features.notEnabled')}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
      <ul className="mt-3 space-y-1 text-sm">
        {plan.steps.map((status, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className={status.state === 'done' ? 'text-emerald-600' : status.state === 'blocked' ? 'text-amber-600' : 'text-zinc-400'}>
              {status.state === 'done' ? '✓' : status.state === 'blocked' ? '⚠' : '○'}
            </span>
            <span>
              <StepText status={status} />
              <span className="sr-only"> ({t(`theme.features.state.${status.state}`)})</span>
              {status.optional && <span className="ml-1 text-xs text-zinc-500">({t('theme.features.optional')})</span>}
              {status.state === 'blocked' && <span className="block text-xs text-amber-700 dark:text-amber-400">{t('theme.features.blocked', { file: status.file ?? '' })}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!plan.enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {menuStep && (
            <label className="inline-flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="accent-sky-700" checked={props.addMenu} onChange={(e) => props.onAddMenu(e.target.checked)} />
              {t('theme.features.addMenu')}
            </label>
          )}
          <button className="btn btn-primary" disabled={blocked || nothingToDo} onClick={() => props.onSetUp(t('theme.features.dialogTitle', { name: label }), plan)}>
            {t('theme.features.setUp')}
          </button>
        </div>
      )}
    </section>
  )
}

function StepText({ status }: { status: StepStatus }) {
  const { t } = useTranslation()
  const { loc } = useLoc()
  const step = status.step
  switch (step.op) {
    case 'ensureListContains':
      return <>{t('theme.features.stepList', { value: step.value, path: step.path.join('.'), file: status.file ?? '' })}</>
    case 'setParam':
      return <>{t('theme.features.stepParam', { key: step.key, value: formatValue(step.value), file: status.file ?? '' })}</>
    case 'ensureContentFile':
      return <>{t('theme.features.stepPage', { path: status.file ?? step.path, layout: step.layout })}</>
    case 'menuItem':
      return <>{t('theme.features.stepMenu', { name: loc(step.name), url: step.url })}</>
  }
}
