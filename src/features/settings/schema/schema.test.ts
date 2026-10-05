import { describe, expect, it } from 'vitest'

import { messages } from '../messages'
import { isGoDuration } from '../model/validate'
import { isPlainObject } from '../model/values'
import { CHROMA_STYLE_NAMES, GROUPS, messageId, SETTINGS, type SettingDef } from '.'
import { keyMessagesEn } from './labels.en'
import { keyMessagesTr } from './labels.tr'

const byId = (s: SettingDef) => messageId(s.path)

function typeMatches(setting: SettingDef, value: unknown): boolean {
  switch (setting.type) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'string':
      return typeof value === 'string'
    case 'integer':
      return Number.isInteger(value)
    case 'number':
      return typeof value === 'number'
    case 'boolOrString':
      return typeof value === 'boolean' || typeof value === 'string'
    case 'duration':
      return isGoDuration(value)
    case 'stringList':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
    case 'stringOrList':
      return typeof value === 'string' || (Array.isArray(value) && value.every((v) => typeof v === 'string'))
    case 'pairList':
      return Array.isArray(value) && value.every((p) => Array.isArray(p) && p.length === 2 && p.every((s) => typeof s === 'string'))
    case 'stringMap':
      return isPlainObject(value) && Object.values(value).every((v) => typeof v === 'string')
    case 'objectList':
      return Array.isArray(value) && value.every(isPlainObject)
    case 'objectMap':
      return isPlainObject(value)
    case 'any':
      return true
  }
}

describe('settings schema', () => {
  it('covers the catalog thoroughly', () => {
    expect(SETTINGS.length).toBeGreaterThanOrEqual(120)
    for (const group of GROUPS) expect(SETTINGS.some((s) => s.group === group.id), group.id).toBe(true)
  })

  it('has unique paths, also ignoring case', () => {
    const paths = SETTINGS.map((s) => s.path.join('.').toLowerCase())
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('leaves params to the Theme screen', () => {
    expect(SETTINGS.filter((s) => s.path[0].toLowerCase() === 'params')).toEqual([])
  })

  it('gives every key an English and a Turkish label and help text', () => {
    const en = keyMessagesEn as Record<string, { label: string; help: string }>
    const tr = keyMessagesTr as Record<string, { label: string; help: string }>
    for (const setting of SETTINGS) {
      const id = byId(setting)
      expect(en[id]?.label, `en label of ${id}`).toBeTruthy()
      expect(en[id]?.help, `en help of ${id}`).toBeTruthy()
      expect(tr[id]?.label, `tr label of ${id}`).toBeTruthy()
      expect(tr[id]?.help, `tr help of ${id}`).toBeTruthy()
    }
    // No orphan messages for keys that no longer exist.
    expect(Object.keys(en).sort()).toEqual(SETTINGS.map(byId).sort())
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort())
  })

  it('registers group, rule and preset texts in both languages', () => {
    for (const group of GROUPS) {
      expect(messages.en.groups[group.id].label).toBeTruthy()
      expect(messages.tr.groups[group.id].label).toBeTruthy()
    }
    expect(Object.keys(messages.tr.migration.rules).sort()).toEqual(Object.keys(messages.en.migration.rules).sort())
  })

  it('has defaults of the declared type', () => {
    for (const setting of SETTINGS) {
      if (setting.default === undefined) continue
      expect(typeMatches(setting, setting.default), `${setting.path.join('.')} default ${JSON.stringify(setting.default)}`).toBe(true)
    }
  })

  it('lists every default among the options of a select or multi-select', () => {
    for (const setting of SETTINGS) {
      const { control } = setting
      if (control.kind === 'select' && setting.default !== undefined) {
        const options = control.options.map((o) => String(o).toLowerCase())
        expect(options, setting.path.join('.')).toContain(String(setting.default).toLowerCase())
      }
      if (control.kind === 'multi' && typeof control.options !== 'string' && Array.isArray(setting.default)) {
        for (const value of setting.default) expect(control.options, setting.path.join('.')).toContain(value)
      }
    }
  })

  it('uses controls that fit the value type', () => {
    const fits: Record<string, string[]> = {
      boolean: ['toggle'],
      string: ['text', 'select', 'url', 'color'],
      integer: ['number'],
      number: ['number'],
      boolOrString: ['select'],
      duration: ['duration'],
      stringList: ['list', 'multi', 'lines'],
      stringOrList: ['list'],
      pairList: ['pairs'],
      stringMap: ['kv'],
      objectList: ['table'],
      objectMap: ['table'],
      any: ['readonly'],
    }
    for (const setting of SETTINGS) expect(fits[setting.type], setting.path.join('.')).toContain(setting.control.kind)
  })

  it('links every key to the Hugo documentation', () => {
    for (const setting of SETTINGS) expect(setting.docs).toMatch(/^https:\/\/gohugo\.io\/configuration\//)
  })

  it('asks for confirmation before risky changes', () => {
    const risky = (path: string) => SETTINGS.find((s) => s.path.join('.') === path)?.requiresConfirm
    expect(risky('markup.goldmark.renderer.unsafe')).toBe(true)
    expect(risky('build.cleanDestinationDir.enable')).toBe(true)
    for (const s of SETTINGS.filter((s) => s.group === 'security')) expect(s.requiresConfirm, s.path.join('.')).toBe(true)
  })

  it('offers all 74 Chroma styles', () => {
    expect(CHROMA_STYLE_NAMES).toHaveLength(74)
    expect(new Set(CHROMA_STYLE_NAMES).size).toBe(74)
    expect(CHROMA_STYLE_NAMES).toContain('monokai')
    expect(CHROMA_STYLE_NAMES).toContain('github-dark')
  })
})
