// GitHub-style alerts (`> [!NOTE]`), which Hugo renders through the
// blockquote render hook. The text stays plain Markdown; this only adds
// line colours and, off the cursor line, a label in place of `[!TYPE]`.

import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { alertLabels, isAlertType, livePreviewEnabled, type AlertType } from './config'
import { activeLines, BLOCK_CONTAINERS, createMarkdownState, fullSyntaxTree, type SyntaxTree } from './syntax'

export interface AlertBlock {
  type: AlertType
  /** The type as written, e.g. `NOTE` or `note`. */
  rawType: string
  /** Custom title written after the marker (`> [!WARNING] Title`), or null. */
  title: string | null
  /** Foldable sign after the marker (`[!NOTE]-`), or null. */
  foldSign: '+' | '-' | null
  /** The blockquote's range. */
  from: number
  to: number
  /** First and last line (1-based, inclusive). */
  fromLine: number
  toLine: number
  /** The `[!TYPE]` marker including a fold sign. */
  markerFrom: number
  markerTo: number
}

// `>` then the marker, then optionally a fold sign and a title.
const FIRST_LINE = /^(>[ \t]*)(\[!([A-Za-z]+)\]([+-]?))(?:[ \t]+(.*?))?[ \t]*$/

/** Finds alerts: blockquotes whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`. */
export function findAlerts(state: EditorState, tree: SyntaxTree = syntaxTree(state)): AlertBlock[] {
  const alerts: AlertBlock[] = []
  tree.iterate({
    enter(node) {
      if (node.name === 'Blockquote') {
        const line = state.doc.lineAt(node.from)
        const match = FIRST_LINE.exec(state.sliceDoc(node.from, line.to))
        const type = match?.[3].toLowerCase()
        if (match && type && isAlertType(type)) {
          const markerFrom = node.from + match[1].length
          alerts.push({
            type,
            rawType: match[3],
            title: match[5] ? match[5] : null,
            foldSign: match[4] === '+' || match[4] === '-' ? match[4] : null,
            from: node.from,
            to: node.to,
            fromLine: line.number,
            toLine: state.doc.lineAt(node.to).number,
            markerFrom,
            markerTo: markerFrom + match[2].length,
          })
        }
      }
      return BLOCK_CONTAINERS.has(node.name)
    },
  })
  return alerts
}

/** {@link findAlerts} for a plain `\n`-separated string (positions are string offsets). */
export function findAlertsInText(text: string): AlertBlock[] {
  const state = createMarkdownState(text)
  return findAlerts(state, fullSyntaxTree(state))
}

/** The alert containing `pos`, if any. */
export function alertAt(alerts: readonly AlertBlock[], state: EditorState, pos: number): AlertBlock | null {
  const line = state.doc.lineAt(pos).number
  let found: AlertBlock | null = null
  for (const alert of alerts) {
    if (line >= alert.fromLine && line <= alert.toLine) found = alert // innermost wins
  }
  return found
}

/** Alerts of the current document, kept in sync with the syntax tree. */
export const alertField = StateField.define<AlertBlock[]>({
  create: (state) => findAlerts(state),
  update(value, tr) {
    if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return findAlerts(tr.state)
    return value
  },
})

/** Line numbers that belong to an alert (used by live preview to skip quote styling). */
export function alertLineSet(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const alert of state.field(alertField, false) ?? []) {
    for (let n = alert.fromLine; n <= alert.toLine; n++) lines.add(n)
  }
  return lines
}

export class AlertLabelWidget extends WidgetType {
  readonly type: AlertType
  readonly label: string
  constructor(type: AlertType, label: string) {
    super()
    this.type = type
    this.label = label
  }
  eq(other: AlertLabelWidget): boolean {
    return other.type === this.type && other.label === this.label
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `cm-alert-label cm-alert-label-${this.type}`
    span.textContent = this.label
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

export interface AlertDecorationOptions {
  /** Lines showing raw source; defaults to the selection's lines. */
  active?: ReadonlySet<number>
}

/** Pure decoration builder (exported for tests). */
export function buildAlertDecorations(state: EditorState, options: AlertDecorationOptions = {}): DecorationSet {
  const alerts = state.field(alertField, false) ?? findAlerts(state)
  const labels = state.facet(alertLabels)
  const live = state.facet(livePreviewEnabled)
  const active = options.active ?? activeLines(state)
  const ranges: Range<Decoration>[] = []
  for (const alert of alerts) {
    for (let n = alert.fromLine; n <= alert.toLine; n++) {
      let cls = `cm-alert cm-alert-${alert.type}`
      if (n === alert.fromLine) cls += ' cm-alert-first'
      if (n === alert.toLine) cls += ' cm-alert-last'
      ranges.push(Decoration.line({ class: cls }).range(state.doc.line(n).from))
    }
    if (live && !active.has(alert.fromLine)) {
      const widget = new AlertLabelWidget(alert.type, labels[alert.type])
      ranges.push(Decoration.replace({ widget }).range(alert.markerFrom, alert.markerTo))
    } else {
      ranges.push(Decoration.mark({ class: 'cm-alert-marker' }).range(alert.markerFrom, alert.markerTo))
    }
    if (alert.title !== null) {
      const line = state.doc.line(alert.fromLine)
      ranges.push(Decoration.mark({ class: 'cm-alert-title' }).range(alert.markerTo, line.to))
    }
  }
  return Decoration.set(ranges, true)
}

const alertPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        update.startState.field(alertField) !== update.state.field(alertField) ||
        update.startState.facet(alertLabels) !== update.state.facet(alertLabels) ||
        update.startState.facet(livePreviewEnabled) !== update.state.facet(livePreviewEnabled)
      ) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function build(view: EditorView): DecorationSet {
  // When the editor is not focused every line is shown rendered.
  return buildAlertDecorations(view.state, view.hasFocus ? {} : { active: new Set() })
}

/** Alert colours and labels. */
export function alerts(): Extension {
  return [alertField, alertPlugin]
}
