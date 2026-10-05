// Line diff for showing config changes before they are written.

export type DiffLine =
  | { kind: 'same'; text: string; oldNumber: number; newNumber: number }
  | { kind: 'removed'; text: string; oldNumber: number }
  | { kind: 'added'; text: string; newNumber: number }

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  // A trailing newline does not start another line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Longest-common-subsequence diff. Config files are small, so O(n·m) is fine. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i], oldNumber: i + 1, newNumber: j + 1 })
      i++
      j++
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // On a tie, removals come first so a replaced line reads as "− old, + new".
      result.push({ kind: 'removed', text: a[i], oldNumber: i + 1 })
      i++
    } else {
      result.push({ kind: 'added', text: b[j], newNumber: j + 1 })
      j++
    }
  }
  return result
}

/** Keeps changed lines plus `context` unchanged lines around them; `null` marks skipped lines. */
export function withContext(lines: DiffLine[], context = 3): (DiffLine | null)[] {
  if (lines.every((line) => line.kind === 'same')) return []
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) {
      keep[k] = true
    }
  })
  const result: (DiffLine | null)[] = []
  lines.forEach((line, index) => {
    if (keep[index]) result.push(line)
    else if (result[result.length - 1] !== null) result.push(null)
  })
  return result
}
