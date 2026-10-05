// Whether this computer is Windows on ARM, where Hugo publishes no extended build.
// The webview's user agent string does not say (WebView2 reports x64 on ARM), so the
// Client Hints API is asked first, with the running Hugo's own os/arch as a fallback.

import type { HugoInfo } from '../../lib/api'

export interface PlatformHints {
  /** `navigator.userAgentData` high-entropy values, when available. */
  uaPlatform?: string | null
  uaArchitecture?: string | null
  uaBitness?: string | null
  /** The running Hugo's build target (`windows`/`arm64`). */
  hugoOs?: string | null
  hugoArch?: string | null
}

export function isWindowsArm64(hints: PlatformHints): boolean {
  const platform = hints.uaPlatform?.toLowerCase()
  const arch = hints.uaArchitecture?.toLowerCase()
  if (platform === 'windows' && arch) return arch === 'arm' && hints.uaBitness !== '32'
  return hints.hugoOs === 'windows' && hints.hugoArch === 'arm64'
}

interface UserAgentData {
  platform?: string
  getHighEntropyValues?(hints: string[]): Promise<{ platform?: string; architecture?: string; bitness?: string }>
}

/** Collects the hints available in this webview. Never throws. */
export async function platformHints(hugo: HugoInfo | null): Promise<PlatformHints> {
  const hints: PlatformHints = { hugoOs: hugo?.version.os ?? null, hugoArch: hugo?.version.arch ?? null }
  try {
    const data = (globalThis.navigator as (Navigator & { userAgentData?: UserAgentData }) | undefined)?.userAgentData
    const values = await data?.getHighEntropyValues?.(['platform', 'architecture', 'bitness'])
    if (values) {
      hints.uaPlatform = values.platform ?? data?.platform ?? null
      hints.uaArchitecture = values.architecture ?? null
      hints.uaBitness = values.bitness ?? null
    }
  } catch {
    // Client hints are optional; the Hugo fallback still applies.
  }
  return hints
}

/** `exe` filter for the binary picker on Windows, none elsewhere (Hugo has no extension there). */
export function isWindowsHost(hugo: HugoInfo | null): boolean {
  if (hugo) return hugo.version.os === 'windows'
  return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
}
