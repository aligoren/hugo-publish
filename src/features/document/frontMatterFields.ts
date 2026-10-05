// Reading and writing named front matter fields the way the form does: keys are matched without
// regard to case (`publishDate` / `publishdate`), and a field emptied by the user is removed only
// when it was not in the file to begin with. Shared by the settings form, the title in the writing
// column and the status pill, so they all make the same (byte-preserving) edits.

import type { FrontMatterValue } from '../../lib/frontmatter'
import { findKey } from './frontMatterOps'
import type { FrontMatterController } from './useFrontMatter'

export interface FieldAccess {
  /** The value of a top-level field, or undefined when it is absent (or values are not known yet). */
  get(name: string): unknown
  /** The key as written in the file, or `name` for a new field. */
  keyOf(name: string): string
  /** Whether the file as loaded has the field (true while that is not known, so nothing is removed). */
  inFile(name: string): boolean
  /** Sets a value, or removes the key when it is emptied and was not in the file before. */
  setOrDrop(name: string, value: FrontMatterValue, empty: boolean, options?: { datetime?: boolean }): void
}

export function fieldAccess(fm: FrontMatterController): FieldAccess {
  const values = fm.values
  const get = (name: string) => {
    const key = findKey(values, name)
    return key === undefined ? undefined : values?.[key]
  }
  const keyOf = (name: string) => findKey(values, name) ?? name
  // Unknown while TOML is parsed: then nothing counts as new, so nothing is removed.
  const inFile = (name: string) => fm.original === null || findKey(fm.original, name) !== undefined
  const setOrDrop = (name: string, value: FrontMatterValue, empty: boolean, options?: { datetime?: boolean }) => {
    const key = findKey(values, name)
    if (empty && !inFile(name)) {
      if (key !== undefined) fm.remove([key])
      return
    }
    if (empty && key === undefined) return
    fm.set([key ?? name], value, options)
  }
  return { get, keyOf, inFile, setOrDrop }
}

export const asText = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))

export const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => asText(item)) : typeof value === 'string' && value !== '' ? [value] : []

export const isDraftValue = (value: unknown) => value === true || value === 'true'

/** Turns `draft` on or off with the same edit as the form's checkbox. */
export function setDraft(access: FieldAccess, draft: boolean) {
  access.setOrDrop('draft', draft, !draft)
}

/** The name of a taxonomy for people: "Categories", "Tags", or the name capitalized. */
export function taxonomyLabel(taxonomy: string, t: (key: string) => string): string {
  if (taxonomy === 'categories') return t('document.taxonomyCategories')
  if (taxonomy === 'tags') return t('document.taxonomyTags')
  return taxonomy.charAt(0).toLocaleUpperCase() + taxonomy.slice(1)
}
