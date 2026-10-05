import { isAppError } from '../../lib/api'

/** `12.3 MB` style sizes for download progress. */
export function formatBytes(bytes: number, locale?: string): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[unit]}`
}

/** Download progress in percent, or null while the size is unknown. */
export function progressPercent(received: number, total: number | null): number | null {
  if (!total || total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)))
}

/**
 * A `hugo.errors.*` key with an explanation for errors from the version manager (the Rust side
 * reports them with stable English prefixes), or null for anything else.
 */
export function errorHintKey(error: unknown): string | null {
  if (!isAppError(error)) return null
  const message = error.message
  if (message.includes('GitHub rate limit')) return 'hugo.errors.rateLimited'
  if (message.includes('Network error')) return 'hugo.errors.network'
  if (message.includes('checksum mismatch')) return 'hugo.errors.checksum'
  return null
}

/** Local date for a GitHub `published_at` timestamp. */
export function formatDate(iso: string, locale?: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}
