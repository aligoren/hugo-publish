// Parameter form for known shortcodes: a popover under the tag with one field
// per parameter (from its definition) plus any other arguments the tag has.
// Applying rewrites only that tag's arguments, with minimal edits (see
// shortcodeArgs.ts). Opens on a click on the chip in live preview (off the
// cursor's lines), with Alt+Enter at the tag, or after inserting a shortcode
// from the slash menu.

import { StateEffect, StateField, Text, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Command, type TooltipView } from '@codemirror/view'
import { livePreviewEnabled } from './config'
import type { ShortcodeDef } from './contract'
import {
  parseShortcodeTag,
  resolveShortcodeValues,
  shortcodeArgEdits,
  shortcodeFieldValues,
  type ParsedShortcodeTag,
  type ShortcodeFieldValue,
} from './shortcodeArgs'
import { shortcodeDef } from './shortcodeDefs'
import { lockShortcodeAtCursor, shortcodeAt, shortcodeField, unlockShortcodeAtCursor, type ShortcodeToken } from './shortcodes'
import { activeLines } from './syntax'

interface FormState {
  from: number
  to: number
  name: string
  focus: boolean
  create: (view: EditorView) => TooltipView
}

export const openShortcodeFormEffect = StateEffect.define<{ pos: number; focus: boolean }>({
  map: (value, mapping) => ({ ...value, pos: mapping.mapPos(value.pos, 1) }),
})
export const closeShortcodeFormEffect = StateEffect.define<null>()

/** The tag a form can be opened for at `pos`: a known opening tag whose definition has parameters. */
export function editableShortcodeAt(state: EditorState, pos: number): { token: ShortcodeToken; def: ShortcodeDef } | null {
  const token = shortcodeAt(state.field(shortcodeField, false) ?? [], pos)
  if (!token || token.escaped || token.kind === 'closing') return null
  const def = shortcodeDef(state, token.name)
  if (!def || def.params.length === 0) return null
  return { token, def }
}

