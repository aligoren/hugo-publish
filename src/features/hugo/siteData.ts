// Everything the parity check needs from the open site: the pin file, the theme's Hugo
// requirement and the version-dependent config keys in use.

import { api } from '../../lib/api'
import { readConfigFile } from '../config-edit'
import {
  isLocalTheme,
  themeName,
  themeRequirement,
  usedFeatures,
  type ThemeRequirement,
  type UsedFeature,
} from './parity'
import { readSiteToml, type SiteTomlFile } from './siteToml'

export interface SiteHugoData {
  file: SiteTomlFile
  theme: ThemeRequirement | null
  features: UsedFeature[]
}

async function tomlValues(path: string): Promise<Record<string, unknown> | null> {
  try {
    return (await api.tomlRead(path)).values
  } catch {
    return null
  }
}

/** The site's config files that can be read, each with its parsed values. Unreadable ones are skipped. */
export async function readSiteConfigs(configFiles: string[]): Promise<{ file: string; values: Record<string, unknown> }[]> {
  const configs: { file: string; values: Record<string, unknown> }[] = []
  for (const file of configFiles) {
    try {
      const data = await readConfigFile(file)
      configs.push({ file, values: data.values })
    } catch {
      // A broken or unsupported config file is reported elsewhere (settings, site health).
    }
  }
  return configs
}

export async function readThemeRequirement(name: string): Promise<ThemeRequirement> {
  if (!isLocalTheme(name)) return themeRequirement(name, null, null)
  const themeToml = await tomlValues(`themes/${name}/theme.toml`)
  const themeConfig = (await tomlValues(`themes/${name}/hugo.toml`)) ?? (await tomlValues(`themes/${name}/config.toml`))
  return themeRequirement(name, themeToml, themeConfig)
}

export async function loadSiteHugoData(configFiles: string[]): Promise<SiteHugoData> {
  const [file, configs] = await Promise.all([readSiteToml(), readSiteConfigs(configFiles)])
  const name = themeName(configs)
  const theme = name ? await readThemeRequirement(name) : null
  return { file, theme, features: usedFeatures(configs) }
}
