// Writing statistics: words, characters and reading time of the prose (the
// text a reader sees: shortcode tags, HTML tags, comments and link
// destinations are left out), reported to the host after a short pause.

import type { Extension } from '@codemirror/state'
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'
import type { EditorStats } from './contract'
import { editorHost } from './host'

export const WORDS_PER_MINUTE = 200

const MARKUP: [RegExp, string][] = [
  [/<!--[\s\S]*?(?:-->|$)/g, ' '],
  [/\{\{[<%][\s\S]*?[>%]\}\}/g, ' '],
  [/^[ \t]*\[(?!\^)[^\]\n]+\]:[ \t]*\S.*$/gm, ' '], // link reference definitions (not footnotes)
  [/\]\([^)\s]*(?:\s+(?:"[^"]*"|'[^']*'))?\)/g, ']'], // inline link / image destinations
  [/\[\^[^\]\s]+\]/g, ' '], // footnote references
  [/\[![A-Za-z]+\][+-]?/g, ' '], // alert markers
  [/<\/?[A-Za-z][^>]*>/g, ' '],
  [/\b(?:https?:\/\/|www\.)\S+/g, ' '],
  [/\{#[^}\n]*\}/g, ' '], // heading ids
]

/** The readable text of Markdown (approximate: used only for counting). */
export function proseText(markdown: string): string {
  let text = markdown
  for (const [pattern, replacement] of MARKUP) text = text.replace(pattern, replacement)
  return text
}

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu

export function countWords(markdown: string): number {
  let count = 0
  for (const _ of proseText(markdown).matchAll(WORD)) count++
  return count
}

/** Characters of the prose, spaces included, line breaks and Markdown marks excluded. */
export function countCharacters(markdown: string): number {
  const text = proseText(markdown)
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|(?:>[ \t]?)+|[-+*][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/gm, '')
    .replace(/[*_~`#|]/g, '')
    .replace(/[ \t]*\r?\n[ \t]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(text.normalize('NFC')).length
}

export function readingMinutes(words: number): number {
  return words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))
}

/** Statistics of a document and its selected text. */
export function computeStats(markdown: string, selected: readonly string[] = []): EditorStats {
  const words = countWords(markdown)
  return {
    words,
    characters: countCharacters(markdown),
    readingMinutes: readingMinutes(words),
    selectionWords: selected.reduce((sum, text) => sum + (text ? countWords(text) : 0), 0),
  }
}

function sameStats(a: EditorStats | null, b: EditorStats): boolean {
  return !!a && a.words === b.words && a.characters === b.characters && a.readingMinutes === b.readingMinutes && a.selectionWords === b.selectionWords
}

/** Calls the host's `onStats` when the numbers change, at most every `delay` ms. */
export function statsReporter(delay = 300): Extension {
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null
      private last: EditorStats | null = null
      private readonly view: EditorView
      constructor(view: EditorView) {
        this.view = view
        this.schedule(0)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) this.schedule(delay)
      }
      schedule(wait: number) {
        if (!this.view.state.facet(editorHost).onStats) return
        if (this.timer !== null) clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          this.timer = null
          this.report()
        }, wait)
      }
      report() {
        const state = this.view.state
        const onStats = state.facet(editorHost).onStats
        if (!onStats) return
        const selected = state.selection.ranges.filter((r) => !r.empty).map((r) => state.sliceDoc(r.from, r.to))
        const stats = computeStats(state.doc.toString(), selected)
        if (sameStats(this.last, stats)) return
        this.last = stats
        onStats(stats)
      }
      destroy() {
        if (this.timer !== null) clearTimeout(this.timer)
      }
    },
  )
}
