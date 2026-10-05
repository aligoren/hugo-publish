import { describe, expect, it } from 'vitest'

import { groupByService, isNoreplyEmail, isThirdParty, knownService, PrivacyAudit, privacySettings } from './privacy'

describe('knownService', () => {
  it('matches hosts and subdomains', () => {
    expect(knownService('fonts.googleapis.com')?.name).toBe('Google Fonts')
    expect(knownService('www.googletagmanager.com')?.tip).toBe('analytics')
    expect(knownService('i.ytimg.com')?.name).toBe('YouTube')
    expect(knownService('www.youtube-nocookie.com')?.name).toBe('YouTube')
    expect(knownService('myblog.disqus.com')?.name).toBe('Disqus')
    expect(knownService('cdn.jsdelivr.net')?.name).toBe('jsDelivr')
    expect(knownService('secure.gravatar.com')?.name).toBe('Gravatar')
    expect(knownService('notyoutube.com')).toBeNull()
    expect(knownService('example.org')).toBeNull()
  })
})

describe('isThirdParty', () => {
  it('ignores www. and case', () => {
    expect(isThirdParty('WWW.example.org', 'example.org')).toBe(false)
    expect(isThirdParty('cdn.example.org', 'example.org')).toBe(true)
    expect(isThirdParty('example.org', null)).toBe(true)
  })
})

describe('PrivacyAudit', () => {
  it('groups third-party requests by host across pages and stylesheets', () => {
    const audit = new PrivacyAudit('https://example.org/', 'example.org')
    audit.add(
      'index.html',
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
       <link rel="stylesheet" href="/css/site.css"><img src="https://example.org/a.png">
       <script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>`,
    )
    audit.add('posts/a/index.html', `<iframe src="https://www.youtube.com/embed/x"></iframe><img src="//unknown-cdn.net/a.png">`)
    audit.add('posts/b/index.html', `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`)
    audit.add('css/site.css', `@font-face { src: url(https://fonts.gstatic.com/s/inter.woff2) } .x{background:url(../img/x.png)}`)

    const result = audit.result()
    expect(result.map((h) => h.host)).toEqual([
      'fonts.googleapis.com',
      'fonts.gstatic.com',
      'www.googletagmanager.com',
      'www.youtube.com',
      'unknown-cdn.net',
    ])
    const fonts = result[0]
    expect(fonts.files).toEqual(['index.html', 'posts/b/index.html'])
    expect(fonts.kinds).toEqual(['stylesheet'])
    expect(fonts.count).toBe(2)
    expect(fonts.urls).toEqual(['https://fonts.googleapis.com/css2?family=Inter'])
    expect(result[1].files).toEqual(['css/site.css'])
    expect(result[4].service).toBeNull()

    const groups = groupByService(result)
    expect(groups.map((g) => g.key)).toEqual(['Google Fonts', 'Google Analytics / Tag Manager', 'YouTube', 'unknown-cdn.net'])
    expect(groups[0].hosts).toHaveLength(2)
  })
})

describe('isNoreplyEmail', () => {
  it('recognizes GitHub noreply addresses', () => {
    expect(isNoreplyEmail('12345+ali@users.noreply.github.com')).toBe(true)
    expect(isNoreplyEmail('ali@users.noreply.github.com')).toBe(true)
    expect(isNoreplyEmail('ali@example.com')).toBe(false)
  })
})

describe('privacySettings', () => {
  it('reads Hugo privacy blocks from the effective config', () => {
    const settings = privacySettings({
      privacy: {
        youtube: { disable: false, privacyenhanced: true },
        disqus: { disable: true },
        x: { disable: false, enabledNT: true, simple: false },
      },
    })
    expect(settings).toEqual([
      { service: 'disqus', disabled: true, options: {} },
      { service: 'x', disabled: false, options: { enabledNT: true, simple: false } },
      { service: 'youtube', disabled: false, options: { privacyenhanced: true } },
    ])
    expect(privacySettings({})).toEqual([])
    expect(privacySettings(null)).toEqual([])
  })
})
