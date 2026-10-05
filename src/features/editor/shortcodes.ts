// Hugo shortcodes: `{{< name args >}}`, `{{% name args %}}`, closing tags,
// self-closing `/>}}` and escaped `{{</* … */>}}`. Hugo expands shortcodes
// before Markdown is parsed (also inside code blocks and HTML comments), so
// they are found with a plain text scan rather than the Markdown tree.
// They are styled as chips; the text of known ones stays editable (their
// parameters also through a form, see shortcodeForm.ts). In live preview,
// unknown shortcodes are locked: the cursor skips over them, deleting takes
// the whole tag, and edits inside are refused until the user unlocks the tag
// or switches to raw mode. An unlock holds for the tag's identity (its name
// and parameters, wherever it is) in this document for the rest of the
// session, also when the document is opened again; "lock again" undoes it.

import {
  EditorState,
  MapMode,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Range,
} from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { knownShortcodes, livePreviewEnabled } from './config'
import { editorHost } from './host'
import { isKnownShortcode, shortcodeDefinitions } from './shortcodeDefs'

export interface ShortcodeToken {
  from: number
  to: number
  /** `<` for `{{< >}}`, `%` for `{{% %}}`. */
  delimiter: '<' | '%'
  kind: 'opening' | 'closing' | 'selfClosing'
  /** Shortcode name, e.g. `figure` or `dir/name`; empty if an escaped token has none. */
  name: string
  nameFrom: number
  nameTo: number
  // Escaped form, `{{</* … */>}}`: Hugo prints it literally instead of running it.
  escaped: boolean
}

export interface ScanOptions {
  /** Also return escaped tokens (`escaped: true`). Default false. */
  includeEscaped?: boolean
}

const START = /\{\{([<%])/g
const NAME = /[A-Za-z0-9_][\w.\-/]*/y
const SPACE = /\s/

/** Index of the `"` closing a quoted string starting at `from` (just after the opening quote), or -1. */
function closingQuote(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') i++
    else if (ch === '"') return i
    else if (ch === '\n' && text[i + 1] === '\n') return -1
  }
  return -1
}

function readName(text: string, pos: number): { name: string; from: number; to: number } | null {
  NAME.lastIndex = pos
  const match = NAME.exec(text)
  if (!match) return null
  // `{{< name/>}}`: the slash belongs to the self-closing marker.
  const name = match[0].replace(/\/+$/, '')
  return { name, from: pos, to: pos + name.length }
}

/** Finds shortcode tags in a text. Positions are string offsets. */
export function scanShortcodes(text: string, options: ScanOptions = {}): ShortcodeToken[] {
  const tokens: ShortcodeToken[] = []
  START.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = START.exec(text))) {
    const from = match.index
    const delimiter = match[1] as '<' | '%'
    const right = delimiter === '<' ? '>}}' : '%}}'
    let pos = from + 3

    if (text.startsWith('/*', pos)) {
      const end = text.indexOf('*/' + right, pos + 2)
      if (end === -1) continue
      const to = end + 2 + right.length
      if (options.includeEscaped) {
        let p = pos + 2
        while (p < end && SPACE.test(text[p])) p++
        const closing = text[p] === '/'
        if (closing) p++
        while (p < end && SPACE.test(text[p])) p++
        const name = readName(text, p)
        tokens.push({
          from,
          to,
          delimiter,
          kind: closing ? 'closing' : 'opening',
          name: name?.name ?? '',
          nameFrom: name?.from ?? p,
          nameTo: name?.to ?? p,
          escaped: true,
        })
      }
      START.lastIndex = to
      continue
    }

    while (pos < text.length && SPACE.test(text[pos])) pos++
    let kind: ShortcodeToken['kind'] = 'opening'
    if (text[pos] === '/') {
      kind = 'closing'
      pos++
      while (pos < text.length && SPACE.test(text[pos])) pos++
    }
    const name = readName(text, pos)
    if (!name) continue

    // Find the right delimiter, skipping over quoted ("…") and raw (`…`) parameters.
    let end = -1
    for (let i = name.to; i < text.length; ) {
      if (text.startsWith(right, i)) {
        end = i
        break
      }
      const ch = text[i]
      if (ch === '"') {
        const close = closingQuote(text, i + 1)
        if (close === -1) break
        i = close + 1
      } else if (ch === '`') {
        const close = text.indexOf('`', i + 1)
        if (close === -1) break
        i = close + 1
      } else if (ch === '{' && text[i + 1] === '{' && (text[i + 2] === '<' || text[i + 2] === '%')) {
        break // another shortcode starts: this one is not closed
      } else {
        i++
      }
    }
    if (end === -1) continue

    let last = end - 1
    while (last > name.to && SPACE.test(text[last])) last--
    if (kind === 'opening' && last >= name.to && text[last] === '/') kind = 'selfClosing'

    tokens.push({ from, to: end + right.length, delimiter, kind, name: name.name, nameFrom: name.from, nameTo: name.to, escaped: false })
    START.lastIndex = end + right.length
  }
  return tokens
}