export const shortcodeFormField = StateField.define<FormState | null>({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) {
      const from = tr.changes.mapPos(value.from, 1)
      const token = (tr.state.field(shortcodeField, false) ?? []).find((t) => t.from === from && !t.escaped)
      value = token && token.name === value.name && token.kind !== 'closing' ? { ...value, from: token.from, to: token.to } : null
    }
    for (const effect of tr.effects) {
      if (effect.is(openShortcodeFormEffect)) {
        const found = editableShortcodeAt(tr.state, effect.value.pos)
        value = found
          ? {
              from: found.token.from,
              to: found.token.to,
              name: found.token.name,
              focus: effect.value.focus,
              create: (view) => new ShortcodeFormView(view),
            }
          : null
      } else if (effect.is(closeShortcodeFormEffect)) {
        value = null
      }
    }
    // Moving the cursor elsewhere (click, arrow keys) closes the form.
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

/** Opens the parameter form for the shortcode at the cursor, or unlocks a locked one there (and locks an unlocked one again). */
export const editShortcodeAtCursor: Command = (view) => {
  const head = view.state.selection.main.head
  if (editableShortcodeAt(view.state, head)) {
    view.dispatch({ effects: openShortcodeFormEffect.of({ pos: head, focus: true }) })
    return true
  }
  return unlockShortcodeAtCursor(view) || lockShortcodeAtCursor(view)
}

const closeForm: Command = (view) => {
  if (!view.state.field(shortcodeFormField, false)) return false
  view.dispatch({ effects: closeShortcodeFormEffect.of(null) })
  return true
}

let fieldIds = 0

class ShortcodeFormView implements TooltipView {
  dom: HTMLFormElement
  private readonly view: EditorView
  private readonly inputs: { field: ShortcodeFieldValue; input: HTMLInputElement | HTMLSelectElement; error: HTMLElement }[] = []
  private readonly message: HTMLElement

  constructor(view: EditorView) {
    this.view = view
    const state = view.state
    const form = state.field(shortcodeFormField) as FormState
    const parsed = currentTag(state, form)
    const def = shortcodeDef(state, form.name)
    const phrase = (text: string, ...insert: unknown[]) => state.phrase(text, ...insert)

    const dom = document.createElement('form')
    dom.className = 'cm-sc-form'
    dom.noValidate = true
    dom.setAttribute('aria-label', phrase('Parameters of $', form.name))
    this.dom = dom

    const head = document.createElement('div')
    head.className = 'cm-sc-form-head'
    const title = document.createElement('code')
    title.textContent = form.name
    head.append(title)
    if (def?.description) {
      const description = document.createElement('span')
      description.textContent = def.description
      head.append(description)
    }
    dom.append(head)

    const fields = parsed && def ? shortcodeFieldValues(parsed, def) : []
    const grid = document.createElement('div')
    grid.className = 'cm-sc-form-fields'
    for (const field of fields) {
      const id = `cm-sc-field-${++fieldIds}`
      const label = document.createElement('label')
      label.htmlFor = id
      const name = field.param?.name ?? field.name ?? phrase('Position $', (field.index ?? 0) + 1)
      label.textContent = name
      if (field.param?.positionalOnly) {
        const hint = document.createElement('small')
        hint.textContent = ` ${phrase('Position $', (field.index ?? 0) + 1)}`
        label.append(hint)
      }
      if (field.param?.required) {
        const star = document.createElement('abbr')
        star.textContent = ' *'
        star.title = phrase('Required')
        label.append(star)
      }
      let input: HTMLInputElement | HTMLSelectElement
      if (field.param?.type === 'boolean') {
        const select = document.createElement('select')
        for (const [value, text] of [
          ['', phrase('Not set')],
          ['true', 'true'],
          ['false', 'false'],
        ]) {
          const option = document.createElement('option')
          option.value = value
          option.textContent = text
          select.append(option)
        }
        select.value = field.value === 'true' || field.value === 'false' ? field.value : ''
        input = select
      } else {
        const text = document.createElement('input')
        text.type = 'text'
        text.value = field.value
        text.spellcheck = false
        if (field.param?.type === 'number') text.inputMode = 'decimal'
        if (field.param?.description) text.placeholder = field.param.description
        input = text
      }
      input.id = id
      input.name = name
      if (field.param?.required) input.setAttribute('aria-required', 'true')
      const error = document.createElement('span')
      error.className = 'cm-sc-form-error'
      error.id = `${id}-error`
      input.setAttribute('aria-describedby', error.id)
      const cell = document.createElement('div')
      cell.append(input, error)
      grid.append(label, cell)
      this.inputs.push({ field, input, error })
    }
    dom.append(grid)

    if (def?.paired && def.markdown) {
      const note = document.createElement('p')
      note.className = 'cm-sc-form-note'
      note.textContent = phrase('The content between the tags is Markdown.')
      dom.append(note)
    }

    this.message = document.createElement('p')
    this.message.className = 'cm-sc-form-error'
    this.message.setAttribute('role', 'alert')
    dom.append(this.message)

    const actions = document.createElement('div')
    actions.className = 'cm-sc-form-actions'
    const apply = document.createElement('button')
    apply.type = 'submit'
    apply.textContent = phrase('Apply')
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = phrase('Cancel')
    cancel.addEventListener('click', () => this.close())
    actions.append(apply, cancel)
    dom.append(actions)

    dom.addEventListener('submit', (event) => {
      event.preventDefault()
      this.apply()
    })
    dom.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.close()
      }
    })
  }

  mount(): void {
    const form = this.view.state.field(shortcodeFormField, false)
    if (form?.focus) this.inputs[0]?.input.focus()
  }

  private close(): void {
    this.view.dispatch({ effects: closeShortcodeFormEffect.of(null) })
    this.view.focus()
  }

  /** Validates and writes the values; returns false when something is missing. */
  apply(): boolean {
    const state = this.view.state
    const form = state.field(shortcodeFormField, false)
    if (!form) return false
    const tag = currentTag(state, form)
    const def = shortcodeDef(state, form.name)
    if (!tag) return false
    let valid = true
    const fields = this.inputs.map(({ field, input, error }) => {
      const value = input.value.trim() === '' ? '' : input.value
      const missing = !!field.param?.required && value === ''
      error.textContent = missing ? state.phrase('$ is required', field.param?.name ?? '') : ''
      input.setAttribute('aria-invalid', String(missing))
      if (missing && valid) {
        valid = false
        input.focus()
      }
      return { ...field, value }
    })
    if (!valid) return false
    const resolved = resolveShortcodeValues(fields, tag, def)
    if (!resolved.values) {
      this.message.textContent = state.phrase('Positional and named parameters cannot be mixed. Clear one of them.')
      return false
    }
    this.message.textContent = ''
    const text = state.doc.sliceString(form.from, form.to)
    const edits = shortcodeArgEdits(text, tag, resolved.values, def, form.from)
    this.view.dispatch({
      changes: edits.map((e) => ({ from: e.from, to: e.to, insert: Text.of(e.insert.split('\n')) })),
      effects: closeShortcodeFormEffect.of(null),
      userEvent: 'input.shortcode',
    })
    this.view.focus()
    return true
  }
}

function currentTag(state: EditorState, form: FormState): ParsedShortcodeTag | null {
  // `doc.sliceString` joins lines with `\n`, so string offsets match document positions.
  return parseShortcodeTag(state.doc.sliceString(form.from, form.to), form.from)
}

/** Opens the form when a known chip is clicked in live preview, off the lines being edited. */
const chipClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
    if (!view.state.facet(livePreviewEnabled)) return false
    const chip = (event.target as Element | null)?.closest?.('.cm-sc-known')
    if (!chip || !view.contentDOM.contains(chip)) return false
    const found = editableShortcodeAt(view.state, view.posAtDOM(chip))
    if (!found) return false
    if (view.hasFocus) {
      const active = activeLines(view.state)
      const first = view.state.doc.lineAt(found.token.from).number
      const last = view.state.doc.lineAt(found.token.to).number
      for (let n = first; n <= last; n++) if (active.has(n)) return false // raw source: a normal click
    }
    event.preventDefault()
    view.dispatch({ effects: openShortcodeFormEffect.of({ pos: found.token.from, focus: true }) })
    return true
  },
})

/** The parameter form, its click handler and Alt+Enter. */
export function shortcodeForm(): Extension {
  return [shortcodeFormField, chipClick, keymap.of([{ key: 'Alt-Enter', run: editShortcodeAtCursor }, { key: 'Escape', run: closeForm }])]
}
