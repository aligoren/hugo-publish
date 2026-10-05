import { describe, expect, it } from 'vitest'

import { isExpired, isFuture } from './dates'

describe('page dates', () => {
  const now = '2026-10-04T20:30:00.000Z'

  it('compares instants, not text, across time zones', () => {
    // 23:14 in +03:00 is 20:14 UTC: already past, though "23" sorts after "20".
    expect(isFuture('2026-10-04T23:14:42+03:00', now)).toBe(false)
    expect(isFuture('2026-10-04T23:44:42+03:00', now)).toBe(true)
    expect(isExpired('2026-10-04T23:14:42+03:00', now)).toBe(true)
  })

  it('ignores unset dates', () => {
    expect(isFuture('0001-01-01T00:00:00Z', now)).toBe(false)
    expect(isExpired('0001-01-01T00:00:00Z', now)).toBe(false)
    expect(isFuture('', now)).toBe(false)
  })
})