/** Shortcode tokens (escaped ones included) of the current document. */
export const shortcodeField = StateField.define<ShortcodeToken[]>({
  create: (state) => scanShortcodes(state.doc.toString(), { includeEscaped: true }),
  update(value, tr) {
    return tr.docChanged ? scanShortcodes(tr.state.doc.toString(), { includeEscaped: true }) : value
  },
})

/** True when `[from, to)` lies inside a shortcode tag (escaped ones included). */
export function insideShortcode(tokens: readonly ShortcodeToken[], from: number, to: number): boolean {
  // Tokens are sorted and do not overlap: binary search for the last token starting at or before `from`.
  let lo = 0
  let hi = tokens.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (tokens[mid].from <= from) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found === -1) return false
  const token = tokens[found]
  return to <= token.to
}

const escapedMark = Decoration.mark({ class: 'cm-sc-escaped' })
const nameMark = Decoration.mark({ class: 'cm-sc-name' })

/** The first token whose range contains `pos` (ends included), if any. */
export function shortcodeAt(tokens: readonly ShortcodeToken[], pos: number): ShortcodeToken | null {
  for (const token of tokens) {
    if (token.from > pos) break
    if (pos <= token.to) return token
  }
  return null
}

/** Pure decoration builder (exported for tests). */
export function buildShortcodeDecorations(state: EditorState): DecorationSet {
  const tokens = state.field(shortcodeField, false) ?? scanShortcodes(state.doc.toString(), { includeEscaped: true })
  const live = state.facet(livePreviewEnabled)
  const defs = state.facet(shortcodeDefinitions)
  const ranges: Range<Decoration>[] = []
  for (const token of tokens) {
    if (token.escaped) {
      ranges.push(escapedMark.range(token.from, token.to))
      continue
    }
    const known = isKnownShortcode(state, token.name)
    let cls = `cm-sc ${known ? 'cm-sc-known' : 'cm-sc-unknown'}`
    if (token.kind === 'closing') cls += ' cm-sc-closing'
    const attributes: Record<string, string> = { 'data-shortcode': token.name }
    // Known tags with parameters open the parameter form when clicked (live preview).
    if (live && known && token.kind !== 'closing' && (defs.get(token.name)?.params.length ?? 0) > 0) {
      attributes.title = state.phrase('Edit parameters (Alt+Enter)')
    }
    ranges.push(Decoration.mark({ class: cls, attributes }).range(token.from, token.to))
    if (token.nameTo > token.nameFrom) ranges.push(nameMark.range(token.nameFrom, token.nameTo))
  }
  return Decoration.set(ranges, true)
}

// ---------------------------------------------------------------------------
// Locked (unknown) shortcodes

/**
 * A tag's position-independent identity: delimiter, name and parameter text
 * (whitespace runs count as one space). Identical tags share it.
 */
