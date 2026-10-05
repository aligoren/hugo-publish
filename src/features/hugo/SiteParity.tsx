import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../components/DiffView'
import { ErrorNote } from '../../components/ErrorNote'
import { useSite } from '../site/SiteContext'
import { CLOUDFLARE_DEFAULT_HUGO, parityWarnings, severity, type ParityWarning } from './parity'
import { loadSiteHugoData, type SiteHugoData } from './siteData'
import { planSiteTomlEdit, SITE_TOML, validatePins, writeSiteToml, type SiteTomlEdit } from './siteToml'
import { Section } from './ui'
import type { HugoManager } from './useHugoManager'
import { hugoVersionString, normalizeVersion } from './versions'
import { warningText } from './warningText'

const SEVERITY_CLASSES = {
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100',
}

interface Props {
  manager: HugoManager
  /** Edition to install for the pin when the site file does not say. */
  extended: boolean
}

export function SiteParity({ manager, extended }: Props) {
  const { t } = useTranslation()
  const { site, hugo, configVersion } = useSite()
  const [data, setData] = useState<SiteHugoData | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [form, setForm] = useState({ hugoVersion: '', hostingVersion: '' })
  const [invalid, setInvalid] = useState<string[]>([])
  const [plan, setPlan] = useState<SiteTomlEdit | null>(null)
  const [writeError, setWriteError] = useState<unknown>(null)
  const [writing, setWriting] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const loaded = await loadSiteHugoData(site.configFiles)
      setData(loaded)
      setLoadError(null)
      setForm({
        hugoVersion: loaded.file.pins.hugoVersion ?? '',
        hostingVersion: loaded.file.pins.hostingVersion ?? '',
      })
    } catch (e) {
      setLoadError(e)
    }
  }, [site.configFiles])

  useEffect(() => {
    // Reload when the site config changes; state only changes after the reads resolve.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load, configVersion])

  const active = useMemo(
    () => (hugo ? { version: hugoVersionString(hugo), extended: hugo.version.extended } : null),
    [hugo],
  )
  const warnings = useMemo(
    () =>
      data
        ? parityWarnings({
            active,
            pinned: data.file.pins.hugoVersion,
            hosting: data.file.pins.hostingVersion,
            theme: data.theme,
            features: data.features,
          })
        : [],
    [data, active],
  )

  const pinned = data ? normalizeVersion(data.file.pins.hugoVersion) : null
  const pinExtended = data?.file.pins.hugoExtended ?? (data?.theme?.extended || extended)
  const busy = manager.busy || manager.installing !== null

  async function review(next: { hugoVersion: string; hostingVersion: string }) {
    if (!data) return
    setSaved(false)
    setWriteError(null)
    const checked = validatePins({ ...next, hugoExtended: data.file.pins.hugoExtended })
    setInvalid(checked.invalid)
    if (checked.invalid.length > 0) return
    try {
      setPlan(await planSiteTomlEdit(data.file, checked.pins))
    } catch (e) {
      setWriteError(e)
    }
  }

  async function write() {
    if (!data || !plan) return
    setWriting(true)
    setWriteError(null)
    try {
      await writeSiteToml(data.file, plan.after)
      setPlan(null)
      setSaved(true)
      await load()
    } catch (e) {
      setWriteError(e)
    } finally {
      setWriting(false)
    }
  }

  function pinActive() {
    if (!active) return
    const next = { ...form, hugoVersion: active.version }
    setForm(next)
    void review(next)
  }

  function actionFor(warning: ParityWarning) {
    if (warning.kind === 'activeNotPinned') {
      const installed = manager.findInstalled(warning.pinned, pinExtended)
      return (
        <button className="btn" disabled={busy} onClick={() => void manager.installAndUse(warning.pinned, pinExtended)}>
          {installed
            ? t('hugo.warnings.useInstalled', { version: warning.pinned })
            : t('hugo.warnings.installAndUse', { version: warning.pinned })}
        </button>
      )
    }
    return null
  }

  return (
    <Section id="hugo-site" title={t('hugo.site.heading')} intro={t('hugo.site.intro', { file: SITE_TOML })}>
      {loadError !== null && <ErrorNote error={loadError} />}
      {data === null ? (
        loadError === null && <p className="text-sm text-zinc-500">{t('hugo.site.loading')}</p>
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-zinc-500">{t('hugo.site.pinned')}</dt>
            <dd className="flex flex-wrap items-center gap-2" data-testid="pinned-version">
              <span className="font-medium tabular-nums">{data.file.pins.hugoVersion ?? t('hugo.site.notPinned')}</span>
              {!pinned && active && (
                <button className="text-sky-700 hover:underline dark:text-sky-400" onClick={pinActive}>
                  {t('hugo.warnings.pinActive', { version: active.version })}
                </button>
              )}
            </dd>
            <dt className="text-zinc-500">{t('hugo.site.hosting')}</dt>
            <dd className="font-medium tabular-nums">{data.file.pins.hostingVersion ?? t('hugo.site.hostingNotSet')}</dd>
            {data.theme && (
              <>
                <dt className="text-zinc-500">{t('hugo.site.theme')}</dt>
                <dd>
                  {data.theme.minVersion
                    ? t('hugo.site.themeNeeds', { theme: data.theme.name, version: data.theme.minVersion })
                    : t('hugo.site.themeNoRequirement', { theme: data.theme.name })}
                  {data.theme.extended && <> {t('hugo.site.themeNeedsExtended', { theme: data.theme.name })}</>}
                </dd>
              </>
            )}
          </dl>

          {warnings.length === 0 ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">✓ {t('hugo.site.allGood')}</p>
          ) : (
            <ul className="space-y-2" aria-label={t('hugo.site.heading')}>
              {warnings.map((warning, index) => (
                <li
                  key={`${warning.kind}-${index}`}
                  data-kind={warning.kind}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${SEVERITY_CLASSES[severity(warning)]}`}
                >
                  <span className="min-w-0 flex-1">{warningText(t, warning)}</span>
                  {actionFor(warning)}
                </li>
              ))}
            </ul>
          )}

          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              void review(form)
            }}
          >
            <label className="field">
              <span>{t('hugo.site.pinnedField')}</span>
              <input
                value={form.hugoVersion}
                placeholder={t('hugo.site.versionPlaceholder')}
                aria-invalid={invalid.includes('hugoVersion')}
                onChange={(e) => setForm({ ...form, hugoVersion: e.target.value })}
              />
              {invalid.includes('hugoVersion') && (
                <em className="text-xs not-italic text-red-700 dark:text-red-400">{t('hugo.site.invalidVersion')}</em>
              )}
            </label>
            <label className="field">
              <span>{t('hugo.site.hostingField')}</span>
              <input
                value={form.hostingVersion}
                placeholder={t('hugo.site.versionPlaceholder')}
                aria-invalid={invalid.includes('hostingVersion')}
                onChange={(e) => setForm({ ...form, hostingVersion: e.target.value })}
              />
              {invalid.includes('hostingVersion') && (
                <em className="text-xs not-italic text-red-700 dark:text-red-400">{t('hugo.site.invalidVersion')}</em>
              )}
            </label>
            <p className="text-xs text-zinc-500 sm:col-span-2">
              {t('hugo.site.hostingHelp', { version: CLOUDFLARE_DEFAULT_HUGO })}
            </p>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" className="btn">
                {t('hugo.site.review')}
              </button>
              {active && form.hugoVersion.trim() !== active.version && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setForm({ ...form, hugoVersion: active.version })}
                >
                  {t('hugo.site.useActive', { version: active.version })}
                </button>
              )}
            </div>
          </form>

          {plan && (
            <div className="space-y-2" data-testid="site-toml-review">
              <p className="font-mono text-sm font-medium">{SITE_TOML}</p>
              {plan.before === plan.after ? (
                <p className="text-sm text-zinc-500">{t('hugo.site.noChanges')}</p>
              ) : (
                <DiffView before={plan.before} after={plan.after} />
              )}
              <div className="flex gap-2">
                <button className="btn" onClick={() => setPlan(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={writing || plan.before === plan.after}
                  onClick={() => void write()}
                >
                  {writing ? t('hugo.site.writing') : t('hugo.site.write', { file: SITE_TOML })}
                </button>
              </div>
            </div>
          )}
          {writeError !== null && <ErrorNote error={writeError} />}
          {saved && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
              {t('hugo.site.saved', { file: SITE_TOML })}
            </p>
          )}
        </>
      )}
    </Section>
  )
}
