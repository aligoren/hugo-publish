// Feature actions from schemas: changes that go beyond [params], such as PaperMod's search
// (JSON in outputs.home, a content/search.md page with layout "search", a menu entry).
import { stringify as stringifyYaml } from 'yaml'

import type { ConfigOp } from '../../lib/api'
import type { ConfigFileData } from '../config-edit'
import { configRank, defaultParamsTarget, isMainConfig, isRecord, lookupCi, ownerOf, writePath, type ParamsSource } from './discovery'
import type { FeatureDef, FeatureStep, Localized } from './schema'

export interface FeatureContext {
  configs: ConfigFileData[]
  paramsSources: ParamsSource[]
  contentDir: string
  language: keyof Localized
  /** Layouts used by existing content pages (front matter `layout`). */
  existingLayouts: Set<string>
  /** Site-relative paths of existing content files. */
  existingFiles: Set<string>
}

export type StepState = 'done' | 'todo' | 'blocked'

export interface StepStatus {
  step: FeatureStep
  state: StepState
  /** File the step changes or creates. */
  file?: string
  optional: boolean
}

export interface FeaturePlan {
  enabled: boolean
  steps: StepStatus[]
  configOps: Record<string, ConfigOp[]>
  newFiles: { path: string; text: string }[]
}

const editable = (c: ConfigFileData) => c.format === 'toml' || c.format === 'yaml'

/** The config file (and key path inside it) that holds a top-level setting such as `outputs`. */
export function locateSetting(configs: ConfigFileData[], path: string[]): { file: ConfigFileData; keyPath: string[]; current: unknown } | null {
  const split = configs.find((c) => new RegExp(`^config/_default/${path[0]}\\.[a-z]+$`, 'i').test(c.path))
  if (split) {
    const hit = lookupCi(split.values, path.slice(1))
    return { file: split, keyPath: hit?.path ?? path.slice(1), current: hit?.value }
  }
  const mains = configs.filter((c) => isMainConfig(c.path)).sort((a, b) => configRank(b.path) - configRank(a.path))
  for (const config of mains) {
    const hit = lookupCi(config.values, path)
    if (hit) return { file: config, keyPath: hit.path, current: hit.value }
  }
  const withParent = mains.find((c) => lookupCi(c.values, path.slice(0, 1)))
  const target = withParent ?? mains.find((c) => !c.path.includes('/')) ?? mains[0]
  if (!target) return null
  const parent = lookupCi(target.values, path.slice(0, 1))
  return { file: target, keyPath: [parent?.path[0] ?? path[0], ...path.slice(1)], current: undefined }
}

function contentPath(path: string, contentDir: string): string {
  return path.startsWith('content/') ? `${contentDir}/${path.slice('content/'.length)}` : path
}

function sameUrl(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false
  const norm = (s: string) => s.trim().toLowerCase().replace(/\/+$/, '')
  return norm(a) === norm(b)
}

/** Where menu entries live: config/_default/menus(.lang).*, or `menu`/`menus` in the main config. */
function locateMenu(configs: ConfigFileData[], menu: string, language: string) {
  const split =
    configs.find((c) => new RegExp(`^config/_default/menus\\.${language}\\.[a-z]+$`, 'i').test(c.path)) ??
    configs.find((c) => /^config\/_default\/menus\.[a-z]+$/i.test(c.path))
  if (split) {
    const hit = lookupCi(split.values, [menu])
    return { file: split, path: [hit?.path[0] ?? menu], entries: hit?.value }
  }
  const mains = configs.filter((c) => isMainConfig(c.path)).sort((a, b) => configRank(b.path) - configRank(a.path))
  for (const config of mains) {
    for (const root of ['menus', 'menu']) {
      const hit = lookupCi(config.values, [root])
      if (hit && isRecord(hit.value)) {
        const entries = lookupCi(hit.value, [menu])
        return { file: config, path: [hit.path[0], entries?.path[0] ?? menu], entries: entries?.value }
      }
    }
  }
  const root = mains.find((c) => !c.path.includes('/')) ?? mains[0]
  return root ? { file: root, path: ['menus', menu], entries: undefined } : null
}

export function contentFileText(title: string, frontMatter: Record<string, unknown>, eol = '\n'): string {
  const yaml = stringifyYaml({ title, ...frontMatter }, { lineWidth: 0 })
  return ['---', yaml.trimEnd(), '---', ''].join('\n').replace(/\n/g, eol)
}

