// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorState } from '../setup'
import { stateFor } from '../testing/harness'
import { SpellClient, type SpellWorkerLike } from './client'
import { misspelledWordAt, openSpellMenu, spellMenuField } from './extension'
import { createSpellService, type SpellRequest, type SpellResponse, type Speller } from './protocol'
import { extractWords, isCorrectWord, shouldCheckWord, spellVariants, suggestionsFor, wordsInRange } from './tokenize'

/** A tiny Turkish "dictionary": exact forms only, like Hunspell without affixes. */
function fakeSpeller(words: string[]): Speller & { added: string[] } {
  const known = new Set(words)
  const added: string[] = []
  return {
    added,
    correct: (word) => known.has(word),
    suggest: (word) => [...known].filter((k) => k.length === word.length && [...k].filter((ch, i) => ch !== word[i]).length === 1),
    add(word) {
      added.push(word)
      known.add(word)
    },
  }
}

const DICT = ['kitap', 'ışık', 'İstanbul', "İstanbul'un", 'güzel', 'bir', 'gün', 've', 'metin']

const words = (marked: string) => {
  const state = stateFor(marked)
  return wordsInRange(state, 0, state.doc.length).map((w) => w.word)
}

describe('which words are checked', () => {
  it('skips code, URLs, HTML tags, shortcodes, link targets and footnote/alert markers', () => {
    const doc = [
      'Güzel `kodd` [bağlantı](https://ornk.com/yol "Başlıkk") <span class="sınıff">metin</span>',
      '{{< figure caption="yazımm" >}} {{% notee %}}',
      '> [!NOTE]',
      'Dipnot[^nott] ve <https://otomatk.com> www.siteee.com eposta@adress.com',
      '```go',
      'kodd := 1',
      '```',
      '[reff]: /yoll',
      'Başlık {#kimlikk}',
    ].join('\n')
    expect(words(doc + '|')).toEqual(['Güzel', 'bağlantı', 'metin', 'Dipnot', 've', 'Başlık'])
  })

  it('skips front matter, words with digits, acronyms, camelCase and non-Latin scripts', () => {
    expect(words('---\ntitle: Başlıkk\n---\nMetin 3D h2o HTML GitHub iPhone السلام שלום Привет α ok|')).toEqual(['Metin', 'ok'])
  })

  it('splits hyphenated words, keeps apostrophes, skips paths and identifiers', () => {
    expect(extractWords("Türk-İslam İstanbul'un İstanbul’da hugo.toml dosya_adi C:\\Yol a/b x=y #etiket")).toEqual([
      { from: 0, to: 4, word: 'Türk' },
      { from: 5, to: 10, word: 'İslam' },
      { from: 11, to: 22, word: "İstanbul'un" },
      { from: 23, to: 34, word: 'İstanbul’da' },
    ])
    expect(shouldCheckWord('a')).toBe(false)
    expect(shouldCheckWord('ŞEHİR')).toBe(false)
    expect(shouldCheckWord('Şehir')).toBe(true)
  })
})

describe('Turkish-aware checking', () => {
  const speller = fakeSpeller(DICT)

  it('tries Turkish lower case and a dotted İ', () => {
    expect(spellVariants('Işık')).toEqual(['Işık', 'ışık', 'İşık'])
    expect(spellVariants('Istanbul')).toEqual(['Istanbul', 'ıstanbul', 'İstanbul'])
    expect(spellVariants('İstanbul’un')).toEqual(["İstanbul'un", "istanbul'un"])
    expect(isCorrectWord(speller, new Set(), 'Işık')).toBe(true) // JS toLowerCase would give "işık"
    expect(isCorrectWord(speller, new Set(), 'Kitap')).toBe(true)
    expect(isCorrectWord(speller, new Set(), 'Istanbul')).toBe(true)
    expect(isCorrectWord(speller, new Set(), 'İstanbul’un')).toBe(true)
    expect(isCorrectWord(speller, new Set(), 'ktiap')).toBe(false)
  })

  it('accepts personal words case-insensitively, also as the stem before an apostrophe', () => {
    const personal = new Set(['hugo'])
    expect(isCorrectWord(speller, personal, 'Hugo')).toBe(true)
    expect(isCorrectWord(speller, personal, 'Hugo’nun')).toBe(true)
    expect(isCorrectWord(speller, new Set(), 'Hugo’nun')).toBe(false)
  })

  it('keeps the capital and apostrophe style in suggestions', () => {
    expect(suggestionsFor(speller, 'kitab')).toEqual(['kitap'])
    expect(suggestionsFor(speller, 'Kitab')).toEqual(['Kitap'])
    expect(suggestionsFor(fakeSpeller(["İstanbul'un"]), 'İstanbul’an')).toEqual(['İstanbul’un'])
  })
})

