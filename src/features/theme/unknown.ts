// Site params the theme never reads: usually typos (`ShowReadTime`) or leftovers from a
// previous theme. Hugo matches keys case-insensitively, so only real spelling differences count.

export interface UnknownParam {
  key: string
  /** Likely intended keys, best first. */
  suggestions: string[]
  /** The key is a front matter (page) setting; in [params] it does nothing. */
  pageOnly: boolean
}

/** Levenshtein distance (case-insensitive). */
export function editDistance(a: string, b: string): number {
  const s = a.toLowerCase()
  const t = b.toLowerCase()
  if (s === t) return 0
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i)
  for (let i = 1; i <= s.length; i++) {
    const cur = [i]
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[t.length]
}

function lastSegment(key: string): string {
  return key.split('.').pop() ?? key
}

function parentOf(key: string): string {
  const i = key.lastIndexOf('.')
  return i === -1 ? '' : key.slice(0, i).toLowerCase()
}

/** Near matches for a key among the keys the theme knows. */
export function suggestKeys(key: string, known: string[], max = 3): string[] {
  const name = lastSegment(key)
  const parent = parentOf(key)
  const scored: { key: string; score: number }[] = []
  for (const candidate of known) {
    if (candidate.toLowerCase() === key.toLowerCase()) continue
    const candidateName = lastSegment(candidate)
    const sameParent = parentOf(candidate) === parent
    const distance = sameParent ? editDistance(name, candidateName) : editDistance(key, candidate)
    const longest = Math.max(sameParent ? name.length : key.length, sameParent ? candidateName.length : candidate.length)
    const limit = Math.max(2, Math.round(longest * 0.3))
    const lowerName = name.toLowerCase()
    const lowerCandidate = candidateName.toLowerCase()
    const contains = sameParent && lowerName.length >= 5 && (lowerCandidate.includes(lowerName) || lowerName.includes(lowerCandidate))
    // Same key in another place (e.g. `ShowToc` written under `[params.article]`).
    const moved = !sameParent && lowerName === lowerCandidate
    if (distance <= limit || contains || moved) scored.push({ key: candidate, score: moved ? 0.5 : contains ? Math.min(distance, limit) : distance })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .slice(0, max)
    .map((s) => s.key)
}

export function unknownParams(unknown: string[], knownSiteKeys: string[], pageKeys: string[]): UnknownParam[] {
  const pageLower = new Set(pageKeys.map((k) => k.toLowerCase()))
  return unknown.map((key) => {
    const pageOnly = pageLower.has(key.toLowerCase())
    return { key, pageOnly, suggestions: pageOnly ? [] : suggestKeys(key, knownSiteKeys) }
  })
}
