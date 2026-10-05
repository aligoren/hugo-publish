// Spellchecking in the editor: misspelled words in the visible part of the
// document get a wavy underline; clicking one (or Mod+. on it) opens a menu
// with suggestions and "Add to dictionary". Checking happens in a worker
// (see client.ts); this only collects words and draws the results.

import { Facet, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  showTooltip,
  type Command,
  type DecorationSet,
  type TooltipView,
  type ViewUpdate,
} from '@codemirror/view'
import type { SpellClient } from './client'
import { wordsInRange, type SpellWord } from './tokenize'

export interface SpellcheckConfig {
  client: SpellClient
  /** Persists a word the user added (the host's personal dictionary). */
  onAddWord?: (word: string) => void
}

export const spellcheckConfig = Facet.define<SpellcheckConfig | null, SpellcheckConfig | null>({
  combine: (values) => (values.length > 0 ? values[values.length - 1] : null),
})

const spellRefresh = StateEffect.define<null>()
const misspelledMark = Decoration.mark({ class: 'cm-spell-error' })

/** Misspelled words among `words` according to the client's cache (exported for tests). */
export function misspelledWords(client: Pick<SpellClient, 'isMisspelled'>, words: readonly SpellWord[]): SpellWord[] {
  return words.filter((word) => client.isMisspelled(word.word) === true)
}

class SpellPlugin {
  decorations: DecorationSet = Decoration.none
  private timer: ReturnType<typeof setTimeout> | null = null
  private unsubscribe: (() => void) | null = null
  private client: SpellClient | null = null
  private readonly view: EditorView

  constructor(view: EditorView) {
    this.view = view
    this.attach(view.state.facet(spellcheckConfig)?.client ?? null)
  }

  private attach(client: SpellClient | null) {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.client = client
    this.decorations = Decoration.none
    if (client) {
      this.unsubscribe = client.subscribe(() => this.schedule(0))
      this.schedule(0)
    }
  }

  update(update: ViewUpdate) {
    const client = update.state.facet(spellcheckConfig)?.client ?? null
    if (client !== this.client) {
      this.attach(client)
      return
    }
    if (!client) return
    if (update.docChanged) this.decorations = this.decorations.map(update.changes)
    if (update.docChanged || update.viewportChanged) this.schedule(400)
    if (update.selectionSet || update.focusChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(spellRefresh)))) {
      this.decorations = this.build()
    }
  }

  private schedule(delay: number) {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, delay)
  }

  private visibleWords(): SpellWord[] {
    const words: SpellWord[] = []
    for (const { from, to } of this.view.visibleRanges) words.push(...wordsInRange(this.view.state, from, to))
    return words
  }

  private async run() {
    const client = this.client
    if (!client || client.status === 'error') return
    const words = this.visibleWords()
    try {
      await client.check(words.map((w) => w.word))
    } catch {
      return
    }
    if (client !== this.client) return
    try {
      this.view.dispatch({ effects: spellRefresh.of(null) })
    } catch {
      // The view was destroyed while the worker was busy.
    }
  }

  private build(): DecorationSet {
    const client = this.client
    if (!client) return Decoration.none
    const { head, empty } = this.view.state.selection.main
    const typing = this.view.hasFocus && empty
    const ranges: Range<Decoration>[] = []
    for (const word of misspelledWords(client, this.visibleWords())) {
      // The word being typed (cursor at its end) is not marked yet.
      if (typing && head === word.to) continue
      ranges.push(misspelledMark.range(word.from, word.to))
    }
    return Decoration.set(ranges, true)
  }

  destroy() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.unsubscribe?.()
  }
}

const spellPlugin = ViewPlugin.fromClass(SpellPlugin, { decorations: (plugin) => plugin.decorations })

// ---------------------------------------------------------------------------
// Suggestions menu

interface MenuState {
  from: number
  to: number
  word: string
  suggestions: readonly string[] | null
  focus: boolean
  create: (view: EditorView) => TooltipView
}

const openMenuEffect = StateEffect.define<{ from: number; to: number; word: string; focus: boolean }>()
const suggestionsEffect = StateEffect.define<{ word: string; suggestions: readonly string[] }>()
const closeMenuEffect = StateEffect.define<null>()

export const spellMenuField = StateField.define<MenuState | null>({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) {
      let touched = false
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA <= value!.to && toA >= value!.from) touched = true
      })
      value = touched ? null : { ...value, from: tr.changes.mapPos(value.from, 1), to: tr.changes.mapPos(value.to, -1) }
    }
    for (const effect of tr.effects) {
      if (effect.is(openMenuEffect)) value = { ...effect.value, suggestions: null, create: (view) => new SpellMenuView(view) }
      else if (effect.is(suggestionsEffect) && value && value.word === effect.value.word) value = { ...value, suggestions: effect.value.suggestions }
      else if (effect.is(closeMenuEffect)) value = null
    }
    if (value && tr.selection && tr.isUserEvent('select')) {
      const head = tr.selection.main.head
      if (head < value.from || head > value.to) value = null
    }
    return value
  },
  provide: (field) =>
    showTooltip.compute([field], (state) => {
      const value = state.field(field)
      return value ? { pos: value.from, above: false, create: value.create } : null
    }),
})

/** The checked, misspelled word at `pos`, if any. */
export function misspelledWordAt(state: EditorState, pos: number): SpellWord | null {
  const client = state.facet(spellcheckConfig)?.client
  if (!client) return null
  const line = state.doc.lineAt(pos)
  return wordsInRange(state, line.from, line.to).find((w) => w.from <= pos && pos <= w.to && client.isMisspelled(w.word) === true) ?? null
}