describe('worker protocol', () => {
  it('loads once, queues requests until ready and answers them', async () => {
    const posted: SpellResponse[] = []
    const speller = fakeSpeller(DICT)
    let release!: () => void
    const loaded = new Promise<void>((resolve) => (release = resolve))
    const handle = createSpellService(async (language) => {
      expect(language).toBe('tr')
      await loaded
      return speller
    }, (response) => posted.push(response))
    const init = handle({ type: 'init', language: 'tr', personal: ['Hugo'] })
    const check = handle({ type: 'check', id: 1, words: ['kitap', 'ktiap', 'Hugo’nun'] })
    expect(posted).toEqual([])
    release()
    await Promise.all([init, check])
    await handle({ type: 'suggest', id: 2, word: 'kitab' })
    await handle({ type: 'personal', words: ['Hugo', 'ktiap'] })
    await handle({ type: 'check', id: 3, words: ['ktiap'] })
    expect(posted).toEqual([
      { type: 'ready', language: 'tr' },
      { type: 'checked', id: 1, misspelled: ['ktiap'] },
      { type: 'suggestions', id: 2, word: 'kitab', suggestions: ['kitap'] },
      { type: 'checked', id: 3, misspelled: [] },
    ])
    expect(speller.added).toEqual(['Hugo', 'ktiap'])
  })

  it('answers with empty results when loading fails', async () => {
    const posted: SpellResponse[] = []
    const handle = createSpellService(() => Promise.reject(new Error('no dictionary')), (response) => posted.push(response))
    await handle({ type: 'init', language: 'tr', personal: [] })
    await handle({ type: 'check', id: 1, words: ['a'] })
    expect(posted).toEqual([
      { type: 'error', message: 'no dictionary' },
      { type: 'error', message: 'no dictionary' },
      { type: 'checked', id: 1, misspelled: [] },
    ])
  })
})

