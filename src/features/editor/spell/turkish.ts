// Case-aware spelling helpers, with Turkish dotted/dotless i rules for
// Turkish (no CodeMirror imports: also used in the worker).

/** Languages with a bundled Hunspell dictionary. */
export type SpellLanguage = 'tr' | 'en'

/** Typographic apostrophe → ASCII (the dictionaries use `'`). */
export function normalizeApostrophe(word: string): string {
  return word.replace(/’/g, "'")
}

export function lowerCase(word: string, language: SpellLanguage = 'tr'): string {
  return word.toLocaleLowerCase(language)
}

export function turkishLower(word: string): string {
  return lowerCase(word, 'tr')
}

/** `kitap` → `Kitap`, `ılık` → `Ilık`, `istanbul` → `İstanbul` (Turkish); `word` → `Word` (English). */
export function capitalize(word: string, language: SpellLanguage = 'tr'): string {
  const first = [...word][0] ?? ''
  return first.toLocaleUpperCase(language) + word.slice(first.length)
}

export function turkishCapitalize(word: string): string {
  return capitalize(word, 'tr')
}

/**
 * Spellings to try for a word: as written, then lower case (a capital at the
 * start of a sentence; Turkish: `Işık` → `ışık`), and for Turkish also with a
 * dotted capital İ (an `I` typed on a non-Turkish keyboard: `Istanbul` → `İstanbul`).
 */
export function spellVariants(word: string, language: SpellLanguage = 'tr'): string[] {
  const normalized = normalizeApostrophe(word)
  const variants = [normalized, lowerCase(normalized, language)]
  if (language === 'tr' && normalized.startsWith('I')) variants.push('İ' + normalized.slice(1))
  return [...new Set(variants)]
}

/** The key personal words are compared by. */
export function personalKey(word: string, language: SpellLanguage = 'tr'): string {
  return lowerCase(normalizeApostrophe(word), language)
}

export interface SpellerLike {
  correct(word: string): boolean
  suggest(word: string): string[]
}

/**
 * Whether a word is spelled correctly: any of its {@link spellVariants} is
 * in the dictionary or the personal list; for `Hugo'nun` / `Hugo's` it is
 * enough that the part before the apostrophe is (proper noun plus suffix).
 */
export function isCorrectWord(speller: SpellerLike, personal: ReadonlySet<string>, word: string, language: SpellLanguage = 'tr'): boolean {
  if (personal.has(personalKey(word, language))) return true
  if (spellVariants(word, language).some((variant) => speller.correct(variant))) return true
  const apostrophe = normalizeApostrophe(word).indexOf("'")
  if (apostrophe > 0) {
    const stem = word.slice(0, apostrophe)
    if (personal.has(personalKey(stem, language)) || spellVariants(stem, language).some((variant) => speller.correct(variant))) return true
  }
  return false
}

/** Suggestions in the word's own capitalization and apostrophe style. */
export function suggestionsFor(speller: SpellerLike, word: string, limit = 8, language: SpellLanguage = 'tr'): string[] {
  const normalized = normalizeApostrophe(word)
  const lower = lowerCase(normalized, language)
  const capitalized = normalized !== lower && capitalize(lower, language) === normalized
  const raw = [...speller.suggest(normalized), ...(lower !== normalized ? speller.suggest(lower) : [])]
  const result: string[] = []
  for (const suggestion of raw) {
    let value = capitalized ? capitalize(suggestion, language) : suggestion
    if (word.includes('’')) value = value.replace(/'/g, '’')
    if (value !== word && !result.includes(value)) result.push(value)
  }
  return result.slice(0, limit)
}
