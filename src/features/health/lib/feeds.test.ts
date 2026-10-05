// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { fakeTomlParse } from '../../document/testing/fakeToml'
import {
  analyzeFeed,
  analyzeLlms,
  analyzeRobots,
  analyzeSitemap,
  compareWithPage,
  frontMatterValues,
  hidingFlags,
  pageArticle,
  parseFeed,
  summarizeFeed,
  suspiciousUrls,
} from './feeds'

describe('analyzeRobots', () => {
  it('finds a site-wide disallow and sitemap lines', () => {
    expect(analyzeRobots('User-agent: *\nDisallow: /\n')).toEqual({ disallowAll: true, sitemaps: [], disallowRules: 1 })
    expect(analyzeRobots('User-agent: *\nDisallow:\nSitemap: https://example.org/sitemap.xml\n')).toEqual({
      disallowAll: false,
      sitemaps: ['https://example.org/sitemap.xml'],
      disallowRules: 0,
    })
  })

  it('does not count a disallow for one bot as site-wide', () => {
    const text = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/ # comment\n'
    expect(analyzeRobots(text)).toMatchObject({ disallowAll: false, disallowRules: 2 })
    expect(analyzeRobots('User-agent: a\nUser-agent: *\nDisallow: /').disallowAll).toBe(true)
  })
})

describe('analyzeSitemap', () => {
  it('counts URLs and lastmod', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.org/a/</loc><lastmod>2026-01-01T00:00:00+00:00</lastmod></url>
      <url><loc>https://example.org/b/?x=1&amp;y=2</loc></url></urlset>`
    expect(analyzeSitemap(xml)).toEqual({
      valid: true,
      isIndex: false,
      urls: ['https://example.org/a/', 'https://example.org/b/?x=1&y=2'],
      sitemaps: [],
      withLastmod: 1,
    })
  })

  it('reads sitemap indexes', () => {
    const xml = '<sitemapindex><sitemap><loc>https://example.org/en/sitemap.xml</loc></sitemap></sitemapindex>'
    expect(analyzeSitemap(xml)).toMatchObject({ isIndex: true, sitemaps: ['https://example.org/en/sitemap.xml'], urls: [] })
  })

  it('handles namespaces, CDATA, comments and alternates like a crawler', () => {
    const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
        <url><loc><![CDATA[https://example.org/ç/]]></loc>
          <xhtml:link rel="alternate" hreflang="tr" href="https://example.org/tr/ç/"/>
          <lastmod> </lastmod></url>
        <!-- <url><loc>https://example.org/commented/</loc></url> -->
      </urlset>`
    expect(analyzeSitemap(xml)).toEqual({ valid: true, isIndex: false, urls: ['https://example.org/ç/'], sitemaps: [], withLastmod: 0 })
  })

  it('reports XML that is not well-formed', () => {
    expect(analyzeSitemap('<urlset><url><loc>https://example.org/a&b</loc></url></urlset>').valid).toBe(false)
    expect(analyzeSitemap('<html></html>').valid).toBe(false)
    expect(analyzeSitemap('').valid).toBe(false)
  })

  it('flags drafts, local hosts and test paths', () => {
    const urls = [
      'https://site.org/posts/ok/',
      'https://site.org/posts/taslak/',
      'http://localhost:1313/x/',
      'https://example.com/',
      'https://site.org/test/page/',
      'not a url',
    ]
    expect(suspiciousUrls(urls, new Set(['/posts/taslak/']))).toEqual(urls.slice(1))
  })
})

describe('analyzeFeed', () => {
  it('reads an RSS feed with summaries', () => {
    const xml = `<rss version="2.0"><channel><title>My Blog</title>
      <item><title>A</title><description>Short summary &lt;p&gt;x&lt;/p&gt;</description></item>
      <item><title></title><description></description></item></channel></rss>`
    expect(analyzeFeed(xml)).toEqual({
      format: 'rss',
      title: 'My Blog',
      items: 2,
      missingTitles: 1,
      missingDescriptions: 1,
      content: 'summary',
      compared: 0,
      invalid: false,
    })
  })

  it('recognizes full content and Atom', () => {
    const body = '&lt;p&gt;1&lt;/p&gt;&lt;p&gt;2&lt;/p&gt;&lt;h2&gt;x&lt;/h2&gt;&lt;pre&gt;c&lt;/pre&gt;'
    const rss = `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>T</title>
      <item><title>A</title><description>${body}</description></item>
      <item><title>B</title><content:encoded><![CDATA[<p>x</p>]]></content:encoded></item></channel></rss>`
    expect(analyzeFeed(rss)?.content).toBe('full')
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>F</title>
      <entry><title type="html">A &amp;amp; B</title><link rel="alternate" href="https://example.org/a/"/><summary>s</summary></entry></feed>`
    expect(analyzeFeed(atom)).toMatchObject({ format: 'atom', title: 'F', items: 1, content: 'summary' })
    expect(parseFeed(atom)?.items[0]).toEqual({ title: 'A &amp; B', link: 'https://example.org/a/', body: 's', fullField: false })
    expect(analyzeFeed('<urlset></urlset>')).toBeNull()
    expect(analyzeFeed('not xml')).toBeNull()
  })

  it('reads RSS 1.0, Atom XHTML content and guid links', () => {
    const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
      <channel><title>R</title></channel><item><title>A</title><link>https://example.org/a/</link><description>d</description></item></rdf:RDF>`
    expect(parseFeed(rdf)).toMatchObject({ format: 'rss', title: 'R', items: [{ title: 'A', link: 'https://example.org/a/' }] })
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>F</title><entry><title>A</title>
      <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>1</p><p>2</p><p>3</p><p>4</p></div></content></entry></feed>`
    expect(analyzeFeed(atom)?.content).toBe('full')
    const rss = '<rss><channel><item><title>G</title><guid>https://example.org/g/</guid><description>x</description></item></channel></rss>'
    expect(parseFeed(rss)?.items[0].link).toBe('https://example.org/g/')
  })

  it('reports feeds that are not well-formed', () => {
    // A prefix without its namespace, and an HTML entity XML does not know.
    for (const xml of [
      '<rss><channel><title>T</title><item><content:encoded>x</content:encoded></item></channel></rss>',
      '<feed><title>Caf&eacute;</title></feed>',
    ]) {
      expect(analyzeFeed(xml)).toMatchObject({ invalid: true, items: 0, content: 'empty' })
    }
  })

  it('compares items with their built page', () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i} has some words about the trip to the sea.</p>`)
    const page = pageArticle(
      `<html><body><nav>Home About</nav><main><article><header><h1>Trip</h1><p>3 min read by someone</p></header>
       ${paragraphs.join('')}<footer><p>Tags: travel, sea, summer and more</p></footer></article></main>
       <script>var x = "not text"</script></body></html>`,
    )
    expect(page.words).toBe(66)
    expect(page.lastParagraph).toBe('Paragraph 5 has some words about the trip to the sea.')
    expect(compareWithPage(paragraphs.join(''), page)).toBe('full')
    expect(compareWithPage(paragraphs.slice(0, 2).join(''), page)).toBe('summary')
    // Short pages cannot tell a summary from the post.
    expect(compareWithPage('<p>x</p>', pageArticle('<article><p>Just a few words here.</p></article>'))).toBeNull()

    const escaped = (html: string) => html.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const looksLong = paragraphs.slice(0, 4).join('')
    const feed = parseFeed(`<rss><channel><title>T</title>
      <item><title>A</title><link>https://example.org/a/</link><description>${escaped(looksLong)}</description></item>
      <item><title>B</title><link>https://example.org/b/</link><description>${escaped(looksLong)}</description></item>
      </channel></rss>`)!
    // Both items look long (four paragraphs); only A has its page in the build, which shows it is
    // a summary. B is judged by its markup.
    const info = summarizeFeed(feed, (link) => (link === 'https://example.org/a/' ? page : null))
    expect(info).toMatchObject({ content: 'mixed', compared: 1 })
    expect(summarizeFeed(feed).content).toBe('full')
  })
})

