import { describe, expect, it } from 'vitest'

import { fileNameOf, folderOf, imageReference, isImagePath } from './reference'

describe('imageReference', () => {
  it('turns static files into root URLs', () => {
    expect(imageReference('static/a/b.png', 'content/posts/x.md')).toBe('/a/b.png')
    expect(imageReference('static/logo.svg', 'content/x/index.md')).toBe('/logo.svg')
  })

  it('uses bundle-relative paths inside the document bundle', () => {
    expect(imageReference('content/x/img.jpg', 'content/x/index.md')).toBe('img.jpg')
    expect(imageReference('content/x/images/img.jpg', 'content/x/index.md')).toBe('images/img.jpg')
    expect(imageReference('content/posts/_index/a.png', 'content/posts/_index.md')).toBe('_index/a.png')
    expect(imageReference('content/x/img.jpg', 'content/x/index.tr.md')).toBe('img.jpg')
    expect(imageReference('content/posts/img.jpg', 'content/posts/_index.md')).toBe('img.jpg')
  })

  it('does not treat a plain page as a bundle', () => {
    expect(imageReference('content/posts/img.jpg', 'content/posts/a.md')).toBe('content/posts/img.jpg')
    expect(imageReference('content/other/img.jpg', 'content/x/index.md')).toBe('content/other/img.jpg')
    // A sibling folder whose name starts the same is not inside the bundle.
    expect(imageReference('content/x-2/img.jpg', 'content/x/index.md')).toBe('content/x-2/img.jpg')
  })

  it('uses assets-relative paths for assets', () => {
    expect(imageReference('assets/images/a.webp', 'content/x/index.md')).toBe('images/a.webp')
  })

  it('normalizes separators', () => {
    expect(imageReference('static\\a\\b.png', 'content\\x.md')).toBe('/a/b.png')
    expect(imageReference('./content/x/img.jpg', '/content/x/index.md')).toBe('img.jpg')
    expect(imageReference('themes/t/static/x.png', 'content/a.md')).toBe('themes/t/static/x.png')
  })
})

describe('path helpers', () => {
  it('recognises image paths', () => {
    expect(isImagePath('C:\\Photos\\IMG_1.JPG')).toBe(true)
    expect(isImagePath('/home/a/b.avif')).toBe(true)
    expect(isImagePath('notes.txt')).toBe(false)
    expect(isImagePath('png')).toBe(false)
  })

  it('splits folders and names', () => {
    expect(folderOf('content/x/img.jpg')).toBe('content/x')
    expect(folderOf('img.jpg')).toBe('')
    expect(fileNameOf('static\\a\\b.png')).toBe('b.png')
  })
})
