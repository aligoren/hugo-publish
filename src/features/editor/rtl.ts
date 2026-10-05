// Right-to-left blocks: raw HTML `<div dir="rtl">` … `</div>` around Arabic,
// Persian or Hebrew text. The lines between the tags are shown right to left
// in an Arabic-capable font; the tag lines stay visible, subdued source.

import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { createMarkdownState, fullSyntaxTree, type SyntaxTree } from './syntax'

export interface RtlBlock {
  /** The opening `<div …>` tag. */
  openFrom: number
  openTo: number
  /** The matching `</div>`. */
  closeFrom: number
  closeTo: number
  /** Lines (1-based) of the opening tag's start and end, and of the closing tag. */
  openLine: number
  openEndLine: number
  closeLine: number
  /** Lines strictly between the tags (inclusive range; empty when from > to). */
  innerFromLine: number
  innerToLine: number
  /** The tag's style contains `text-align: center`. */
  centered: boolean
}

const DIV_TAG = /<(\/?)div\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const DIR_RTL = /(?:^|\s)dir\s*=\s*(?:"\s*rtl\s*"|'\s*rtl\s*'|rtl(?![\w-]))/i
const CENTERED = /text-align\s*:\s*center/i
const TAG_ONLY_LINE = /^\s*<\/?div\b(?:[^>"']|"[^"]*"|'[^']*')*>\s*$/i

const SKIPPED = new Set(['FencedCode', 'CodeBlock', 'CommentBlock', 'Comment', 'InlineCode', 'ProcessingInstructionBlock'])

interface DivToken {
  from: number
  to: number
  closing: boolean
  attributes: string
}

/** Blanks out `<!-- … -->` comments inside an HTML block, keeping offsets. */
function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => ' '.repeat(comment.length))
}

/**
 * Finds `<div>` elements whose `dir` attribute is `rtl` (any quote style) and
 * their matching `</div>`, counting nested divs. Divs inside code, HTML
 * comments and unclosed RTL divs are ignored. Sorted by position.
 */
export function findRtlBlocks(state: EditorState, tree: SyntaxTree = syntaxTree(state)): RtlBlock[] {
  const tokens: DivToken[] = []
  tree.iterate({
    enter(node) {
      if (SKIPPED.has(node.name)) return false
      if (node.name === 'HTMLBlock' || node.name === 'HTMLTag') {
        const text = blankComments(state.sliceDoc(node.from, node.to))
        for (const match of text.matchAll(DIV_TAG)) {
          const from = node.from + (match.index ?? 0)
          tokens.push({ from, to: from + match[0].length, closing: match[1] === '/', attributes: match[2] })
        }
        return false
      }
      return true
    },
  })

  const blocks: RtlBlock[] = []
  const stack: DivToken[] = []
  for (const token of tokens) {
    if (!token.closing) {
      stack.push(token)
      continue
    }
    const open = stack.pop()
    if (!open || !DIR_RTL.test(open.attributes)) continue
    const openLine = state.doc.lineAt(open.from).number
    const openEndLine = state.doc.lineAt(open.to).number
    const closeLine = state.doc.lineAt(token.from).number
    blocks.push({
      openFrom: open.from,
      openTo: open.to,
      closeFrom: token.from,
      closeTo: token.to,
      openLine,
      openEndLine,
      closeLine,
      innerFromLine: openEndLine + 1,
      innerToLine: closeLine - 1,
      centered: CENTERED.test(open.attributes),
    })
  }
  return blocks.sort((a, b) => a.openFrom - b.openFrom)
}

/** {@link findRtlBlocks} for a plain `\n`-separated string. */
export function findRtlBlocksInText(text: string): RtlBlock[] {
  const state = createMarkdownState(text)
  return findRtlBlocks(state, fullSyntaxTree(state))
}

export const rtlField = StateField.define<RtlBlock[]>({
  create: (state) => findRtlBlocks(state),
  update(value, tr) {
    if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return findRtlBlocks(tr.state)
    return value
  },
})

export type RtlLineKind = 'tag' | 'rtl' | 'rtl-center'

/**
 * How each line inside RTL blocks is shown: tag lines (any line holding only a
 * `<div>`/`</div>` tag) stay left-to-right source; the rest are right-to-left.
 */
export function rtlLineKinds(state: EditorState, blocks: readonly RtlBlock[]): Map<number, RtlLineKind> {
  const kinds = new Map<number, RtlLineKind>()
  for (const block of blocks) {
    for (let n = block.openLine; n <= block.openEndLine; n++) kinds.set(n, 'tag')
    kinds.set(block.closeLine, 'tag')
    for (let n = block.innerFromLine; n <= block.innerToLine; n++) {
      if (kinds.get(n) === 'tag') continue
      kinds.set(n, TAG_ONLY_LINE.test(state.doc.line(n).text) ? 'tag' : block.centered ? 'rtl-center' : 'rtl')
    }
  }
  return kinds
}

const tagLine = Decoration.line({ class: 'cm-rtl-tag' })
const rtlLine = Decoration.line({ class: 'cm-rtl-line', attributes: { dir: 'rtl' } })
const rtlCenterLine = Decoration.line({ class: 'cm-rtl-line cm-rtl-center', attributes: { dir: 'rtl' } })

/** Pure decoration builder (exported for tests). */
export function buildRtlDecorations(state: EditorState): DecorationSet {
  const blocks = state.field(rtlField, false) ?? findRtlBlocks(state)
  const ranges: Range<Decoration>[] = []
  for (const [line, kind] of rtlLineKinds(state, blocks)) {
    const deco = kind === 'tag' ? tagLine : kind === 'rtl' ? rtlLine : rtlCenterLine
    ranges.push(deco.range(state.doc.line(line).from))
  }
  return Decoration.set(ranges, true)
}

/** RTL block decorations plus per-line text direction support. */
export function rtlBlocks(): Extension {
  return [
    rtlField,
    EditorView.perLineTextDirection.of(true),
    EditorView.decorations.compute([rtlField], (state) => buildRtlDecorations(state)),
  ]
}

const autoLine = Decoration.line({ attributes: { dir: 'auto' } })

/**
 * Gives every visible line outside RTL blocks `dir="auto"`, so a line that
 * starts with Arabic or Hebrew is laid out right to left.
 */
export const autoLineDirection = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.startState.field(rtlField, false) !== update.state.field(rtlField, false)
      ) {
        this.decorations = this.build(update.view)
      }
    }
    build(view: EditorView): DecorationSet {
      const rtl = rtlLineKinds(view.state, view.state.field(rtlField, false) ?? [])
      const ranges: Range<Decoration>[] = []
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos)
          if (!rtl.has(line.number)) ranges.push(autoLine.range(line.from))
          pos = line.to + 1
        }
      }
      return Decoration.set(ranges, true)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
