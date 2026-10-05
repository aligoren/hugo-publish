// @vitest-environment jsdom
import { deleteCharBackward, deleteCharForward, cursorCharRight } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { livePreviewEnabled } from './config'
import { createEditorState } from './setup'
import { editShortcodeAtCursor } from './shortcodeForm'
import {
  buildLockDecorations,
  clearShortcodeUnlocks,
  lockedShortcodeField,
  lockShortcodeAtCursor,
  sessionShortcodeUnlocks,
  shortcodeIdentity,
  unlockShortcodeAtCursor,
  unlockShortcodeEffect,
} from './shortcodes'
import { stateFor } from './testing/harness'

const DOC = 'Önce {{< bilinmeyen a="b" >}} sonra {{< figure src="x" >}}'
const TAG_FROM = 5
const TAG_TO = DOC.indexOf('>}}') + 3

describe('locked unknown shortcodes (state)', () => {
  it('locks unknown tags only, and none in raw mode or for site shortcodes', () => {
    const state = stateFor(DOC + '|')
    expect(state.field(lockedShortcodeField).tokens.map((t) => t.name)).toEqual(['bilinmeyen'])
    expect(stateFor(DOC, 'lf', { livePreview: false }).field(lockedShortcodeField).tokens).toEqual([])
    expect(stateFor(DOC, 'lf', { knownShortcodes: ['bilinmeyen'] }).field(lockedShortcodeField).tokens).toEqual([])
    expect(
      stateFor(DOC, 'lf', { shortcodes: [{ name: 'bilinmeyen', params: [], paired: false, source: 'site' }] }).field(lockedShortcodeField).tokens,
    ).toEqual([])
  })

  it('refuses user edits inside a locked tag but allows them around it', () => {
    const state = stateFor(DOC)
    const inside = state.update({ changes: { from: TAG_FROM + 5, insert: 'X' }, userEvent: 'input.type' }).state
    expect(inside.sliceDoc()).toBe(DOC)
    const before = state.update({ changes: { from: TAG_FROM, insert: 'X' }, userEvent: 'input.type' }).state
    expect(before.sliceDoc()).toBe(DOC.slice(0, TAG_FROM) + 'X' + DOC.slice(TAG_FROM))
    const after = state.update({ changes: { from: TAG_TO, insert: 'Y' }, userEvent: 'input.type' }).state
    expect(after.sliceDoc()).toBe(DOC.slice(0, TAG_TO) + 'Y' + DOC.slice(TAG_TO))
  })

  it('deletes a whole tag, and keeps the tag when a deletion only cuts into it', () => {
    const state = stateFor(DOC)
    const whole = state.update({ changes: { from: TAG_FROM - 1, to: TAG_TO }, userEvent: 'delete.selection' }).state
    expect(whole.sliceDoc()).toBe('Önce' + DOC.slice(TAG_TO))
    const partial = state.update({ changes: { from: 2, to: TAG_FROM + 4 }, userEvent: 'delete.selection' }).state
    expect(partial.sliceDoc()).toBe('Ön' + DOC.slice(TAG_FROM))
  })

  it('lets host updates, undo and unlocked or raw-mode edits through', () => {
    const state = stateFor(DOC)
    expect(state.update({ changes: { from: TAG_FROM + 5, insert: 'X' } }).state.sliceDoc()).toContain('{{< bXilinmeyen')
    const unlocked = state.update({ effects: unlockShortcodeEffect.of(TAG_FROM) }).state
    expect(unlocked.field(lockedShortcodeField).tokens).toEqual([])
    expect(unlocked.update({ changes: { from: TAG_FROM + 5, insert: 'X' }, userEvent: 'input.type' }).state.sliceDoc()).toContain('bXilinmeyen')
    // The tag stays unlocked while text before it is edited.
    const moved = unlocked.update({ changes: { from: 0, insert: 'Yeni ' }, userEvent: 'input.type' }).state
    expect(moved.field(lockedShortcodeField).tokens).toEqual([])
    const raw = state.update({ effects: [] }).state
    expect(raw.field(lockedShortcodeField).tokens).toHaveLength(1)
  })

  it('unlocks the tag next to the cursor', () => {
    let state = stateFor(DOC.slice(0, TAG_TO) + '|' + DOC.slice(TAG_TO))
    expect(unlockShortcodeAtCursor({ state, dispatch: (tr) => (state = tr.state) })).toBe(true)
    expect(state.field(lockedShortcodeField).tokens).toEqual([])
    expect(unlockShortcodeAtCursor({ state, dispatch: () => {} })).toBe(false)
  })

  it('draws a lock button and a locked mark', () => {
    const set = buildLockDecorations(stateFor(DOC))
    const out: string[] = []
    set.between(0, DOC.length, (from, to, deco) => {
      out.push(`${from}-${to} ${(deco.spec as { class?: string }).class ?? 'widget'}`)
    })
    expect(out).toEqual([`${TAG_FROM}-${TAG_FROM} widget`, `${TAG_FROM}-${TAG_TO} cm-sc-locked`])
  })
})

