// Spelling worker: runs nspell off the main thread with the Turkish
// (dictionary-tr, MIT) or English (dictionary-en, MIT AND BSD) Hunspell
// dictionary. The packages' own entry points read the files with Node's
// `fs`, so the .aff/.dic files are imported as asset URLs (Vite copies them
// to the build) and fetched here as text, only for the language in use.

import nspell from 'nspell'
import enAffUrl from '../../../../node_modules/dictionary-en/index.aff?url'
import enDicUrl from '../../../../node_modules/dictionary-en/index.dic?url'
import trAffUrl from '../../../../node_modules/dictionary-tr/index.aff?url'
import trDicUrl from '../../../../node_modules/dictionary-tr/index.dic?url'
import { createSpellService, type SpellLanguage, type SpellRequest, type SpellResponse, type Speller } from './protocol'

const DICTIONARIES: Record<SpellLanguage, { aff: string; dic: string }> = {
  tr: { aff: trAffUrl, dic: trDicUrl },
  en: { aff: enAffUrl, dic: enDicUrl },
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`)
  return response.text()
}

async function load(language: SpellLanguage): Promise<Speller> {
  const files = DICTIONARIES[language]
  const [aff, dic] = await Promise.all([fetchText(files.aff), fetchText(files.dic)])
  return nspell({ aff, dic })
}

const scope = self as unknown as {
  postMessage(message: SpellResponse): void
  addEventListener(type: 'message', listener: (event: MessageEvent<SpellRequest>) => void): void
}

const handle = createSpellService(load, (response) => scope.postMessage(response))
scope.addEventListener('message', (event) => void handle(event.data))
