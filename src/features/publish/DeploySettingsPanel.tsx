import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../components/DiffView'
import { ErrorNote } from '../../components/ErrorNote'
import { api } from '../../lib/api'
import { deploySettingsOps, forgeSetting, SETTINGS_PATH, validateSettings, type DeploySettings, type SettingsFile } from './deploySettings'

interface Props {
  file: SettingsFile
  /** The site's baseURL, shown as the default live address. */
  baseUrl: string | null
  onSaved(): void
}

/** `[deploy]` in `.hugo-publisher/site.toml`: edit, review the diff, write. */
export function DeploySettingsPanel({ file, baseUrl, onSaved }: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<DeploySettings>(file.settings)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const invalid = validateSettings(draft)

  function update(patch: Partial<DeploySettings>) {
    setDraft((current) => ({ ...current, ...patch }))
    setPreview(null)
    setNotice(null)
  }

  async function review() {
    setError(null)
    setNotice(null)
    const ops = deploySettingsOps(file.values, draft)
    if (ops.length === 0) {
      setNotice(t('publish.deploy.settings.noChanges'))
      return
    }
    try {
      setPreview(await api.tomlEditText(file.text, ops))
    } catch (e) {
      setError(e)
    }
  }

  async function save() {
    if (preview === null) return
    setBusy(true)
    setError(null)
    try {
      await api.writeText(SETTINGS_PATH, preview, file.version)
      setPreview(null)
      setNotice(t('publish.deploy.settings.saved'))
      onSaved()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer font-semibold">
        {t('publish.deploy.settings.title')}:{' '}
        <span className="font-normal text-zinc-600 dark:text-zinc-400">
          {file.settings.method === 'gh-pages' ? t('publish.deploy.settings.methodGhPages') : t('publish.deploy.settings.methodPush')}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('publish.deploy.settings.method')}</legend>
          {(['push', 'gh-pages'] as const).map((method) => (
            <label key={method} className="flex items-start gap-2">
              <input
                type="radio"
                name="deploy-method"
                className="mt-1"
                checked={draft.method === method}
                onChange={() => update({ method })}
              />
              <span>
                {t(method === 'push' ? 'publish.deploy.settings.methodPush' : 'publish.deploy.settings.methodGhPages')}
                <small className="block text-zinc-500">
                  {t(method === 'push' ? 'publish.deploy.settings.methodPushHint' : 'publish.deploy.settings.methodGhPagesHint')}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        {draft.method === 'gh-pages' && (
          <label className="field">
            <span>{t('publish.deploy.settings.branch')}</span>
            <input className="font-mono" value={draft.branch} onChange={(e) => update({ branch: e.target.value })} />
          </label>
        )}
        <label className="field">
          <span>{t('publish.deploy.settings.liveUrl')}</span>
          <input
            className="font-mono"
            value={draft.liveUrl}
            placeholder={baseUrl ?? 'https://'}
            onChange={(e) => update({ liveUrl: e.target.value })}
          />
          <small className="text-zinc-500">{t('publish.deploy.settings.liveUrlHint')}</small>
        </label>
        <label className="field">
          <span>{t('publish.deploy.settings.cloudflareProject')}</span>
          <input className="font-mono" value={draft.cloudflareProject} onChange={(e) => update({ cloudflareProject: e.target.value })} />
          <small className="text-zinc-500">{t('publish.deploy.settings.cloudflareProjectHint')}</small>
        </label>
        <label className="field">
          <span>{t('publish.deploy.settings.forge')}</span>
          <select value={draft.forge} onChange={(e) => update({ forge: forgeSetting(e.target.value) })}>
            <option value="">{t('publish.deploy.settings.forgeAuto')}</option>
            <option value="github">{t('publish.deploy.settings.forgeGithub')}</option>
            <option value="gitlab">{t('publish.deploy.settings.forgeGitlab')}</option>
            <option value="gitea">{t('publish.deploy.settings.forgeGitea')}</option>
          </select>
          <small className="text-zinc-500">{t('publish.deploy.settings.forgeHint')}</small>
        </label>
        {invalid && <p className="text-xs text-red-700 dark:text-red-400">{t(`publish.deploy.settings.invalid.${invalid}`)}</p>}
        {preview !== null && <DiffView before={file.text} after={preview} />}
        {error !== null && <ErrorNote error={error} />}
        {notice && <p role="status" className="text-xs text-emerald-800 dark:text-emerald-300">{notice}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {preview === null ? (
            <button className="btn" disabled={invalid !== null} onClick={() => void review()}>
              {t('publish.deploy.settings.review')}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {t('publish.deploy.settings.save')}
            </button>
          )}
          <small className="text-zinc-500">{t('publish.deploy.settings.file', { path: SETTINGS_PATH })}</small>
        </div>
      </div>
    </details>
  )
}
