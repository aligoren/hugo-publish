import { describe, expect, it } from 'vitest'

import { KNOWN_SERVICES } from './lib/privacy'
import { messages } from './messages'

const sources = import.meta.glob<string>(['./**/*.tsx', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })

function lookup(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree)
}

/** A key exists as a string, or as the `_one`/`_other` pair of a plural. */
function has(tree: unknown, key: string): boolean {
  return typeof lookup(tree, key) === 'string' || (typeof lookup(tree, `${key}_one`) === 'string' && typeof lookup(tree, `${key}_other`) === 'string')
}

function leafKeys(tree: unknown, prefix = ''): string[] {
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
  )
}

const dynamicKeys = [
  ...['checks', 'internal', 'external', 'privacy', 'social', 'feeds', 'changes', 'config', 'live'].map((k) => `tabs.${k}`),
  ...['error', 'warn', 'info'].map((k) => `severity.${k}`),
  ...['added', 'changed', 'removed'].map((k) => `changes.kinds.${k}`),
  ...['full', 'summary', 'mixed', 'empty'].map((k) => `feeds.modes.${k}`),
  ...['missing', 'unpublished', 'contentMissing', 'fragmentMissing'].map((k) => `internal.problems.${k}`),
  ...['script', 'stylesheet', 'font', 'icon', 'preload', 'preconnect', 'image', 'media', 'iframe', 'embed', 'css'].map(
    (k) => `privacy.kinds.${k}`,
  ),
  ...[...new Set(KNOWN_SERVICES.map((s) => s.tip)), 'unknown'].map((k) => `privacy.tips.${k}`),
  ...[
    'noTitle',
    'titleLong',
    'noDescription',
    'descriptionLong',
    'descriptionShort',
    'noOgTitle',
    'noOgDescription',
    'noImage',
    'imageRelative',
    'noTwitterCard',
    'noSiteName',
    'noindex',
  ].map((k) => `social.hints.${k}`),
]

describe('health messages', () => {
  it('has every key the components use, in both languages', () => {
    const used = new Set<string>()
    for (const source of Object.values(sources)) {
      // Every 'health.…' string literal is a key, also in `t(ok ? 'health.a' : 'health.b')`.
      for (const match of source.matchAll(/'health\.([\w.]+)'/g)) used.add(match[1])
    }
    expect(used.size).toBeGreaterThan(50)
    for (const key of [...used, ...dynamicKeys]) {
      expect(has(messages.en, key), `en: ${key}`).toBe(true)
      expect(has(messages.tr, key), `tr: ${key}`).toBe(true)
    }
  })

  it('has the same keys in English and Turkish', () => {
    expect(leafKeys(messages.tr).sort()).toEqual(leafKeys(messages.en).sort())
  })
})
