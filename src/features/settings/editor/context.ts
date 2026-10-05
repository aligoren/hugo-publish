import { createContext, useContext } from 'react'

import type { KeyPath } from '../../../lib/api'
import type { ConfigDraft } from '../../config-edit'
import type { ListDrafts } from '../hooks/useListDrafts'
import type { PageMenus } from '../hooks/usePageMenus'
import type { FileOps } from '../model/edits'
import type { ValuesOf } from '../model/owner'
import type { LoadedSource } from '../model/sources'
import type { Tree } from '../model/values'
import type { OptionSource } from '../schema'

export type DynamicOptions = Record<OptionSource, readonly string[]>

/** Everything the settings fields need: files, pending changes, Hugo's view, and edit actions. */
export interface SettingsEditor {
  sources: readonly LoadedSource[]
  /** Edited environment; null = all environments (root + `config/_default`). */
  env: string | null
  /** File values with pending changes applied. */
  valuesOf: ValuesOf
  /** `hugo config` for the environment (keys lower-cased), when Hugo is available. */
  effective: Tree | null
  hugoAvailable: boolean
  draft: ConfigDraft
  lists: ListDrafts
  /** Menu entries in page front matter, with their unsaved changes. */
  pageMenus: PageMenus
  options: DynamicOptions
  /** Replaces the pending ops at and below `base` in `file` with these ops. */
  applyFileOps(fileOps: FileOps): void
  /** Sets a key in its write target; choosing the `inherited` value again leaves the files alone. */
  editValue(path: KeyPath, value: unknown, inherited: unknown): void
  /** Removes a key from the edited files (back to the default, or to the base value in an environment). */
  resetPath(path: KeyPath): void
  /** Drops pending changes of a key. */
  revertPath(path: KeyPath): void
}

export const SettingsEditorContext = createContext<SettingsEditor | null>(null)

export function useSettingsEditor(): SettingsEditor {
  const value = useContext(SettingsEditorContext)
  if (!value) throw new Error('useSettingsEditor() must be used inside the settings view')
  return value
}
