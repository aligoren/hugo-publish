// Line ending and byte order mark helpers.
//
// The app must write back exactly the bytes it read, so the file's line
// ending style and BOM are detected once on open and restored on save.

/** Line ending style of a whole text. `none` means the text has no line break at all. */
export type Eol = 'lf' | 'crlf' | 'mixed' | 'none'

/** A concrete line separator. */
export type LineSeparator = '\n' | '\r\n'

/** The UTF-8 byte order mark as it appears in a decoded JS string. */
export const BOM = '﻿'

export interface EolCounts {
  /** `\n` not preceded by `\r`. */
  lf: number
  /** `\r\n` pairs. */
  crlf: number
  /** `\r` not followed by `\n` (classic Mac); counted so such files are reported as mixed. */
  cr: number
}

export function countLineEndings(text: string): EolCounts {
  const counts: EolCounts = { lf: 0, crlf: 0, cr: 0 }
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        counts.crlf++
        i++
      } else {
        counts.cr++
      }
    } else if (ch === 10) {
      counts.lf++
    }
  }
  return counts
}

/** Detects the line ending style. A text using more than one kind of line break is `mixed`. */
export function detectEol(text: string): Eol {
  const { lf, crlf, cr } = countLineEndings(text)
  const kinds = (lf > 0 ? 1 : 0) + (crlf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0)
  if (kinds === 0) return 'none'
  if (kinds > 1) return 'mixed'
  if (crlf > 0) return 'crlf'
  if (lf > 0) return 'lf'
  return 'mixed' // only lone `\r`: no supported single style
}

/**
 * The line ending a new line should get in this text: the most common one,
 * or `fallback` when the text has no line break. Ties go to LF.
 */
export function dominantEol(text: string, fallback: 'lf' | 'crlf' = 'lf'): 'lf' | 'crlf' {
  const { lf, crlf } = countLineEndings(text)
  if (lf === 0 && crlf === 0) return fallback
  return crlf > lf ? 'crlf' : 'lf'
}

export function eolToSeparator(eol: 'lf' | 'crlf'): LineSeparator {
  return eol === 'crlf' ? '\r\n' : '\n'
}

export function separatorToEol(separator: LineSeparator): 'lf' | 'crlf' {
  return separator === '\r\n' ? 'crlf' : 'lf'
}

/** The separator that new lines in `text` should use (see {@link dominantEol}). */
export function lineSeparatorOf(text: string, fallback: 'lf' | 'crlf' = 'lf'): LineSeparator {
  return eolToSeparator(dominantEol(text, fallback))
}

export function hasBom(text: string): boolean {
  return text.charCodeAt(0) === 0xfeff
}

export function stripBom(text: string): { bom: boolean; text: string } {
  return hasBom(text) ? { bom: true, text: text.slice(1) } : { bom: false, text }
}

export function restoreBom(text: string, bom: boolean): string {
  if (!bom) return text
  return hasBom(text) ? text : BOM + text
}

/** Converts every `\r\n` to `\n`. A lone `\r` is left alone. */
export function toLf(text: string): string {
  return text.indexOf('\r\n') === -1 ? text : text.replace(/\r\n/g, '\n')
}

/**
 * Converts the line breaks of a `\n`-normalized text to `eol`. Existing `\r\n`
 * pairs are not doubled, so this is safe to call on text that is already CRLF.
 */
export function fromLf(text: string, eol: 'lf' | 'crlf' | LineSeparator): string {
  const separator = eol === 'crlf' || eol === '\r\n' ? '\r\n' : '\n'
  if (separator === '\n') return toLf(text)
  return text.replace(/\r?\n/g, '\r\n')
}

export interface LineWithEol {
  /** Line content without its line break. */
  text: string
  /** The line break that ended the line as written; empty for the last line without one. */
  eol: '' | LineSeparator
}

/**
 * Splits text into lines and keeps each line's own line break, so
 * `lines.map(l => l.text + l.eol).join('')` is the input again. Only `\n` and
 * `\r\n` end a line. A text ending with a line break has no empty last entry.
 */
export function splitLinesKeepEol(text: string): LineWithEol[] {
  const lines: LineWithEol[] = []
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    if (nl === -1) {
      lines.push({ text: text.slice(start), eol: '' })
      break
    }
    const crlf = nl > start && text.charCodeAt(nl - 1) === 13
    lines.push({ text: text.slice(start, crlf ? nl - 1 : nl), eol: crlf ? '\r\n' : '\n' })
    start = nl + 1
  }
  return lines
}