/** A fake Worker running the real service in the same thread. */
function fakeWorker(speller: Speller, log: SpellRequest[] = []): () => SpellWorkerLike {
  return () => {
    const listeners: ((event: MessageEvent<SpellResponse>) => void)[] = []
    const handle = createSpellService(async () => speller, (response) => {
      queueMicrotask(() => listeners.forEach((l) => l({ data: response } as MessageEvent<SpellResponse>)))
    })
    return {
      postMessage(message) {
        log.push(message)
        void handle(message)
      },
      addEventListener: (_type, listener) => void listeners.push(listener),
      terminate() {},
    }
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('SpellClient', () => {
  it('sends only unknown words and caches the results', async () => {
    const log: SpellRequest[] = []
    const client = new SpellClient('tr', [], fakeWorker(fakeSpeller(DICT), log))
    await client.check(['kitap', 'ktiap'])
    await client.check(['kitap', 'ktiap', 'güzel'])
    expect(log.filter((m) => m.type === 'check').map((m) => (m as { words: readonly string[] }).words)).toEqual([['kitap', 'ktiap'], ['güzel']])
    expect(client.isMisspelled('ktiap')).toBe(true)
    expect(client.isMisspelled('kitap')).toBe(false)
    expect(client.isMisspelled('yeni')).toBe(undefined)
    expect(await client.suggest('kitab')).toEqual(['kitap'])
    await flush()
    expect(client.status).toBe('ready')
  })

  it('updates cached results when personal words change', async () => {
    const client = new SpellClient('tr', [], fakeWorker(fakeSpeller(DICT)))
    let notified = 0
    client.subscribe(() => notified++)
    await client.check(['Hugo', 'Hugo’nun'])
    expect(client.isMisspelled('Hugo’nun')).toBe(true)
    client.addWord('Hugo')
    expect(client.isMisspelled('Hugo')).toBe(false)
    expect(client.isMisspelled('Hugo’nun')).toBe(false)
    client.setPersonal([])
    expect(client.isMisspelled('Hugo')).toBe(undefined)
    expect(notified).toBeGreaterThanOrEqual(2)
    client.destroy()
    await expect(client.check(['x'])).resolves.toBeUndefined()
  })
})

describe('spellcheck in the editor', () => {
  const views: EditorView[] = []
  afterEach(() => views.splice(0).forEach((v) => v.destroy()))

  async function mount(doc: string, added: string[] = []) {
    const client = new SpellClient('tr', [], fakeWorker(fakeSpeller(DICT)))
    const view = new EditorView({
      state: createEditorState(doc, { spellcheck: { client, onAddWord: (w) => added.push(w) } }),
      parent: document.body,
    })
    views.push(view)
    await flush()
    return { view, client }
  }

  it('underlines misspelled words and turns off the browser checker', async () => {
    const { view } = await mount('Bir güzl gün ve `kodd`.')
    const marked = [...view.contentDOM.querySelectorAll('.cm-spell-error')].map((e) => e.textContent)
    expect(marked).toEqual(['güzl'])
    expect(view.contentDOM.getAttribute('spellcheck')).toBe('false')
  })

  it('replaces a word from the suggestions menu', async () => {
    const { view } = await mount('Bir güzal gün.')
    view.dispatch({ selection: EditorSelection.cursor(6) })
    expect(misspelledWordAt(view.state, 6)?.word).toBe('güzal')
    expect(openSpellMenu(view)).toBe(true)
    await flush()
    const menu = view.dom.querySelector('.cm-spell-menu')!
    const buttons = [...menu.querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['güzel', 'Add to dictionary'])
    expect(document.activeElement).toBe(buttons[0])
    buttons[0].click()
    expect(view.state.sliceDoc()).toBe('Bir güzel gün.')
    expect(view.state.field(spellMenuField)).toBe(null)
  })

  it('adds a word to the dictionary', async () => {
    const added: string[] = []
    const { view, client } = await mount('Hugo’nun metin.', added)
    expect(view.contentDOM.querySelectorAll('.cm-spell-error')).toHaveLength(1)
    view.dispatch({ selection: EditorSelection.cursor(2) })
    openSpellMenu(view)
    await flush()
    const add = view.dom.querySelector<HTMLButtonElement>('.cm-spell-add')!
    add.click()
    await flush()
    expect(added).toEqual(['Hugo’nun'])
    expect(client.isMisspelled('Hugo’nun')).toBe(false)
    expect(view.contentDOM.querySelectorAll('.cm-spell-error')).toHaveLength(0)
  })

  it('uses the browser checker for English', () => {
    const view = new EditorView({ state: createEditorState('x', { spellcheck: { native: 'en' } }), parent: document.body })
    views.push(view)
    expect(view.contentDOM.getAttribute('spellcheck')).toBe('true')
    expect(view.contentDOM.getAttribute('lang')).toBe('en')
  })
})

describe('English', () => {
  const en = fakeSpeller(['internet', 'word', 'Hugo', 'colour', 'color', "don't"])

  it('lower-cases the English way (no Turkish dotless i)', () => {
    expect(spellVariants('Internet', 'en')).toEqual(['Internet', 'internet'])
    expect(isCorrectWord(en, new Set(), 'Internet', 'en')).toBe(true)
    expect(isCorrectWord(en, new Set(), 'Internet', 'tr')).toBe(false) // Turkish: I → ı
    expect(isCorrectWord(en, new Set(), 'Hugo’s', 'en')).toBe(true)
    expect(isCorrectWord(en, new Set(['blog']), 'Blog', 'en')).toBe(true)
    expect(suggestionsFor(en, 'Wurd', 8, 'en')).toEqual(['Word'])
  })

  it('loads each dictionary lazily, once, and switches language in the same worker', async () => {
    const loads: string[] = []
    const posted: SpellResponse[] = []
    const handle = createSpellService(async (language) => {
      loads.push(language)
      return language === 'en' ? fakeSpeller(['word']) : fakeSpeller(DICT)
    }, (response) => posted.push(response))
    await handle({ type: 'init', language: 'en', personal: ['Hugo'] })
    await handle({ type: 'check', id: 1, words: ['word', 'kitap', 'Hugo'] })
    await handle({ type: 'init', language: 'tr', personal: ['Hugo'] })
    await handle({ type: 'check', id: 2, words: ['word', 'kitap', 'Hugo'] })
    await handle({ type: 'init', language: 'en', personal: ['Hugo'] })
    expect(loads).toEqual(['en', 'tr'])
    expect(posted.filter((p) => p.type === 'checked')).toEqual([
      { type: 'checked', id: 1, misspelled: ['kitap'] },
      { type: 'checked', id: 2, misspelled: ['word'] },
    ])
  })

  it('SpellClient.setLanguage re-initialises the worker and drops cached results', async () => {
    const log: SpellRequest[] = []
    const client = new SpellClient('tr', ['Hugo'], fakeWorker(fakeSpeller([...DICT, 'word']), log))
    await client.check(['kitap'])
    expect(client.isMisspelled('kitap')).toBe(false)
    client.setLanguage('en')
    expect(client.language).toBe('en')
    expect(client.isMisspelled('kitap')).toBe(undefined)
    expect(log.filter((m) => m.type === 'init')).toEqual([
      { type: 'init', language: 'tr', personal: ['Hugo'] },
      { type: 'init', language: 'en', personal: ['Hugo'] },
    ])
    client.setLanguage('en')
    expect(log.filter((m) => m.type === 'init')).toHaveLength(2)
  })
})
