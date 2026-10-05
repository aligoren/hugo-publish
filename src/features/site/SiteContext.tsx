import { createContext, useContext } from 'react'

import type { ContentFile, HugoInfo, PageEntry, SiteInfo } from '../../lib/api'

export type View = 'dashboard' | 'content' | 'pages' | 'translations' | 'taxonomies' | 'media' | 'settings' | 'theme' | 'health' | 'publish' | 'hugo'

export interface SiteContextValue {
  site: SiteInfo
  hugo: HugoInfo | null
  files: ContentFile[]
  pages: PageEntry[]
  /** ISO time the page list was read; "now" for scheduled and expired posts. */
  pagesAt: string
  reloadFiles(): Promise<void>
  reloadPages(): Promise<void>
  /** Re-detects Hugo, e.g. after the active Hugo version changed. */
  refreshHugo(): Promise<void>
  /** Switches to the editor with this site-relative file open. */
  openFile(path: string): void
  /** Switches to another top-level view. */
  showView(view: View): void
  /** Increases after any config file is written, so views can reload what they show. */
  configVersion: number
  /** Call after writing a config file (hugo.toml, params, i18n…). */
  notifyConfigChanged(): void
}

export const SiteContext = createContext<SiteContextValue | null>(null)

export function useSite(): SiteContextValue {
  const value = useContext(SiteContext)
  if (!value) throw new Error('useSite() must be used inside <SiteContext.Provider>')
  return value
}
