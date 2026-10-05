// App updates through the Tauri updater: GitHub's latest release publishes `latest.json`
// and signed installers (see .github/workflows/release.yml).
import { LazyStore } from '@tauri-apps/plugin-store'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

const KEY = 'checkUpdatesAtStartup'
const store = new LazyStore('app.json', { defaults: {}, autoSave: 200 })

export type { Update }

/** Whether the app looks for a new version when it starts (on unless turned off). */
export async function loadCheckAtStartup(): Promise<boolean> {
  try {
    return (await store.get<boolean>(KEY)) !== false
  } catch {
    return true
  }
}

export async function saveCheckAtStartup(on: boolean): Promise<void> {
  try {
    await store.set(KEY, on)
  } catch {
    // Not persisted; the choice still applies until the app closes.
  }
}

/** The newer version on offer, or null when this one is the latest. */
export function checkForUpdate(): Promise<Update | null> {
  return check({ timeout: 30_000 })
}

/** Downloads and installs `update`, reporting progress from 0 to 1 when the size is known, then restarts. */
export async function installUpdate(update: Update, onProgress: (fraction: number | null) => void): Promise<void> {
  let total = 0
  let received = 0
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0
      onProgress(total ? 0 : null)
    } else if (event.event === 'Progress') {
      received += event.data.chunkLength
      onProgress(total ? Math.min(received / total, 1) : null)
    } else {
      onProgress(1)
    }
  })
  await relaunch()
}
