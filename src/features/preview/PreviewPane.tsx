import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import type { ServerOptions } from '../../lib/api'
import type { LogLine, ServerState } from './usePreviewServer'

// Embedding http://localhost in the app's own page is unverified on macOS's WebKit,
// so the preview uses its own window there until that is tested.
const embedPreview = !navigator.userAgent.includes('Mac')

type Device = 'desktop' | 'tablet' | 'phone'
const DEVICES: Device[] = ['desktop', 'tablet', 'phone']
const DEVICE_WIDTH: Record<Device, string> = { desktop: '100%', tablet: '768px', phone: '390px' }

interface Props {
  state: ServerState
  /** URL of the page being edited, or the site root. */
  pageUrl: string | null
  logs: LogLine[]
  onStart(options: ServerOptions): void
  onStop(): void
  onClearLogs(): void
  /** Drafts / future posts; the pane keeps its own choice when these are not given. */
  options?: ServerOptions
  onOptionsChange?: (options: ServerOptions) => void
  /** Inside the document's side pane (which has its own title and border). */
  embedded?: boolean
}

async function openInWindow(url: string) {
  const existing = await WebviewWindow.getByLabel('preview')
  if (existing) {
    await existing.close()
  }
  new WebviewWindow('preview', { url, title: 'Hugo Publisher – Preview', width: 1100, height: 800 })
}

export function PreviewPane({ state, pageUrl, logs, onStart, onStop, onClearLogs, options: optionsProp, onOptionsChange, embedded = false }: Props) {
  const { t } = useTranslation()
  const [ownOptions, setOwnOptions] = useState<ServerOptions>({ drafts: true, future: false })
  const options = optionsProp ?? ownOptions
  const setOptions = (next: ServerOptions) => {
    setOwnOptions(next)
    onOptionsChange?.(next)
  }
  const [showLogs, setShowLogs] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  // Changing the key reloads the frame, e.g. after editing layouts Hugo does not hot-reload.
  const [reloads, setReloads] = useState(0)
  const problems = logs.filter((l) => l.level !== 'info').length

  return (
    <section
      aria-label={embedded ? t('preview.title') : undefined}
      className={`flex h-full min-w-0 flex-col ${embedded ? '' : 'border-l border-zinc-200 dark:border-zinc-800'}`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
        {embedded ? <span className="mr-auto" /> : <h2 className="mr-auto font-semibold">{t('preview.title')}</h2>}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!options.drafts}
            onChange={(e) => setOptions({ ...options, drafts: e.target.checked })}
          />
          {t('preview.drafts')}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!options.future}
            onChange={(e) => setOptions({ ...options, future: e.target.checked })}
          />
          {t('preview.future')}
        </label>
        {state.status === 'running' ? (
          <>
            <button className="btn" onClick={() => onStart(options)}>
              {t('preview.restart')}
            </button>
            <button className="btn" onClick={onStop}>
              {t('preview.stop')}
            </button>
          </>
        ) : state.status === 'failed' ? (
          <button className="btn btn-primary" onClick={() => onStart(options)}>
            {t('preview.start')}
          </button>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1 bg-white dark:bg-zinc-900">
        {state.status === 'running' && pageUrl ? (
          embedPreview ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-center gap-1 border-b border-zinc-200 py-1 text-xs dark:border-zinc-800">
                {DEVICES.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDevice(d)}
                    aria-pressed={device === d}
                    className={`rounded px-2 py-0.5 ${device === d ? 'bg-zinc-200 dark:bg-zinc-700' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                  >
                    {t(`preview.device.${d}`)}
                  </button>
                ))}
                <button className="ml-2 rounded px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setReloads((n) => n + 1)}>
                  {t('preview.reload')}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-950">
                <iframe
                  key={reloads}
                  title={t('preview.title')}
                  src={pageUrl}
                  style={{ width: DEVICE_WIDTH[device] }}
                  className="mx-auto block h-full max-w-full border-0 bg-white shadow-sm"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-4 text-sm">
              <p>{t('preview.macWindowNote')}</p>
              <button className="btn btn-primary" onClick={() => void openInWindow(pageUrl)}>
                {t('preview.openInWindow')}
              </button>
            </div>
          )
        ) : state.status === 'failed' ? (
          <div className="p-4">
            <ErrorNote error={state.error} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-500">
            {state.status === 'starting' ? (
              <p role="status">{t('preview.starting')}</p>
            ) : (
              <>
                <p>{t('preview.notRunning')}</p>
                <button className="btn btn-primary px-4 py-2" onClick={() => onStart(options)}>
                  {t('preview.start')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-zinc-200 text-sm dark:border-zinc-800">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <button className="text-left font-medium hover:underline" onClick={() => setShowLogs(!showLogs)}>
            {t('preview.logs')} {problems > 0 && <span className="ml-1 rounded bg-amber-200 px-1.5 text-xs text-amber-900">{problems}</span>}
          </button>
          {state.status === 'running' && pageUrl && (
            <>
              <button className="ml-auto text-xs hover:underline" onClick={() => void openUrl(pageUrl)}>
                {t('preview.openInBrowser')}
              </button>
              {embedPreview && (
                <button className="text-xs hover:underline" onClick={() => void openInWindow(pageUrl)}>
                  {t('preview.openInWindow')}
                </button>
              )}
            </>
          )}
        </div>
        {showLogs && (
          <div className="max-h-56 overflow-auto border-t border-zinc-200 px-3 py-2 font-mono text-xs dark:border-zinc-800">
            {logs.length === 0 ? (
              <p className="text-zinc-500">{t('preview.noLogs')}</p>
            ) : (
              logs.map((line) => (
                <p
                  key={line.id}
                  className={
                    line.level === 'error'
                      ? 'text-red-700 dark:text-red-400'
                      : line.level === 'warn'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-zinc-600 dark:text-zinc-400'
                  }
                >
                  {line.text}
                </p>
              ))
            )}
            {logs.length > 0 && (
              <button className="mt-1 text-zinc-500 hover:underline" onClick={onClearLogs}>
                {t('preview.clearLogs')}
              </button>
            )}
          </div>
        )}
      </footer>
    </section>
  )
}
