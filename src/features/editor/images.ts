// Images: thumbnails under lines that hold images (`![alt](src)` and
// `{{< figure src="…" >}}`), resolved through the host's `resolveImage` and
// cached per source; and inserting images from pasted or dropped files, the
// toolbar or the slash menu through the host's `onImageFiles` /
// `onRequestImage`. Thumbnails are block widgets below the line: nothing in
// the text changes.

import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { insertImageSyntax, insertImagesSpec } from './commands'
import { livePreviewEnabled } from './config'
import type { InsertedImage } from './contract'
import { editorHost } from './host'
import { htmlHasText } from './pasteHtml'
import { parseShortcodeTag } from './shortcodeArgs'
import { shortcodeField } from './shortcodes'

export interface ImageRef {
  src: string
  alt: string
  /** Start and end of the image syntax. */
  from: number
  to: number
}

const ESCAPED = /\\([!-/:-@[-`{-~])/g

/** Images in a range of the document: Markdown images and `figure` shortcodes, in order. */
export function findImages(state: EditorState, from = 0, to = state.doc.length): ImageRef[] {
  const images: ImageRef[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'Image') return true
      const url = node.node.getChild('URL')
      if (!url) return false
      let src = state.doc.sliceString(url.from, url.to)
      if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1)
      const marks = node.node.getChildren('LinkMark')
      const altEnd = marks.find((m) => state.doc.sliceString(m.from, m.to) === ']')
      const alt = altEnd ? state.doc.sliceString(node.from + 2, altEnd.from).replace(ESCAPED, '$1') : ''
      if (src) images.push({ src, alt, from: node.from, to: node.to })
      return false
    },
  })
  for (const token of state.field(shortcodeField, false) ?? []) {
    if (token.to < from || token.from > to) continue
    if (token.escaped || token.kind === 'closing' || token.name !== 'figure') continue
    const tag = parseShortcodeTag(state.doc.sliceString(token.from, token.to), token.from)
    const src = tag?.args.find((a) => a.name === 'src')?.value
    if (src) images.push({ src, alt: tag?.args.find((a) => a.name === 'alt')?.value ?? '', from: token.from, to: token.to })
  }
  return images.sort((a, b) => a.from - b.from)
}

// ---------------------------------------------------------------------------
// Resolved sources

/** A resolved preview URL for a source (null: the host could not find it). */
export const imageResolvedEffect = StateEffect.define<{ src: string; url: string | null }>()

/** Preview URLs by image source, filled as the host resolves them. */
export const imageCacheField = StateField.define<ReadonlyMap<string, string | null>>({
  create: () => new Map(),
  update(value, tr) {
    let next: Map<string, string | null> | null = null
    for (const effect of tr.effects) {
      if (!effect.is(imageResolvedEffect)) continue
      next ??= new Map(value)
      next.set(effect.value.src, effect.value.url)
    }
    return next ?? value
  },
})

class ImagePreviewWidget extends WidgetType {
  readonly images: readonly { url: string; alt: string; src: string }[]
  readonly label: (src: string) => string
  constructor(images: readonly { url: string; alt: string; src: string }[], label: (src: string) => string) {
    super()
    this.images = images
    this.label = label
  }
  eq(other: ImagePreviewWidget): boolean {
    return (
      other.images.length === this.images.length &&
      other.images.every((image, i) => image.url === this.images[i].url && image.alt === this.images[i].alt)
    )
  }
  get estimatedHeight(): number {
    return 168
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-lp-image-preview'
    wrap.setAttribute('contenteditable', 'false')
    for (const image of this.images) {
      const img = document.createElement('img')
      img.src = image.url
      img.alt = image.alt || this.label(image.src)
      img.title = image.src
      img.loading = 'lazy'
      img.decoding = 'async'
      img.draggable = false
      img.addEventListener('load', () => view.requestMeasure())
      img.addEventListener('error', () => {
        img.remove()
        view.requestMeasure()
      })
      wrap.append(img)
    }
    return wrap
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** Thumbnail widgets for resolved images, one block below each line with images (exported for tests). */
export function buildImagePreviews(state: EditorState): DecorationSet {
  if (!state.facet(livePreviewEnabled)) return Decoration.none
  const cache = state.field(imageCacheField, false)
  if (!cache || cache.size === 0) return Decoration.none
  const byLine = new Map<number, { url: string; alt: string; src: string }[]>()
  for (const image of findImages(state)) {
    const url = cache.get(image.src)
    if (typeof url !== 'string') continue
    const lineEnd = state.doc.lineAt(image.to).to
    const list = byLine.get(lineEnd) ?? []
    list.push({ url, alt: image.alt, src: image.src })
    byLine.set(lineEnd, list)
  }
  const label = (src: string) => state.phrase('Preview of $', src)
  const ranges: Range<Decoration>[] = []
  for (const [pos, images] of byLine) {
    ranges.push(Decoration.widget({ widget: new ImagePreviewWidget(images, label), block: true, side: 1 }).range(pos))
  }
  return Decoration.set(ranges, true)
}

const imagePreviewField = StateField.define<DecorationSet>({
  create: buildImagePreviews,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.reconfigured ||
      tr.effects.some((e) => e.is(imageResolvedEffect)) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildImagePreviews(tr.state)
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** Asks the host for the preview of each visible image source once. */
const imageResolver = ViewPlugin.fromClass(
  class {
    private readonly requested = new Set<string>()
    private destroyed = false
    private readonly view: EditorView
    constructor(view: EditorView) {
      this.view = view
      this.request()
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState) || update.view.state.facet(livePreviewEnabled) !== update.startState.facet(livePreviewEnabled)) {
        this.request()
      }
    }
    request() {
      const state = this.view.state
      const resolve = state.facet(editorHost).resolveImage
      if (!resolve || !state.facet(livePreviewEnabled)) return
      const cache = state.field(imageCacheField, false)
      if (!cache) return
      const { from, to } = this.view.viewport
      for (const image of findImages(state, from, to)) {
        if (cache.has(image.src) || this.requested.has(image.src)) continue
        this.requested.add(image.src)
        const src = image.src
        Promise.resolve()
          .then(() => resolve(src))
          .catch(() => null)
          .then((url) => {
            if (this.destroyed) return
            this.view.dispatch({ effects: imageResolvedEffect.of({ src, url: url ?? null }) })
          })
      }
    }
    destroy() {
      this.destroyed = true
    }
  },
)

// ---------------------------------------------------------------------------
// Inserting images from the host

const addPendingEffect = StateEffect.define<{ id: number; pos: number }>()
const removePendingEffect = StateEffect.define<number>()

/** Where pending (still uploading) images go, kept through edits made meanwhile. */
export const pendingImagesField = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value
    if (tr.docChanged && value.size > 0) {
      next = new Map([...value].map(([id, pos]) => [id, tr.changes.mapPos(pos, -1)]))
    }
    for (const effect of tr.effects) {
      if (effect.is(addPendingEffect)) next = new Map(next).set(effect.value.id, effect.value.pos)
      else if (effect.is(removePendingEffect) && next.has(effect.value)) {
        next = new Map(next)
        ;(next as Map<number, number>).delete(effect.value)
      }
    }
    return next
  },
})

let pendingIds = 0

/**
 * Inserts the images `result` resolves to at `pos` (mapped through edits made
 * while waiting). With `replaceTo`, the range `[pos, replaceTo)` is deleted
 * first (a paste over a selection); `moveCursor` puts the cursor at `pos`
 * (a drop). When the cursor is still at `pos` once the images arrive, it
 * moves into the first empty alt text (or after the images); otherwise the
 * user has moved on and it stays where it is. Resolves to the number of
 * images inserted.
 */
export async function insertImagesLater(
  view: EditorView,
  pos: number,
  result: Promise<InsertedImage[] | InsertedImage | null>,
  options: { replaceTo?: number; userEvent?: string; moveCursor?: boolean } = {},
): Promise<number> {
  const id = ++pendingIds
  const deleting = options.replaceTo !== undefined && options.replaceTo > pos
  view.dispatch({
    changes: deleting ? { from: pos, to: options.replaceTo } : undefined,
    selection: options.moveCursor ? { anchor: pos } : undefined,
    effects: addPendingEffect.of({ id, pos }),
    userEvent: deleting ? 'delete.cut' : undefined,
  })
  let images: InsertedImage[] = []
  try {
    const value = await result
    images = value === null ? [] : Array.isArray(value) ? value : [value]
  } catch {
    images = []
  }
  const at = view.state.field(pendingImagesField, false)?.get(id)
  if (at === undefined) return 0
  const target = Math.min(at, view.state.doc.length)
  const spec = insertImagesSpec(view.state, images, target)
  // The cursor follows the images (into an empty alt text) only if the user left it where they go.
  const main = view.state.selection.main
  const follow = main.empty && main.head === target
  if (spec && !follow) delete spec.selection
  try {
    view.dispatch({ ...(spec ?? {}), effects: removePendingEffect.of(id), userEvent: options.userEvent ?? 'input', scrollIntoView: !!spec && follow })
  } catch {
    return 0 // the view was destroyed meanwhile
  }
  return spec ? images.length : 0
}

/**
 * Asks the host for an image (file picker / media library) and inserts it at
 * the cursor. Without a host handler, inserts the `![]()` syntax to fill in.
 */
export function requestImage(view: EditorView): boolean {
  const request = view.state.facet(editorHost).onRequestImage
  if (!request) return insertImageSyntax(view)
  const { from, to } = view.state.selection.main
  void insertImagesLater(view, from, Promise.resolve().then(request), { replaceTo: to, userEvent: 'input' })
  return true
}

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?|heic)$/i

/** The image files among dropped or pasted files. */
export function imageFiles(list: FileList | readonly File[] | null | undefined): File[] {
  if (!list) return []
  return Array.from(list).filter((file) => file.type.startsWith('image/') || IMAGE_FILE.test(file.name))
}

const fileHandlers = EditorView.domEventHandlers({
  paste(event, view) {
    const onImageFiles = view.state.facet(editorHost).onImageFiles
    const files = imageFiles(event.clipboardData?.files)
    if (!onImageFiles || files.length === 0 || view.state.readOnly) return false
    // Word also puts a picture of the copied text on the clipboard: text wins (see pasteHtml.ts).
    if (htmlHasText(event.clipboardData?.getData('text/html') ?? '')) return false
    event.preventDefault()
    const { from, to } = view.state.selection.main
    void insertImagesLater(view, from, Promise.resolve().then(() => onImageFiles(files)), { replaceTo: to, userEvent: 'input.paste' })
    return true
  },
  drop(event, view) {
    const onImageFiles = view.state.facet(editorHost).onImageFiles
    const files = imageFiles(event.dataTransfer?.files)
    if (!onImageFiles || files.length === 0 || view.state.readOnly) return false
    event.preventDefault()
    let pos: number | null = null
    try {
      pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    } catch {
      pos = null // no layout information
    }
    pos ??= view.state.selection.main.head
    void insertImagesLater(view, pos, Promise.resolve().then(() => onImageFiles(files)), { userEvent: 'input.drop', moveCursor: true })
    return true
  },
})

/** Image thumbnails and image insertion. */
export function images(): Extension {
  return [imageCacheField, imagePreviewField, imageResolver, pendingImagesField, fileHandlers]
}
