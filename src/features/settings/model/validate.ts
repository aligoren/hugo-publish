// Checks for typed field values before they reach the draft.

export type ValidationError =
  | { key: 'urlInvalid' }
  | { key: 'urlSlash' }
  | { key: 'notNumber' }
  | { key: 'notInteger' }
  | { key: 'tooSmall'; min: number }
  | { key: 'tooLarge'; max: number }
  | { key: 'duration' }
  | { key: 'envName' }
  | { key: 'envExists' }

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ValidationError }

/** An absolute http(s) URL; Hugo wants `baseURL` to end with a slash. Empty is allowed (Hugo's default). */
export function parseUrl(text: string, trailingSlash: boolean): Parsed<string> {
  const value = text.trim()
  if (value === '') return { ok: true, value }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, error: { key: 'urlInvalid' } }
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.host) return { ok: false, error: { key: 'urlInvalid' } }
  if (trailingSlash && !value.endsWith('/')) return { ok: false, error: { key: 'urlSlash' } }
  return { ok: true, value }
}

export function parseNumber(text: string, { integer = false, min, max }: { integer?: boolean; min?: number; max?: number } = {}): Parsed<number> {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '' || !/^-?\d*\.?\d+$/.test(trimmed)) return { ok: false, error: { key: 'notNumber' } }
  const value = Number(trimmed)
  if (integer && !Number.isInteger(value)) return { ok: false, error: { key: 'notInteger' } }
  if (min !== undefined && value < min) return { ok: false, error: { key: 'tooSmall', min } }
  if (max !== undefined && value > max) return { ok: false, error: { key: 'tooLarge', max } }
  return { ok: true, value }
}

const GO_DURATION = /^-?(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/

/** A Go duration (`60s`, `1h30m`) as a string, or a whole number (seconds, or -1/0 for caches). */
export function parseDuration(text: string): Parsed<string | number> {
  const value = text.trim()
  if (/^-?\d+$/.test(value)) return { ok: true, value: Number(value) }
  if (GO_DURATION.test(value)) return { ok: true, value }
  return { ok: false, error: { key: 'duration' } }
}

export function isGoDuration(value: unknown): boolean {
  return typeof value === 'number' ? Number.isInteger(value) : typeof value === 'string' && parseDuration(value).ok
}

/** A folder name for `config/<env>/`. */
export function parseEnvironmentName(text: string, existing: readonly string[]): Parsed<string> {
  const value = text.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || value === '_default') return { ok: false, error: { key: 'envName' } }
  if (existing.some((e) => e.toLowerCase() === value.toLowerCase())) return { ok: false, error: { key: 'envExists' } }
  return { ok: true, value }
}
