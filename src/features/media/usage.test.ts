import { describe, expect, it } from 'vitest'

import { findUnusedImages, mentionedNames } from './usage'

describe('findUnusedImages', () => {
  const images = [
    'static/images/a.png',
    'static/images/b.jpg',
    'content/posts/x/photo.webp',
    'content/posts/x/unused.jpg',
    'assets/img/hero-large.png',
    'assets/img/diagram.svg',
    'static/favicon.png',
    'content/posts/y/feature.jpg',
    'static/images/my photo.jpg',
    'static/images/çiçek.png',
  ]

  it('finds references in Markdown, HTML, front matter, shortcodes and CSS', () => {
    const texts = [
      '---\ntitle: X\ncover:\n  image: "photo.webp"\n---\n![A](/images/a.png "title")\n',
      '<p><img src="https://example.com/images/b.jpg?v=2" alt=""></p>',
      '{{< figure src="images/%C3%A7i%C3%A7ek.png" >}}',
      '.x { background: url(img/diagram.svg) }',
      '<img src="my photo.jpg">',
    ]
    expect([...findUnusedImages(images, texts)]).toEqual(['content/posts/x/unused.jpg'])
  })

  it('reports everything unused when nothing refers to images', () => {
    const unused = findUnusedImages(images, ['# Hello\n\nNo pictures here.'])
    expect(unused.has('static/images/a.png')).toBe(true)
    // Names themes pick up by convention are never reported.
    expect(unused.has('static/favicon.png')).toBe(false)
    expect(unused.has('content/posts/y/feature.jpg')).toBe(false)
    expect(unused.has('assets/img/hero-large.png')).toBe(false)
  })

  it('matches file names case-insensitively, ignoring punctuation around them', () => {
    expect(findUnusedImages(['static/A.PNG'], ['see (a.png).']).size).toBe(0)
    expect(findUnusedImages(['static/a.png'], ['xa.png']).size).toBe(1)
  })
})

describe('mentionedNames', () => {
  it('keeps the last path segment and decoded variants', () => {
    const names = mentionedNames(['![x](../b/C%20D.png#frag) [y]: ./e.jpg'])
    expect(names.has('c%20d.png')).toBe(true)
    expect(names.has('c d.png')).toBe(true)
    expect(names.has('e.jpg')).toBe(true)
  })
})
