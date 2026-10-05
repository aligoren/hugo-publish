import { describe, expect, it } from 'vitest'

import {
  fileToBase64,
  humanizeFileName,
  imageTargetDir,
  importFileName,
  isBundleIndex,
  isGenericImageName,
  postSlug,
  siteImagePath,
  siteImagePaths,
} from './imagePaths'

describe('where images go', () => {
  it('uses the page bundle folder for index.md', () => {
    expect(isBundleIndex('content/posts/yazi/index.md')).toBe(true)
    expect(isBundleIndex('content/posts/_index.md')).toBe(true)
    expect(isBundleIndex('content/posts/indexed.md')).toBe(false)
    expect(isBundleIndex('content/posts/yazi/index.tr.md')).toBe(true)
    expect(imageTargetDir('content/posts/yazi/index.md')).toBe('content/posts/yazi')
  })

  it('uses static/images/<slug-of-post> otherwise', () => {
    expect(imageTargetDir('content/posts/İlk Yazı.md')).toBe('static/images/ilk-yazi')
    expect(imageTargetDir('content/posts/x.md', 'Özel Slug')).toBe('static/images/ozel-slug')
    expect(postSlug('content/posts/x.md', '')).toBe('x')
    expect(postSlug('content/posts/kitap/index.md')).toBe('kitap')
  })
})

describe('image sources back to site files', () => {
  it('maps a src to the files it may be', () => {
    expect(siteImagePath('/images/a.png', 'content/posts/x.md')).toBe('static/images/a.png')
    expect(siteImagePaths('/images/a.png', 'content/posts/x.md')).toEqual(['static/images/a.png', 'assets/images/a.png'])
    expect(siteImagePath('/images/a%20b.png?v=1#x', 'content/posts/x.md')).toBe('static/images/a b.png')
    expect(siteImagePaths('kapak.png', 'content/posts/yazi/index.md')).toEqual(['content/posts/yazi/kapak.png', 'assets/kapak.png'])
    expect(siteImagePath('kapak.png', 'content/posts/yazi/index.tr.md')).toBe('content/posts/yazi/kapak.png')
    expect(siteImagePath('./img/../kapak.png', 'content/posts/yazi/index.md')).toBe('content/posts/yazi/kapak.png')
    expect(siteImagePaths('images/kapak.png', 'content/posts/x.md')).toEqual(['assets/images/kapak.png'])
    expect(siteImagePaths('https://example.org/a.png', 'content/posts/x.md')).toEqual([])
    expect(siteImagePaths('//cdn.example.org/a.png', 'content/posts/x.md')).toEqual([])
    expect(siteImagePaths('../../../../etc/passwd', 'content/posts/yazi/index.md')).toEqual([])
  })
})

describe('file names', () => {
  it('humanizes a file name for alt text', () => {
    expect(humanizeFileName('kitap-kapağı_2.jpg')).toBe('Kitap kapağı 2')
    expect(humanizeFileName('static/images/ilk.yazi.png')).toBe('Ilk yazi')
    expect(humanizeFileName('')).toBe('')
  })

  it('names pasted images after the post without a timestamp', () => {
    const pasted = new File(['x'], 'image.png', { type: 'image/png' })
    expect(importFileName(pasted, 'yazi', () => 0.5)).toBe('yazi-7fffff.png')
    expect(importFileName(new File(['x'], 'kapak.jpg', { type: 'image/jpeg' }), 'yazi')).toBe('kapak.jpg')
    expect(importFileName(new File(['x'], '', { type: 'image/webp' }), 'yazi', () => 0)).toBe('yazi-000000.webp')
    expect(importFileName(new File(['x'], 'image.JPEG', { type: 'image/jpeg' }), 'yazi', () => 0)).toBe('yazi-000000.jpg')
  })

  it('recognises generic clipboard names', () => {
    expect(['', 'image.png', 'image.jpeg', 'Image.GIF'].every(isGenericImageName)).toBe(true)
    expect(['images.png', 'image-1.png', 'kapak.png', 'image'].some(isGenericImageName)).toBe(false)
  })

  it('encodes file bytes as base64', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    expect(await fileToBase64(new Blob([bytes]))).toBe('AAEC+v8=')
  })
})
