import { describe, expect, it } from 'vitest'

import { shortPath, timeAgo } from './display'

describe('shortPath', () => {
  it('keeps short paths as they are', () => {
    expect(shortPath('D:\\Workspace\\blog')).toBe('D:\\Workspace\\blog')
  })

  it('shows the home folder as ~ and cuts long paths in the middle', () => {
    expect(shortPath('C:\\Users\\ali\\AppData\\Local\\Temp\\x\\site-copy')).toBe('~\\…\\x\\site-copy')
    expect(shortPath('/home/ali/sites/blog')).toBe('~/sites/blog')
    expect(shortPath('/srv/www/a/b/c/blog')).toBe('/…/c/blog')
  })

  it('shows the home folder itself as ~', () => {
    expect(shortPath('/home/alice')).toBe('~')
    expect(shortPath('C:\\Users\\ali-old')).toBe('~')
  })
})

describe('timeAgo', () => {
  const now = Date.UTC(2026, 9, 5, 12)

  it('uses the largest whole unit', () => {
    expect(timeAgo(now - 2 * 3600_000, now, 'en')).toBe('2 hours ago')
    expect(timeAgo(now - 26 * 3600_000, now, 'en')).toBe('yesterday')
    expect(timeAgo(now - 10_000, now, 'en')).toBe('now')
  })
})
