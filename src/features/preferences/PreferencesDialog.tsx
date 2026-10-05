import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { languages, setLanguage, type Language } from '../../i18n'
import { api, type AiStatus } from '../../lib/api'
import { UpdatesSection } from '../updates/UpdatesSection'
import type { Update } from '../updates/updates'

interface Props {
  onClose(): void
  /** A newer app version was found with "Check now". */
  onUpdateFound?(update: Update): void
}

/** App-wide preferences (not stored in any site): interface language, updates and the AI assistant. */
export function PreferencesDialog({ onClose, onUpdateFound }: Props) {
  const { t, i18n } = useTranslation()
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .aiStatus()
      .then((status) => !cancelled && setAi(status))
      .catch((e: unknown) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [])

  async function run(action: () => Promise<AiStatus>) {
    setError(null)
    setSaved(false)
    try {
      setAi(await action())
      setSaved(true)
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
      <div className="flex max-h-full w-full max-w-xl flex-col gap-5 overflow-auto rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h2 id="preferences-title" className="text-lg font-semibold">
          {t('preferences.title')}
        </h2>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('common.language')}</h3>
          <div className="flex gap-2">
            {languages.map((language) => (
              <button
                key={language}
                className={`btn ${i18n.resolvedLanguage === language ? 'btn-primary' : ''}`}
                onClick={() => setLanguage(language as Language)}
              >
                {language === 'tr' ? 'Türkçe' : 'English'}
              </button>
            ))}
          </div>
        </section>

        <UpdatesSection
          onFound={(found) => {
            onUpdateFound?.(found)
            onClose()
          }}
        />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t('preferences.aiTitle')}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('preferences.aiIntro')}</p>
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('preferences.aiPrivacy')}</p>
          {ai === null ? (
            <p className="text-sm text-zinc-500">{t('common.loading')}</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ai.enabled} onChange={(e) => void run(() => api.aiConfigure(e.target.checked))} />
                {t('preferences.aiEnabled')}
              </label>
              <div className="space-y-1 text-sm">
                <p>
                  {ai.hasKey ? `✓ ${t('preferences.aiKeyStored')}` : t('preferences.aiNoKey')}{' '}
                  <span className="text-xs text-zinc-500">{t('preferences.aiModel', { model: ai.model })}</span>
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="sk-ant-…"
                    aria-label={t('preferences.aiKey')}
                    className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    className="btn"
                    disabled={!key.trim()}
                    onClick={() =>
                      void run(async () => {
                        const status = await api.aiSetKey(key)
                        setKey('')
                        return status
                      })
                    }
                  >
                    {t('preferences.aiSaveKey')}
                  </button>
                  {ai.hasKey && (
                    <button className="btn" onClick={() => void run(() => api.aiSetKey(null))}>
                      {t('preferences.aiRemoveKey')}
                    </button>
                  )}
                </div>
                <button className="text-xs text-sky-700 hover:underline dark:text-sky-400" onClick={() => void openUrl('https://console.anthropic.com/settings/keys')}>
                  {t('preferences.aiGetKey')}
                </button>
              </div>
            </>
          )}
          {saved && <p className="text-xs text-emerald-700 dark:text-emerald-400">{t('common.saved')}</p>}
          {error !== null && <ErrorNote error={error} />}
        </section>

        <div className="flex justify-end">
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
