import { useCallback, useMemo } from 'react'

import type { KeyPath } from '../../../lib/api'
import { useConfigDraft } from '../../config-edit'
import { useSite } from '../../site/SiteContext'
import type { DynamicOptions, SettingsEditor } from '../editor/context'
import { countOps, editOps, resetOps, type FileOps } from '../model/edits'
import { mergeOps } from '../model/lists'
import { findMenus } from '../model/menus'
import { resolveKey, type ValuesOf } from '../model/owner'
import { globalTree, stackFor, type LoadedSource } from '../model/sources'
import { mergedFiles, urlConfigOf } from '../model/urlConfig'
import { applyOps, isPlainObject, startsWith, type Tree } from '../model/values'
import { BUILTIN_OUTPUT_FORMATS, COMMON_LOCALES, COMMON_TIME_ZONES } from '../schema/options'
import { useListDrafts } from './useListDrafts'
import { usePageMenus } from './usePageMenus'

interface Options {
  sources: readonly LoadedSource[]
  env: string | null
  effective: Tree | null
  hugoAvailable: boolean
}

function uniqueCaseless(values: Iterable<string>): string[] {
  const seen = new Map<string, string>()
  for (const v of values) if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v)
  return [...seen.values()]
}

function keysAt(tree: unknown, key: string): string[] {
  if (!isPlainObject(tree)) return []
  const found = Object.keys(tree).find((k) => k.toLowerCase() === key)
  const value = found === undefined ? undefined : tree[found]
  return isPlainObject(value) ? Object.keys(value) : []
}

/** Builds the settings editor: pending drafts, pending-aware values, and the edit actions. */
export function useSettingsEditorState({ sources, env, effective, hugoAvailable }: Options) {
  const { pages, site, hugo } = useSite()
  const draft = useConfigDraft()
  const lists = useListDrafts()

  const opsByFile = useMemo(() => mergeOps(draft.opsByFile, lists.opsByFile), [draft.opsByFile, lists.opsByFile])
  const pendingCount = useMemo(() => countOps(opsByFile), [opsByFile])

  const valuesOf = useMemo<ValuesOf>(() => {
    const pending = new Map<string, Tree>()
    for (const source of sources) {
      const ops = opsByFile[source.path]
      if (ops) pending.set(source.path, applyOps(source.values, ops))
    }
    return (source) => pending.get(source.path) ?? source.values
  }, [sources, opsByFile])

  const { revert, set, remove } = draft
  const revertUnder = useCallback(
    (file: string, base: KeyPath) => {
      for (const op of draft.opsByFile[file] ?? []) {
        if (op.op !== 'appendTable' && startsWith(op.path, base)) revert(file, op.path)
      }
      for (const list of Object.values(lists.drafts)) {
        if (list.file === file && startsWith(list.path, base)) lists.drop(list.file, list.path)
      }
    },
    [draft.opsByFile, lists, revert],
  )

  const applyFileOps = useCallback(
    ({ file, base, ops }: FileOps) => {
      revertUnder(file, base)
      for (const op of ops) {
        if (op.op === 'set') set(file, op.path, op.value)
        else if (op.op === 'remove') remove(file, op.path)
      }
    },
    [remove, revertUnder, set],
  )

  const editValue = useCallback(
    (path: KeyPath, value: unknown, inherited: unknown) => {
      const ops = editOps(resolveKey(sources, env, path), value, inherited)
      if (ops) applyFileOps(ops)
    },
    [applyFileOps, env, sources],
  )

  const revertPath = useCallback(
    (path: KeyPath) => {
      const resolution = resolveKey(sources, env, path)
      for (const l of resolution.layerLocations) revertUnder(l.source.path, l.filePath)
      if (resolution.target) revertUnder(resolution.target.source.path, resolution.target.filePath)
    },
    [env, revertUnder, sources],
  )

  const resetPath = useCallback(
    (path: KeyPath) => {
      revertPath(path)
      for (const ops of resetOps(resolveKey(sources, env, path))) applyFileOps(ops)
    },
    [applyFileOps, env, revertPath, sources],
  )

  const options = useMemo<DynamicOptions>(() => {
    const stack = stackFor(sources, env)
    const trees = stack.map((s) => globalTree(s, valuesOf(s)))
    return {
      outputFormats: uniqueCaseless([...BUILTIN_OUTPUT_FORMATS, ...trees.flatMap((t) => keysAt(t, 'outputformats')), ...keysAt(effective, 'outputformats')]),
      sections: uniqueCaseless(pages.map((p) => p.section)).sort(),
      languages: uniqueCaseless([...trees.flatMap((t) => keysAt(t, 'languages')), ...keysAt(effective, 'languages')]),
      menus: uniqueCaseless(['main', ...findMenus(sources, env).map((m) => m.name)]),
      locales: COMMON_LOCALES,
      timeZones: COMMON_TIME_ZONES,
    }
  }, [effective, env, pages, sources, valuesOf])
  // Content folders per language, so menu entries in pages get their language.
  const urlConfig = useMemo(() => urlConfigOf(mergedFiles(sources, env), effective, hugo?.version ?? null, site.root), [effective, env, hugo, site.root, sources])
  const pageMenus = usePageMenus(options.languages, urlConfig)

  const editor = useMemo<SettingsEditor>(
    () => ({
      sources,
      env,
      valuesOf,
      effective,
      hugoAvailable,
      draft,
      lists,
      pageMenus,
      options,
      applyFileOps,
      editValue,
      resetPath,
      revertPath,
    }),
    [applyFileOps, draft, editValue, effective, env, hugoAvailable, lists, options, pageMenus, resetPath, revertPath, sources, valuesOf],
  )

  /** Drops pending config changes (front matter changes are kept). */
  const discardConfig = useCallback(() => {
    draft.clear()
    lists.clear()
  }, [draft, lists])

  const { clear: clearPageMenus } = pageMenus
  const discard = useCallback(() => {
    discardConfig()
    clearPageMenus()
  }, [clearPageMenus, discardConfig])

  return { editor, opsByFile, pendingCount: pendingCount + pageMenus.count, discard, discardConfig }
}
