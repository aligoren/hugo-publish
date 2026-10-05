// Pre-publish checks for one content file. Pure and synchronous: callers pass in everything
// (the archetype text, whether the site uses descriptions), so the same rules run in the editor,
// the Publish view and the site health view.

import { splitFrontMatter } from '../../lib/frontmatter'
import { parseDocument } from './fields'

export type CheckSeverity = 'error' | 'warn' | 'info'

export interface CheckIssue {
  /** Stable rule id, e.g. 'description-empty', 'archetype-leftover'. */
  rule: string
  severity: CheckSeverity
  /** i18n key inside the `checks` namespace; render with t(`checks.${messageKey}`, params). */
  messageKey: string
  params?: Record<string, string | number>
  /** 1-based line in the whole file, when the issue points at a line. */
  line?: number
}

export interface CheckInput {
  path: string
  /** Whole file text (front matter + body), CRLF allowed. */
  text: string
  /** Text of the archetype this file was created from, when known. */
  archetypeText?: string | null
  /**
   * Most posts of the site have a description, so a missing one is worth a warning.
   * (A description key in the archetype counts the same.)
   */
  siteUsesDescription?: boolean
  /**
   * `markup.goldmark.renderer.unsafe` of the site: when false, Hugo drops raw HTML in Markdown
   * (`<br>`, `<div dir="rtl">`…). Unknown (undefined) skips the check.
   */
  rawHtmlAllowed?: boolean
}

/** Search engines cut descriptions at roughly this length. */
export const DESCRIPTION_MAX = 160
/** At most this many issues per rule that points at lines, so one bad habit does not flood the list. */
const MAX_PER_RULE = 10

const SEVERITY_ORDER: Record<CheckSeverity, number> = { error: 0, warn: 1, info: 2 }

export function runChecks(input: CheckInput): CheckIssue[] {
  const issues: CheckIssue[] = []
  const add = (issue: CheckIssue) => {
    if (issue.line !== undefined && issues.filter((i) => i.rule === issue.rule).length >= MAX_PER_RULE) return
    issues.push(issue)
  }
  const doc = parseDocument(input.text)
  const isList = /(^|\/)_index\.[^/]+$/.test(input.path)
  const archetype = input.archetypeText ? archetypeInfo(input.archetypeText) : null

  if (doc.error !== null) {
    add({ rule: 'front-matter-invalid', severity: 'error', messageKey: 'rules.frontMatterInvalid', params: { detail: doc.error } })
  } else {
    const fields = doc.fields ?? {}
    const title = fields.title
    if (typeof title !== 'string' || title.trim() === '') {
      // A list page (`_index.md`) without a title gets one from Hugo, so it is only a hint there.
      add({ rule: 'title-missing', severity: isList ? 'info' : 'error', messageKey: 'rules.titleMissing' })
    }

    const hasDescriptionKey = Object.hasOwn(fields, 'description')
    const description = fields.description
    const expectsDescription =
      hasDescriptionKey || input.siteUsesDescription === true || (archetype?.keys.has('description') ?? false)
    if (expectsDescription && (typeof description !== 'string' || description.trim() === '')) {
      add({ rule: 'description-empty', severity: 'warn', messageKey: 'rules.descriptionEmpty' })
    } else if (typeof description === 'string' && [...description.trim()].length > DESCRIPTION_MAX) {
      add({
        rule: 'description-long',
        severity: 'warn',
        messageKey: 'rules.descriptionLong',
        params: { count: [...description.trim()].length, max: DESCRIPTION_MAX },
      })
    }

    if (fields.draft === true || fields.draft === 'true') {
      add({ rule: 'draft', severity: 'info', messageKey: 'rules.draft' })
    }

    if (archetype) {
      for (const key of ['title', 'description', 'summary']) {
        const value = fields[key]
        const template = archetype.values.get(key)
        if (typeof value === 'string' && template !== undefined && value.trim() === template) {
          add({
            rule: 'archetype-leftover',
            severity: 'warn',
            messageKey: 'rules.archetypeLeftoverField',
            params: { field: key, text: template },
          })
        }
      }
    }
  }

  checkBody(doc.parts.body, doc.bodyLine, { isList, archetype, rawHtmlAllowed: input.rawHtmlAllowed }, add)

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.line ?? 0) - (b.line ?? 0))
}

interface BodyOptions {
  isList: boolean
  archetype: ArchetypeInfo | null
  rawHtmlAllowed?: boolean
}

/** An HTML tag (not an autolink like `<https://…>`, a comment or a shortcode delimiter). */
const RAW_HTML_TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])[^>]*>/

