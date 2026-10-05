// A small parser for `git diff` output (unified format), for the per-file diff viewer.

export type DiffLineType = 'context' | 'add' | 'del' | 'note'

export interface DiffLine {
  type: DiffLineType
  /** Without the leading `+`/`-`/space and without a trailing CR. */
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  header: string
  oldStart: number
  newStart: number
  /** Function or heading git shows after the `@@ … @@`. */
  section: string
  lines: DiffLine[]
}

export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'modified'

export interface DiffFile {
  oldPath: string | null
  newPath: string | null
  status: DiffFileStatus
  binary: boolean
  /** Rename similarity, e.g. 100. */
  similarity: number | null
  hunks: DiffHunk[]
  /** `\` lines outside hunks. */
  notes: string[]
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  // Lines still expected in the current hunk, from its header; this keeps a content line such as
  // `+++ x` or `--- y` from being read as a file header.
  let oldLeft = 0
  let newLeft = 0

  const startFile = (): DiffFile => {
    const created: DiffFile = {
      oldPath: null,
      newPath: null,
      status: 'modified',
      binary: false,
      similarity: null,
      hunks: [],
      notes: [],
    }
    files.push(created)
    hunk = null
    oldLeft = 0
    newLeft = 0
    return created
  }

  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const current = hunk as DiffHunk | null

    if (current && (oldLeft > 0 || newLeft > 0)) {
      const sign = line[0]
      if (sign === '+' && newLeft > 0) {
        current.lines.push({ type: 'add', text: line.slice(1), oldLine: null, newLine: newLine++ })
        newLeft--
        continue
      }
      if (sign === '-' && oldLeft > 0) {
        current.lines.push({ type: 'del', text: line.slice(1), oldLine: oldLine++, newLine: null })
        oldLeft--
        continue
      }
      if (sign === ' ' || line === '') {
        current.lines.push({ type: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
        oldLeft--
        newLeft--
        continue
      }
    }
    if (current && line.startsWith('\\')) {
      // "\ No newline at end of file", or the app's truncation marker.
      current.lines.push({ type: 'note', text: line.slice(1).trim(), oldLine: null, newLine: null })
      continue
    }

    if (line.startsWith('diff --git ')) {
      file = startFile()
      const paths = splitGitHeader(line.slice('diff --git '.length))
      if (paths) {
        file.oldPath = stripPrefix(paths[0])
        file.newPath = stripPrefix(paths[1])
      }
      continue
    }

    const hunkMatch = HUNK.exec(line)
    if (hunkMatch) {
      file ??= startFile()
      oldLine = Number(hunkMatch[1])
      newLine = Number(hunkMatch[3])
      oldLeft = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2])
      newLeft = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4])
      hunk = { header: line, oldStart: oldLine, newStart: newLine, section: hunkMatch[5].trim(), lines: [] }
      file.hunks.push(hunk)
      continue
    }

    if (line.startsWith('--- ')) {
      if (!file || file.hunks.length > 0) file = startFile()
      file.oldPath = headerPath(line.slice(4))
      if (file.oldPath === null) file.status = 'added'
      continue
    }
    if (line.startsWith('+++ ')) {
      file ??= startFile()
      file.newPath = headerPath(line.slice(4))
      if (file.newPath === null) file.status = 'deleted'
      continue
    }
    if (!file) continue

    if (line.startsWith('new file mode')) file.status = 'added'
    else if (line.startsWith('deleted file mode')) file.status = 'deleted'
    else if (line.startsWith('rename from ')) {
      file.status = 'renamed'
      file.oldPath = unquote(line.slice('rename from '.length))
    } else if (line.startsWith('rename to ')) {
      file.status = 'renamed'
      file.newPath = unquote(line.slice('rename to '.length))
    } else if (line.startsWith('similarity index ')) {
      file.similarity = parseInt(line.slice('similarity index '.length), 10)
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      file.binary = true
    } else if (line.startsWith('\\')) {
      file.notes.push(line.slice(1).trim())
    }
  }
  return files
}

/** `a/x b/y`, either side possibly quoted. */
function splitGitHeader(rest: string): [string, string] | null {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest)
    if (end === -1) return null
    return [unquote(rest.slice(0, end + 1)), unquote(rest.slice(end + 2))]
  }
  if (rest.endsWith('"')) {
    const start = rest.lastIndexOf(' "')
    return start === -1 ? null : [rest.slice(0, start), unquote(rest.slice(start + 1))]
  }
  // Unquoted: when the path did not change, both halves are the same apart from `a/` and `b/`.
  const half = (rest.length - 1) / 2
  if (Number.isInteger(half) && rest[half] === ' ' && rest.slice(2, half) === rest.slice(half + 3)) {
    return [rest.slice(0, half), rest.slice(half + 1)]
  }
  const split = rest.indexOf(' b/')
  return split === -1 ? null : [rest.slice(0, split), rest.slice(split + 1)]
}

function closingQuote(text: string): number {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '"') return i
  }
  return -1
}

function headerPath(value: string): string | null {
  // git may append a tab after a name that contains spaces.
  const path = unquote(value.replace(/\t.*$/, ''))
  return path === '/dev/null' ? null : stripPrefix(path)
}

function stripPrefix(path: string): string {
  return path.replace(/^[ab]\//, '')
}

/** Undoes git's C-style quoting (`"a\"b\303\244"`), decoding octal bytes as UTF-8. */
export function unquote(value: string): string {
  if (!(value.startsWith('"') && value.endsWith('"') && value.length >= 2)) return value
  const bytes: number[] = []
  const escapes: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 }
  const encoder = new TextEncoder()
  const inner = value.slice(1, -1)
  for (let i = 0; i < inner.length; i++) {
    const codePoint = inner.codePointAt(i)!
    if (codePoint !== 92) {
      bytes.push(...encoder.encode(String.fromCodePoint(codePoint)))
      if (codePoint > 0xffff) i++
      continue
    }
    const next = inner[i + 1] ?? ''
    const octal = /^[0-7]{1,3}/.exec(inner.slice(i + 1))
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      i += octal[0].length
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0))
      i++
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}
