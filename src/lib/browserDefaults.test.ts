import { describe, expect, it } from 'vitest'

import { isBrowserKey, keepsNativeMenu, type MenuTarget } from './browserDefaults'

const target = (over: Partial<MenuTarget>): MenuTarget => ({ field: null, inputType: '', editable: false, hasSelection: false, ...over })

describe('keepsNativeMenu', () => {
  it('hides the browser menu on the app itself', () => {
    expect(keepsNativeMenu(target({}))).toBe(false)
  })

  it('keeps it for typing and copying', () => {
    expect(keepsNativeMenu(target({ field: 'textarea' }))).toBe(true)
    expect(keepsNativeMenu(target({ field: 'input', inputType: 'text' }))).toBe(true)
    expect(keepsNativeMenu(target({ editable: true }))).toBe(true)
    expect(keepsNativeMenu(target({ hasSelection: true }))).toBe(true)
  })

  it('hides it on inputs that hold no text', () => {
    expect(keepsNativeMenu(target({ field: 'input', inputType: 'checkbox' }))).toBe(false)
    expect(keepsNativeMenu(target({ field: 'input', inputType: 'color' }))).toBe(false)
  })
})

describe('isBrowserKey', () => {
  const press = (key: string, ctrl = false, alt = false) => isBrowserKey({ key, ctrl, alt })

  it('catches reload, print, save as and navigation', () => {
    expect(press('F5')).toBe(true)
    expect(press('r', true)).toBe(true)
    expect(press('R', true)).toBe(true)
    expect(press('p', true)).toBe(true)
    expect(press('s', true)).toBe(true)
    expect(press('ArrowLeft', false, true)).toBe(true)
  })

  it('leaves typing and editing keys alone', () => {
    expect(press('r')).toBe(false)
    expect(press('ArrowLeft')).toBe(false)
    expect(press('k', true)).toBe(false)
    expect(press('z', true)).toBe(false)
    expect(press('r', true, true)).toBe(false)
  })
})
