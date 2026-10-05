// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import type { InsertedImage } from './contract'
import { dataUrlToFile, imageNameFromText, pasteImageNoticeField, pastedImageNames, pastedImagePlaceholders, resetPasteImageNotice } from './pasteImages'
import { createEditorState, type MarkdownEditorOptions } from './setup'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const flush = async () => {
  for (let i = 0; i < 6; i++) await tick()
}

// jsdom has no layout; tooltips (the notice) measure text ranges.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects ??= emptyRects
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const GIF = 'data:image/gif;base64,R0lGODlh'

describe('files from data URLs', () => {
  it('decodes base64 and percent-encoded images', async () => {
    const png = dataUrlToFile(PNG, 'kedi')!
    expect([png.name, png.type, png.size]).toEqual(['kedi.png', 'image/png', 8])
    expect([...new Uint8Array(await png.arrayBuffer())].slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47])
    const svg = dataUrlToFile('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E', 'logo')!
    expect([svg.name, svg.type, svg.size]).toEqual(['logo.svg', 'image/svg+xml', 6])
    expect(dataUrlToFile('data:image/jpeg;base64,/9j/', 'a')!.name).toBe('a.jpg')
  })

  it('refuses what is not a decodable image', () => {
    expect(dataUrlToFile('data:text/plain;base64,aGk=', 'x')).toBe(null)
    expect(dataUrlToFile('data:image/png;base64,%%%', 'x')).toBe(null)
    expect(dataUrlToFile('data:image/png;base64,', 'x')).toBe(null)
    expect(dataUrlToFile('https://example.com/a.png', 'x')).toBe(null)
  })

  it('names files from alt text or title, otherwise pasted-image-N, unique within a paste', () => {
    expect(imageNameFromText('İstanbul Boğazı, gece!')).toBe('istanbul-bogazi-gece')
    expect(imageNameFromText('   ')).toBe('')
    expect(
      pastedImageNames([
        { alt: 'İstanbul Boğazı', title: '' },
        { alt: '', title: '' },
        { alt: '', title: 'Logo' },
        { alt: 'istanbul bogazi', title: '' },
        { alt: '', title: '' },
      ]),
    ).toEqual(['istanbul-bogazi', 'pasted-image-1', 'logo', 'istanbul-bogazi-2', 'pasted-image-2'])
  })
})

