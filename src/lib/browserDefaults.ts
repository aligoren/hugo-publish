// WebView2 behaves like a browser unless told otherwise: a right-click menu with Back, Refresh,
// Save as and Print, and keys that reload the app (losing unsaved text) or go "back". The menu
// stays only where it helps: in text fields (cut, copy, paste, spelling) and on selected text
// (copy). The preview is a cross-origin frame, so it is not affected.

/** Input types that hold text the user types, where cut/copy/paste is useful. */
const TEXT_INPUTS = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'password', 'number'])

export interface MenuTarget {
  /** Tag of the nearest field around the click (`input`, `textarea`), if any. */
  field: string | null
  inputType: string
  /** Inside a contenteditable element, such as the editor. */
  editable: boolean
  hasSelection: boolean
}

export function keepsNativeMenu({ field, inputType, editable, hasSelection }: MenuTarget): boolean {
  if (hasSelection || editable || field === 'textarea') return true
  return field === 'input' && TEXT_INPUTS.has(inputType.toLowerCase())
}

function describe(event: MouseEvent): MenuTarget {
  const element = event.target instanceof Element ? event.target : null
  const field = element?.closest('input, textarea') ?? null
  return {
    field: field?.tagName.toLowerCase() ?? null,
    inputType: field instanceof HTMLInputElement ? field.type : '',
    editable: element instanceof HTMLElement && element.isContentEditable,
    hasSelection: (window.getSelection()?.toString() ?? '') !== '',
  }
}

export interface Keys {
  key: string
  ctrl: boolean
  alt: boolean
}

/** Reload, print, save as, view source, back and forward. The app's own handlers still see them. */
export function isBrowserKey({ key, ctrl, alt }: Keys): boolean {
  const k = key.toLowerCase()
  if (k === 'f5' || k === 'browserback' || k === 'browserforward' || k === 'browserrefresh') return true
  if (alt && (k === 'arrowleft' || k === 'arrowright')) return true
  return ctrl && !alt && ['r', 'p', 's', 'u'].includes(k)
}

/** Turns off the browser behaviour above; left alone in development for "Inspect" and reload. */
export function hideBrowserDefaults(): void {
  if (import.meta.env.DEV) return
  document.addEventListener('contextmenu', (event) => {
    if (!keepsNativeMenu(describe(event))) event.preventDefault()
  })
  document.addEventListener('keydown', (event) => {
    if (isBrowserKey({ key: event.key, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey })) event.preventDefault()
  })
}
