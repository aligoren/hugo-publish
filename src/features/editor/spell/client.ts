// The editor side of the spelling worker: request/response matching and a
// per-word result cache, so only new words go to the worker.

import { personalKey } from './turkish'
import type { SpellLanguage, SpellRequest, SpellResponse } from './protocol'

/** What the client needs from a Worker (a fake in tests). */
export interface SpellWorkerLike {
  postMessage(message: SpellRequest): void
  addEventListener(type: 'message', listener: (event: MessageEvent<SpellResponse>) => void): void
  terminate(): void
}

/** The real worker (bundled by Vite as a module worker). */
export function createSpellWorker(): SpellWorkerLike {
  return new Worker(new URL('./spell.worker.ts', import.meta.url), { type: 'module' }) as unknown as SpellWorkerLike
}

export type SpellStatus = 'loading' | 'ready' | 'error'

export class SpellClient {
  status: SpellStatus = 'loading'
  language: SpellLanguage
  private readonly worker: SpellWorkerLike
  /** word → spelled correctly */
  private readonly cache = new Map<string, boolean>()
  private readonly waiting = new Map<number, (response: SpellResponse) => void>()
  private readonly listeners = new Set<() => void>()
  private personal: string[]
  private nextId = 0
  private destroyed = false

  constructor(language: SpellLanguage, personal: readonly string[] = [], createWorker: () => SpellWorkerLike = createSpellWorker) {
    this.language = language
    this.personal = [...personal]
    this.worker = createWorker()
    this.worker.addEventListener('message', (event) => this.receive(event.data))
    this.worker.postMessage({ type: 'init', language, personal: this.personal })
  }

  private receive(response: SpellResponse): void {
    if (response.type === 'ready') {
      this.status = 'ready'
      this.notify()
    } else if (response.type === 'error') {
      if (this.status === 'loading') this.status = 'error'
    } else {
      const resolve = this.waiting.get(response.id)
      this.waiting.delete(response.id)
      resolve?.(response)
    }
  }

  private request<T extends SpellResponse>(message: SpellRequest & { id: number }): Promise<T> {
    if (this.destroyed) return Promise.reject(new Error('Spellchecker closed'))
    return new Promise<T>((resolve) => {
      this.waiting.set(message.id, resolve as (response: SpellResponse) => void)
      this.worker.postMessage(message)
    })
  }

  /** Called when results may have changed (dictionary ready, personal words changed). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /** true / false once checked, undefined while unknown. */
  isMisspelled(word: string): boolean | undefined {
    const correct = this.cache.get(word)
    return correct === undefined ? undefined : !correct
  }

  /** Checks the words not checked yet; resolves when their results are cached. */
  async check(words: Iterable<string>): Promise<void> {
    const unknown = [...new Set(words)].filter((word) => !this.cache.has(word))
    if (unknown.length === 0 || this.destroyed) return
    const language = this.language
    const response = await this.request<Extract<SpellResponse, { type: 'checked' }>>({ type: 'check', id: ++this.nextId, words: unknown })
    if (language !== this.language) return // answered for the previous language
    const misspelled = new Set(response.misspelled)
    for (const word of unknown) this.cache.set(word, !misspelled.has(word))
  }

  async suggest(word: string): Promise<string[]> {
    if (this.destroyed) return []
    const response = await this.request<Extract<SpellResponse, { type: 'suggestions' }>>({ type: 'suggest', id: ++this.nextId, word })
    return response.suggestions
  }

  /** Replaces the personal word list; affected results are checked again. */
  setPersonal(words: readonly string[]): void {
    const same = words.length === this.personal.length && words.every((w, i) => w === this.personal[i])
    if (same || this.destroyed) return
    const oldKeys = new Set(this.personal.map((w) => personalKey(w, this.language)))
    this.personal = [...words]
    this.worker.postMessage({ type: 'personal', words: this.personal })
    const keys = new Set(this.personal.map((w) => personalKey(w, this.language)))
    for (const [word, correct] of this.cache) {
      // New personal words (also as the stem of `Hugo'nun`) are correct now; words that only
      // a removed personal word made correct are checked again.
      const key = personalKey(word, this.language)
      const stem = key.split("'")[0]
      if (!correct && (keys.has(key) || keys.has(stem))) this.cache.set(word, true)
      else if (correct && (oldKeys.has(key) || oldKeys.has(stem)) && !keys.has(key) && !keys.has(stem)) this.cache.delete(word)
    }
    this.notify()
  }

  /**
   * Switches the language in the same worker (its dictionary is loaded the
   * first time it is needed); cached results are dropped.
   */
  setLanguage(language: SpellLanguage): void {
    if (language === this.language || this.destroyed) return
    this.language = language
    this.status = 'loading'
    this.cache.clear()
    this.worker.postMessage({ type: 'init', language, personal: this.personal })
    this.notify()
  }

  /** Accepts a word from now on (the host persists it through `onAddWord`). */
  addWord(word: string): void {
    if (!this.personal.includes(word)) this.setPersonal([...this.personal, word])
  }

  destroy(): void {
    this.destroyed = true
    this.listeners.clear()
    this.worker.terminate()
    for (const resolve of this.waiting.values()) resolve({ type: 'checked', id: -1, misspelled: [] })
    this.waiting.clear()
  }
}
