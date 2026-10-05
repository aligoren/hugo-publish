import { describe, expect, it } from 'vitest'

import type { PageEntry } from '../../lib/api'
import { backupFileName, countPages, recentlyEdited } from './summary'

const ZERO = '0001-01-01T00:00:00Z'

function page(overrides: Partial<PageEntry>): PageEntry {
  return {
    path: 'content/x.md',
    slug: '',
    title: 'x',
    date: ZERO,
    expiryDate: ZERO,
    publishDate: ZERO,
    draft: false,
    permalink: 'https://example.org/x/',
    kind: 'page',
    section: '',
    ...overrides,
  }
}

describe('countPages', () => {
  it('sorts pages into published, drafts, scheduled and expired', () => {
    const now = '2026-10-04T12:00:00+03:00'
    const counts = countPages(
      [
        page({}),
        page({ draft: true, publishDate: '2030-01-01T00:00:00Z' }),
        page({ publishDate: '2026-10-05T00:00:00+03:00' }),
        page({ publishDate: '2026-10-04T08:00:00+00:00' }),
        page({ expiryDate: '2026-01-01T00:00:00Z' }),
        page({ kind: 'section' }),
        page({ kind: 'term' }),
      ],
      now,
    )
    expect(counts).toEqual({ published: 2, drafts: 1, scheduled: 1, expired: 1 })
  })
})

describe('recentlyEdited', () => {
  it('lists the newest edits first', () => {
    const files = [1, 5, 3].map((m) => ({ path: `p${m}`, title: null, modifiedMs: m }))
    expect(recentlyEdited(files, 2).map((f) => f.path)).toEqual(['p5', 'p3'])
  })
})

describe('backupFileName', () => {
  it('names the zip after the site and the date', () => {
    expect(backupFileName('blog', new Date(2026, 9, 4))).toBe('blog-backup-2026-10-04.zip')
    expect(backupFileName('', new Date(2026, 0, 9))).toBe('site-backup-2026-01-09.zip')
  })
})
