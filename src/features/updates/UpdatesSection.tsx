import { getVersion } from '@tauri-apps/api/app'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { checkForUpdate, loadCheckAtStartup, saveCheckAtStartup, type Update } from './updates'

interface Props {
  /** A newer version was found; the app shows its install banner. */
  onFound(update: Update): void
}

/** The Updates part of Preferences: current version, check now, check at startup. */
export function UpdatesSection({ onFound }: Props) {
  const { t } = useTranslation()
  const [version, setVersion] = useState<string | null>(null)
  const [atStartup, setAtStartup] = useState<boolean | null>(null)
  const [state, setState] = useState<'idle' | 'checking' | 'latest'>('idle')
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {})
    void loadCheckAtStartup().then(setAtStartup)
  }, [])

  async function checkNow() {
    setError(null)
    setState('checking')
    try {
      const update = await checkForUpdate()
      setState(update ? 'idle' : 'latest')
      if (update) onFound(update)
    } catch (e) {
      setError(e)
      setState('idle')
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t('updates.title')}</h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {version ? t('updates.current', { version }) : null} {t('updates.intro')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={state === 'checking'} onClick={() => void checkNow()}>
          {state === 'checking' ? t('updates.checking') : t('updates.checkNow')}
        </button>
        {state === 'latest' && <span className="text-sm text-emerald-700 dark:text-emerald-400">✓ {t('updates.latest')}</span>}
      </div>
      {atStartup !== null && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={atStartup}
            onChange={(e) => {
              setAtStartup(e.target.checked)
              void saveCheckAtStartup(e.target.checked)
            }}
          />
          {t('updates.atStartup')}
        </label>
      )}
      {error !== null && <ErrorNote error={error} />}
    </section>
  )
}
