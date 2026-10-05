import { describe, expect, it } from 'vitest'

import { messages } from './messages'
import { MIGRATION_RULES } from './model/migration'
import { PRESETS } from './model/presets'

const sources = import.meta.glob(['./**/*.tsx', './**/*.ts', '!./**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function has(tree: unknown, key: string): boolean {
  let current: unknown = tree
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return false
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string'
}

/** `pending.count` may be stored as `count_one` / `count_other`. */
function exists(tree: unknown, key: string): boolean {
  return has(tree, key) || (has(tree, `${key}_one`) && has(tree, `${key}_other`))
}

describe('settings messages', () => {
  const used = new Set<string>()
  for (const text of Object.values(sources)) {
    for (const match of text.matchAll(/\bt\(\s*'settings\.([A-Za-z0-9_.]+)'/g)) used.add(match[1])
  }

  it('finds the keys used by the components', () => {
    expect(used.size).toBeGreaterThan(100)
  })

  it.each([...used].sort())('defines %s in English and Turkish', (key) => {
    expect(exists(messages.en, key), `en: ${key}`).toBe(true)
    expect(exists(messages.tr, key), `tr: ${key}`).toBe(true)
  })

  it('explains every migration rule and preset in both languages', () => {
    for (const rule of MIGRATION_RULES) {
      expect(messages.en.migration.rules[rule.id as keyof typeof messages.en.migration.rules], rule.id).toBeTruthy()
      expect(messages.tr.migration.rules[rule.id as keyof typeof messages.tr.migration.rules], rule.id).toBeTruthy()
    }
    for (const preset of PRESETS) {
      expect(messages.en.presets[preset.id].title).toBeTruthy()
      expect(messages.tr.presets[preset.id].description).toBeTruthy()
    }
  })

  it('uses common.* and review.* keys that exist', () => {
    // These come from the app-wide strings; spot-check the ones this feature relies on.
    const common = ['common.cancel', 'common.save', 'common.saving', 'common.saved', 'common.loading', 'review.valid', 'review.invalid', 'review.checking', 'document.reload', 'document.unsaved']
    for (const text of Object.values(sources)) {
      for (const match of text.matchAll(/\bt\(\s*'((?:common|review|document)\.[A-Za-z]+)'/g)) expect(common).toContain(match[1])
    }
  })
})