describe('pasting HTML with images', () => {
  const views: EditorView[] = []
  afterEach(() => {
    views.splice(0).forEach((v) => v.destroy())
    resetPasteImageNotice()
  })

  function mount(doc: string, options: MarkdownEditorOptions = {}) {
    const view = new EditorView({ state: createEditorState(doc, options), parent: document.body })
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    views.push(view)
    return view
  }

  function paste(view: EditorView, html: string) {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/html' ? html : ''), files: [], types: ['text/html'] },
    })
    view.contentDOM.dispatchEvent(event)
    return event.defaultPrevented
  }

  /** A host that imports each file to `/img/<name>`, failing for names in `failing`. */
  function host(failing: string[] = []) {
    const calls: string[][] = []
    const resolvers: (() => void)[] = []
    const onImageFiles = async (files: File[]): Promise<InsertedImage[]> => {
      calls.push(files.map((f) => `${f.name} ${f.type}`))
      await new Promise<void>((resolve) => resolvers.push(resolve))
      if (failing.includes(files[0].name)) throw new Error('import failed')
      return files.map((f) => ({ src: `/img/${f.name}`, alt: 'from host' }))
    }
    const release = async () => {
      while (resolvers.length) {
        resolvers.shift()!()
        await flush()
      }
    }
    return { calls, onImageFiles, release }
  }

  it('imports embedded images one by one and puts them where they were (CRLF kept)', async () => {
    const h = host(['logo.gif'])
    const view = mount('Giriş\r\n', { eol: 'crlf', host: { onImageFiles: h.onImageFiles } })
    const html = `<p>Önce <img src="${PNG}" alt="Kedi [1]"> sonra</p><p><img src="${GIF}" title="Logo"> ve <img src="${PNG}"></p>`
    expect(paste(view, html)).toBe(true)
    // The alt texts stand in while the imports run.
    expect(view.state.sliceDoc()).toBe('Giriş\r\nÖnce Kedi [1] sonra\r\n\r\n ve ')
    expect(view.state.field(pastedImagePlaceholders)).toHaveLength(3)
    await flush()
    expect(view.dom.querySelectorAll('.cm-image-importing-badge')).toHaveLength(3)
    await h.release()
    expect(h.calls).toEqual([['kedi-1.png image/png'], ['logo.gif image/gif'], ['pasted-image-1.png image/png']])
    // The HTML's alt text wins over the host's; a failed import leaves its (empty) alt text.
    expect(view.state.sliceDoc()).toBe('Giriş\r\nÖnce ![Kedi \\[1\\]](/img/kedi-1.png) sonra\r\n\r\n ve ![](/img/pasted-image-1.png)')
    expect(view.state.field(pastedImagePlaceholders)).toEqual([])
    expect(view.dom.querySelector('.cm-image-importing-badge')).toBe(null)
  })

  it('keeps the user’s edits to a placeholder and skips deleted ones', async () => {
    const h = host()
    const view = mount('', { host: { onImageFiles: h.onImageFiles } })
    paste(view, `<p><b>A</b> <img src="${PNG}" alt="Kedi"> <img src="${GIF}" alt="Köpek"></p>`)
    expect(view.state.sliceDoc()).toBe('**A** Kedi Köpek')
    // Typing inside the first placeholder, deleting the second.
    view.dispatch({ changes: { from: 8, insert: 'x' } })
    view.dispatch({ changes: { from: 12, to: 17 } })
    expect(view.state.field(pastedImagePlaceholders)).toHaveLength(1)
    await h.release()
    expect(h.calls).toHaveLength(2)
    expect(view.state.sliceDoc()).toBe('**A** Kexdi![Kedi](/img/kedi.png) ')
  })

  it('pastes Word’s text, not the picture of it that comes along; a copied image alone is imported', async () => {
    const imported: string[] = []
    const view = mount('', {
      host: {
        onImageFiles: async (files) => {
          imported.push(...files.map((f) => f.name))
          return files.map((f) => ({ src: `/img/${f.name}`, alt: 'Resim' }))
        },
      },
    })
    const pasteWith = (html: string) => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      const files = [new File(['x'], 'image.png', { type: 'image/png' })]
      Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/html' ? html : ''), files, types: ['text/html', 'Files'] } })
      view.contentDOM.dispatchEvent(event)
    }
    pasteWith('<p>Bu <b>kalın</b> bir metin</p>')
    await flush()
    expect(view.state.sliceDoc()).toBe('Bu **kalın** bir metin')
    expect(imported).toEqual([])
    pasteWith('<meta charset="utf-8"><img src="https://example.com/kedi.png">')
    await flush()
    expect(imported).toEqual(['image.png'])
    expect(view.state.sliceDoc()).toBe('Bu **kalın** bir metin![Resim](/img/image.png)')
  })

  it('without a host, pastes the alt text only', async () => {
    const view = mount('')
    paste(view, `<p><b>A</b> <img src="${PNG}" alt="Kedi"></p>`)
    await flush()
    expect(view.state.sliceDoc()).toBe('**A** Kedi')
    expect(view.state.field(pastedImagePlaceholders)).toEqual([])
  })

  it('explains once that images from Word must be pasted separately', () => {
    const view = mount('')
    const word = '<p><b>Rapor</b> <img src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" alt="Grafik"></p>'
    paste(view, word)
    expect(view.state.sliceDoc()).toBe('**Rapor** Grafik')
    expect(view.state.field(pasteImageNoticeField)).not.toBe(null)
    const notice = view.dom.querySelector('.cm-paste-notice')!
    expect(notice.textContent).toContain('Copy each image on its own')
    notice.querySelector('button')!.click()
    expect(view.state.field(pasteImageNoticeField)).toBe(null)
    paste(view, word)
    expect(view.state.field(pasteImageNoticeField)).toBe(null)
  })

  it('closes the notice with Escape', () => {
    const view = mount('')
    paste(view, '<p><b>x</b><img src="file:///C:/a.png"></p>')
    expect(view.state.field(pasteImageNoticeField)).not.toBe(null)
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(view.state.field(pasteImageNoticeField)).toBe(null)
  })
})
