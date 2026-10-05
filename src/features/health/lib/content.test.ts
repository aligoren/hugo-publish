import { describe, expect, it } from 'vitest'

import { classifyLink, extractContentLinks, trimBareUrl } from './content'

const doc = [
  '---', // 1
  'title: Deneme', // 2
  'link: https://front-matter.example.com/', // 3
  '---', // 4
  'Bir [bağlantı](/yazilar/a/) ve ![görsel](kapak.jpg "Başlık").', // 5
  'Wikipedia: [x](https://en.wikipedia.org/wiki/Foo_(bar)) bitti.', // 6
  '[![logo](/img/logo.png)](https://example.com/)', // 7
  '`[kod](/degil/)` ve <https://otomatik.example.org/yol>', // 8
  '```', // 9
  '[blok](/blok-icinde/)', // 10
  '```', // 11
  'Düz adres: https://duz.example.org/a/b. Sonra (https://parantez.example.org/x).', // 12
  '<a href="/html/link/">h</a> <img src=\'/html/img.png\'>', // 13
  '{{< figure src="/images/sekil.png" alt="x" >}}', // 14
  'Bkz. [ref]({{< ref "yazilar/b.md#bolum" >}}) ve {{< relref path="/hakkinda" >}}.', // 15
  '[tanım]: https://tanim.example.org/  "Başlık"', // 16
  '<!-- [yorum](/yorum/) -->', // 17
  '[çapa](#giriş) [md](../b.md) [mail](mailto:a@b.c)', // 18
].join('\n')

describe('extractContentLinks', () => {
  it('finds every kind of link with its line, skipping code and comments', () => {
    expect(extractContentLinks(doc)).toEqual([
      { url: '/yazilar/a/', line: 5, source: 'markdown' },
      { url: 'kapak.jpg', line: 5, source: 'image' },
      { url: 'https://en.wikipedia.org/wiki/Foo_(bar)', line: 6, source: 'markdown' },
      { url: 'https://example.com/', line: 7, source: 'markdown' },
      { url: '/img/logo.png', line: 7, source: 'image' },
      { url: 'https://otomatik.example.org/yol', line: 8, source: 'autolink' },
      { url: 'https://duz.example.org/a/b', line: 12, source: 'bare' },
      { url: 'https://parantez.example.org/x', line: 12, source: 'bare' },
      { url: '/html/link/', line: 13, source: 'html' },
      { url: '/html/img.png', line: 13, source: 'html' },
      { url: '/images/sekil.png', line: 14, source: 'html' },
      { url: 'yazilar/b.md#bolum', line: 15, source: 'ref' },
      { url: '/hakkinda', line: 15, source: 'ref' },
      { url: 'https://tanim.example.org/', line: 16, source: 'reference' },
      { url: '#giriş', line: 18, source: 'markdown' },
      { url: '../b.md', line: 18, source: 'markdown' },
      { url: 'mailto:a@b.c', line: 18, source: 'markdown' },
    ])
  })

  it('counts lines in CRLF files and files without front matter', () => {
    expect(extractContentLinks('---\r\ntitle: x\r\n---\r\n\r\n[a](/a/)\r\n')).toEqual([{ url: '/a/', line: 5, source: 'markdown' }])
    expect(extractContentLinks('[a](/a/)')).toEqual([{ url: '/a/', line: 1, source: 'markdown' }])
    expect(extractContentLinks('+++\ntitle = "x"\n+++\n[a](<b c.md>)')).toEqual([{ url: 'b c.md', line: 4, source: 'markdown' }])
  })
})

describe('trimBareUrl', () => {
  it('drops sentence punctuation and unbalanced parentheses', () => {
    expect(trimBareUrl('https://a.org/x.')).toBe('https://a.org/x')
    expect(trimBareUrl('https://a.org/x),')).toBe('https://a.org/x')
    expect(trimBareUrl('https://a.org/Foo_(bar)')).toBe('https://a.org/Foo_(bar)')
  })
})

describe('classifyLink', () => {
  const host = 'example.org'
  const c = (url: string, source: 'markdown' | 'ref' = 'markdown') => classifyLink({ url, source }, host)

  it('separates external, site, relative, fragment, content and ignored links', () => {
    expect(c('https://other.org/a')).toEqual({ type: 'external', url: 'https://other.org/a' })
    expect(c('//cdn.other.org/a.js')).toEqual({ type: 'external', url: 'https://cdn.other.org/a.js' })
    expect(c('https://www.example.org/yaz%C4%B1/#x')).toEqual({ type: 'site', path: '/yazı/', fragment: 'x' })
    expect(c('/a/b/?q=1#f')).toEqual({ type: 'site', path: '/a/b/', fragment: 'f' })
    expect(c('../b/')).toEqual({ type: 'relative', path: '../b/', fragment: null })
    expect(c('#giriş')).toEqual({ type: 'fragment', fragment: 'giriş' })
    expect(c('../b.md#x')).toEqual({ type: 'content', path: '../b.md', fragment: 'x' })
    expect(c('yazilar/b.md#bolum', 'ref')).toEqual({ type: 'content', path: 'yazilar/b.md', fragment: 'bolum' })
    for (const ignored of ['mailto:a@b.c', 'tel:+90', 'javascript:void(0)', '{{ .Site.BaseURL }}', 'ftp://x.org/']) {
      expect(c(ignored)).toEqual({ type: 'ignored' })
    }
  })

  it('treats every absolute URL as external without a site host', () => {
    expect(classifyLink({ url: 'https://example.org/', source: 'markdown' }, null).type).toBe('external')
  })
})
