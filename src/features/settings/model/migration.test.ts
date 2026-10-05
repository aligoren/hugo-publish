import { describe, expect, it } from 'vitest'

import {
  deprecationSeverity,
  findMigrations,
  fixOpsByFile,
  hugoProblems,
  MIGRATION_RULES,
  parseVersion,
  ruleStatus,
  sortFindings,
  toVersion,
  type Finding,
} from './migration'
import { sourcesOf } from './testing'

const v = parseVersion
const HUGO_167 = v('0.167.0')

function byRule(findings: Finding[], id: string): Finding[] {
  return findings.filter((f) => f.rule.id === id)
}

function rule(id: string) {
  const found = MIGRATION_RULES.find((r) => r.id === id)
  if (!found) throw new Error(id)
  return found
}

describe('deprecation severity', () => {
  it('follows Hugo’s INFO < 3 minors, WARN < 15, then ERROR rule', () => {
    expect(deprecationSeverity(v('0.167.0'), HUGO_167)).toBe('info')
    expect(deprecationSeverity(v('0.165.0'), HUGO_167)).toBe('info')
    expect(deprecationSeverity(v('0.164.0'), HUGO_167)).toBe('warn')
    expect(deprecationSeverity(v('0.158.0'), HUGO_167)).toBe('warn')
    expect(deprecationSeverity(v('0.153.0'), HUGO_167)).toBe('warn')
    expect(deprecationSeverity(v('0.153.0'), v('0.168.0'))).toBe('error')
    expect(deprecationSeverity(v('0.152.0'), HUGO_167)).toBe('error')
    expect(deprecationSeverity(v('0.148.0'), HUGO_167)).toBe('error')
    expect(deprecationSeverity(v('0.158.0'), v('1.0.0'))).toBe('error')
  })

  it('marks removed keys as silently ignored from the version that dropped them', () => {
    expect(ruleStatus(rule('paginate'), v('0.155.0'))).toBe('error')
    expect(ruleStatus(rule('paginate'), v('0.156.0'))).toBe('ignored')
    expect(ruleStatus(rule('privacyTwitter'), v('0.164.2'))).toBe('error')
    expect(ruleStatus(rule('privacyTwitter'), HUGO_167)).toBe('ignored')
    expect(ruleStatus(rule('languageCode'), HUGO_167)).toBe('warn')
    expect(ruleStatus(rule('cleanDestinationDir'), HUGO_167)).toBe('info')
    expect(ruleStatus(rule('renderHooksEnableDefault'), HUGO_167)).toBe('error')
    // Still works without a message.
    expect(ruleStatus(rule('permalinkFilename'), HUGO_167)).toBe('info')
  })

  it('uses the installed version, or the catalog version without Hugo', () => {
    expect(toVersion({ major: 0, minor: 160, patch: 1, extended: true, withDeploy: false, os: 'windows', arch: 'amd64' })).toEqual(v('0.160.1'))
    expect(toVersion(null)).toEqual(HUGO_167)
  })
})

