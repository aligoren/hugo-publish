import { describe, expect, it } from 'vitest'

import {
  decodeEntities,
  extractCssUrls,
  extractIds,
  extractMeta,
  extractResources,
  hasFragment,
  parseSrcset,
  parseTags,
} from './html'

describe('parseTags', () => {
  it('reads attributes in every quoting style and decodes entities', () => {
    const tags = parseTags(`<a href="/x?a=1&amp;b=2" data-x='y' title=plain hidden>t</a>`)
    expect(tags).toEqual([{ name: 'a', attrs: { href: '/x?a=1&b=2', 'data-x': 'y', title: 'plain', hidden: '' } }])
  })

  it('skips comments and script contents but keeps the script tag', () => {
    const tags = parseTags(`<!-- <img src="no.png"> --><script src="a.js">var s = "<img src='x.png'>"</script><p id="ok">`)
    expect(tags.map((t) => t.name)).toEqual(['script', 'p'])
  })

  it('handles > inside quoted attributes', () => {
    expect(parseTags(`<div title="a > b" id="d">`)[0].attrs).toEqual({ title: 'a > b', id: 'd' })
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric references', () => {
    expect(decodeEntities('&lt;b&gt; &quot;x&quot; &#39;y&#x27; &#351;')).toBe(`<b> "x" 'y' ş`)
    expect(decodeEntities('&unknown; &#0;')).toBe('&unknown; &#0;')
    expect(decodeEntities('Writer&rsquo;s &ldquo;note&rdquo; &ndash; &hellip;')).toBe('Writer’s “note” – …')
  })
})

describe('ids and fragments', () => {
  it('collects ids and named anchors', () => {
    const ids = extractIds(`<h2 id="giriş">Giriş</h2><a name="eski"></a><div id='x y'>`)
    expect([...ids]).toEqual(['giriş', 'eski', 'x y'])
  })

  it('matches encoded fragments and always accepts # and #top', () => {
    const ids = new Set(['giriş'])
    expect(hasFragment(ids, 'giriş')).toBe(true)
    expect(hasFragment(ids, 'giri%C5%9F')).toBe(true)
    expect(hasFragment(ids, '')).toBe(true)
    expect(hasFragment(ids, 'TOP')).toBe(true)
    expect(hasFragment(ids, 'sonuç')).toBe(false)
    expect(hasFragment(ids, '%E0%A4%A')).toBe(false)
  })
})

describe('extractMeta', () => {
  const page = `<!doctype html><html lang="tr"><head>
    <title> First post &amp; notes | My Blog </title>
    <meta name="description" content="Kısa açıklama">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://example.org/a/">
    <meta property="og:title" content="OG başlık">
    <meta property="og:image" content="https://example.org/a/cover.jpg">
    <meta property="og:image" content="https://example.org/second.jpg">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="X başlık">
    </head><body><svg><title>icon</title></svg></body></html>`

  it('reads title, description, canonical, robots and lang', () => {
    const meta = extractMeta(page)
    expect(meta.title).toBe('First post & notes | My Blog')
    expect(meta.description).toBe('Kısa açıklama')
    expect(meta.canonical).toBe('https://example.org/a/')
    expect(meta.robots).toBe('index, follow')
    expect(meta.lang).toBe('tr')
  })

  it('keeps the first og/twitter value of each key', () => {
    const meta = extractMeta(page)
    expect(meta.og).toEqual({ title: 'OG başlık', image: 'https://example.org/a/cover.jpg' })
    expect(meta.twitter).toEqual({ card: 'summary_large_image', title: 'X başlık' })
  })

  it('does not take an svg title from the body', () => {
    expect(extractMeta('<html><head></head><body><svg><title>icon</title></svg></body>').title).toBeNull()
  })
})

describe('srcset and css', () => {
  it('splits srcset candidates', () => {
    expect(parseSrcset('a.jpg 1x, b.jpg 2x')).toEqual(['a.jpg', 'b.jpg'])
    expect(parseSrcset('https://x.org/a.jpg 480w,https://x.org/b.jpg 800w')).toEqual(['https://x.org/a.jpg', 'https://x.org/b.jpg'])
    expect(parseSrcset('one.png')).toEqual(['one.png'])
    expect(parseSrcset('a.png,, b.png 2x')).toEqual(['a.png', 'b.png'])
  })

  it('finds @import and url() but not data: URLs or comments', () => {
    const css = `@import url("https://fonts.googleapis.com/css2?family=Inter");
      @import 'local.css';
      /* url(commented.png) */
      body { background: url(bg.png) } .x { src: url('https://fonts.gstatic.com/a.woff2') format('woff2') }
      .y { background: url(data:image/png;base64,AAA) }`
    expect(extractCssUrls(css)).toEqual([
      { kind: 'stylesheet', url: 'https://fonts.googleapis.com/css2?family=Inter' },
      { kind: 'stylesheet', url: 'local.css' },
      { kind: 'css', url: 'bg.png' },
      { kind: 'css', url: 'https://fonts.gstatic.com/a.woff2' },
    ])
  })
})

describe('extractResources', () => {
  it('lists what a page makes the browser fetch', () => {
    const html = `<head>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto">
      <link rel="preconnect" href="https://fonts.gstatic.com">
      <link rel="preload" as="font" href="/fonts/a.woff2" crossorigin>
      <link rel="icon" href="/favicon.ico">
      <link rel="canonical" href="https://example.org/">
      <script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
      <script>(function(){var s='https://www.google-analytics.com/analytics.js'; var o='https://example.net/x.js'})()</script>
      <style>body{background:url(https://cdn.example.com/bg.png)}</style>
      </head><body>
      <img src="/a.png" srcset="/a-2x.png 2x, https://img.example.com/a.png 3x">
      <iframe src="https://www.youtube.com/embed/abc"></iframe>
      <video src="v.mp4" poster="https://i.vimeocdn.com/p.jpg"></video>
      <div style="background-image: url('https://cdn.example.com/hero.jpg')"></div>
      <a href="https://not-a-request.example.com/">link</a>
      <img src="data:image/png;base64,AAAA">
      </body>`
    const isTracker = (host: string) => host.endsWith('google-analytics.com')
    expect(extractResources(html, isTracker)).toEqual([
      { kind: 'script', url: 'https://www.google-analytics.com/analytics.js' },
      { kind: 'css', url: 'https://cdn.example.com/bg.png' },
      { kind: 'stylesheet', url: 'https://fonts.googleapis.com/css?family=Roboto' },
      { kind: 'preconnect', url: 'https://fonts.gstatic.com' },
      { kind: 'font', url: '/fonts/a.woff2' },
      { kind: 'icon', url: '/favicon.ico' },
      { kind: 'script', url: 'https://www.googletagmanager.com/gtag/js?id=G-1' },
      { kind: 'image', url: '/a.png' },
      { kind: 'image', url: '/a-2x.png' },
      { kind: 'image', url: 'https://img.example.com/a.png' },
      { kind: 'iframe', url: 'https://www.youtube.com/embed/abc' },
      { kind: 'media', url: 'v.mp4' },
      { kind: 'image', url: 'https://i.vimeocdn.com/p.jpg' },
      { kind: 'css', url: 'https://cdn.example.com/hero.jpg' },
    ])
  })
})
