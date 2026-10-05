// Desktop notifications for deploy results, only while the app is in the background.

import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'

export async function notifyInBackground(title: string, body: string): Promise<void> {
  if (typeof document !== 'undefined' && document.hasFocus()) return
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === 'granted'
    if (granted) sendNotification({ title, body })
  } catch {
    // Notifications are a convenience; the result is on screen as well.
  }
}
