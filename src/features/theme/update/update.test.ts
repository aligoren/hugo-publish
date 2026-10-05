import { describe, expect, it } from 'vitest'

import { findOverrides } from '../overrides'
import { scanTemplates } from '../scan/scanner'
import { compareHashes, hashText, inferSource, isLockedPath, isTextFile, lockText, makeLock, parseGithubRepo, parseLock, sizeHash } from './lock'
import { CONFLICT_OURS, CONFLICT_THEIRS, hasConflictMarkers, merge3 } from './merge3'
import { githubModule, moduleTags, shortSha, sortTagsNewestFirst } from './repoInfo'
import { classifyDrift, i18nDrift, lostHooks, paramDiff, paramsBecomingUnused } from './plan'

describe('merge3', () => {
  const base = 'a\nb\nc\nd\ne\n'

  it('takes non-overlapping changes from both sides', () => {
    expect(merge3(base, 'a\nB\nc\nd\ne\n', 'a\nb\nc\nD\ne\n')).toEqual({ text: 'a\nB\nc\nD\ne\n', conflicts: 0 })
    expect(merge3(base, 'x\na\nb\nc\nd\ne\n', 'a\nb\nc\nd\ne\ny\n')).toEqual({ text: 'x\na\nb\nc\nd\ne\ny\n', conflicts: 0 })
    expect(merge3(base, 'a\nc\nd\ne\n', 'a\nb\nc\nd\n')).toEqual({ text: 'a\nc\nd\n', conflicts: 0 })
  })

  it('accepts the same change on both sides and one-sided changes', () => {
    expect(merge3(base, 'a\nX\nc\nd\ne\n', 'a\nX\nc\nd\ne\n').conflicts).toBe(0)
    expect(merge3(base, base, 'a\nb\nNEW\nd\ne\n').text).toBe('a\nb\nNEW\nd\ne\n')
    expect(merge3(base, 'a\nb\nMINE\nd\ne\n', base).text).toBe('a\nb\nMINE\nd\ne\n')
  })

  it('marks overlapping changes as conflicts', () => {
    const result = merge3(base, 'a\nmine\nc\nd\ne\n', 'a\ntheirs\nc\nd\ne\n')
    expect(result.conflicts).toBe(1)
    expect(result.text).toBe(
      ['a', CONFLICT_OURS, 'mine', '||||||| theme before the update', 'b', '=======', 'theirs', CONFLICT_THEIRS, 'c', 'd', 'e', ''].join('\n'),
    )
    expect(hasConflictMarkers(result.text)).toBe(true)
    expect(hasConflictMarkers('a\n<<<<<<< nope\n')).toBe(false)
  })

  it('keeps the site copy line endings (the deprecation-fix case)', () => {
    const themeOld = '<html dir="{{ .Language.LanguageDirection }}">\n<head></head>\n<body>\n<main>\n'
    const site = '{{/* site copy */}}\r\n<html dir="{{ .Language.Direction }}">\r\n<head></head>\r\n<body>\r\n<main>\r\n{{ partial "banner.html" . }}\r\n'
    const themeNew = '<html dir="{{ .Language.LanguageDirection }}">\n<head></head>\n<body class="x">\n<main>\n'
    expect(merge3(themeOld, site, themeNew)).toEqual({
      text: '{{/* site copy */}}\r\n<html dir="{{ .Language.Direction }}">\r\n<head></head>\r\n<body class="x">\r\n<main>\r\n{{ partial "banner.html" . }}\r\n',
      conflicts: 0,
    })
    // Changes on neighbouring lines overlap, as in git.
    expect(merge3('a\nb\n', 'A\nb\n', 'a\nB\n').conflicts).toBe(1)
  })
})

