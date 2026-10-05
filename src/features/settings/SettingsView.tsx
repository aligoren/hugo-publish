import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api, isAppError, type ConfigOp, type ConfigValidation, type HugoMessage } from '../../lib/api'
import { ReviewChangesDialog } from '../config-edit'
import { useSite } from '../site/SiteContext'
import { EnvironmentPicker } from './components/EnvironmentPicker'
import { FileChangesDialog, type FileChange } from './components/FileChangesDialog'
import { MenusTab } from './components/MenusTab'
import { MigrationTab } from './components/MigrationTab'
import { NewFileDialog } from './components/NewFileDialog'
import { PendingBar } from './components/PendingBar'
import { PresetsTab } from './components/PresetsTab'
import { RawTab } from './components/RawTab'
import { RiskConfirmDialog } from './components/RiskConfirm'
import { SettingsTab } from './components/SettingsTab'
import { SourcesSummary } from './components/SourcesSummary'
import { NOTE, WARNING_NOTE } from './components/styles'
import { SettingsEditorContext } from './editor/context'
import { useConfigSources } from './hooks/useConfigSources'
import { useEffectiveConfig } from './hooks/useEffectiveConfig'
import { useSettingsEditorState } from './hooks/useSettingsEditorState'
import { findMigrations, hugoProblems, toVersion } from './model/migration'
import { rootFileOf } from './model/owner'
import { hasKeepFiles, risksOfOps, type Risk } from './model/risk'
import { environmentsOf, globalTree, layerFor, stackFor } from './model/sources'
import { rootFilesInTheWay, splitChanges, splitValidationFiles, verifySplit } from './model/splitApply'
import { tomlDocument } from './model/toml'
import type { PresetPlan } from './model/presets'

type Tab = 'settings' | 'menus' | 'migration' | 'presets' | 'raw'
const TABS: Tab[] = ['settings', 'menus', 'migration', 'presets', 'raw']

interface Review {
  opsByFile: Record<string, ConfigOp[]>
  /** Writing it saves the pending changes, so the draft is cleared afterwards. */
  fromDraft: boolean
}

interface RiskGate {
  review: Review
  risks: Risk[]
}

/** A text-level change shown in FileChangesDialog. */
interface TextChange {
  title: string
  intro?: string
  prepare(): Promise<FileChange[]>
  verify?(changes: FileChange[]): Promise<string[]>
  validateAll?(changes: FileChange[]): Promise<ConfigValidation | null>
  onDone(changes: FileChange[]): void
}

interface NewFile {
  path: string
  text: string
  /** Switch to this environment once the file exists. */
  selectEnv?: string
}

/** Hugo's stderr lines from a failed `hugo config`, for the migration list. */
function errorLines(error: unknown): HugoMessage[] | null {
  if (!isAppError(error)) return null
  return error.message
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((text) => ({ level: /^\s*WARN/.test(text) ? 'warn' : 'error', text }))
}