function checkBody(body: string, firstLine: number, options: BodyOptions, add: (issue: CheckIssue) => void) {
  const lines = body.split('\n').map((line) => line.replace(/\r$/, ''))

  const visible = body.replace(/<!--[\s\S]*?-->/g, '').trim()
  if (visible === '' && !options.isList) {
    add({ rule: 'body-empty', severity: 'warn', messageKey: 'rules.bodyEmpty' })
    return
  }

  let fence: string | null = null
  let seenH1 = false
  lines.forEach((raw, index) => {
    const line = firstLine + index
    const trimmed = raw.trim()

    // Archetype text left as it was. Code blocks count too: an untouched example is still a leftover.
    if (options.archetype && matchesArchetype(normalizeLine(trimmed), options.archetype)) {
      add({ rule: 'archetype-leftover', severity: 'warn', messageKey: 'rules.archetypeLeftover', params: { text: excerpt(trimmed) }, line })
    }

    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = null
      return
    }
    if (fence !== null) return
    const prose = raw.replace(/(`+)[^`]*?\1/g, '')

    for (const placeholder of findPlaceholders(prose)) {
      add({ rule: 'placeholder', severity: 'warn', messageKey: 'rules.placeholder', params: { text: excerpt(placeholder) }, line })
    }
    if (/!\[\s*\]\(/.test(prose) || /<img\b(?![^>]*\balt\s*=\s*["']?[^"'\s>])[^>]*>/i.test(prose) || figureWithoutAlt(prose)) {
      add({ rule: 'image-alt', severity: 'warn', messageKey: 'rules.imageAlt', line })
    }
    if (options.rawHtmlAllowed === false) {
      const tag = RAW_HTML_TAG.exec(prose.replace(/\{\{[<%][\s\S]*?[%>]\}\}/g, ''))
      if (tag) add({ rule: 'raw-html', severity: 'warn', messageKey: 'rules.rawHtml', params: { tag: tag[1].toLowerCase() }, line })
    }
    if (!seenH1 && /^#\s+\S/.test(prose)) {
      seenH1 = true
      add({ rule: 'body-h1', severity: 'info', messageKey: 'rules.bodyH1', line })
    }
  })
}

function figureWithoutAlt(line: string): boolean {
  const match = /\{\{[<%]\s*figure\b([^}]*)[>%]\}\}/.exec(line)
  return match !== null && !/\balt\s*=\s*["'`]?[^"'`\s]/.test(match[1])
}

const PLACEHOLDER_WORDS = [
  'buraya',
  'burada',
  'yazılacak',
  'eklenecek',
  'doldurulacak',
  'doldur',
  'todo',
  'tbd',
  'tk',
  'fixme',
  'xxx',
  'placeholder',
  'insert',
  'here',
  'lorem',
]

/** `[TODO]`, `[buraya … yaz]`, a standalone `TK` or `TODO`, `lorem ipsum`. */
export function findPlaceholders(line: string): string[] {
  const found: string[] = []
  // Bracketed text that is not a link, footnote, task box or alert marker.
  for (const match of line.matchAll(/(?<![!\]\\])\[([^\]\n]{1,100})\](?![([:])/g)) {
    const inner = match[1].trim()
    if (inner === '' || /^[!^]/.test(inner) || inner === 'x' || inner === 'X') continue
    // Both casings: Turkish lowercases `I` to `ı`, English to `i` ("Insert", "IŞIK").
    const words = [inner.toLocaleLowerCase('tr'), inner.toLowerCase()].flatMap((s) => s.split(/[^\p{L}\p{N}]+/u))
    if (words.some((w) => PLACEHOLDER_WORDS.includes(w))) found.push(match[0])
  }
  // Link targets, URLs and bracketed text (handled above) are not prose.
  const outside = line
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[[^\]\n]*\]/g, ' ')
  for (const match of outside.matchAll(/\b(TODO|FIXME|TBD|TK)\b(?!\s*\d)/g)) found.push(match[0])
  for (const match of outside.matchAll(/\blorem ipsum\b/gi)) found.push(match[0])
  return found
}

function excerpt(text: string): string {
  const chars = [...text]
  return chars.length > 80 ? chars.slice(0, 77).join('') + '…' : text
}

// ---------------------------------------------------------------------------
// Archetypes

interface ArchetypeInfo {
  /** Front matter keys of the archetype. */
  keys: Set<string>
  /** Literal (non-template) front matter string values. */
  values: Map<string, string>
  /** Body lines worth recognizing, normalized. */
  lines: Set<string>
  /** Body lines with template actions (`{{ .Name }}`), as patterns. */
  patterns: RegExp[]
}

const infoCache = new Map<string, ArchetypeInfo>()

