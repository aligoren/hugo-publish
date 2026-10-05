// The site's personal spellcheck dictionary: `.hugo-publisher/dictionary.txt`, one word per
// line. It lives in the site (committed with it), so every computer shares the same words.

import { api, isAppError } from '../../lib/api'
import { lineSeparatorOf } from '../../lib/eol'

export const DICTIONARY_PATH = '.hugo-publisher/dictionary.txt'

/** Words in the file; blank lines and `#` comments are skipped. */
export function parseDictionary(text: string): string[] {
  const words: string[] = []
  const seen = new Set<string>()
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const word = line.trim()
    if (!word || word.startsWith('#') || seen.has(word)) continue
    seen.add(word)
    words.push(word)
  }
  return words
}

/** The file with `word` appended (same line endings; nothing changes when it is already there). */
export function addWordToText(text: string, word: string): string {
  const clean = word.trim()
  if (!clean || parseDictionary(text).includes(clean)) return text
  const sep = lineSeparatorOf(text)
  const needsBreak = text.length > 0 && !text.endsWith('\n')
  return text + (needsBreak ? sep : '') + clean + sep
}

export interface DictionaryFile {
  words: string[]
  text: string
  /** Null when the file does not exist yet. */
  version: string | null
}

export interface DictionaryDeps {
  readText(path: string): Promise<{ text: string; version: string }>
  writeText(path: string, text: string, expectedVersion?: string): Promise<string>
}

export async function readDictionary(deps: DictionaryDeps = api): Promise<DictionaryFile> {
  try {
    const file = await deps.readText(DICTIONARY_PATH)
    return { words: parseDictionary(file.text), text: file.text, version: file.version }
  } catch {
    return { words: [], text: '', version: null }
  }
}

/**
 * Adds a word and writes the file (created on the first word). When another program changed the
 * file in the meantime, it is read again and the word added to that.
 */
export async function addDictionaryWord(current: DictionaryFile, word: string, deps: DictionaryDeps = api): Promise<DictionaryFile> {
  const write = async (base: DictionaryFile): Promise<DictionaryFile> => {
    const text = addWordToText(base.text, word)
    if (text === base.text) return base
    const version = await deps.writeText(DICTIONARY_PATH, text, base.version ?? undefined)
    return { words: parseDictionary(text), text, version }
  }
  try {
    return await write(current)
  } catch (error) {
    if (!isAppError(error) || error.code !== 'conflict') throw error
    return write(await readDictionary(deps))
  }
}
