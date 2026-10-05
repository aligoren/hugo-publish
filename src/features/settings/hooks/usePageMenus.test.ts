import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api', () => ({ api: {} }))

import { siteUrlConfig } from '../../../lib/permalinks'
import { pageLanguage } from './usePageMenus'

describe('the language of a page with menu entries', () => {
  it('comes from the content folder of a language, else from the file name', () => {
    const config = siteUrlConfig({ defaultContentLanguage: 'en', languages: { en: {}, tr: { contentDir: 'content/tr' } } })
    expect(pageLanguage('content/tr/hakkinda.md', ['en', 'tr'], config)).toBe('tr')
    expect(pageLanguage('content/about.tr.md', ['en', 'tr'], config)).toBe('tr')
    expect(pageLanguage('content/about.md', ['en', 'tr'], config)).toBeNull()
    // Without the settings only the file name tells.
    expect(pageLanguage('content/tr/hakkinda.md', ['en', 'tr'], null)).toBeNull()
    expect(pageLanguage('content/about.tr.md', ['en', 'tr'], null)).toBe('tr')
  })
})
