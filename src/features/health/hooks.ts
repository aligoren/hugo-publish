// Shared state of the health view: one production build that several sections read, the
// effective config, and results that survive leaving and re-opening the view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, type BuildResult, type EffectiveConfig } from '../../lib/api'
import { useSite } from '../site/SiteContext'
import { mapLimit } from './lib/pool'

export interface HealthBuild {
  result: BuildResult | null
  building: boolean
  error: unknown
  /** The current build, made first if there is none. */
  ensure(): Promise<BuildResult>
  /** Throws the current build away and makes a new one. */
  rebuild(): Promise<BuildResult>
  /** A text file of the current build. */
  read(path: string): Promise<string>
}

function discard(build: BuildResult | null) {
  if (build) void api.discardBuild(build.outputDir).catch(() => undefined)
}

/** A temporary production build of the working tree, discarded when the view closes. */
export function useHealthBuild(): HealthBuild {
  const [result, setResult] = useState<BuildResult | null>(null)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const current = useRef<BuildResult | null>(null)
  const pending = useRef<Promise<BuildResult> | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      discard(current.current)
      current.current = null
    }
  }, [])

  const start = useCallback((): Promise<BuildResult> => {
    discard(current.current)
    current.current = null
    setResult(null)
    setError(null)
    setBuilding(true)
    const promise = api.buildSite({}).then(
      (built) => {
        pending.current = null
        if (!alive.current) {
          // The view closed while Hugo was running.
          discard(built)
          return built
        }
        current.current = built
        setResult(built)
        setBuilding(false)
        return built
      },
      (failure: unknown) => {
        pending.current = null
        if (alive.current) {
          setError(failure)
          setBuilding(false)
        }
        throw failure
      },
    )
    pending.current = promise
    return promise
  }, [])

  const ensure = useCallback(
    () => (current.current ? Promise.resolve(current.current) : (pending.current ?? start())),
    [start],
  )
  const rebuild = useCallback(() => pending.current ?? start(), [start])
  const read = useCallback((path: string) => {
    const build = current.current
    return build ? api.readBuildFile(build.outputDir, path) : Promise.reject(new Error('no build'))
  }, [])

  return useMemo(
    () => ({ result, building, error, ensure, rebuild, read }),
    [result, building, error, ensure, rebuild, read],
  )
}

export interface SiteConfigState {
  config: EffectiveConfig | null
  error: unknown
  loading: boolean
  baseUrl: string | null
  reload(): Promise<void>
}

/** `hugo config` of the site, reloaded after config changes. */
export function useEffectiveConfig(): SiteConfigState {
  const { configVersion } = useSite()
  const [config, setConfig] = useState<EffectiveConfig | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setConfig(await api.configEffective())
      setError(null)
    } catch (failure) {
      setError(failure)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // State only changes after the command resolves.
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [reload, configVersion])

  const baseUrl = typeof config?.values.baseurl === 'string' && config.values.baseurl.trim() ? config.values.baseurl.trim() : null
  return { config, error, loading, baseUrl, reload }
}

const sessionStore = new Map<string, unknown>()

/** Like useState, but the value outlives the view (per site, until the app closes). */
export function useSessionState<T>(key: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const { site } = useSite()
  const fullKey = `${site.root}\n${key}`
  const [value, setValue] = useState<T>(() => (sessionStore.has(fullKey) ? (sessionStore.get(fullKey) as T) : initial))
  const set = useCallback(
    (next: T | ((previous: T) => T)) =>
      setValue((previous) => {
        const value = typeof next === 'function' ? (next as (p: T) => T)(previous) : next
        sessionStore.set(fullKey, value)
        return value
      }),
    [fullKey],
  )
  return [value, set]
}

/** Forgets remembered results (tests). */
export function clearSessionState(): void {
  sessionStore.clear()
}

/** Reads content files eight at a time; unreadable files are left out. */
export async function readTexts(
  paths: string[],
  options: { onProgress?: (done: number) => void; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const texts = await mapLimit(paths, 8, (path) => api.readText(path).then((f) => f.text).catch(() => null), options)
  const map = new Map<string, string>()
  paths.forEach((path, i) => {
    const text = texts[i]
    if (text !== null) map.set(path, text)
  })
  return map
}
