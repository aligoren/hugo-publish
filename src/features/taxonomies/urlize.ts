// Hugo's term paths, reproduced from `helpers.PathSpec.MakePathSanitized` and `paths.Sanitize`:
//
// 1. Sanitize: letters, digits, marks and `. / \ _ # + ~ - @` (and `%XX` escapes) are kept,
//    every other character is dropped; a run of white space becomes one `-` (never at the start
//    or the end, and not next to an existing `-`).
// 2. `removePathAccents = true`: combining marks are removed after Unicode decomposition
//    (é → e, ş → s, İ → I). The dotless ı has no decomposition and stays ı.
// 3. Unless `disablePathToLower = true`: Go's `strings.ToLower`, which is not Turkish aware
//    (I → i, İ → i).
//
// Hugo groups terms by this value, so `Kitap` and `kitap` end up on the same term page.

export interface PathOptions {
  /** Site config `removePathAccents`. */
  removePathAccents: boolean
  /** Site config `disablePathToLower`. */
  disablePathToLower: boolean
}

export const DEFAULT_PATH_OPTIONS: PathOptions = { removePathAccents: false, disablePathToLower: false }

/** Characters Go's `unicode.IsSpace` accepts. */
const GO_SPACE = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u
/** `unicode.IsLetter`, `unicode.IsDigit` (decimal digits) and `unicode.IsMark`. */
const LETTER_DIGIT_MARK = /^[\p{L}\p{Nd}\p{M}]$/u
const ALLOWED_PUNCTUATION = new Set(['.', '/', '\\', '_', '#', '+', '~', '-', '@'])
const HEX = /^[0-9a-fA-F]$/

function isAllowedPathCharacter(text: string, index: number, ch: string): boolean {
  if (ch === ' ') return false
  if (LETTER_DIGIT_MARK.test(ch) || ALLOWED_PUNCTUATION.has(ch)) return true
  return ch === '%' && HEX.test(text[index + 1] ?? '') && HEX.test(text[index + 2] ?? '')
}

/** Hugo's `paths.Sanitize`. Keeps the casing. */
export function sanitizePath(text: string): string {
  let out = ''
  let prependHyphen = false
  let wasHyphen = false
  let index = 0
  for (const ch of text) {
    if (isAllowedPathCharacter(text, index, ch)) {
      wasHyphen = ch === '-'
      if (prependHyphen) {
        if (!wasHyphen) out += '-'
        prependHyphen = false
      }
      out += ch
    } else if (out.length > 0 && !wasHyphen && GO_SPACE.test(ch)) {
      prependHyphen = true
    }
    index += ch.length
  }
  return out
}

/** Hugo's `text.RemoveAccentsString`: NFD, drop non-spacing marks, NFC. */
export function removeAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC')
}

/** Go's `strings.ToLower`: simple per-character mapping, no locale rules (İ → i, I → i). */
export function goToLower(text: string): string {
  let out = ''
  for (const ch of text) out += ch === 'İ' ? 'i' : ch.toLowerCase()
  return out
}

/**
 * The path segment Hugo uses for a term (and the key it groups terms by), e.g.
 * `Kitap Notları` → `kitap-notları`, or `kitap-notlari` with `removePathAccents`.
 * Not percent-encoded; browsers show it like this.
 */
export function termSegment(term: string, options: PathOptions = DEFAULT_PATH_OPTIONS): string {
  let path = sanitizePath(term)
  if (options.removePathAccents) path = removeAccents(path)
  return options.disablePathToLower ? path : goToLower(path)
}

/** Site-relative URL of a term page, e.g. `/categories/kitap/`. */
export function termUrl(plural: string, term: string, options: PathOptions = DEFAULT_PATH_OPTIONS): string {
  return `/${termSegment(plural, options)}/${termSegment(term, options)}/`
}