/** Site settings (hugo.toml and friends) as forms. */
export function SettingsView() {
  const { t } = useTranslation()
  const { hugo, notifyConfigChanged, reloadFiles } = useSite()
  const config = useConfigSources()
  const [env, setEnv] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [tab, setTab] = useState<Tab>('settings')
  const [review, setReview] = useState<Review | null>(null)
  const [gate, setGate] = useState<RiskGate | null>(null)
  const [textChange, setTextChange] = useState<TextChange | null>(null)
  const [newFile, setNewFile] = useState<NewFile | null>(null)
  const [rawFile, setRawFile] = useState<string | null>(null)
  const hugoAvailable = hugo !== null
  const effective = useEffectiveConfig(env, hugoAvailable, token)

  const { editor, opsByFile, pendingCount, discard, discardConfig } = useSettingsEditorState({
    sources: config.sources,
    env,
    effective: effective.effective?.values ?? null,
    hugoAvailable,
  })

  const found = environmentsOf(config.sources)
  // A just-created environment stays selectable while the file list reloads.
  const environments = env !== null && !found.includes(env) ? [...found, env] : found
  const findings = useMemo(() => findMigrations(config.sources, toVersion(hugo?.version)), [config.sources, hugo])
  const hugoMessages = effective.effective?.messages ?? errorLines(effective.error)
  const migrationCount = findings.length + (hugoMessages ? hugoProblems(hugoMessages).length : 0)
  const layer = layerFor(config.sources, env)
  const rootFile = rootFileOf(layer)
  const raw = rawFile ?? config.sources.find((s) => s.active && s.editable)?.path ?? config.sources[0]?.path ?? null

  function reload() {
    config.reload()
    setToken((n) => n + 1)
  }

  function header(key: 'header' | 'envHeader', name?: string): string[] {
    return t(`settings.newFile.${key}`, { env: name }).split('\n')
  }

  function createEnvironment(name: string) {
    setNewFile({ path: `config/${name}/hugo.toml`, text: tomlDocument({}, header('envHeader', name)), selectEnv: name })
  }

  /** Opens the review, after an explicit confirmation when the changes are risky. */
  function requestReview(next: Review) {
    const risks = risksOfOps(config.sources, next.opsByFile)
    if (risks.length > 0) setGate({ review: next, risks })
    else setReview(next)
  }

  /** Front matter changes of menu entries, reviewed after the config changes. */
  function reviewPageMenus() {
    setTextChange({
      title: t('settings.changes.pagesTitle'),
      intro: t('settings.changes.pagesIntro'),
      prepare: editor.pageMenus.prepareChanges,
      onDone: () => {
        editor.pageMenus.clear()
        void reloadFiles()
      },
    })
  }

  function reviewPending() {
    if (Object.keys(opsByFile).length > 0) requestReview({ opsByFile, fromDraft: true })
    else if (editor.pageMenus.count > 0) reviewPageMenus()
  }

  function splitConfig() {
    const root = config.sources.find((s) => s.layer === 'root' && s.active)
    if (!root) return
    const inTheWay = rootFilesInTheWay(config.sources, root)
    setTextChange({
      title: t('settings.split.title'),
      intro: root.format === 'json' ? `${t('settings.split.intro')} ${t('settings.split.json')}` : t('settings.split.intro'),
      prepare: () => splitChanges(root),
      verify: async (changes) => [...inTheWay.map((path) => t('settings.split.otherRoot', { path, root: root.path })), ...(await verifySplit(root, changes))],
      validateAll: (changes) => api.configValidateFiles(splitValidationFiles(changes)),
      onDone: (changes) => {
        for (const c of changes) config.addCreated(c.moveTo ?? c.path)
        config.addRemoved(root.path)
      },
    })
  }

  function applyPreset(plan: PresetPlan) {
    const [path, text] = Object.entries(plan.newFiles)[0] ?? []
    if (path !== undefined && text !== undefined) setNewFile({ path, text })
    else requestReview({ opsByFile: plan.opsByFile, fromDraft: false })
  }

  if (config.loading && config.sources.length === 0) {
    return <p className="p-6 text-sm text-zinc-500">{t('common.loading')}</p>
  }

  return (
    <SettingsEditorContext.Provider value={editor}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-center gap-3 px-4 pt-3 pb-2">
          <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
          <div className="ml-auto flex items-center gap-3">
            <EnvironmentPicker environments={environments} value={env} onChange={setEnv} onCreate={createEnvironment} />
            <button type="button" className="btn" onClick={reload}>
              {t('settings.reload')}
            </button>
          </div>
        </header>

        <SourcesSummary
          sources={config.sources}
          env={env}
          onSplit={splitConfig}
          splitBlocked={Object.keys(opsByFile).some((f) => !f.includes('/'))}
        />

        <div className="space-y-2 px-4 pb-2">
          {config.error !== null && <ErrorNote error={config.error} />}
          {!hugoAvailable && <p className={NOTE}>{t('settings.noHugo')}</p>}
          {hugoAvailable && effective.loading && <p className="text-xs text-zinc-500">{t('settings.effectiveLoading')}</p>}
          {hugoAvailable && !effective.loading && (
            <p className="text-xs text-zinc-500">{env === null ? t('settings.effectiveFor.all') : t('settings.effectiveFor.env', { env })}</p>
          )}
          {effective.error !== null && (
            <div className="space-y-1">
              <p className="text-sm text-red-700 dark:text-red-400">{t('settings.effectiveError')}</p>
              <ErrorNote error={effective.error} />
            </div>
          )}
          {!rootFile && (
            <div className={`${WARNING_NOTE} flex flex-wrap items-center gap-2`}>
              <span className="flex-1">{env === null ? t('settings.missingRoot.all') : t('settings.missingRoot.env', { env })}</span>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  env === null
                    ? setNewFile({ path: 'hugo.toml', text: tomlDocument({}, header('header')) })
                    : setNewFile({ path: `config/${env}/hugo.toml`, text: tomlDocument({}, header('envHeader', env)) })
                }
              >
                {env === null ? t('settings.missingRoot.createRoot') : t('settings.missingRoot.createEnv', { env })}
              </button>
            </div>
          )}
        </div>

        <div role="tablist" aria-label={t('settings.title')} className="flex gap-1 border-b border-zinc-200 px-4 dark:border-zinc-800">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="settings-tabpanel"
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-sky-600 font-medium' : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
            >
              {t(`settings.tabs.${id}`)}
              {id === 'migration' && migrationCount > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{migrationCount}</span>
              )}
            </button>
          ))}
        </div>

        <div id="settings-tabpanel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-auto">
          {tab === 'settings' && <SettingsTab onShowMenus={() => setTab('menus')} />}
          {tab === 'menus' && <MenusTab />}
          {tab === 'migration' && (
            <MigrationTab
              findings={findings}
              messages={hugoMessages}
              hugoVersion={hugo ? `${hugo.version.major}.${hugo.version.minor}.${hugo.version.patch}` : null}
              onFix={(ops) => requestReview({ opsByFile: ops, fromDraft: false })}
            />
          )}
          {tab === 'presets' && <PresetsTab onApply={applyPreset} />}
          {/* Kept mounted so unsaved text survives switching tabs. */}
          {raw && (
            <div hidden={tab !== 'raw'} className={tab === 'raw' ? 'flex min-h-0 flex-1 flex-col' : undefined}>
              <RawTab file={raw} onFileChange={setRawFile} onSaved={() => notifyConfigChanged()} />
            </div>
          )}
        </div>

        <PendingBar count={pendingCount} files={[...Object.keys(opsByFile), ...editor.pageMenus.files]} onReview={reviewPending} onDiscard={discard} />
      </div>

      {gate && (
        <RiskConfirmDialog
          risks={gate.risks}
          keepFiles={stackFor(config.sources, env).some((s) => hasKeepFiles(globalTree(s, editor.valuesOf(s))))}
          onCancel={() => setGate(null)}
          onContinue={() => {
            setReview(gate.review)
            setGate(null)
          }}
        />
      )}
      {review && (
        <ReviewChangesDialog
          opsByFile={review.opsByFile}
          skipValidation={!hugoAvailable}
          onClose={() => setReview(null)}
          onWritten={() => {
            if (review.fromDraft) discardConfig()
            setReview(null)
            notifyConfigChanged()
            // Menu entries in pages are written next, with their own diff.
            if (review.fromDraft && editor.pageMenus.count > 0) reviewPageMenus()
          }}
        />
      )}
      {textChange && (
        <FileChangesDialog
          title={textChange.title}
          intro={textChange.intro}
          prepare={textChange.prepare}
          verify={textChange.verify}
          validateAll={textChange.validateAll}
          hugoAvailable={hugoAvailable}
          onClose={() => setTextChange(null)}
          onWritten={(changes) => {
            textChange.onDone(changes)
            setTextChange(null)
            notifyConfigChanged()
          }}
        />
      )}
      {newFile && (
        <NewFileDialog
          path={newFile.path}
          text={newFile.text}
          validate={hugoAvailable}
          onClose={() => setNewFile(null)}
          onWritten={(path) => {
            config.addCreated(path)
            if (newFile.selectEnv) setEnv(newFile.selectEnv)
            setNewFile(null)
            notifyConfigChanged()
          }}
        />
      )}
    </SettingsEditorContext.Provider>
  )
}