export function shortcodeIdentity(text: string, token: ShortcodeToken): string {
  const params = text.slice(token.nameTo - token.from, token.to - token.from - 3).replace(/\s+/g, ' ').trim()
  return `${token.delimiter}${token.kind === 'closing' ? '/' : ''}${token.name} ${params}`
}

function identityOf(state: EditorState, token: ShortcodeToken): string {
  return shortcodeIdentity(state.sliceDoc(token.from, token.to), token)
}

// Unlocked identities per document (by the host's `docPath`) for this session.
const sessionUnlocks = new Map<string, ReadonlySet<string>>()

/** Forgets the unlocked shortcodes of every document (tests, or closing the site). */
export function clearShortcodeUnlocks(): void {
  sessionUnlocks.clear()
}

/** The unlocked shortcode identities remembered for a document. */
export function sessionShortcodeUnlocks(docPath: string): ReadonlySet<string> {
  return sessionUnlocks.get(docPath) ?? new Set()
}

/** Unlocks the unknown tag starting at the given position (and every identical tag). */
export const unlockShortcodeEffect = StateEffect.define<number>({ map: (pos, mapping) => mapping.mapPos(pos, 1) })
/** Locks the tag starting at the given position (and every identical tag) again. */
export const lockShortcodeEffect = StateEffect.define<number>({ map: (pos, mapping) => mapping.mapPos(pos, 1) })

export interface UnlockedShortcodes {
  /** Identities of unlocked tags. */
  ids: ReadonlySet<string>
  /** Unlocked tags followed through edits, so typing inside one keeps it unlocked. */
  tracked: readonly { pos: number; id: string }[]
}

function tokenStartingAt(tokens: readonly ShortcodeToken[], pos: number): ShortcodeToken | undefined {
  return tokens.find((t) => t.from === pos && !t.escaped)
}

function trackTokens(state: EditorState, ids: ReadonlySet<string>, tracked: { pos: number; id: string }[]): void {
  if (ids.size === 0) return
  const positions = new Set(tracked.map((t) => t.pos))
  for (const token of state.field(shortcodeField, false) ?? []) {
    if (token.escaped || positions.has(token.from)) continue
    const id = identityOf(state, token)
    if (ids.has(id)) tracked.push({ pos: token.from, id })
  }
}

/** Unknown tags the user unlocked: by identity, and followed through edits made inside them. */
export const unlockedShortcodes = StateField.define<UnlockedShortcodes>({
  create(state) {
    const docPath = state.facet(editorHost).docPath
    const ids = docPath ? sessionShortcodeUnlocks(docPath) : new Set<string>()
    const tracked: { pos: number; id: string }[] = []
    trackTokens(state, ids, tracked)
    return { ids, tracked }
  },
  update(value, tr) {
    const effects = tr.effects.filter((e) => e.is(unlockShortcodeEffect) || e.is(lockShortcodeEffect))
    if (!tr.docChanged && effects.length === 0) return value
    let ids = new Set(value.ids)
    let tracked = value.tracked
    const tokens = tr.state.field(shortcodeField, false) ?? []
    if (tr.docChanged) {
      const next: { pos: number; id: string }[] = []
      const renamed: string[] = []
      for (const item of tracked) {
        const pos = tr.changes.mapPos(item.pos, 1, MapMode.TrackDel)
        if (pos === null) continue
        // An edit inside the tag changes its identity: the new one is unlocked instead.
        const token = tokenStartingAt(tokens, pos)
        const id = token ? identityOf(tr.state, token) : item.id
        if (id !== item.id) {
          ids.add(id)
          renamed.push(item.id)
        }
        next.push({ pos, id })
      }
      if (renamed.length > 0) {
        const present = new Set(next.map((t) => t.id))
        for (const token of tokens) if (!token.escaped) present.add(identityOf(tr.state, token))
        for (const id of renamed) if (!present.has(id)) ids.delete(id)
      }
      tracked = next
    }
    for (const effect of effects) {
      const token = tokenStartingAt(tokens, effect.value)
      if (!token) continue
      const id = identityOf(tr.state, token)
      if (effect.is(unlockShortcodeEffect)) ids.add(id)
      else {
        ids.delete(id)
        tracked = tracked.filter((t) => t.id !== id)
      }
    }
    const list = [...tracked]
    trackTokens(tr.state, ids, list)
    if (ids.size === value.ids.size && [...ids].every((id) => value.ids.has(id))) ids = value.ids as Set<string>
    return { ids, tracked: list }
  },
})

