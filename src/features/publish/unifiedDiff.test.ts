import { describe, expect, it } from 'vitest'

import { parseUnifiedDiff, unquote } from './unifiedDiff'

describe('parseUnifiedDiff', () => {
  it('parses a modified file with line numbers', () => {
    const text = [
      'diff --git a/içerik/ğüşıöç.md b/içerik/ğüşıöç.md',
      'index 1111111..2222222 100644',
      '--- a/içerik/ğüşıöç.md',
      '+++ b/içerik/ğüşıöç.md',
      '@@ -1,3 +1,4 @@ title: x',
      ' bir',
      '-iki',
      '+İKİ',
      '+--- not a header',
      ' üç',
      '@@ -10 +11 @@',
      '-on',
      '+on bir',
      '\\ No newline at end of file',
      '',
    ].join('\n')
    const [file] = parseUnifiedDiff(text)
    expect(file).toMatchObject({ oldPath: 'içerik/ğüşıöç.md', newPath: 'içerik/ğüşıöç.md', status: 'modified', binary: false })
    expect(file.hunks).toHaveLength(2)
    expect(file.hunks[0].section).toBe('title: x')
    expect(file.hunks[0].lines).toEqual([
      { type: 'context', text: 'bir', oldLine: 1, newLine: 1 },
      { type: 'del', text: 'iki', oldLine: 2, newLine: null },
      { type: 'add', text: 'İKİ', oldLine: null, newLine: 2 },
      { type: 'add', text: '--- not a header', oldLine: null, newLine: 3 },
      { type: 'context', text: 'üç', oldLine: 3, newLine: 4 },
    ])
    expect(file.hunks[1].lines).toEqual([
      { type: 'del', text: 'on', oldLine: 10, newLine: null },
      { type: 'add', text: 'on bir', oldLine: null, newLine: 11 },
      { type: 'note', text: 'No newline at end of file', oldLine: null, newLine: null },
    ])
  })

  it('parses new, deleted, renamed and binary files, stripping CRs', () => {
    const text = [
      'diff --git a/yeni yazı.md b/yeni yazı.md',
      'new file mode 100644',
      'index 0000000..8ba3a16',
      '--- /dev/null',
      '+++ b/yeni yazı.md',
      '@@ -0,0 +1,2 @@',
      '+satır 1\r',
      '+satır 2\r',
      'diff --git a/gidecek.md b/gidecek.md',
      'deleted file mode 100644',
      '--- a/gidecek.md',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-elveda',
      'diff --git a/eski.md b/yeni.md',
      'similarity index 100%',
      'rename from eski.md',
      'rename to yeni.md',
      'diff --git a/logo.png b/logo.png',
      'new file mode 100644',
      'Binary files /dev/null and b/logo.png differ',
    ].join('\n')
    const files = parseUnifiedDiff(text)
    expect(files.map((f) => [f.status, f.oldPath, f.newPath, f.binary])).toEqual([
      ['added', null, 'yeni yazı.md', false],
      ['deleted', 'gidecek.md', null, false],
      ['renamed', 'eski.md', 'yeni.md', false],
      ['added', 'logo.png', 'logo.png', true],
    ])
    expect(files[0].hunks[0].lines.map((l) => [l.text, l.newLine])).toEqual([
      ['satır 1', 1],
      ['satır 2', 2],
    ])
    expect(files[2].similarity).toBe(100)
    expect(files[2].hunks).toEqual([])
  })

  it('reads quoted paths and plain --- / +++ diffs', () => {
    const text = [
      'diff --git "a/tab\\there.md" "b/tab\\there.md"',
      '--- "a/tab\\there.md"',
      '+++ "b/tab\\there.md"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '--- a/x.md',
      '+++ b/x.md',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n')
    const files = parseUnifiedDiff(text)
    expect(files.map((f) => f.newPath)).toEqual(['tab\there.md', 'x.md'])
  })

  it('keeps the truncation marker as a note', () => {
    const files = parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n\\ (diff truncated)\n')
    expect(files[0].hunks[0].lines.at(-1)).toEqual({ type: 'note', text: '(diff truncated)', oldLine: null, newLine: null })
  })

  it('returns nothing for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})

describe('unquote', () => {
  it('decodes C-style escapes and octal UTF-8 bytes', () => {
    expect(unquote('"i\\303\\247erik/\\"a\\".md"')).toBe('içerik/"a".md')
    expect(unquote('"emoji 😀 \\\\"')).toBe('emoji 😀 \\')
    expect(unquote('plain')).toBe('plain')
  })
})
