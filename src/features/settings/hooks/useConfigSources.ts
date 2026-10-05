import { useCallback, useEffect, useState } from 'react'

import { api } from '../../../lib/api'
import { readConfigFile } from '../../config-edit'
import { useSite } from '../../site/SiteContext'
import { CONFIG_EXTENSIONS, discoverSources, loadedSource, type ConfigSource, type LoadedSource } from '../model/sources'

interface State {
  sources: LoadedSource[]
  loading: boolean
  error: unknown
}

async function load(source: ConfigSource): Promise<LoadedSource> {
  try {
    return loadedSource(source, await readConfigFile(source.path))
  } catch (error) {
    // Keep the text so the raw editor can still fix a file that does not parse.
    const file = await api.readText(source.path).catch(() => null)
    const data = file && { path: source.path, format: source.format, text: file.text, version: file.version, values: {}, comments: {} }
    return loadedSource(source, data, error)
  }
}

/** Every config file of the site (root, `config/_default`, all environments), read and parsed. */
export function useConfigSources() {
  const { site, configVersion } = useSite()
  const [state, setState] = useState<State>({ sources: [], loading: true, error: null })
  const [token, setToken] = useState(0)
  // Files created here after the site was opened (`site.configFiles` is read once).
  const [created, setCreated] = useState<string[]>([])
  // Root files moved away here (`site.configFiles` still lists them).
  const [removed, setRemoved] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const listed = await api.listFiles('config', CONFIG_EXTENSIONS).catch(() => [])
        const roots = [...site.configFiles, ...created].filter((p) => !removed.includes(p))
        const found = discoverSources(roots, listed.map((f) => f.path))
        const sources = await Promise.all(found.map(load))
        if (!cancelled) setState({ sources, loading: false, error: null })
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [site.configFiles, created, removed, configVersion, token])

  const reload = useCallback(() => setToken((n) => n + 1), [])
  const addCreated = useCallback((path: string) => {
    setCreated((list) => (list.includes(path) ? list : [...list, path]))
    setRemoved((list) => list.filter((p) => p !== path))
  }, [])
  const addRemoved = useCallback((path: string) => setRemoved((list) => (list.includes(path) ? list : [...list, path])), [])

  return { ...state, reload, addCreated, addRemoved }
}