function archetypeInfo(text: string): ArchetypeInfo {
  const cached = infoCache.get(text)
  if (cached) return cached
  const parts = splitFrontMatter(text)
  const keys = new Set<string>()
  const values = new Map<string, string>()
  for (const raw of parts.frontMatterText.split('\n')) {
    const match = /^([A-Za-z_][\w-]*)\s*[:=]\s*(.*?)\s*$/.exec(raw.replace(/\r$/, ''))
    if (!match) continue
    keys.add(match[1])
    const value = unquote(match[2])
    if (value !== '' && !value.includes('{{')) values.set(match[1], value)
  }
  const lines = new Set<string>()
  const patterns: RegExp[] = []
  for (const raw of parts.body.split('\n')) {
    const line = normalizeLine(raw)
    if (line.includes('{{')) {
      const pattern = templatePattern(line)
      if (pattern) patterns.push(pattern)
    } else if (!isTrivialLine(line)) {
      lines.add(line)
    }
  }
  const info = { keys, values, lines, patterns }
  if (infoCache.size > 50) infoCache.clear()
  infoCache.set(text, info)
  return info
}

function matchesArchetype(line: string, info: ArchetypeInfo): boolean {
  if (line === '') return false
  return info.lines.has(line) || info.patterns.some((p) => p.test(line))
}

function unquote(value: string): string {
  const match = /^(["'])(.*)\1$/.exec(value)
  return match ? match[2] : value
}

function normalizeLine(line: string): string {
  return line.replace(/\r$/, '').trim().replace(/\s+/g, ' ')
}

/** Lines too generic to call leftovers: headings, rules, fences, lone tags, shortcodes, short text. */
export function isTrivialLine(line: string): boolean {
  if (line === '') return true
  if (/^#{1,6}(\s|$)/.test(line)) return true
  if (/^(`{3,}|~{3,})/.test(line)) return true
  if (/^([-*_])(\s*\1){2,}$/.test(line)) return true
  if (/^\|?[\s:|-]+\|?$/.test(line)) return true
  if (/^<\/?[a-z][^>]*>$/i.test(line) || /^<!--.*-->$/.test(line)) return true
  if (/^\{\{[<%].*[%>]\}\}$/.test(line)) return true
  if (/^>\s*\[![A-Za-z]+\]/.test(line)) return true
  return line.replace(/[^\p{L}\p{N}]/gu, '').length < 10
}

/** A template line becomes a pattern where every `{{ … }}` matches any text. */
function templatePattern(line: string): RegExp | null {
  const literals = line.split(/\{\{.*?\}\}/)
  const letters = literals.join('').replace(/[^\p{L}\p{N}]/gu, '').length
  if (letters < 10 || isTrivialLine(literals.join(' ').trim())) return null
  const source = literals.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${source}$`, 'u')
}

/**
 * Picks the archetype text for a content path: the archetype named like the file's section
 * (`content/posts/x.md` → `posts`), else `default`. `null` when neither exists.
 */
export function archetypeFor(path: string, archetypes: { name: string; text: string }[]): string | null {
  const relative = path.replace(/\\/g, '/').replace(/^content\//, '')
  const segments = relative.split('/')
  const section = segments.length > 1 ? segments[0] : ''
  const match = (section && archetypes.find((a) => a.name === section)) || archetypes.find((a) => a.name === 'default')
  return match ? match.text : null
}

/**
 * Like {@link archetypeFor}, but when the text still contains lines of some other archetype
 * (the post was made with an explicit kind), that archetype wins.
 */
export function archetypeForDocument(path: string, text: string, archetypes: { name: string; text: string }[]): string | null {
  const body = splitFrontMatter(text).body.split('\n').map(normalizeLine)
  let best: { text: string; hits: number } | null = null
  for (const archetype of archetypes) {
    const info = archetypeInfo(archetype.text)
    const hits = body.filter((line) => matchesArchetype(line, info)).length
    if (hits > 0 && (best === null || hits > best.hits)) best = { text: archetype.text, hits }
  }
  return best ? best.text : archetypeFor(path, archetypes)
}

// ---------------------------------------------------------------------------
// Summaries

export interface ChecksSummary {
  errors: number
  warnings: number
  infos: number
  /** Files with at least one error or warning. */
  filesWithProblems: number
}

/** Totals over several files, for the Publish view. */
export function summarizeChecks(results: { path: string; issues: CheckIssue[] }[]): ChecksSummary {
  const summary: ChecksSummary = { errors: 0, warnings: 0, infos: 0, filesWithProblems: 0 }
  for (const { issues } of results) {
    let problem = false
    for (const issue of issues) {
      if (issue.severity === 'error') summary.errors++
      else if (issue.severity === 'warn') summary.warnings++
      else summary.infos++
      if (issue.severity !== 'info') problem = true
    }
    if (problem) summary.filesWithProblems++
  }
  return summary
}

/** True when an issue should make the user confirm before publishing. */
export function isProblem(issue: CheckIssue): boolean {
  return issue.severity !== 'info'
}
