// Small DOM helpers for the media component tests (no testing-library in this project).
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

import type { MediaFile } from '../../lib/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []

export function cleanup() {
  while (cleanups.length) cleanups.pop()!()
}

export async function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  await flush()
  const unmount = () => {
    act(() => root.unmount())
    container.remove()
  }
  cleanups.push(() => {
    if (container.isConnected) unmount()
  })
  return { container, unmount }
}

/** Lets pending promises and the renders they cause finish. */
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

export function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name || b.title === name,
  )
  if (!found) throw new Error(`no button "${name}" in: ${container.textContent}`)
  return found
}

export function tile(container: HTMLElement, path: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[title="${path}"]`)
  if (!found) throw new Error(`no tile for ${path}`)
  return found
}

export async function click(element: HTMLElement) {
  await act(async () => element.click())
  await flush()
}

export async function doubleClick(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  await flush()
}

export async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export function image(path: string, extra: Partial<MediaFile> = {}): MediaFile {
  return {
    path,
    size: 1000,
    width: 100,
    height: 50,
    format: 'jpeg',
    hasGps: false,
    hasMetadata: false,
    modifiedMs: 1,
    ...extra,
  }
}
