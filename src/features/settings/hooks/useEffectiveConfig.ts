import { useEffect, useState } from 'react'

import { api, type EffectiveConfig } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'

interface State {
  key: string
  effective: EffectiveConfig | null
  error: unknown
}

/**
 * `hugo config` for an environment (null: Hugo's default, production). Skipped without Hugo.
 * `token` forces a reload.
 */
export function useEffectiveConfig(env: string | null, enabled: boolean, token: number) {
  const { configVersion } = useSite()
  const key = `${env ?? ''}|${configVersion}|${token}|${enabled}`
  const [state, setState] = useState<State>({ key: '', effective: null, error: null })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    api.configEffective(env ?? undefined).then(
      (effective) => !cancelled && setState({ key, effective, error: null }),
      (error: unknown) => !cancelled && setState({ key, effective: null, error }),
    )
    return () => {
      cancelled = true
    }
  }, [env, enabled, key])

  if (!enabled) return { effective: null, error: null, loading: false }
  return { effective: state.effective, error: state.error, loading: state.key !== key }
}
