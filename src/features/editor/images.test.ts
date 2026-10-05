// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import type { InsertedImage } from './contract'
import { buildImagePreviews, findImages, imageCacheField, imageFiles, imageResolvedEffect, insertImagesLater, requestImage } from './images'
import { createEditorState, type MarkdownEditorOptions } from './setup'
import { stateFor } from './testing/harness'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((v) => v.destroy()))

function mount(doc: string, options: MarkdownEditorOptions = {}) {
  const view = new EditorView({ state: createEditorState(doc, options), parent: document.body })
  views.push(view)
  return view
}

describe('findImages', () => {
  it('finds Markdown images and figure shortcodes with their alt text', () => {
    const state = stateFor('![Kedi \\[1\\]](/img/kedi.jpg "T") ve ![](<my photo.png>)\n\n{{< figure src="/img/f.jpg" alt="Şekil" >}}\n\n{{</* figure src="x" */>}}\n`![kod](a.png)`|')
    expect(findImages(state).map((i) => [i.src, i.alt])).toEqual([
      ['/img/kedi.jpg', 'Kedi [1]'],
      ['my photo.png', ''],
      ['/img/f.jpg', 'Şekil'],
    ])
  })
})

describe('thumbnails', () => {
  it('shows a block widget under each line with resolved images, none for unresolved or raw mode', () => {
    let state = stateFor('![a](a.png) ![b](b.png)\n\n![c](c.png)|')
    expect(buildImagePreviews(state).size).toBe(0)
    state = state.update({
      effects: [
        imageResolvedEffect.of({ src: 'a.png', url: 'data:image/png;base64,AA' }),
        imageResolvedEffect.of({ src: 'b.png', url: 'data:image/png;base64,BB' }),
        imageResolvedEffect.of({ src: 'c.png', url: null }),
      ],
    }).state
    expect(state.field(imageCacheField).get('c.png')).toBe(null)
    const widgets: number[] = []
    buildImagePreviews(state).between(0, state.doc.length, (from, _to, deco) => {
      expect(deco.spec.block).toBe(true)
      widgets.push(from)
    })
    expect(widgets).toEqual([state.doc.line(1).to])
    const raw = stateFor('![a](a.png)|', 'lf', { livePreview: false })
    expect(buildImagePreviews(raw.update({ effects: imageResolvedEffect.of({ src: 'a.png', url: 'x' }) }).state).size).toBe(0)
  })

  it('asks the host once per source and renders the result', async () => {
    const asked: string[] = []
    const view = mount('![a](a.png)\n\n![a again](a.png)\n\n![yok](yok.png)', {
      host: {
        resolveImage: async (src) => {
          asked.push(src)
          return src === 'a.png' ? 'data:image/png;base64,AA' : null
        },
      },
    })
    await tick()
    await tick()
    expect(asked).toEqual(['a.png', 'yok.png'])
    const images = view.dom.querySelectorAll<HTMLImageElement>('.cm-lp-image-preview img')
    expect(images).toHaveLength(2)
    expect(images[0].src).toBe('data:image/png;base64,AA')
    expect(images[1].alt).toBe('a again')
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n\n![b](a.png)' } })
    await tick()
    expect(asked).toEqual(['a.png', 'yok.png'])
  })

  it('survives a failing resolver', async () => {
    const view = mount('![a](a.png)', { host: { resolveImage: () => Promise.reject(new Error('x')) } })
    await tick()
    await tick()
    expect(view.state.field(imageCacheField).get('a.png')).toBe(null)
  })
})

describe('inserting images', () => {
  it('inserts at the original position even after edits made while waiting (CRLF)', async () => {
    const view = mount('Önce\r\nSonra', { eol: 'crlf' })
    let resolve!: (images: InsertedImage[]) => void
    const done = insertImagesLater(view, 5, new Promise((r) => (resolve = r)))
    view.dispatch({ changes: { from: 0, insert: 'Yeni ' } })
    resolve([
      { src: 'a.jpg', alt: 'A' },
      { src: 'b.jpg', alt: 'B' },
    ])
    expect(await done).toBe(2)
    expect(view.state.sliceDoc()).toBe('Yeni Önce\r\n![A](a.jpg)\r\n![B](b.jpg)\r\nSonra')
  })

  it('replaces the selection with the requested image', async () => {
    const view = mount('Bir seçili kelime', { host: { onRequestImage: async () => ({ src: '/k.png', alt: 'K' }) } })
    view.dispatch({ selection: EditorSelection.range(4, 10) })
    expect(requestImage(view)).toBe(true)
    await tick()
    expect(view.state.sliceDoc()).toBe('Bir ![K](/k.png) kelime')
  })

  it('inserts nothing when the host cancels', async () => {
    const view = mount('x', { host: { onRequestImage: async () => null } })
    requestImage(view)
    await tick()
    expect(view.state.sliceDoc()).toBe('x')
  })

  it('puts the cursor into the empty alt text of a generic pasted image (image.png)', async () => {
    const view = mount('Metin ', { host: { onImageFiles: async (files) => files.map(() => ({ src: '/img/yazi-1a2b3c.png', alt: '' })) } })
    view.dispatch({ selection: EditorSelection.cursor(6) })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { files: [new File(['x'], 'image.png', { type: 'image/png' })], getData: () => '' } })
    view.contentDOM.dispatchEvent(paste)
    await tick()
    expect(view.state.sliceDoc()).toBe('Metin ![](/img/yazi-1a2b3c.png)')
    expect(view.state.selection.main.head).toBe(8)
    // Typing describes the image; skipping it leaves the alt text empty.
    view.dispatch(view.state.replaceSelection('Ekran görüntüsü'))
    expect(view.state.sliceDoc()).toBe('Metin ![Ekran görüntüsü](/img/yazi-1a2b3c.png)')
  })

  it('leaves the cursor alone when the user moved on while the image was importing', async () => {
    const view = mount('Bir\n\nİki', {})
    view.dispatch({ selection: EditorSelection.cursor(3) })
    let resolve!: (images: InsertedImage[]) => void
    const done = insertImagesLater(view, 3, new Promise((r) => (resolve = r)))
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) })
    resolve([{ src: 'a.png', alt: '' }])
    expect(await done).toBe(1)
    expect(view.state.sliceDoc()).toBe('Bir![](a.png)\n\nİki')
    expect(view.state.selection.main.head).toBe(view.state.doc.length)
  })

  it('filters image files', () => {
    const files = [new File(['x'], 'a.png', { type: 'image/png' }), new File(['x'], 'b.JPG'), new File(['x'], 'c.pdf', { type: 'application/pdf' })]
    expect(imageFiles(files).map((f) => f.name)).toEqual(['a.png', 'b.JPG'])
    expect(imageFiles(null)).toEqual([])
  })

  it('hands pasted and dropped image files to the host', async () => {
    const received: string[][] = []
    const view = mount('Metin', {
      host: {
        onImageFiles: async (files) => {
          received.push(files.map((f) => f.name))
          return files.map((f) => ({ src: `/img/${f.name}`, alt: '' }))
        },
      },
    })
    view.dispatch({ selection: EditorSelection.cursor(5) })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File(['x'], 'p.png', { type: 'image/png' })], getData: () => '' },
    })
    view.contentDOM.dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(true)
    await tick()
    expect(view.state.sliceDoc()).toBe('Metin![](/img/p.png)')

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['x'], 'd.webp', { type: 'image/webp' })], getData: () => '' } })
    view.contentDOM.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
    await tick()
    expect(received).toEqual([['p.png'], ['d.webp']])
    expect(view.state.sliceDoc()).toContain('![](/img/d.webp)')
  })
})
