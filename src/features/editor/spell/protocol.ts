// Messages between the editor and the spelling worker, and the worker's
// logic as a plain function (so it can be tested with a fake speller).

import { isCorrectWord, personalKey, suggestionsFor, type SpellLanguage, type SpellerLike } from './turkish'

export type { SpellLanguage } from './turkish'

export type SpellRequest =
  /** Selects the language (its dictionary is loaded the first time) and the personal words. */
  | { type: 'init'; language: SpellLanguage; personal: readonly string[] }
  | { type: 'check'; id: number; words: readonly string[] }
  | { type: 'suggest'; id: number; word: string }
  | { type: 'personal'; words: readonly string[] }

export type SpellResponse =
  | { type: 'ready'; language?: SpellLanguage }
  | { type: 'error'; message: string }
  | { type: 'checked'; id: number; misspelled: string[] }
  | { type: 'suggestions'; id: number; word: string; suggestions: string[] }

export interface Speller extends SpellerLike {
  add(word: string): unknown
}

/**
 * The worker's message handler. `load` builds the speller for a language
 * (in the worker: nspell with that language's Hunspell dictionary). Each
 * dictionary is loaded only when a language first needs it and kept for
 * later switches; requests that arrive while it loads wait for it. Returns
 * a function to call with each request.
 */
export function createSpellService(
  load: (language: SpellLanguage) => Promise<Speller>,
  post: (response: SpellResponse) => void,
): (request: SpellRequest) => Promise<void> {
  const loaded = new Map<SpellLanguage, Promise<Speller>>()
  const added = new WeakMap<Speller, Set<string>>()
  let current: { language: SpellLanguage; speller: Promise<Speller> } | null = null
  let personalWords: readonly string[] = []

  /** Personal words count as correct and are offered as suggestions. */
  const applyPersonal = (instance: Speller) => {
    const seen = added.get(instance) ?? new Set<string>()
    added.set(instance, seen)
    for (const word of personalWords) {
      if (seen.has(word)) continue
      seen.add(word)
      instance.add(word)
    }
  }
  const personalSet = (language: SpellLanguage) => new Set(personalWords.map((w) => personalKey(w, language)))

  return async (request) => {
    try {
      if (request.type === 'init') {
        personalWords = request.personal
        let speller = loaded.get(request.language)
        if (!speller) {
          speller = load(request.language)
          loaded.set(request.language, speller)
          speller.catch(() => loaded.delete(request.language))
        }
        current = { language: request.language, speller }
        applyPersonal(await speller)
        post({ type: 'ready', language: request.language })
        return
      }
      if (!current) throw new Error('Spellchecker used before init')
      const { language } = current
      const instance = await current.speller
      if (request.type === 'personal') {
        personalWords = request.words
        applyPersonal(instance)
      } else if (request.type === 'check') {
        const personal = personalSet(language)
        post({ type: 'checked', id: request.id, misspelled: request.words.filter((word) => !isCorrectWord(instance, personal, word, language)) })
      } else if (request.type === 'suggest') {
        post({ type: 'suggestions', id: request.id, word: request.word, suggestions: suggestionsFor(instance, request.word, 8, language) })
      }
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      if (request.type === 'check') post({ type: 'checked', id: request.id, misspelled: [] })
      if (request.type === 'suggest') post({ type: 'suggestions', id: request.id, word: request.word, suggestions: [] })
    }
  }
}
