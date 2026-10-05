import { describe, expect, it } from 'vitest'

import { messages } from './messages'

const sources = import.meta.glob(['./**/*.tsx', './**/*.ts', '!./**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function has(tree: unknown, key: string): boolean {
  let current: unknown = tree
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return false
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string'
}

describe('pages messages', () => {
  const used = new Set<string>()
  for (const text of Object.values(sources)) {
    for (const match of text.matchAll(/\bt\(\s*'pages\.([A-Za-z0-9_.]+)'/g)) used.add(match[1])
  }

  it('finds the keys used by the view', () => {
    expect(used.size).toBeGreaterThan(10)
  })

  it.each([...used].sort())('defines %s in English and Turkish', (key) => {
    expect(has(messages.en, key), `en: ${key}`).toBe(true)
    expect(has(messages.tr, key), `tr: ${key}`).toBe(true)
  })

  it('names every reason a page is listed', () => {
    for (const reason of ['home', 'section', 'root', 'type'] as const) {
      expect(messages.en.reason[reason]).toBeTruthy()
      expect(messages.tr.reason[reason]).toBeTruthy()
    }
  })
})