describe('locked shortcodes in a view', () => {
  const views: EditorView[] = []
  afterEach(() => views.splice(0).forEach((v) => v.destroy()))

  function view(doc: string, cursor: number) {
    const v = new EditorView({ state: createEditorState(doc), parent: document.body })
    v.dispatch({ selection: EditorSelection.cursor(cursor) })
    views.push(v)
    return v
  }

  it('moves the cursor over the tag and deletes it whole', () => {
    const v = view(DOC, TAG_FROM)
    cursorCharRight(v)
    expect(v.state.selection.main.head).toBe(TAG_TO)
    deleteCharBackward(v)
    expect(v.state.sliceDoc()).toBe('Önce ' + DOC.slice(TAG_TO))
    const w = view(DOC, TAG_FROM)
    deleteCharForward(w)
    expect(w.state.sliceDoc()).toBe('Önce ' + DOC.slice(TAG_TO))
  })

  it('unlocks with the lock button; raw mode has no locks', () => {
    const v = view(DOC, 0)
    const button = v.contentDOM.querySelector<HTMLButtonElement>('.cm-sc-lock')!
    expect(button).not.toBeNull()
    expect(v.contentDOM.querySelector('.cm-sc-locked')).not.toBeNull()
    button.click()
    expect(v.state.field(lockedShortcodeField).tokens).toEqual([])
    expect(v.contentDOM.querySelector('.cm-sc-lock')).toBeNull()
    const raw = new EditorView({ state: createEditorState(DOC, { livePreview: false }), parent: document.body })
    views.push(raw)
    expect(raw.state.facet(livePreviewEnabled)).toBe(false)
    expect(raw.contentDOM.querySelector('.cm-sc-lock')).toBeNull()
  })
})

