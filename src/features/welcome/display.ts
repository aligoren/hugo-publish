// How a recent site's folder and last-opened time are shown on the welcome screen.

const HOME = /^(?:[A-Za-z]:[\\/]Users[\\/][^\\/]+|\/(?:Users|home)\/[^/]+)(?=[\\/]|$)/

/** `C:\Users\me\a\b\c\site` → `~\…\c\site`: the home folder as `~`, long paths cut in the middle. */
export function shortPath(path: string, keep = 2): string {
  const sep = path.includes('\\') ? '\\' : '/'
  const short = path.replace(HOME, '~')
  const parts = short.split(/[\\/]+/).filter((p, i) => p !== '' || i === 0)
  if (parts.length <= keep + 2) return parts.join(sep)
  return [parts[0], '…', ...parts.slice(-keep)].join(sep)
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "2 hours ago", "yesterday"…; under a minute counts as now. */
export function timeAgo(ms: number, now: number, locale: string | undefined): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const seconds = Math.round((ms - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(0, 'second')
}
