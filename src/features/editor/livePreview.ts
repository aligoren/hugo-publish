// Live preview (Typora/Obsidian style): off the cursor's lines, Markdown
// syntax marks are hidden and the text is styled in place. On the lines that
// hold the cursor or selection the raw source is shown. Nothing here changes
// the document; it is a view-only layer of decorations.

import { syntaxTree } from '@codemirror/language'
import { EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { alertField, alertLineSet } from './alerts'
import { toggleTaskSpec } from './commands'
import { livePreviewEnabled } from './config'
import { insideShortcode, shortcodeField } from './shortcodes'
import { activeLines, type SyntaxNode, type SyntaxTree } from './syntax'

const BULLETS = ['•', '◦', '▪']

/** A list bullet (`-`, `*`, `+`) shown as a dot; the character stays in the document. */
class BulletWidget extends WidgetType {
  readonly depth: number
  constructor(depth: number) {
    super()
    this.depth = depth
  }
  eq(other: BulletWidget): boolean {
    return other.depth === this.depth
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-lp-bullet'
    span.textContent = BULLETS[this.depth % BULLETS.length]
    span.setAttribute('aria-hidden', 'true')
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** A task checkbox; clicking it flips `[ ]` / `[x]` with a one-character edit. */
class TaskWidget extends WidgetType {
  readonly checked: boolean
  readonly label: string
  constructor(checked: boolean, label: string) {
    super()
    this.checked = checked
    this.label = label
  }
  eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.label === this.label
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-lp-task'
    box.checked = this.checked
    box.tabIndex = -1
    box.setAttribute('aria-label', this.label)
    box.addEventListener('mousedown', (event) => event.preventDefault())
    box.addEventListener('click', (event) => {
      event.preventDefault()
      const spec = toggleTaskSpec(view.state, view.posAtDOM(box))
      if (spec) view.dispatch({ ...spec, userEvent: 'input.toggle' })
    })
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** The language of a fenced code block, shown in place of the opening fence. */
class CodeLabelWidget extends WidgetType {
  readonly language: string
  constructor(language: string) {
    super()
    this.language = language
  }
  eq(other: CodeLabelWidget): boolean {
    return other.language === this.language
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-lp-code-label'
    span.textContent = this.language
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

class HorizontalRuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-lp-hr'
    span.setAttribute('aria-hidden', 'true')
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

const hidden = Decoration.replace({})
const hrWidget = Decoration.replace({ widget: new HorizontalRuleWidget() })
const markCache = new Map<string, Decoration>()
const lineCache = new Map<string, Decoration>()

function mark(cls: string): Decoration {
  let deco = markCache.get(cls)
  if (!deco) markCache.set(cls, (deco = Decoration.mark({ class: cls })))
  return deco
}

function lineDeco(cls: string): Decoration {
  let deco = lineCache.get(cls)
  if (!deco) lineCache.set(cls, (deco = Decoration.line({ class: cls })))
  return deco
}

const INLINE_STYLE: Record<string, string> = {
  Emphasis: 'cm-lp-em',
  StrongEmphasis: 'cm-lp-strong',
  Strikethrough: 'cm-lp-strike',
}

const INLINE_MARK: Record<string, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
}

export interface LivePreviewOptions {
  /** Ranges to decorate (the viewport); defaults to the whole document. */
  ranges?: readonly { from: number; to: number }[]
  /** Lines that show raw source; defaults to the selection's lines. */
  active?: ReadonlySet<number>
  /**
   * Selection ranges: list markers and task boxes they touch show as source.
   * Defaults to the selection, or none when `active` is empty (not focused).
   */
  cursors?: readonly { from: number; to: number }[]
  tree?: SyntaxTree
}

/** `"Title"` / `'Title'` / `(Title)` → `Title`. */
function unquoteTitle(text: string): string {
  return text.length >= 2 ? text.slice(1, -1) : text
}

function listDepth(node: SyntaxNode): number {
  let depth = 0
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'BulletList' || parent.name === 'OrderedList') depth++
  }
  return Math.max(0, depth - 1)
}

/** Pure decoration builder (exported for tests). */
export function buildLivePreviewDecorations(state: EditorState, options: LivePreviewOptions = {}): DecorationSet {
  const doc = state.doc
  const tree = options.tree ?? syntaxTree(state)
  const active = options.active ?? activeLines(state)
  const ranges = options.ranges ?? [{ from: 0, to: doc.length }]
  const shortcodes = state.field(shortcodeField, false) ?? []
  const alertLines = state.field(alertField, false) ? alertLineSet(state) : new Set<number>()
  const cursors = options.cursors ?? (options.active && options.active.size === 0 ? [] : state.selection.ranges)
  const out: Range<Decoration>[] = []
  const lineDone = new Set<string>()
  const taskLabel = state.phrase('Toggle task')

  const isActive = (pos: number) => active.has(doc.lineAt(pos).number)
  const touched = (from: number, to: number) => cursors.some((r) => r.from <= to && r.to >= from)
  const addLine = (pos: number, cls: string) => {
    const line = doc.lineAt(pos)
    const key = `${line.from}|${cls}`
    if (lineDone.has(key)) return
    lineDone.add(key)
    out.push(lineDeco(cls).range(line.from))
  }
  const addLines = (from: number, to: number, cls: string) => {
    // A node ending right after a line break does not cover the next line.
    if (to > from && doc.lineAt(to).from === to) to--
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      addLine(line.from, cls)
      pos = line.to + 1
    }
  }
  /** Hides `[from, to)` unless its line is active, it crosses a line break or sits inside a shortcode. */
  const hide = (from: number, to: number) => {
    if (from >= to || isActive(from)) return
    if (doc.lineAt(from).to < to) return
    if (insideShortcode(shortcodes, from, to)) return
    out.push(hidden.range(from, to))
  }
  const spacesAfter = (pos: number, limit: number) => {
    let end = pos
    while (end < limit && /[ \t]/.test(doc.sliceString(end, end + 1))) end++
    return end
  }

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(nodeRef) {
        const name = nodeRef.name
        const node = nodeRef.node

        if (name.startsWith('ATXHeading')) {
          addLine(node.from, `cm-lp-heading cm-lp-h${name.slice(-1)}`)
          const line = doc.lineAt(node.from)
          for (let child = node.firstChild; child; child = child.nextSibling) {
            if (child.name !== 'HeaderMark') continue
            if (child.from === node.from) hide(child.from, spacesAfter(child.to, line.to))
            else {
              // Closing sequence `## Title ##`: hide it with the spaces before it.
              let start = child.from
              while (start > node.from && /[ \t]/.test(doc.sliceString(start - 1, start))) start--
              hide(start, child.to)
            }
          }
          return true
        }

        if (name === 'SetextHeading1' || name === 'SetextHeading2') {
          const underline = node.getChild('HeaderMark')
          const textEnd = underline ? doc.lineAt(underline.from).from - 1 : node.to
          addLines(node.from, textEnd, `cm-lp-heading cm-lp-h${name.slice(-1)}`)
          if (underline) {
            // Off the cursor the `===` / `---` underline is hidden and its line collapsed.
            const hiddenLine = !isActive(underline.from) && !insideShortcode(shortcodes, underline.from, underline.to)
            addLine(underline.from, hiddenLine ? 'cm-lp-setext-mark cm-lp-setext-hidden' : 'cm-lp-setext-mark')
            hide(underline.from, underline.to)
          }
          return true
        }

        if (name === 'ListMark') {
          const item = node.parent
          const list = item?.parent
          if (!item || !list) return false
          const task = item.getChild('Task')
          const marker = task?.getChild('TaskMarker')
          const end = marker ? marker.to : spacesAfter(node.to, doc.lineAt(node.from).to)
          if (touched(node.from, end) || insideShortcode(shortcodes, node.from, node.to)) return false
          if (marker) {
            // `- [ ] ` becomes a checkbox: the bullet and its space are hidden.
            out.push(hidden.range(node.from, Math.min(spacesAfter(node.to, marker.from), marker.from)))
            const checked = doc.sliceString(marker.from + 1, marker.from + 2) !== ' '
            out.push(Decoration.replace({ widget: new TaskWidget(checked, taskLabel) }).range(marker.from, marker.to))
            if (checked) out.push(mark('cm-lp-task-done').range(marker.to, task!.to))
          } else if (list.name === 'BulletList') {
            out.push(Decoration.replace({ widget: new BulletWidget(listDepth(node)) }).range(node.from, node.to))
          } else {
            out.push(mark('cm-lp-list-number').range(node.from, node.to))
          }
          return false
        }

        if (name in INLINE_STYLE) {
          out.push(mark(INLINE_STYLE[name]).range(node.from, node.to))
          for (const child of node.getChildren(INLINE_MARK[name])) hide(child.from, child.to)
          return true
        }

        if (name === 'InlineCode') {
          out.push(mark('cm-lp-code').range(node.from, node.to))
          for (const child of node.getChildren('CodeMark')) hide(child.from, child.to)
          return false
        }

        if (name === 'Link') {
          // Only links with a destination or reference label; `[placeholder]` text stays as written.
          if (!node.getChild('URL') && !node.getChild('LinkLabel')) return true
          const marks = node.getChildren('LinkMark')
          const open = marks[0]
          const close = marks.find((m) => m.from > open.from && doc.sliceString(m.from, m.to) === ']')
          if (!open || !close) return true
          // The hidden destination is shown as a tooltip.
          const url = node.getChild('URL')
          const title = node.getChild('LinkTitle')
          const label = node.getChild('LinkLabel')
          let tooltip = url ? doc.sliceString(url.from, url.to) : label ? doc.sliceString(label.from, label.to) : ''
          if (title) tooltip += ` – ${unquoteTitle(doc.sliceString(title.from, title.to))}`
          if (open.to < close.from) {
            out.push(Decoration.mark({ class: 'cm-lp-link', attributes: { title: tooltip } }).range(open.to, close.from))
          }
          hide(open.from, open.to)
          hide(close.from, node.to)
          return true
        }

        if (name === 'Autolink') {
          const url = node.getChild('URL')
          if (url) out.push(mark('cm-lp-link').range(url.from, url.to))
          for (const child of node.getChildren('LinkMark')) hide(child.from, child.to)
          return false
        }

        if (name === 'Image') {
          const url = node.getChild('URL')
          const attributes = url ? { title: doc.sliceString(url.from, url.to) } : undefined
          out.push(Decoration.mark({ class: 'cm-lp-image', attributes }).range(node.from, node.to))
          return false
        }

        if (name === 'Blockquote') {
          for (let pos = node.from; pos <= node.to; ) {
            const line = doc.lineAt(pos)
            if (!alertLines.has(line.number)) addLine(line.from, 'cm-lp-quote')
            pos = line.to + 1
          }
          return true
        }

        if (name === 'QuoteMark') {
          const next = doc.sliceString(node.to, node.to + 1)
          hide(node.from, next === ' ' ? node.to + 1 : node.to)
          return false
        }

        if (name === 'HorizontalRule') {
          if (!isActive(node.from) && doc.lineAt(node.from).to >= node.to) out.push(hrWidget.range(node.from, node.to))
          return false
        }

        if (name === 'FencedCode' || name === 'CodeBlock') {
          addLines(node.from, node.to, 'cm-lp-codeblock')
          addLine(node.from, 'cm-lp-codeblock-first')
          addLine(node.to, 'cm-lp-codeblock-last')
          if (name === 'FencedCode') {
            // Off the cursor: the opening fence becomes a language label, the closing fence disappears.
            const marks = node.getChildren('CodeMark')
            const openLine = doc.lineAt(node.from)
            if (marks[0] && !isActive(node.from) && !insideShortcode(shortcodes, openLine.from, openLine.to)) {
              const info = node.getChild('CodeInfo')
              const language = info ? doc.sliceString(info.from, info.to).trim().split(/[\s{,]/)[0] : ''
              const end = info && doc.lineAt(info.to).number === openLine.number ? openLine.to : marks[0].to
              out.push(
                language
                  ? Decoration.replace({ widget: new CodeLabelWidget(language) }).range(marks[0].from, end)
                  : hidden.range(marks[0].from, end),
              )
            }
            const close = marks.length > 1 ? marks[marks.length - 1] : null
            if (close && doc.lineAt(close.from).number !== openLine.number) hide(close.from, close.to)
          }
          return false
        }

        if (name === 'HTMLBlock') {
          addLines(node.from, node.to, 'cm-lp-html')
          return false
        }

        if (name === 'CommentBlock') {
          addLines(node.from, node.to, 'cm-lp-comment')
          return false
        }

        if (name === 'Comment') {
          out.push(mark('cm-lp-comment').range(node.from, node.to))
          return false
        }

        if (name === 'Table') {
          addLines(node.from, node.to, 'cm-lp-table')
          return true
        }

        if (name === 'TableHeader') {
          out.push(mark('cm-lp-table-header').range(node.from, node.to))
          return true
        }

        if (name === 'TableDelimiter') {
          // The `|---|:-:|` row (a child of the table) or a cell separator `|`.
          out.push(mark(node.parent?.name === 'Table' ? 'cm-lp-table-rule' : 'cm-lp-table-pipe').range(node.from, node.to))
          return false
        }

        return true
      },
    })
  }
  return Decoration.set(out, true)
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        update.state.facet(livePreviewEnabled) !== update.startState.facet(livePreviewEnabled) ||
        update.state.facet(EditorState.phrases) !== update.startState.facet(EditorState.phrases)
      ) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function build(view: EditorView): DecorationSet {
  if (!view.state.facet(livePreviewEnabled)) return Decoration.none
  // When the editor is not focused every line is shown rendered.
  return buildLivePreviewDecorations(view.state, {
    ranges: view.visibleRanges,
    active: view.hasFocus ? undefined : new Set(),
  })
}

/** The live preview layer. Turn it off with `livePreviewEnabled.of(false)` (raw mode). */
export function livePreview(): Extension {
  return livePreviewPlugin
}
