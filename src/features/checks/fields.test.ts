import { describe, expect, it } from 'vitest'

import { parseDocument, readTomlTopLevel } from './fields'

describe('readTomlTopLevel', () => {
  it('reads top-level strings, booleans, numbers, dates and arrays', () => {
    const text = [
      '# yorum',
      "title = 'Merhaba: \"dünya\"'",
      'description = "Satır\\tsekme \\u00e7 \\U0001F600" # yorum',
      'draft = true',
      'weight = 1_000',
      'date = 2026-10-04T10:00:00+03:00',
      'tags = ["a", \'b\', "c,d"]',
      'categories = [',
      '  "x", # yorum',
      '  "y",',
      ']',
      '"quoted key" = "q"',
      'summary = """',
      'iki',
      'satır"""',
      'inline = { a = 1 }',
      '[params]',
      'title = "params title"',
    ].join('\r\n')
    expect(readTomlTopLevel(text)).toEqual({
      title: 'Merhaba: "dünya"',
      description: 'Satır\tsekme ç 😀',
      draft: true,
      weight: 1000,
      date: '2026-10-04T10:00:00+03:00',
      tags: ['a', 'b', 'c,d'],
      categories: ['x', 'y'],
      'quoted key': 'q',
      summary: 'iki\nsatır',
    })
  })
})

describe('parseDocument', () => {
  it('finds where the body starts', () => {
    expect(parseDocument('---\r\ntitle: A\r\n---\r\nGövde').bodyLine).toBe(4)
    expect(parseDocument('﻿+++\ntitle = "A"\n+++\n\nGövde').bodyLine).toBe(4)
    expect(parseDocument('Gövde').bodyLine).toBe(1)
  })

  it('returns fields or the parse error', () => {
    expect(parseDocument('---\ntitle: A\n---\n').fields).toEqual({ title: 'A' })
    expect(parseDocument('+++\ntitle = "A"\n+++\n').fields).toEqual({ title: 'A' })
    expect(parseDocument('no front matter').fields).toBeNull()
    const broken = parseDocument('---\ntitle: [x\n---\n')
    expect(broken.fields).toBeNull()
    expect(broken.error).toBeTruthy()
  })
})