describe('unlocks that last for the session', () => {
  const views: EditorView[] = []
  afterEach(() => {
    views.splice(0).forEach((v) => v.destroy())
    clearShortcodeUnlocks()
  })

  function open(doc: string, docPath = 'content/posts/a.md') {
    const v = new EditorView({ state: createEditorState(doc, { host: { docPath } }), parent: document.body })
    views.push(v)
    return v
  }

  const lockedNames = (v: EditorView) => v.state.field(lockedShortcodeField).tokens.map((t) => v.state.sliceDoc(t.from, t.to))

  it('identifies a tag by name and parameters, not by position or spacing', () => {
    const doc = 'x {{< kutu  renk="mavi" >}} y'
    const token = { from: 2, to: doc.indexOf('>}}') + 3, delimiter: '<' as const, kind: 'opening' as const, name: 'kutu', nameFrom: 6, nameTo: 10, escaped: false }
    expect(shortcodeIdentity(doc.slice(token.from, token.to), token)).toBe('<kutu renk="mavi"')
  })

  it('keeps a tag unlocked when the document is opened again, and only in that document', () => {
    const first = open(DOC)
    first.contentDOM.querySelector<HTMLButtonElement>('.cm-sc-lock')!.click()
    expect(lockedNames(first)).toEqual([])
    expect([...sessionShortcodeUnlocks('content/posts/a.md')]).toEqual(['<bilinmeyen a="b"'])
    first.destroy()
    // Opened again, with the tag somewhere else.
    expect(lockedNames(open('Yeni giriş.\n\n' + DOC))).toEqual([])
    expect(lockedNames(open(DOC, 'content/posts/b.md'))).toEqual(['{{< bilinmeyen a="b" >}}'])
    // A different tag of the same shortcode is still locked.
    expect(lockedNames(open('{{< bilinmeyen a="c" >}}'))).toEqual(['{{< bilinmeyen a="c" >}}'])
  })

  it('stays unlocked while its parameters are edited, and after a cut and paste', () => {
    const v = open(DOC)
    v.dispatch({ effects: unlockShortcodeEffect.of(TAG_FROM) })
    const inside = DOC.indexOf('"b"') + 2
    v.dispatch({ changes: { from: inside, insert: 'c' }, userEvent: 'input.type' })
    expect(v.state.sliceDoc()).toContain('a="bc"')
    expect(lockedNames(v)).toEqual([])
    expect([...sessionShortcodeUnlocks('content/posts/a.md')]).toEqual(['<bilinmeyen a="bc"'])
    // Cut the tag and paste it at the end.
    const tag = v.state.sliceDoc(TAG_FROM, TAG_TO + 1)
    v.dispatch({ changes: { from: TAG_FROM, to: TAG_TO + 1 }, userEvent: 'delete.cut' })
    v.dispatch({ changes: { from: v.state.doc.length, insert: ' ' + tag }, userEvent: 'input.paste' })
    expect(lockedNames(v)).toEqual([])
  })

  it('locks a tag again with its button or at the cursor', () => {
    const v = open(DOC + ' ' + DOC)
    v.contentDOM.querySelector<HTMLButtonElement>('.cm-sc-lock')!.click()
    // Identical tags share the unlock.
    expect(lockedNames(v)).toEqual([])
    expect(v.contentDOM.querySelectorAll('.cm-sc-relock')).toHaveLength(2)
    v.contentDOM.querySelector<HTMLButtonElement>('.cm-sc-relock')!.click()
    expect(lockedNames(v)).toHaveLength(2)
    expect(sessionShortcodeUnlocks('content/posts/a.md').size).toBe(0)
    expect(v.contentDOM.querySelector('.cm-sc-relock')).toBe(null)

    v.dispatch({ selection: EditorSelection.cursor(TAG_FROM + 1) })
    expect(lockShortcodeAtCursor(v)).toBe(false)
    expect(unlockShortcodeAtCursor(v)).toBe(true)
    expect(lockShortcodeAtCursor(v)).toBe(true)
    expect(lockedNames(v)).toHaveLength(2)
    // Alt+Enter toggles: unlock, then lock again.
    expect(editShortcodeAtCursor(v)).toBe(true)
    expect(lockedNames(v)).toEqual([])
    expect(editShortcodeAtCursor(v)).toBe(true)
    expect(lockedNames(v)).toHaveLength(2)
  })

  it('draws no lock-again button in raw mode', () => {
    const v = new EditorView({ state: createEditorState(DOC, { livePreview: false, host: { docPath: 'content/posts/a.md' } }), parent: document.body })
    views.push(v)
    v.dispatch({ effects: unlockShortcodeEffect.of(TAG_FROM) })
    expect(v.contentDOM.querySelector('.cm-sc-relock, .cm-sc-lock')).toBe(null)
  })
})
