// A small diff3-style line merge for theme overrides: base = the theme file the site copy was
// made from, ours = the site's copy, theirs = the theme file in the new version.

export interface MergeResult {
  text: string
  /** Number of conflicting regions (0 = clean merge). */
  conflicts: number
}

export const CONFLICT_OURS = '<<<<<<< your site'
export const CONFLICT_BASE = '||||||| theme before the update'
export const CONFLICT_SEP = '======='
export const CONFLICT_THEIRS = '>>>>>>> theme after the update'

function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** For each line of `a`, the index of the matching line in `b` (longest common subsequence). */
function matchLines(a: string[], b: string[]): (number | undefined)[] {
  // Common prefix and suffix first, the O(n·m) table only for the middle.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const match: (number | undefined)[] = new Array(a.length).fill(undefined)
  for (let i = 0; i < start; i++) match[i] = i
  for (let k = 0; k < a.length - endA; k++) match[endA + k] = endB + k
  const n = endA - start
  const m = endB - start
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[start + i] === b[start + j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      match[start + i] = start + j
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) i++
    else j++
  }
  return match
}

function same(x: string[], y: string[]): boolean {
  return x.length === y.length && x.every((line, i) => line === y[i])
}

/** Merges the changes base→ours and base→theirs; overlapping changes become conflict markers. */
export function merge3(base: string, ours: string, theirs: string): MergeResult {
  const eol = ours.includes('\r\n') ? '\r\n' : theirs.includes('\r\n') && !ours.includes('\n') ? '\r\n' : '\n'
  const endsWithNewline = /\n$/.test(ours) || (ours === '' && /\n$/.test(theirs))
  const O = splitLines(base)
  const A = splitLines(ours)
  const B = splitLines(theirs)
  const toA = matchLines(O, A)
  const toB = matchLines(O, B)
  const out: string[] = []
  let conflicts = 0
  let i = 0
  let a = 0
  let b = 0
  for (;;) {
    // Next base line that is unchanged in both versions (a stable point), or the end.
    let k = i
    while (k < O.length && !(toA[k] !== undefined && toB[k] !== undefined && toA[k]! >= a && toB[k]! >= b)) k++
    const ak = k < O.length ? toA[k]! : A.length
    const bk = k < O.length ? toB[k]! : B.length
    const baseChunk = O.slice(i, k)
    const oursChunk = A.slice(a, ak)
    const theirsChunk = B.slice(b, bk)
    if (same(oursChunk, baseChunk)) out.push(...theirsChunk)
    else if (same(theirsChunk, baseChunk) || same(oursChunk, theirsChunk)) out.push(...oursChunk)
    else {
      conflicts++
      out.push(CONFLICT_OURS, ...oursChunk, CONFLICT_BASE, ...baseChunk, CONFLICT_SEP, ...theirsChunk, CONFLICT_THEIRS)
    }
    if (k >= O.length) break
    out.push(O[k])
    i = k + 1
    a = ak + 1
    b = bk + 1
  }
  const text = out.join(eol) + (out.length > 0 && endsWithNewline ? eol : '')
  return { text, conflicts }
}

export function hasConflictMarkers(text: string): boolean {
  return text.split(/\r?\n/).some((line) => line === CONFLICT_OURS || line === CONFLICT_THEIRS)
}
