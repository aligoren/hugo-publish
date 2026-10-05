// State and actions behind the Hugo version view: the app-managed versions, the stored
// preference, installs with progress, and switching the Hugo in use.

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, type HugoInstallProgress, type ManagedHugo } from '../../lib/api'
import { useSite } from '../site/SiteContext'
import { samePath, sameVersion } from './versions'

export type ManagerNotice =
  | { kind: 'installed'; result: ManagedHugo }
  | { kind: 'standardInstead'; result: ManagedHugo }

export interface HugoManager {
  /** null while loading. */
  installed: ManagedHugo[] | null
  /** The stored custom/managed binary; null = automatic detection; undefined while loading. */
  preferred: string | null | undefined
  /** The version being installed and its latest progress event. */
  installing: { version: string; extended: boolean; progress: HugoInstallProgress | null } | null
  /** A preference change or removal is running. */
  busy: boolean
  error: unknown
  notice: ManagerNotice | null
  clearMessages(): void
  reload(): Promise<void>
  use(path: string | null): Promise<void>
  install(version: string, extended: boolean): Promise<ManagedHugo | null>
  installAndUse(version: string, extended: boolean): Promise<void>
  uninstall(entry: ManagedHugo): Promise<void>
  /** Whether an installed entry is the Hugo in use. */
  isInUse(entry: ManagedHugo): boolean
  findInstalled(version: string, extended: boolean): ManagedHugo | null
}

/** The installed entry for a version: the same edition, or (when asked for extended but that cannot
 * be had here) the standard one. */
export function findInstalledVersion(
  installed: ManagedHugo[] | null,
  version: string,
  extended: boolean,
  standardIsFine: boolean,
): ManagedHugo | null {
  const matches = (installed ?? []).filter((m) => sameVersion(m.version, version))
  return (
    matches.find((m) => m.extended === extended) ??
    (extended && standardIsFine ? matches.find((m) => !m.extended) : undefined) ??
    // An extended build does everything the standard one does.
    (!extended ? matches.find((m) => m.extended) : undefined) ??
    null
  )
}

export function useHugoManager(options: {
  confirm(message: string): Promise<boolean>
  uninstallMessage(entry: ManagedHugo, inUse: boolean): string
  /** True on platforms without an extended build (Windows on ARM). */
  noExtendedBuild: boolean
}): HugoManager {
  const { hugo, refreshHugo } = useSite()
  const [installed, setInstalled] = useState<ManagedHugo[] | null>(null)
  const [preferred, setPreferred] = useState<string | null | undefined>(undefined)
  const [installing, setInstalling] = useState<HugoManager['installing']>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<ManagerNotice | null>(null)
  const installingRef = useRef<string | null>(null)
  const mounted = useRef(true)
  const { confirm, uninstallMessage, noExtendedBuild } = options

  const reload = useCallback(async () => {
    try {
      const [list, stored] = await Promise.all([api.hugoInstalled(), api.hugoPreferred()])
      if (!mounted.current) return
      setInstalled(list)
      setPreferred(stored)
    } catch (e) {
      if (!mounted.current) return
      setInstalled((current) => current ?? [])
      setPreferred((current) => (current === undefined ? null : current))
      setError(e)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // Load on mount; state only changes after the commands resolve.
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
    return () => {
      mounted.current = false
    }
  }, [reload])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let disposed = false
    void api
      .onHugoInstallProgress((progress) => {
        if (progress.version !== installingRef.current) return
        setInstalling((current) => (current && current.version === progress.version ? { ...current, progress } : current))
      })
      .then((stop) => {
        // Unmounted before the listener was registered: remove it right away.
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => {
        // Without events the install still works, just without a progress bar.
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const clearMessages = useCallback(() => {
    setError(null)
    setNotice(null)
  }, [])

  const use = useCallback(
    async (path: string | null) => {
      setBusy(true)
      clearMessages()
      try {
        await api.hugoSetPreferred(path)
        await refreshHugo()
        await reload()
      } catch (e) {
        if (mounted.current) setError(e)
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [clearMessages, refreshHugo, reload],
  )

  const install = useCallback(
    async (version: string, extended: boolean): Promise<ManagedHugo | null> => {
      if (installingRef.current) return null
      installingRef.current = version
      clearMessages()
      setInstalling({ version, extended, progress: null })
      try {
        const result = await api.hugoInstall(version, extended)
        await reload()
        if (mounted.current) {
          setNotice({ kind: extended && !result.extended ? 'standardInstead' : 'installed', result })
        }
        return result
      } catch (e) {
        if (mounted.current) setError(e)
        return null
      } finally {
        installingRef.current = null
        if (mounted.current) setInstalling(null)
      }
    },
    [clearMessages, reload],
  )

  const findInstalled = useCallback(
    (version: string, extended: boolean) => findInstalledVersion(installed, version, extended, noExtendedBuild),
    [installed, noExtendedBuild],
  )

  const installAndUse = useCallback(
    async (version: string, extended: boolean) => {
      const target = findInstalled(version, extended) ?? (await install(version, extended))
      if (target) await use(target.path)
    },
    [findInstalled, install, use],
  )

  const isInUse = useCallback((entry: ManagedHugo) => samePath(hugo?.path, entry.path), [hugo])

  const uninstall = useCallback(
    async (entry: ManagedHugo) => {
      const inUse = isInUse(entry) || samePath(preferred, entry.path)
      if (!(await confirm(uninstallMessage(entry, inUse)))) return
      setBusy(true)
      clearMessages()
      try {
        await api.hugoUninstall(entry.version, entry.extended)
        if (inUse) await refreshHugo()
        await reload()
      } catch (e) {
        if (mounted.current) setError(e)
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [clearMessages, confirm, isInUse, preferred, refreshHugo, reload, uninstallMessage],
  )

  return {
    installed,
    preferred,
    installing,
    busy,
    error,
    notice,
    clearMessages,
    reload,
    use,
    install,
    installAndUse,
    uninstall,
    isInUse,
    findInstalled,
  }
}
