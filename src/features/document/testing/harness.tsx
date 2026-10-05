// Helpers for the document pane's component tests (jsdom).
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: (() => void)[] = []

export function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(element))
  const unmount = () => {
    act(() => root.unmount())
    container.remove()
  }
  mounted.push(unmount)
  return { container, rerender: (next: ReactElement) => act(() => root.render(next)), unmount }
}

export function unmountAll() {
  while (mounted.length) {
    const unmount = mounted.pop()!
    try {
      unmount()
    } catch {
      // Already unmounted.
    }
  }
}

/** Lets pending promises (mocked commands) and the renders they cause finish. */
export async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** Types into a controlled input the way React sees it. */
export function typeInto(element: Element | null | undefined, value: string) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
    throw new Error(`not an input: ${element?.outerHTML}`)
  }
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

export function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
  act(() => element.click())
}

export function press(element: Element, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}

export function button(container: ParentNode, name: string | RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) =>
    typeof name === 'string' ? b.textContent?.trim() === name || b.getAttribute('aria-label') === name : name.test(b.textContent ?? ''),
  )
  if (!found) throw new Error(`no button ${String(name)}`)
  return found
}

/** The input inside the `<label>` whose caption is `name`. */
export function field(container: ParentNode, name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const byAria = [...container.querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === name)
  if (byAria instanceof HTMLInputElement || byAria instanceof HTMLTextAreaElement) return byAria
  const labels = [...container.querySelectorAll('label')]
  const label =
    labels.find((l) => l.querySelector(':scope > span')?.textContent?.trim() === name || l.textContent?.trim() === name) ??
    // Checkboxes with a hint under their caption.
    labels.find((l) => l.textContent?.trim().startsWith(name))
  const input = label?.querySelector('input, textarea, select')
  if (!input) throw new Error(`no field ${name}`)
  return input as HTMLInputElement
}