/** Whether a tag is unlocked (its identity is). */
export function isShortcodeUnlocked(state: EditorState, token: ShortcodeToken): boolean {
  const unlocked = state.field(unlockedShortcodes, false)
  return !!unlocked && unlocked.ids.size > 0 && unlocked.ids.has(identityOf(state, token))
}

/** Remembers the unlocked identities of the document for the session. */
const rememberUnlocks = EditorView.updateListener.of((update) => {
  const before = update.startState.field(unlockedShortcodes, false)
  const after = update.state.field(unlockedShortcodes, false)
  if (!after || before?.ids === after.ids) return
  const docPath = update.state.facet(editorHost).docPath
  if (!docPath) return
  if (after.ids.size === 0) sessionUnlocks.delete(docPath)
  else sessionUnlocks.set(docPath, after.ids)
})

class LockedRange extends RangeValue {}
const lockedValue = new LockedRange()

export interface LockedShortcodes {
  tokens: readonly ShortcodeToken[]
  ranges: RangeSet<LockedRange>
}

const noLocks: LockedShortcodes = { tokens: [], ranges: RangeSet.empty }

/** Unknown, non-escaped tags that are locked in the current state (none in raw mode). */
export function computeLockedShortcodes(state: EditorState): LockedShortcodes {
  if (!state.facet(livePreviewEnabled)) return noLocks
  const tokens = state.field(shortcodeField, false) ?? []
  const locked = tokens.filter((t) => !t.escaped && !isKnownShortcode(state, t.name) && !isShortcodeUnlocked(state, t))
  if (locked.length === 0) return noLocks
  return { tokens: locked, ranges: RangeSet.of(locked.map((t) => lockedValue.range(t.from, t.to))) }
}

export const lockedShortcodeField = StateField.define<LockedShortcodes>({
  create: computeLockedShortcodes,
  update(value, tr) {
    if (tr.docChanged || tr.reconfigured || tr.startState.field(unlockedShortcodes, false)?.ids !== tr.state.field(unlockedShortcodes, false)?.ids) {
      return computeLockedShortcodes(tr.state)
    }
    return value
  },
})

/**
 * Change filter: user edits that cut into a locked tag lose the part inside
 * it. Inserting right before or after a tag, and deleting or replacing a
 * whole tag, are allowed. Undo/redo and changes from the host (no user
 * event) always go through.
 */
export function lockedChangeFilter(tr: Transaction): boolean | readonly number[] {
  if (!tr.docChanged) return true
  const event = tr.annotation(Transaction.userEvent)
  if (!event || event.startsWith('undo') || event.startsWith('redo')) return true
  const { tokens } = tr.startState.field(lockedShortcodeField, false) ?? noLocks
  if (tokens.length === 0) return true
  const suppressed: number[] = []
  for (const token of tokens) {
    let touched = false
    let covered = false
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA <= token.from && toA >= token.to && toA > fromA) covered = true
      else if (fromA < token.to && toA > token.from) touched = true
      else if (fromA === toA && fromA > token.from && fromA < token.to) touched = true
    })
    if (touched && !covered) suppressed.push(token.from, token.to)
  }
  return suppressed.length > 0 ? suppressed : true
}

const CLOSED_LOCK =
  '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2z"/></svg>'
const OPEN_LOCK =
  '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M4.5 7h7A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7z"/><path fill="none" stroke="currentColor" stroke-width="1.5" d="M6 7V4.5a2.5 2.5 0 0 1 5 0"/></svg>'

