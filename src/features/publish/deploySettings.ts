// Per-site deploy settings in `.hugo-publisher/site.toml`, table `[deploy]`.

import { api, type ConfigOp } from '../../lib/api'
import type { ForgeKind } from './deployApi'

export const SETTINGS_PATH = '.hugo-publisher/site.toml'

export type DeployMethod = 'push' | 'gh-pages'

export interface DeploySettings {
  /** `push`: pushing the sources publishes (Cloudflare Pages, Netlify, Actions). `gh-pages`: the app builds and pushes the output. */
  method: DeployMethod
  /** Branch for the built site (gh-pages method). */
  branch: string
  /** Address of the live site; empty = the site's baseURL. */
  liveUrl: string
  /** Cloudflare Pages project name, for branch preview URLs. */
  cloudflareProject: string
  /** Kind of a self-hosted forge for the build status; empty = recognised from the remote URL. */
  forge: ForgeKind | ''
}

export const DEFAULT_SETTINGS: DeploySettings = { method: 'push', branch: 'gh-pages', liveUrl: '', cloudflareProject: '', forge: '' }

/** The `forge` setting as the Rust side reads it (`forgejo` and `codeberg` mean Gitea). */
export function forgeSetting(value: string): ForgeKind | '' {
  const name = value.trim().toLowerCase()
  if (name === 'github' || name === 'gitlab' || name === 'gitea') return name
  return name === 'forgejo' || name === 'codeberg' ? 'gitea' : ''
}

const KEYS: Record<keyof DeploySettings, string> = {
  method: 'method',
  branch: 'branch',
  liveUrl: 'liveUrl',
  cloudflareProject: 'cloudflareProject',
  forge: 'forge',
}

function lookup(table: Record<string, unknown>, key: string): unknown {
  const found = Object.keys(table).find((k) => k.toLowerCase() === key.toLowerCase())
  return found === undefined ? undefined : table[found]
}

/** Settings from the parsed file (missing or odd values fall back to the defaults). */
export function readDeploySettings(values: Record<string, unknown>): DeploySettings {
  const raw = lookup(values, 'deploy')
  const table = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const text = (key: keyof DeploySettings) => {
    const value = lookup(table, KEYS[key])
    return typeof value === 'string' ? value.trim() : ''
  }
  return {
    method: text('method') === 'gh-pages' ? 'gh-pages' : 'push',
    branch: text('branch') || DEFAULT_SETTINGS.branch,
    liveUrl: text('liveUrl'),
    cloudflareProject: text('cloudflareProject'),
    forge: forgeSetting(text('forge')),
  }
}

/** The ops that turn the file's `[deploy]` table into `next`; empty optional values are removed. */
export function deploySettingsOps(values: Record<string, unknown>, next: DeploySettings): ConfigOp[] {
  const raw = lookup(values, 'deploy')
  const table = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const ops: ConfigOp[] = []
  for (const key of Object.keys(KEYS) as (keyof DeploySettings)[]) {
    const existingKey = Object.keys(table).find((k) => k.toLowerCase() === KEYS[key].toLowerCase()) ?? KEYS[key]
    const value = next[key].trim()
    const current = table[existingKey]
    if (value === '') {
      if (current !== undefined) ops.push({ op: 'remove', path: ['deploy', existingKey] })
    } else if (current !== value) {
      ops.push({ op: 'set', path: ['deploy', existingKey], value })
    }
  }
  return ops
}

export function validateSettings(settings: DeploySettings): 'branch' | 'liveUrl' | 'cloudflareProject' | null {
  if (settings.method === 'gh-pages' && !/^(?!-)(?!.*\.\.)[\w./-]+(?<![./])$/.test(settings.branch.trim())) return 'branch'
  if (settings.liveUrl.trim() !== '' && !/^https?:\/\/[^\s/]+/i.test(settings.liveUrl.trim())) return 'liveUrl'
  if (settings.cloudflareProject.trim() !== '' && !/^[a-z0-9][a-z0-9-]*$/i.test(settings.cloudflareProject.trim())) {
    return 'cloudflareProject'
  }
  return null
}

export interface SettingsFile {
  /** File text; empty when the file does not exist yet. */
  text: string
  /** Version for writing; `''` when the file does not exist (create it). */
  version: string
  values: Record<string, unknown>
  settings: DeploySettings
}

export async function loadSettingsFile(): Promise<SettingsFile> {
  let text = ''
  let version = ''
  try {
    const file = await api.readText(SETTINGS_PATH)
    text = file.text
    version = file.version
  } catch {
    // No settings yet: defaults, and the file is created on save.
  }
  const values = text.trim() === '' ? {} : (await api.tomlParseText(text)).values
  return { text, version, values, settings: readDeploySettings(values) }
}
