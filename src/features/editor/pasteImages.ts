// Images inside pasted HTML (Word, Google Docs, web pages). Embedded
// `data:` images are turned into files and imported through the host's
// `onImageFiles`, one at a time; until an import finishes, its alt text
// stands in the document as a placeholder (and stays there if the import
// fails). Word's own clip files (`file:///…/clip_image001.png`) cannot be
// read from the webview: the alt text is kept and a one-time notice explains
// how to paste such images.

import { MapMode, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, showTooltip, type DecorationSet, type Tooltip } from '@codemirror/view'
import { imageMarkdown } from './commands'
import type { InsertedImage } from './contract'

/** An embedded image of a paste: where its alt text placeholder is, and what to import. */
export interface PastedImage {
  /** Offset of the placeholder in the converted Markdown (line breaks `\n`). */
  offset: number
  /** The placeholder text (the escaped alt text, possibly empty). */
  placeholder: string
  alt: string
  title: string
  /** The `data:` URL. */
  src: string
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/heic': 'heic',
}

const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is

/** The MIME type of an image `data:` URL, or null for anything else. */
export function dataUrlType(src: string): string | null {
  const match = DATA_URL.exec(src.trim())
  const type = match?.[1].trim().toLowerCase() ?? ''
  return type.startsWith('image/') ? type : null
}

/**
 * A file for an image `data:` URL (base64 or percent-encoded), named
 * `<baseName>.<ext>`; null when it is not an image or cannot be decoded.
 */
export function dataUrlToFile(src: string, baseName: string): File | null {
  const match = DATA_URL.exec(src.trim())
  const type = dataUrlType(src)
  if (!match || !type) return null
  const base64 = /;base64$/i.test(match[2])
  let bytes: Uint8Array
  try {
    if (base64) {
      const binary = atob(match[3].replace(/\s+/g, ''))
      bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(match[3]))
    }
  } catch {
    return null
  }
  if (bytes.length === 0) return null
  const ext = EXTENSIONS[type] ?? (type.slice(6).replace(/[^a-z0-9].*$/, '') || 'png')
  return new File([bytes as BlobPart], `${baseName}.${ext}`, { type })
}

const TURKISH_ASCII: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }

/** A file name (without extension) from an image's alt text or title: `İstanbul Boğazı` → `istanbul-bogazi`. */
export function imageNameFromText(text: string, maxLength = 60): string {
  const slug = text
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (ch) => TURKISH_ASCII[ch])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, maxLength).replace(/-+$/, '')
}

/**
 * File names (without extension) for the images of one paste: from the alt
 * text or title, otherwise `pasted-image-N`; unique within the paste.
 */
export function pastedImageNames(images: readonly { alt: string; title: string }[]): string[] {
  const used = new Map<string, number>()
  let unnamed = 0
  return images.map((image) => {
    let name = imageNameFromText(image.alt) || imageNameFromText(image.title)
    if (!name) name = `pasted-image-${++unnamed}`
    const count = (used.get(name) ?? 0) + 1
    used.set(name, count)
    return count > 1 ? `${name}-${count}` : name
  })
}

// ---------------------------------------------------------------------------
// Placeholders of images being imported

interface Placeholder {
  id: number
  from: number
  to: number
  /** The placeholder text as inserted. */
  text: string
}

const addPlaceholdersEffect = StateEffect.define<readonly Placeholder[]>()
const removePlaceholderEffect = StateEffect.define<number>()

/** Alt text placeholders of pasted images still being imported, mapped through edits. */
export const pastedImagePlaceholders = StateField.define<readonly Placeholder[]>({
  create: () => [],
  update(value, tr) {
    let next = value
    if (tr.docChanged && next.length > 0) {
      const mapped: Placeholder[] = []
      for (const item of next) {
        if (item.from === item.to) {
          // An empty placeholder disappears when a deletion covers it.
          const pos = tr.changes.mapPos(item.from, -1, MapMode.TrackDel)
          if (pos !== null) mapped.push({ ...item, from: pos, to: pos })
          continue
        }
        // A non-empty placeholder whose text was deleted (or typed over) is gone.
        const from = tr.changes.mapPos(item.from, 1)
        const to = tr.changes.mapPos(item.to, -1)
        if (from < to) mapped.push({ ...item, from, to })
      }
      next = mapped
    }
    for (const effect of tr.effects) {
      if (effect.is(addPlaceholdersEffect)) next = [...next, ...effect.value]
      else if (effect.is(removePlaceholderEffect)) next = next.filter((item) => item.id !== effect.value)
    }
    return next
  },
  provide: (field) => EditorView.decorations.compute([field, 'doc'], (state) => placeholderDecorations(state, state.field(field))),
})