/** The lock button before a locked tag (unlocks it), or the open lock before an unlocked one (locks it again). */
class LockWidget extends WidgetType {
  readonly label: string
  readonly locked: boolean
  constructor(label: string, locked: boolean) {
    super()
    this.label = label
    this.locked = locked
  }
  eq(other: LockWidget): boolean {
    return other.label === this.label && other.locked === this.locked
  }
  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = this.locked ? 'cm-sc-lock' : 'cm-sc-relock'
    button.title = this.label
    button.setAttribute('aria-label', this.label)
    button.innerHTML = this.locked ? CLOSED_LOCK : OPEN_LOCK
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      const pos = view.posAtDOM(button)
      view.dispatch({ effects: (this.locked ? unlockShortcodeEffect : lockShortcodeEffect).of(pos) })
      view.focus()
    })
    return button
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** Unknown tags the user unlocked (live preview only: raw mode has no locks). */
function unlockedUnknownTokens(state: EditorState): ShortcodeToken[] {
  if (!state.facet(livePreviewEnabled)) return []
  const unlocked = state.field(unlockedShortcodes, false)
  if (!unlocked || unlocked.ids.size === 0) return []
  return (state.field(shortcodeField, false) ?? []).filter(
    (t) => !t.escaped && !isKnownShortcode(state, t.name) && isShortcodeUnlocked(state, t),
  )
}

/** Lock marks and unlock buttons; "lock again" buttons before unlocked tags (exported for tests). */
export function buildLockDecorations(state: EditorState): DecorationSet {
  const { tokens } = state.field(lockedShortcodeField, false) ?? computeLockedShortcodes(state)
  const unlocked = unlockedUnknownTokens(state)
  if (tokens.length === 0 && unlocked.length === 0) return Decoration.none
  const button = Decoration.widget({ widget: new LockWidget(state.phrase('Unlock shortcode for editing'), true), side: -1 })
  const relock = Decoration.widget({ widget: new LockWidget(state.phrase('Lock shortcode again'), false), side: -1 })
  const mark = Decoration.mark({ class: 'cm-sc-locked', attributes: { title: state.phrase('Unknown shortcode: locked so it is not changed by accident') } })
  const ranges: Range<Decoration>[] = []
  for (const token of tokens) {
    ranges.push(button.range(token.from))
    ranges.push(mark.range(token.from, token.to))
  }
  for (const token of unlocked) ranges.push(relock.range(token.from))
  return Decoration.set(ranges, true)
}

/** Unlocks a locked tag at or next to the cursor. */
export function unlockShortcodeAtCursor(target: { state: EditorState; dispatch: (tr: Transaction) => void }): boolean {
  const { tokens } = target.state.field(lockedShortcodeField, false) ?? noLocks
  const token = shortcodeAt(tokens, target.state.selection.main.head)
  if (!token) return false
  target.dispatch(target.state.update({ effects: unlockShortcodeEffect.of(token.from) }))
  return true
}

/** Locks an unlocked unknown tag at or next to the cursor again. */
export function lockShortcodeAtCursor(target: { state: EditorState; dispatch: (tr: Transaction) => void }): boolean {
  const token = shortcodeAt(unlockedUnknownTokens(target.state), target.state.selection.main.head)
  if (!token) return false
  target.dispatch(target.state.update({ effects: lockShortcodeEffect.of(token.from) }))
  return true
}

/** Shortcode chips and locks for unknown tags. */
export function shortcodes(): Extension {
  return [
    shortcodeField,
    unlockedShortcodes,
    lockedShortcodeField,
    EditorView.decorations.compute(
      [shortcodeField, knownShortcodes, shortcodeDefinitions, livePreviewEnabled, EditorState.phrases],
      buildShortcodeDecorations,
    ),
    EditorView.decorations.compute([lockedShortcodeField, unlockedShortcodes, EditorState.phrases], buildLockDecorations),
    rememberUnlocks,
    EditorView.atomicRanges.of((view) => view.state.field(lockedShortcodeField).ranges),
    EditorState.changeFilter.of(lockedChangeFilter),
  ]
}