function openMenu(view: EditorView, word: SpellWord, focus: boolean): void {
  const config = view.state.facet(spellcheckConfig)
  if (!config) return
  view.dispatch({ effects: openMenuEffect.of({ ...word, focus }) })
  config.client
    .suggest(word.word)
    .catch(() => [])
    .then((suggestions) => {
      try {
        view.dispatch({ effects: suggestionsEffect.of({ word: word.word, suggestions }) })
      } catch {
        // destroyed
      }
    })
}

/** Opens the suggestions menu for the misspelled word at the cursor. */
export const openSpellMenu: Command = (view) => {
  const word = misspelledWordAt(view.state, view.state.selection.main.head)
  if (!word) return false
  openMenu(view, word, true)
  return true
}

const closeSpellMenu: Command = (view) => {
  if (!view.state.field(spellMenuField, false)) return false
  view.dispatch({ effects: closeMenuEffect.of(null) })
  return true
}

class SpellMenuView implements TooltipView {
  dom: HTMLElement
  private readonly view: EditorView
  private rendered: readonly string[] | null | undefined = undefined

  constructor(view: EditorView) {
    this.view = view
    this.dom = document.createElement('div')
    this.dom.className = 'cm-spell-menu'
    this.dom.setAttribute('role', 'menu')
    this.dom.addEventListener('keydown', (event) => this.onKey(event))
    this.dom.addEventListener('mousedown', (event) => event.preventDefault())
    this.render()
  }

  private get menu(): MenuState | null {
    return this.view.state.field(spellMenuField, false) ?? null
  }

  private item(text: string, run: () => void, className = ''): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.tabIndex = -1
    button.className = className
    button.textContent = text
    button.addEventListener('click', (event) => {
      event.preventDefault()
      run()
    })
    return button
  }

  private render(): void {
    const menu = this.menu
    if (!menu || menu.suggestions === this.rendered) return
    const hadFocus = this.dom.contains(document.activeElement)
    this.rendered = menu.suggestions
    const state = this.view.state
    this.dom.setAttribute('aria-label', state.phrase('Spelling suggestions for $', menu.word))
    this.dom.replaceChildren()
    if (menu.suggestions === null) {
      const loading = document.createElement('div')
      loading.className = 'cm-spell-menu-note'
      loading.textContent = '…'
      this.dom.append(loading)
    } else if (menu.suggestions.length === 0) {
      const none = document.createElement('div')
      none.className = 'cm-spell-menu-note'
      none.textContent = state.phrase('No suggestions')
      this.dom.append(none)
    } else {
      for (const suggestion of menu.suggestions) this.dom.append(this.item(suggestion, () => this.replace(suggestion), 'cm-spell-suggestion'))
    }
    const separator = document.createElement('div')
    separator.className = 'cm-spell-menu-separator'
    separator.setAttribute('role', 'separator')
    this.dom.append(separator, this.item(state.phrase('Add to dictionary'), () => this.addWord(), 'cm-spell-add'))
    if (menu.focus || hadFocus) this.focusItem(0)
  }

  mount(): void {
    if (this.menu?.focus) this.focusItem(0)
  }

  update(): void {
    this.render()
  }

  private items(): HTMLButtonElement[] {
    return Array.from(this.dom.querySelectorAll('button'))
  }

  private focusItem(index: number): void {
    const items = this.items()
    if (items.length === 0) return
    items[(index + items.length) % items.length].focus()
  }

  private onKey(event: KeyboardEvent): void {
    const items = this.items()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') this.focusItem(current + 1)
    else if (event.key === 'ArrowUp') this.focusItem(current - 1)
    else if (event.key === 'Home') this.focusItem(0)
    else if (event.key === 'End') this.focusItem(items.length - 1)
    else if (event.key === 'Escape' || event.key === 'Tab') {
      this.view.dispatch({ effects: closeMenuEffect.of(null) })
      this.view.focus()
    } else return
    event.preventDefault()
    event.stopPropagation()
  }

  private replace(suggestion: string): void {
    const menu = this.menu
    if (!menu) return
    this.view.dispatch({
      changes: { from: menu.from, to: menu.to, insert: suggestion },
      selection: { anchor: menu.from + suggestion.length },
      effects: closeMenuEffect.of(null),
      userEvent: 'input.spell',
    })
    this.view.focus()
  }

  private addWord(): void {
    const menu = this.menu
    const config = this.view.state.facet(spellcheckConfig)
    if (!menu || !config) return
    config.onAddWord?.(menu.word)
    config.client.addWord(menu.word)
    this.view.dispatch({ effects: closeMenuEffect.of(null) })
    this.view.focus()
  }
}

const clickHandler = EditorView.domEventHandlers({
  click(event, view) {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
    const target = (event.target as Element | null)?.closest?.('.cm-spell-error')
    if (!target || !view.contentDOM.contains(target)) return false
    if (!view.state.selection.main.empty) return false
    const word = misspelledWordAt(view.state, view.posAtDOM(target))
    if (!word) return false
    openMenu(view, word, false)
    return false
  },
})

/** Spellchecking with a {@link SpellClient}; without one (null) it does nothing. */
export function spellcheck(config: SpellcheckConfig | null): Extension {
  if (!config) return []
  return [
    spellcheckConfig.of(config),
    spellPlugin,
    spellMenuField,
    clickHandler,
    keymap.of([
      { key: 'Mod-.', run: openSpellMenu },
      { key: 'Escape', run: closeSpellMenu },
    ]),
  ]
}