describe('classifyDrift', () => {
  it('classifies overrides against the new theme version', () => {
    expect(classifyDrift({ base: 'a\n', theirs: 'a\r\n', ours: 'x\n', baseReliable: true }).kind).toBe('unchanged')
    expect(classifyDrift({ base: 'a\n', theirs: null, ours: 'x\n', baseReliable: true }).kind).toBe('themeRemoved')
    expect(classifyDrift({ base: 'old\n', theirs: 'fixed\n', ours: 'fixed\n', baseReliable: true }).kind).toBe('nowIdentical')
    expect(classifyDrift({ base: 'a\nx\nb\n', theirs: 'a\nx\nB\n', ours: 'A\nx\nb\n', baseReliable: true })).toEqual({
      kind: 'merged',
      merged: 'A\nx\nB\n',
      conflicts: 0,
    })
    expect(classifyDrift({ base: 'a\n', theirs: 'b\n', ours: 'c\n', baseReliable: true })).toMatchObject({ kind: 'conflict', conflicts: 1 })
    expect(classifyDrift({ base: 'a\n', theirs: 'b\n', ours: 'c\n', baseReliable: false }).kind).toBe('noBase')
  })
})

describe('theme lock', () => {
  it('hashes text with normalised line endings', async () => {
    const lf = await hashText('a\nb\n')
    expect(lf).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(await hashText('a\r\nb\r\n')).toBe(lf)
    expect(await hashText('﻿a\nb\n')).toBe(lf)
    expect(await hashText('a\nc\n')).not.toBe(lf)
    expect(sizeHash(12)).toBe('size:12')
    expect(isTextFile('layouts/a.html')).toBe(true)
    expect(isTextFile('images/x.png')).toBe(false)
    expect(isLockedPath('exampleSite/hugo.toml')).toBe(false)
    expect(isLockedPath('layouts/.DS_Store')).toBe(false)
    expect(isLockedPath('layouts/x.html')).toBe(true)
  })

  it('compares the lock with the theme folder', () => {
    const lock = { 'a.html': 'sha256:1', 'b.html': 'sha256:2', 'c.png': 'size:3' }
    expect(compareHashes(lock, { 'a.html': 'sha256:1', 'b.html': 'sha256:9', 'd.html': 'sha256:4' })).toEqual({
      added: ['d.html'],
      changed: ['b.html'],
      removed: ['c.png'],
    })
  })

  it('reads and writes the lock file and finds the source repository', () => {
    const lock = makeLock('PaperMod', { owner: 'adityatelange', repo: 'hugo-PaperMod', name: 'PaperMod' }, { 'x.html': 'sha256:1' }, new Date('2026-10-04T00:00:00Z'))
    expect(parseLock(lockText(lock))).toEqual({
      theme: 'PaperMod',
      source: { owner: 'adityatelange', repo: 'hugo-PaperMod' },
      installedAt: '2026-10-04T00:00:00.000Z',
      files: { 'x.html': 'sha256:1' },
    })
    expect(parseLock('{"theme":1}')).toBeNull()
    expect(parseLock('nope')).toBeNull()
    expect(parseGithubRepo('https://github.com/CaiJimmy/hugo-theme-stack/')).toEqual({ owner: 'CaiJimmy', repo: 'hugo-theme-stack' })
    expect(parseGithubRepo('git@github.com:alex-shpak/hugo-book.git')).toEqual({ owner: 'alex-shpak', repo: 'hugo-book' })
    expect(parseGithubRepo('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
    expect(parseGithubRepo('https://example.org/x')).toBeNull()
    expect(inferSource({ homepage: 'https://github.com/adityatelange/hugo-PaperMod/' }, null)).toEqual({ owner: 'adityatelange', repo: 'hugo-PaperMod' })
    expect(inferSource({ homepage: 'https://blowfish.page' }, 'github.com/nunocoracao/blowfish/v2')).toEqual({ owner: 'nunocoracao', repo: 'blowfish' })
    expect(inferSource({ homepage: 'https://example.org' }, null)).toBeNull()
  })
})

describe('update report', () => {
  it('lists params added and removed between versions', () => {
    const before = scanTemplates([{ path: 'layouts/a.html', text: '{{ site.Params.keep }}{{ site.Params.assets.disableHLJS }}{{ range site.Params.icons }}{{ .url }}{{ end }}' }])
    const after = scanTemplates([{ path: 'layouts/a.html', text: '{{ site.Params.Keep }}{{ site.Params.disableLangToggle }}{{ .Params.newPage }}' }])
    expect(paramDiff(before, after)).toEqual({ added: ['disableLangToggle', 'newPage'], removed: ['assets.disableHLJS', 'icons'] })
    expect(paramsBecomingUnused(['typo'], ['Typo', 'icons'])).toEqual(['icons'])
  })

  it('finds hooks the site relies on that the new version lacks', () => {
    const oldTheme = ['layouts/_partials/extend_post_content.html', 'assets/css/extended/blank.css', 'layouts/baseof.html']
    const entries = findOverrides(
      ['layouts/partials/extend_post_content.html', 'assets/css/extended/alert.css', 'layouts/baseof.html'],
      oldTheme,
      'themes/T',
    )
    expect(lostHooks(entries, ['layouts/baseof.html'])).toEqual([
      { sitePath: 'layouts/partials/extend_post_content.html', hook: 'layouts/_partials/extend_post_content.html' },
      { sitePath: 'assets/css/extended/alert.css', hook: 'assets/css/extended/' },
    ])
    expect(lostHooks(entries, oldTheme)).toEqual([])
  })
})

describe('repository info', () => {
  it('sorts version tags newest first and keeps other tags after them', () => {
    expect(sortTagsNewestFirst(['v7.0', 'latest', 'v8.0', 'v7.10', 'v7.2', 'v8.0-rc1', '1.0.0'])).toEqual(['v8.0', 'v8.0-rc1', 'v7.10', 'v7.2', 'v7.0', '1.0.0', 'latest'])
    expect(shortSha('d3768854d00ad003b0a8dbdba254ce9224377a01')).toBe('d376885')
    expect(shortSha(null)).toBe('')
  })
})


describe('module updates and content hashes', () => {
  it('reads GitHub module paths and keeps tags go get can use', () => {
    expect(githubModule('github.com/nunocoracao/blowfish/v2')).toEqual({ owner: 'nunocoracao', repo: 'blowfish', major: 2 })
    expect(githubModule('github.com/adityatelange/hugo-PaperMod')).toEqual({ owner: 'adityatelange', repo: 'hugo-PaperMod', major: null })
    expect(githubModule('gitlab.com/a/b')).toBeNull()
    const tags = ['v1.0.0', 'v2.1.0', 'v2.0.0', 'v2.2.0-beta.1', 'v0.9.1', 'nightly', 'v2.1']
    expect(moduleTags(tags, 2)).toEqual(['v2.2.0-beta.1', 'v2.1.0', 'v2.0.0'])
    expect(moduleTags(tags, null)).toEqual(['v1.0.0', 'v0.9.1'])
  })

  it('accepts old size-only lock entries when the size is unchanged', () => {
    const lock = { 'a.png': 'size:3', 'b.png': 'size:3', 'c.html': 'sha256:1' }
    const now = { 'a.png': 'sha256:aa', 'b.png': 'sha256:bb', 'c.html': 'sha256:1' }
    expect(compareHashes(lock, now, { 'a.png': 3, 'b.png': 4 })).toEqual({ added: [], changed: ['b.png'], removed: [] })
  })

  it('finds site i18n keys whose theme text changed or went away', () => {
    const site = { shape: 'map' as const, entries: { readMore: 'Devamı', toc: 'İçindekiler', own: 'Kendi' } }
    const before = { shape: 'list' as const, entries: { readMore: 'Read more', toc: 'Table of contents', gone: 'x' } }
    const after = { shape: 'map' as const, entries: { ReadMore: 'Continue reading', newKey: 'y' } }
    expect(i18nDrift('i18n/tr.yaml', 'tr', site, before, after)).toEqual({
      sitePath: 'i18n/tr.yaml',
      language: 'tr',
      changed: [{ key: 'readMore', site: 'Devamı', before: 'Read more', after: 'Continue reading' }],
      removed: [{ key: 'toc', site: 'İçindekiler', before: 'Table of contents', after: null }],
    })
    expect(i18nDrift('i18n/tr.yaml', 'tr', site, before, before)).toMatchObject({ changed: [], removed: [] })
  })
})