describe('analyzeLlms', () => {
  it('reads the title, lines and links', () => {
    expect(analyzeLlms('# My Blog\n\n> notes\n\n- [A](https://example.org/a/)\n- [B](https://example.org/b/)\n')).toEqual({
      title: 'My Blog',
      lines: 4,
      links: 2,
    })
  })
})

describe('hidingFlags', () => {
  const toml = { tomlParseText: async (text: string) => ({ values: fakeTomlParse(text) }) }
  const flags = async (text: string) => hidingFlags(await frontMatterValues(text, toml))

  it('reads build options in every front matter format', async () => {
    expect(await flags('---\ntitle: x\nbuild:\n  list: never\n---\n')).toEqual(['build.list = never'])
    expect(await flags('---\n_build:\n  list: false\n  render: true\n---\n')).toEqual(['build.list = never'])
    expect(await flags('---\nBuild: { list: local, render: link }\n---\n')).toEqual(['build.list = local', 'build.render = link'])
    expect(await flags("+++\ntitle = 'x'\n[build]\nlist = 'never'\nrender = 'never'\n+++\n")).toEqual([
      'build.list = never',
      'build.render = never',
    ])
    expect(await flags('{\n  "build": { "list": "never" }\n}\n')).toEqual(['build.list = never'])
  })

  it('reads sitemap.disable, noindex-style params and cascades', async () => {
    expect(await flags('---\nsitemap:\n  disable: true\n---\n')).toEqual(['sitemap.disable = true'])
    expect(await flags('---\nnoindex: true\nparams:\n  private: "yes"\n  robots: noindex, follow\n---\n')).toEqual([
      'noindex = true',
      'private = true',
      'robots = "noindex, follow"',
    ])
    expect(await flags('+++\nsearchHidden = true\n[sitemap]\ndisable = true\n+++\n')).toEqual([
      'sitemap.disable = true',
      'searchHidden = true',
    ])
    expect(await flags('---\ncascade:\n  - build:\n      list: never\n    _target:\n      path: /old/**\n---\n')).toEqual([
      'cascade: build.list = never',
    ])
  })

  it('ignores lookalikes and normal pages', async () => {
    // Text patterns matched these.
    expect(await flags('---\nlist: never\n---\n')).toEqual([])
    expect(await flags('---\nbuild:\n  list: always\n  render: always\n---\n')).toEqual([])
    expect(await flags('---\ntitle: "build: { list: never }"\nsummary: noindex\n---\n')).toEqual([])
    expect(await flags('---\nnoindex: false\nhidden: 0\n---\n')).toEqual([])
    expect(await flags('no front matter')).toEqual([])
    expect(await flags('---\n: broken: [\n---\n')).toEqual([])
  })
})
