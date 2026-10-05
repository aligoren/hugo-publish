import { describe, expect, it } from 'vitest'

import { hasKeepFiles, riskyChanges, risksOfOps, risksOfValues } from './risk'
import { sourceOf, sourcesOf } from './testing'

describe('risky changes', () => {
  it('flags raw HTML only when it is turned on', () => {
    expect(riskyChanges({}, { markup: { goldmark: { renderer: { unsafe: true } } } })).toEqual([
      { kind: 'unsafe', key: 'markup.goldmark.renderer.unsafe', value: true },
    ])
    expect(riskyChanges({ markup: { goldmark: { renderer: { unsafe: true } } } }, { markup: { goldmark: { renderer: { unsafe: false } } } })).toEqual([])
  })

  it('flags every security change, _merge anywhere and cleanDestinationDir', () => {
    const risks = riskyChanges(
      { security: { exec: { allow: ['^go$'] } } },
      {
        security: { exec: { allow: ['^go$', '^curl$'] } },
        params: { _merge: 'deep' },
        cleanDestinationDir: true,
        build: { cleanDestinationDir: { enable: true } },
      },
    )
    expect(risks.map((r) => [r.kind, r.key])).toEqual([
      ['security', 'security.exec.allow'],
      ['merge', 'params._merge'],
      ['cleanDestinationDir', 'cleanDestinationDir'],
      ['cleanDestinationDir', 'build.cleanDestinationDir.enable'],
    ])
  })

  it('matches keys without regard to case and flags other confirm-only settings', () => {
    expect(riskyChanges({ Security: { funcs: { getenv: ['^HUGO_'] } } }, { security: { funcs: { getenv: ['^HUGO_'] } } })).toEqual([])
    expect(riskyChanges({}, { canonifyURLs: true }).map((r) => r.kind)).toEqual(['confirm'])
    expect(riskyChanges({ title: 'a' }, { title: 'b' })).toEqual([])
  })

  it('reads pending ops of each file in its place in the merged config', () => {
    const sources = sourcesOf({
      'hugo.toml': { title: 'x' },
      'config/_default/markup.toml': { goldmark: { renderer: { unsafe: false } } },
    })
    const risks = risksOfOps(sources, {
      'config/_default/markup.toml': [{ op: 'set', path: ['goldmark', 'renderer', 'unsafe'], value: true }],
      'hugo.toml': [{ op: 'set', path: ['title'], value: 'y' }],
    })
    expect(risks).toEqual([{ file: 'config/_default/markup.toml', kind: 'unsafe', key: 'markup.goldmark.renderer.unsafe', value: true }])
  })

  it('compares raw text values with the file on disk', () => {
    const source = sourceOf('hugo.toml', { title: 'x' })
    expect(risksOfValues(source, { title: 'x', security: { enableInlineShortcodes: true } }).map((r) => r.key)).toEqual(['security.enableInlineShortcodes'])
  })

  it('knows whether keepFiles protects extra files', () => {
    expect(hasKeepFiles({ build: { cleanDestinationDir: { keepFiles: ['CNAME'] } } })).toBe(true)
    expect(hasKeepFiles({ build: { cleanDestinationDir: { enable: true } } })).toBe(false)
  })
})