describe('finding deprecated keys', () => {
  const legacy = sourcesOf({
    'hugo.toml': {
      baseURL: 'https://example.com/',
      languageCode: 'tr',
      paginate: 5,
      paginatePath: 'sayfa',
      cleanDestinationDir: true,
      author: { name: 'Ali', email: 'a@example.com' },
      disableKinds: ['taxonomyTerm', 'rss'],
      permalinks: { posts: '/:year/:filename/', page: { notes: '/:slugorfilename/' } },
      privacy: { twitter: { disable: true, simple: true }, x: { simple: false } },
      services: { twitter: { disableInlineCSS: true } },
      markup: { goldmark: { renderHooks: { image: { enableDefault: true }, link: { enableDefault: false } } } },
      languages: { tr: { languageName: 'Türkçe', languageDirection: 'ltr', paginate: 8 } },
    },
  })
  const findings = findMigrations(legacy, HUGO_167)

  it('renames languageCode to locale and keeps an existing locale', () => {
    expect(byRule(findings, 'languageCode')[0].ops).toEqual([
      { op: 'set', path: ['locale'], value: 'tr' },
      { op: 'remove', path: ['languageCode'] },
    ])
    const both = findMigrations(sourcesOf({ 'hugo.toml': { languageCode: 'tr', locale: 'tr-TR' } }), HUGO_167)
    expect(byRule(both, 'languageCode')[0].ops).toEqual([{ op: 'remove', path: ['languageCode'] }])
  })

  it('renames per-language keys', () => {
    expect(byRule(findings, 'languageName')[0]).toMatchObject({
      oldKey: 'languages.tr.languageName',
      ops: [
        { op: 'set', path: ['languages', 'tr', 'label'], value: 'Türkçe' },
        { op: 'remove', path: ['languages', 'tr', 'languageName'] },
      ],
    })
    expect(byRule(findings, 'languageDirection')[0].ops[0]).toEqual({ op: 'set', path: ['languages', 'tr', 'direction'], value: 'ltr' })
  })

  it('moves the silently ignored pagination keys, also per language', () => {
    const paginate = byRule(findings, 'paginate')
    expect(paginate.map((f) => f.status)).toEqual(['ignored', 'ignored'])
    expect(paginate[0].ops).toEqual([
      { op: 'set', path: ['pagination', 'pagerSize'], value: 5 },
      { op: 'remove', path: ['paginate'] },
    ])
    expect(paginate[1].ops).toEqual([
      { op: 'set', path: ['languages', 'tr', 'pagination', 'pagerSize'], value: 8 },
      { op: 'remove', path: ['languages', 'tr', 'paginate'] },
    ])
    expect(byRule(findings, 'paginatePath')[0].ops[0]).toEqual({ op: 'set', path: ['pagination', 'path'], value: 'sayfa' })
  })

  it('moves twitter tables to x without overwriting x keys', () => {
    expect(byRule(findings, 'privacyTwitter')[0]).toMatchObject({
      status: 'ignored',
      ops: [
        { op: 'set', path: ['privacy', 'x', 'disable'], value: true },
        { op: 'remove', path: ['privacy', 'twitter'] },
      ],
    })
    expect(byRule(findings, 'servicesTwitter')[0].ops[0]).toEqual({ op: 'set', path: ['services', 'x', 'disableInlineCSS'], value: true })
  })

  it('converts enableDefault to useEmbedded', () => {
    expect(byRule(findings, 'renderHooksEnableDefault').map((f) => f.ops[0])).toEqual([
      { op: 'set', path: ['markup', 'goldmark', 'renderHooks', 'image', 'useEmbedded'], value: 'fallback' },
      { op: 'set', path: ['markup', 'goldmark', 'renderHooks', 'link', 'useEmbedded'], value: 'never' },
    ])
  })

  it('moves root cleanDestinationDir and author, and fixes taxonomyTerm', () => {
    expect(byRule(findings, 'cleanDestinationDir')[0].ops[0]).toEqual({ op: 'set', path: ['build', 'cleanDestinationDir', 'enable'], value: true })
    expect(byRule(findings, 'author')[0]).toMatchObject({
      status: 'ignored',
      ops: [
        { op: 'set', path: ['params', 'author', 'name'], value: 'Ali' },
        { op: 'set', path: ['params', 'author', 'email'], value: 'a@example.com' },
        { op: 'remove', path: ['author'] },
      ],
    })
    expect(byRule(findings, 'taxonomyTerm')[0].ops).toEqual([{ op: 'set', path: ['disableKinds'], value: ['taxonomy', 'rss'] }])
  })

  it('rewrites deprecated permalink tokens', () => {
    expect(byRule(findings, 'permalinkFilename').map((f) => f.ops[0])).toEqual([
      { op: 'set', path: ['permalinks', 'posts'], value: '/:year/:contentbasename/' },
      { op: 'set', path: ['permalinks', 'page', 'notes'], value: '/:slugorcontentbasename/' },
    ])
  })

  it('fans out the global image settings inside a category file', () => {
    const sources = sourcesOf({ 'hugo.toml': {}, 'config/_default/imaging.toml': { quality: 80, webp: { quality: 70 }, hint: 'drawing' } })
    const result = findMigrations(sources, HUGO_167)
    expect(byRule(result, 'imagingQuality')[0]).toMatchObject({
      oldKey: 'imaging.quality',
      status: 'warn',
      ops: [
        { op: 'set', path: ['jpeg', 'quality'], value: 80 },
        { op: 'remove', path: ['quality'] },
      ],
    })
    expect(byRule(result, 'imagingHint')[0].ops).toEqual([
      { op: 'set', path: ['webp', 'hint'], value: 'drawing' },
      { op: 'set', path: ['avif', 'hint'], value: 'drawing' },
      { op: 'remove', path: ['hint'] },
    ])
  })

  it('flags mount options that become errors in the next release', () => {
    const sources = sourcesOf({
      'hugo.toml': { module: { mounts: [{ source: 'content/tr', target: 'content', lang: 'tr', excludeFiles: '*.draft.md' }] } },
    })
    const result = findMigrations(sources, HUGO_167)
    const mount = byRule(result, 'mountLang')
    expect(mount.every((f) => f.status === 'warn' && f.errorNextRelease)).toBe(true)
    expect(mount.flatMap((f) => f.ops)).toEqual([
      { op: 'set', path: ['module', 'mounts', 0, 'sites', 'matrix', 'languages'], value: ['tr'] },
      { op: 'remove', path: ['module', 'mounts', 0, 'lang'] },
      { op: 'set', path: ['module', 'mounts', 0, 'files'], value: ['! *.draft.md'] },
      { op: 'remove', path: ['module', 'mounts', 0, 'excludeFiles'] },
    ])
  })

  it('skips rules whose replacement the installed Hugo does not know yet', () => {
    const sources = sourcesOf({ 'hugo.toml': { languageCode: 'tr' } })
    expect(findMigrations(sources, v('0.150.0'))).toEqual([])
  })

  it('offers no fix for read-only JSON files', () => {
    const result = findMigrations(sourcesOf({ 'hugo.json': { paginate: 5 } }), HUGO_167)
    expect(result).toHaveLength(1)
    expect(result[0].ops).toEqual([])
  })

  it('groups fixes by file and lists silently ignored keys first', () => {
    const sources = sourcesOf({
      'hugo.toml': { languageCode: 'tr' },
      'config/_default/privacy.toml': { twitter: { disable: true } },
    })
    const result = findMigrations(sources, HUGO_167)
    expect(Object.keys(fixOpsByFile(result)).sort()).toEqual(['config/_default/privacy.toml', 'hugo.toml'])
    expect(fixOpsByFile(result)['config/_default/privacy.toml']).toEqual([
      { op: 'set', path: ['x', 'disable'], value: true },
      { op: 'remove', path: ['twitter'] },
    ])
    expect(sortFindings(result).map((f) => f.status)).toEqual(['ignored', 'warn'])
  })

  it('finds nothing in a current config', () => {
    const sources = sourcesOf({ 'hugo.toml': { locale: 'tr', pagination: { pagerSize: 5 }, privacy: { x: { disable: true } } } })
    expect(findMigrations(sources, HUGO_167)).toEqual([])
  })

  it('keeps only Hugo’s warnings and errors', () => {
    expect(
      hugoProblems([
        { level: 'info', text: 'Watching' },
        { level: 'warn', text: 'WARN  deprecated: project config key languageCode' },
        { level: 'error', text: 'ERROR failed' },
      ]).map((m) => m.level),
    ).toEqual(['warn', 'error'])
  })
})