export function planFeature(def: FeatureDef, ctx: FeatureContext, options: { addMenu: boolean }): FeaturePlan {
  const steps: StepStatus[] = []
  const configOps: Record<string, ConfigOp[]> = {}
  const newFiles: { path: string; text: string }[] = []
  const addOp = (file: string, op: ConfigOp) => {
    configOps[file] = [...(configOps[file] ?? []), op]
  }
  let requiredLayoutDone = true

  for (const step of def.steps) {
    switch (step.op) {
      case 'ensureListContains': {
        const where = locateSetting(ctx.configs, step.path)
        if (!where) {
          steps.push({ step, state: 'blocked', optional: false })
          break
        }
        const current = Array.isArray(where.current) ? (where.current as unknown[]) : null
        const has = current?.some((v) => typeof v === 'string' && v.toLowerCase() === step.value.toLowerCase()) ?? false
        if (has) {
          steps.push({ step, state: 'done', file: where.file.path, optional: false })
        } else if (!editable(where.file)) {
          steps.push({ step, state: 'blocked', file: where.file.path, optional: false })
        } else {
          steps.push({ step, state: 'todo', file: where.file.path, optional: false })
          addOp(where.file.path, { op: 'set', path: where.keyPath, value: [...(current ?? step.defaultList), step.value] })
        }
        break
      }
      case 'setParam': {
        const path = step.key.split('.')
        const owner = ownerOf(ctx.paramsSources, path)
        const target = owner?.source ?? defaultParamsTarget(ctx.paramsSources)
        const current = owner ? lookupCi(owner.source.values, path)?.value : undefined
        if (JSON.stringify(current) === JSON.stringify(step.value)) {
          steps.push({ step, state: 'done', file: owner?.source.file, optional: false })
        } else if (!target || !target.editable) {
          steps.push({ step, state: 'blocked', file: target?.file, optional: false })
        } else {
          steps.push({ step, state: 'todo', file: target.file, optional: false })
          addOp(target.file, { op: 'set', path: writePath(target, path), value: step.value })
        }
        break
      }
      case 'ensureContentFile': {
        const path = contentPath(step.path, ctx.contentDir)
        if (ctx.existingLayouts.has(step.layout.toLowerCase()) || ctx.existingFiles.has(path)) {
          steps.push({ step, state: 'done', file: path, optional: false })
        } else {
          requiredLayoutDone = false
          steps.push({ step, state: 'todo', file: path, optional: false })
          newFiles.push({ path, text: contentFileText(step.title[ctx.language], step.frontMatter) })
        }
        break
      }
      case 'menuItem': {
        const menu = locateMenu(ctx.configs, step.menu, ctx.language)
        const exists = Array.isArray(menu?.entries) && menu.entries.some((e) => isRecord(e) && (sameUrl(e.url, step.url) || sameUrl(e.pageRef, step.url)))
        if (exists) {
          steps.push({ step, state: 'done', file: menu?.file.path, optional: true })
        } else if (!menu || !editable(menu.file)) {
          steps.push({ step, state: 'blocked', file: menu?.file.path, optional: true })
        } else {
          steps.push({ step, state: 'todo', file: menu.file.path, optional: true })
          if (options.addMenu) {
            addOp(menu.file.path, { op: 'appendTable', path: menu.path, entries: { name: step.name[ctx.language], url: step.url, weight: step.weight } })
          }
        }
        break
      }
    }
  }
  const enabled = requiredLayoutDone && steps.every((s) => s.optional || s.state === 'done')
  return { enabled, steps, configOps, newFiles }
}

export interface DetectedFeature {
  id: string
  def: FeatureDef
  /** Set for features found by scanning (labels come from the app's strings). */
  genericLayout?: string
}

/**
 * Special page layouts the theme compares `.Layout` with and ships a template for (search,
 * archives…), turned into "create the page" actions for themes without a curated profile.
 */
export function detectedFeatures(curated: Record<string, FeatureDef>, scannedLayouts: string[], themeFiles: string[]): DetectedFeature[] {
  const out: DetectedFeature[] = Object.entries(curated).map(([id, def]) => ({ id, def }))
  const covered = new Set(
    Object.values(curated).flatMap((def) => def.steps.flatMap((s) => (s.op === 'ensureContentFile' ? [s.layout.toLowerCase()] : []))),
  )
  const files = new Set(themeFiles.map((f) => f.toLowerCase()))
  for (const layout of scannedLayouts) {
    const lower = layout.toLowerCase()
    if (covered.has(lower) || !/^[\w-]+$/.test(layout)) continue
    const hasTemplate = [`layouts/${lower}.html`, `layouts/_default/${lower}.html`].some((p) => files.has(p))
    if (!hasTemplate) continue
    const title = layout.charAt(0).toUpperCase() + layout.slice(1)
    const steps: FeatureStep[] = []
    if (lower === 'search' && (files.has('layouts/index.json') || files.has('layouts/home.json') || files.has('layouts/_default/index.json'))) {
      steps.push({ op: 'ensureListContains', path: ['outputs', 'home'], value: 'JSON', defaultList: ['HTML', 'RSS'] })
    }
    steps.push({ op: 'ensureContentFile', path: `content/${lower}.md`, title: { en: title, tr: title }, frontMatter: { layout }, layout })
    out.push({ id: `layout-${lower}`, def: { label: { en: '', tr: '' }, description: { en: '', tr: '' }, steps }, genericLayout: layout })
  }
  return out
}

/** The config change that makes `name` the site's theme (keeps other theme components). */
export function setThemeOps(configs: ConfigFileData[], name: string): { file: string; ops: ConfigOp[] } | null {
  const where = locateSetting(configs, ['theme'])
  if (!where || where.file.format === 'json') return null
  const value = Array.isArray(where.current) ? [name, ...(where.current as unknown[]).slice(1)] : name
  return { file: where.file.path, ops: [{ op: 'set', path: where.keyPath, value }] }
}