class ImportingWidget extends WidgetType {
  readonly label: string
  constructor(label: string) {
    super()
    this.label = label
  }
  eq(other: ImportingWidget): boolean {
    return other.label === this.label
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-image-importing-badge'
    span.setAttribute('role', 'status')
    span.setAttribute('aria-label', this.label)
    span.title = this.label
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

function placeholderDecorations(state: EditorState, items: readonly Placeholder[]): DecorationSet {
  if (items.length === 0) return Decoration.none
  const label = state.phrase('Importing image…')
  const badge = Decoration.widget({ widget: new ImportingWidget(label), side: 1 })
  const mark = Decoration.mark({ class: 'cm-image-importing' })
  const ranges: Range<Decoration>[] = []
  for (const item of items) {
    if (item.to > item.from) ranges.push(mark.range(item.from, item.to))
    ranges.push(badge.range(item.to))
  }
  return Decoration.set(ranges, true)
}

let placeholderIds = 0

/**
 * Imports the embedded images of a paste whose Markdown starts at `start`,
 * one after another, and replaces each placeholder with the image when its
 * import succeeds (if the user changed the placeholder meanwhile, the image
 * goes right after it). Failed imports leave the alt text. Resolves to the
 * number of images inserted.
 */
export async function importPastedImages(
  view: EditorView,
  start: number,
  images: readonly PastedImage[],
  onImageFiles: (files: File[]) => Promise<InsertedImage[]>,
): Promise<number> {
  const names = pastedImageNames(images)
  const jobs: { id: number; image: PastedImage; file: File }[] = []
  images.forEach((image, i) => {
    const file = dataUrlToFile(image.src, names[i])
    if (file) jobs.push({ id: ++placeholderIds, image, file })
  })
  if (jobs.length === 0) return 0
  view.dispatch({
    effects: addPlaceholdersEffect.of(
      jobs.map(({ id, image }) => ({
        id,
        from: start + image.offset,
        to: start + image.offset + image.placeholder.length,
        text: image.placeholder,
      })),
    ),
  })
  let inserted = 0
  // One at a time: each import is a separate call, so a failure cannot shift the others.
  for (const { id, image, file } of jobs) {
    let result: InsertedImage | undefined
    try {
      result = (await onImageFiles([file]))[0]
    } catch {
      result = undefined
    }
    const item = view.state.field(pastedImagePlaceholders, false)?.find((p) => p.id === id)
    try {
      if (!item || !result) {
        view.dispatch({ effects: removePlaceholderEffect.of(id) })
        continue
      }
      // Our file name says nothing the alt text does not; the HTML's own alt text (or title) wins.
      const markdown = imageMarkdown({ src: result.src, alt: image.alt || image.title })
      const unchanged = view.state.sliceDoc(item.from, item.to).replace(/\r\n/g, '\n') === item.text
      view.dispatch({
        changes: unchanged ? { from: item.from, to: item.to, insert: markdown } : { from: item.to, insert: markdown },
        effects: removePlaceholderEffect.of(id),
        userEvent: 'input.paste',
      })
      inserted++
    } catch {
      return inserted // the view was destroyed meanwhile
    }
  }
  return inserted
}

// ---------------------------------------------------------------------------
// Notice for images that cannot be pasted (Word's temporary clip files)

const showNoticeEffect = StateEffect.define<number>()
const hideNoticeEffect = StateEffect.define<null>()

let noticeShown = false

/** Lets the one-time notice show again (tests). */
export function resetPasteImageNotice(): void {
  noticeShown = false
}

export const pasteImageNoticeField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) {
      const pos = tr.changes.mapPos(value.pos)
      value = pos === value.pos ? value : { ...value, pos }
    }
    for (const effect of tr.effects) {
      if (effect.is(showNoticeEffect)) value = { pos: effect.value, above: false, create: noticeView }
      else if (effect.is(hideNoticeEffect)) value = null
    }
    // A click elsewhere in the text closes it.
    if (value && tr.isUserEvent('select.pointer')) value = null
    return value
  },
  provide: (field) => showTooltip.from(field),
})

function noticeView(view: EditorView) {
  const dom = document.createElement('div')
  dom.className = 'cm-paste-notice'
  dom.setAttribute('role', 'alert')
  const text = document.createElement('p')
  text.textContent = view.state.phrase(
    'Images from Word could not be pasted with the text: Word keeps them in temporary files the editor cannot read. Their descriptions were kept. Copy each image on its own and paste it separately.',
  )
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = view.state.phrase('Dismiss')
  close.addEventListener('mousedown', (event) => event.preventDefault())
  close.addEventListener('click', () => {
    view.dispatch({ effects: hideNoticeEffect.of(null) })
    view.focus()
  })
  dom.append(text, close)
  return { dom }
}

/**
 * Shows the notice about unreadable (local file) images at `pos`, once per
 * session. Returns whether it was shown.
 */
export function showPasteImageNotice(view: EditorView, pos: number): boolean {
  if (noticeShown || view.state.field(pasteImageNoticeField, false) === undefined) return false
  noticeShown = true
  view.dispatch({ effects: showNoticeEffect.of(Math.min(pos, view.state.doc.length)) })
  return true
}

const noticeKeymap = keymap.of([
  {
    key: 'Escape',
    run(view) {
      if (!view.state.field(pasteImageNoticeField, false)) return false
      view.dispatch({ effects: hideNoticeEffect.of(null) })
      return true
    },
  },
])

/** Placeholders and the notice (installed with the HTML paste extension). */
export function pastedImages(): Extension {
  return [pastedImagePlaceholders, pasteImageNoticeField, noticeKeymap]
}
