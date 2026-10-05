// Which words of a Markdown document to spellcheck. Pure functions: the
// ranges to skip (code, URLs, HTML tags, shortcodes, front matter, link
// destinations…) come from the syntax tree; the tokenizer then picks words
// and drops what is not prose (paths, e-mail addresses, words with digits,
// acronyms, camelCase, Arabic and other non-Latin scripts).

import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { shortcodeField } from '../shortcodes'

export interface SpellWord {
  from: number
  to: number
  word: string
}

export interface Range {
  from: number
  to: number
}

/** Nodes whose whole text is not prose. */
const SKIP_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'URL',
  'Autolink',
  'HTMLTag',
  'Comment',
  'CommentBlock',
  'ProcessingInstruction',
  'ProcessingInstructionBlock',
  'LinkLabel',
  'LinkReference',
  'LinkTitle',
  'CodeInfo',
])

/** Inline patterns that are not words: footnote refs, alert markers, heading ids, entities, tags in HTML blocks. */
const SKIP_PATTERNS = [/\[\^[^\]\s]+\]/g, /\[![A-Za-z]+\][+-]?/g, /\{[#.][^}\n]*\}/g, /&#?\w+;/g, /<\/?[A-Za-z][^>\n]*>/g]

const FRONT_MATTER = /^(?:---[ \t]*\r?\n[\s\S]*?\r?\n---|\+\+\+[ \t]*\r?\n[\s\S]*?\r?\n\+\+\+)[ \t]*(?:\r?\n|$)/

/** Ranges inside `[from, to)` that are not prose, sorted and possibly overlapping. */
export function spellSkipRanges(state: EditorState, from = 0, to = state.doc.length): Range[] {
  const ranges: Range[] = []
  const front = FRONT_MATTER.exec(state.doc.sliceString(0, Math.min(state.doc.length, 64 * 1024)))
  if (front) ranges.push({ from: 0, to: front[0].length })
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (SKIP_NODES.has(node.name)) {
        ranges.push({ from: node.from, to: node.to })
        return false
      }
      return true
    },
  })
  for (const token of state.field(shortcodeField, false) ?? []) {
    if (token.to >= from && token.from <= to) ranges.push({ from: token.from, to: token.to })
  }
  const text = state.doc.sliceString(from, to)
  for (const pattern of SKIP_PATTERNS) {
    for (const match of text.matchAll(pattern)) ranges.push({ from: from + match.index, to: from + match.index + match[0].length })
  }
  return ranges.sort((a, b) => a.from - b.from)
}

/** `text` with the skipped ranges blanked out (same length, so offsets stay valid). */
export function maskRanges(text: string, offset: number, ranges: readonly Range[]): string {
  if (ranges.length === 0) return text
  const chars = text.split('')
  for (const range of ranges) {
    const start = Math.max(0, range.from - offset)
    const end = Math.min(text.length, range.to - offset)
    for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' '
  }
  return chars.join('')
}

const CHUNK = /\S+/g
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu
/** Chunks that are paths, addresses, identifiers or URLs. */
const NOT_PROSE = /:\/\/|^www\.|@|[\\/=_#$%^~|]|\p{L}\.\p{L}/u
const NON_LATIN = /[^\p{Script=Latin}\p{M}'’]/u
const HAS_LOWER_THEN_UPPER = /\p{Ll}\p{Lu}/u

/** Whether a word should be checked at all. */
export function shouldCheckWord(word: string): boolean {
  if ([...word.replace(/['’]/g, '')].length < 2) return false
  if (NON_LATIN.test(word)) return false // Arabic, Hebrew, Greek, Cyrillic, CJK…
  const letters = word.replace(/['’].*$/, '')
  if (letters.length > 1 && letters === letters.toLocaleUpperCase('tr') && letters !== letters.toLocaleLowerCase('tr')) return false // acronym
  if (HAS_LOWER_THEN_UPPER.test(word)) return false // camelCase, iPhone, GitHub
  return true
}

/**
 * Words of `text` (whose first character is at document position `offset`)
 * worth checking, outside `skip` ranges. Hyphenated words are checked part
 * by part; words touching digits are skipped.
 */
export function extractWords(text: string, offset = 0, skip: readonly Range[] = []): SpellWord[] {
  const masked = maskRanges(text, offset, skip)
  const words: SpellWord[] = []
  for (const chunk of masked.matchAll(CHUNK)) {
    const value = chunk[0]
    if (NOT_PROSE.test(value)) continue
    for (const match of value.matchAll(WORD)) {
      const start = match.index
      const end = start + match[0].length
      if (/\p{N}/u.test(value[start - 1] ?? '') || /\p{N}/u.test(value[end] ?? '')) continue
      if (!shouldCheckWord(match[0])) continue
      const from = offset + chunk.index + start
      words.push({ from, to: from + match[0].length, word: match[0] })
    }
  }
  return words
}

/** Words to check in a document range (whole lines are read so words are not cut). */
export function wordsInRange(state: EditorState, from: number, to: number): SpellWord[] {
  const start = state.doc.lineAt(from).from
  const end = state.doc.lineAt(to).to
  return extractWords(state.doc.sliceString(start, end), start, spellSkipRanges(state, start, end))
}

export * from './turkish'
