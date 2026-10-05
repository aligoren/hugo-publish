// Pasting formatted text (Word, Google Docs, web pages) as Markdown. The
// clipboard's HTML is cleaned (Office/Docs markup, inline styles) and
// converted with turndown; plain-looking HTML (only paragraphs and spans, as
// code editors put on the clipboard) is left to the normal plain-text paste.
// Embedded (`data:`) images are imported through the host (see
// pasteImages.ts); remote images stay links.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { Text, type EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import TurndownService from 'turndown'
import { escapeImageAlt, formatImageSrc } from './commands'
import { editorHost } from './host'
import { dataUrlType, importPastedImages, pastedImages, showPasteImageNotice, type PastedImage } from './pasteImages'
import type { SyntaxNode } from './syntax'

/** Elements that make HTML worth converting (anything else pastes as plain text). */
const SEMANTIC = 'h1,h2,h3,h4,h5,h6,strong,b,em,i,del,s,strike,a[href],ul,ol,blockquote,table,img,pre,code,hr'

function unwrap(element: Element): void {
  element.replaceWith(...Array.from(element.childNodes))
}

function wrapChildren(element: Element, tag: string): void {
  const wrapper = element.ownerDocument.createElement(tag)
  wrapper.append(...Array.from(element.childNodes))
  element.append(wrapper)
}

function styleOf(element: Element): string {
  return (element.getAttribute('style') ?? '').toLowerCase()
}

/** Word's `mso-list` paragraphs → real nested lists. */
function convertWordLists(doc: Document): void {
  const listId = (node: Element) => /mso-list:\s*(l\d+)\s+level\d+/.exec(styleOf(node))?.[1] ?? null
  for (const start of Array.from(doc.querySelectorAll('p'))) {
    const id = start.isConnected ? listId(start) : null
    if (id === null) continue
    // One run per Word list (`l0`, `l1`…) of adjacent paragraphs.
    const run: Element[] = []
    for (let node: Element | null = start; node && node.tagName === 'P' && listId(node) === id; node = node.nextElementSibling) run.push(node)
    const stack: { level: number; list: HTMLElement }[] = []
    const roots: HTMLElement[] = []
    for (const paragraph of run) {
      const level = Number(/level(\d+)/.exec(styleOf(paragraph))?.[1] ?? '1')
      const ignored = Array.from(paragraph.querySelectorAll('span')).find((span) => /mso-list:\s*ignore/.test(styleOf(span)))
      const marker = ignored?.textContent?.replace(/ /g, ' ').trim() ?? ''
      ignored?.remove()
      const tag = /^(?:\d+|[a-z]|[ivxlcdm]+)[.)]$/i.test(marker) ? 'OL' : 'UL'
      const item = doc.createElement('li')
      item.append(...Array.from(paragraph.childNodes))
      while (stack.length > 0 && stack[stack.length - 1].level > level) stack.pop()
      const top = stack[stack.length - 1]
      if (!top || top.level < level || top.list.tagName !== tag) {
        if (top && top.level === level) stack.pop()
        const list = doc.createElement(tag.toLowerCase())
        const parentItem = stack.length > 0 ? stack[stack.length - 1].list.lastElementChild : null
        if (parentItem) parentItem.append(list)
        else roots.push(list)
        stack.push({ level, list })
      }
      stack[stack.length - 1].list.append(item)
    }
    run[0].before(...roots)
    for (const paragraph of run) paragraph.remove()
  }
}

/** Removes Office / Google Docs markup and turns styled spans into strong/em/del. */
export function cleanPastedHtml(doc: Document): void {
  // Comments (also Word's conditional comments) and non-content elements.
  const walker = doc.createTreeWalker(doc, 128 /* NodeFilter.SHOW_COMMENT */)
  const comments: Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  for (const comment of comments) comment.parentNode?.removeChild(comment)
  for (const element of Array.from(doc.querySelectorAll('style,script,meta,link,title,xml,colgroup,col,template'))) element.remove()
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    const tag = element.tagName.toLowerCase()
    if (tag.includes(':')) {
      // <o:p>, <w:…>, <v:…>: Office namespaces.
      if (tag === 'o:p') element.replaceWith(...Array.from(element.childNodes))
      else element.remove()
    }
  }
  convertWordLists(doc)
  // Google Docs wraps everything in <b id="docs-internal-guid-…" style="font-weight:normal">.
  for (const element of Array.from(doc.querySelectorAll('[id^="docs-internal-guid"]'))) unwrap(element)
  for (const element of Array.from(doc.querySelectorAll('b,strong'))) {
    if (/font-weight:\s*(?:normal|[1-5]00)\b/.test(styleOf(element))) unwrap(element)
  }
  // A list directly inside a list (Google Docs nesting) belongs to the previous item.
  for (const list of Array.from(doc.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol'))) {
    const previous = list.previousElementSibling
    if (previous?.tagName === 'LI') previous.append(list)
  }
  // A single paragraph in a list item (Google Docs) would make the list loose.
  for (const item of Array.from(doc.querySelectorAll('li'))) {
    const paragraphs = Array.from(item.children).filter((child) => child.tagName === 'P')
    if (paragraphs.length === 1) unwrap(paragraphs[0])
  }
  // Line breaks between blocks (not inside text) are layout, not content.
  const BLOCK = /^(?:P|DIV|UL|OL|TABLE|H[1-6]|BLOCKQUOTE|PRE|HR)$/
  for (const br of Array.from(doc.querySelectorAll('br'))) {
    const sibling = (node: ChildNode | null, next: boolean): ChildNode | null => {
      while (node && node.nodeType === 3 && node.textContent?.trim() === '') node = next ? node.nextSibling : node.previousSibling
      return node
    }
    const before = sibling(br.previousSibling, false)
    const after = sibling(br.nextSibling, true)
    const isBlock = (node: ChildNode | null) => !node || (node.nodeType === 1 && BLOCK.test((node as Element).tagName))
    if (isBlock(before) && isBlock(after)) br.remove()
  }
  // Styled spans: keep bold, italic and strikethrough, drop the rest of the styling.
  for (const span of Array.from(doc.querySelectorAll('span,font'))) {
    const style = styleOf(span)
    const inHeading = !!span.closest('h1,h2,h3,h4,h5,h6,th')
    const text = span.textContent ?? ''
    if (text.trim() !== '') {
      if (/text-decoration[^;]*line-through/.test(style)) wrapChildren(span, 'del')
      if (/font-style:\s*italic/.test(style)) wrapChildren(span, 'em')
      if (!inHeading && /font-weight:\s*(?:bold|[6-9]00)\b/.test(style)) wrapChildren(span, 'strong')
    }
    unwrap(span)
  }
  // Anchors without a link (Word bookmarks).
  for (const anchor of Array.from(doc.querySelectorAll('a:not([href])'))) unwrap(anchor)
  // Merge adjacent identical inline wrappers: <strong>a</strong><strong>b</strong>.
  for (const tag of ['strong', 'em', 'del']) {
    for (const element of Array.from(doc.querySelectorAll(tag))) {
      const next = element.nextSibling
      if (next && next.nodeType === 1 && (next as Element).tagName.toLowerCase() === tag) {
        ;(next as Element).prepend(...Array.from(element.childNodes))
        element.remove()
      }
    }
  }
}

/**
 * Escapes what Markdown would read as syntax, and nothing else: Turkish
 * quotes, apostrophes and `[bracket placeholders]` stay as they are.
 */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\')
    .replace(/[*`]/g, '\\$&')
    .replace(/~~/g, '\\~~')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (match) => match.replace('_', '\\_'))
    .replace(/\](?=[([:])/g, '\\]')
    .replace(/<(?=[A-Za-z/!?])/g, '\\<')
    .replace(/\{\{(?=[<%])/g, '{{\\')
    .replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+](?=\s)|=+$)/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])(?=\s)/, '$1\\$2')
}

/** A table cell's Markdown on one line: its lines joined with `<br>`, pipes escaped. */
export function cellText(content: string): string {
  return content
    .split('\n')
    .map((line) => line.trim().replace(/(?<!\\)\\$/, '').trimEnd())
    .filter((line) => line !== '')
    .join('<br>')
    .replace(/\|/g, '\\|')
}

const BOLD = 'strong,b'

/** Every non-blank text of `cell` is bold, and there is some. */
function allBold(cell: Element): boolean {
  const walker = cell.ownerDocument.createTreeWalker(cell, 4 /* NodeFilter.SHOW_TEXT */)
  let any = false
  while (walker.nextNode()) {
    const node = walker.currentNode
    if ((node.textContent ?? '').trim() === '') continue
    const bold = node.parentElement?.closest(BOLD)
    if (!bold || !cell.contains(bold)) return false
    any = true
  }
  return any
}

/**
 * Prepares tables for GFM: `colspan`/`rowspan` cells are expanded with empty
 * cells so columns line up, and without `<th>` a first row that is all bold
 * is taken as the header (its bold dropped: headers are bold anyway).
 * Without either, the first row still becomes the header, as GFM needs one.
 */
function normalizeTables(doc: Document): void {
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    const rows = Array.from(table.rows)
    // `pending[c]`: how many more rows column c is covered by a rowspan from above.
    const pending: number[] = []
    for (const row of rows) {
      let column = 0
      const fill = (before: Element | null) => {
        while ((pending[column] ?? 0) > 0) {
          pending[column]--
          row.insertBefore(doc.createElement('td'), before)
          column++
        }
      }
      for (const cell of Array.from(row.cells)) {
        fill(cell)
        const colspan = Math.max(1, Math.min(50, Number(cell.getAttribute('colspan')) || 1))
        const rowspan = Math.max(1, Math.min(500, Number(cell.getAttribute('rowspan')) || 1))
        cell.removeAttribute('colspan')
        cell.removeAttribute('rowspan')
        for (let i = 0; i < colspan; i++) {
          if (i > 0) cell.after(doc.createElement(cell.tagName.toLowerCase() === 'th' ? 'th' : 'td'))
          if (rowspan > 1) pending[column + i] = rowspan - 1
        }
        column += colspan
      }
      fill(null)
    }
    const first = rows[0]
    if (!first || rows.length < 2 || table.querySelector('th')) continue
    const cells = Array.from(first.cells)
    const filled = cells.filter((cell) => (cell.textContent ?? '').trim() !== '')
    if (filled.length > 0 && filled.every(allBold)) {
      for (const cell of cells) for (const bold of Array.from(cell.querySelectorAll(BOLD))) unwrap(bold)
    }
  }
}

/** The delimiter cell for a column, from the alignment of its first cell. */
function delimiterCell(cell: Element | undefined): string {
  const align = cell ? (cell.getAttribute('align') ?? /text-align:\s*([a-z]+)/.exec(styleOf(cell))?.[1] ?? '').toLowerCase() : ''
  if (align === 'center') return ' :-: |'
  if (align === 'right' || align === 'end') return ' --: |'
  return ' --- |'
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    br: '\\',
  })
  service.escape = escapeMarkdownText
  service.addRule('strikethrough', {
    filter: (node) => node.nodeName === 'DEL' || node.nodeName === 'S' || node.nodeName === 'STRIKE',
    replacement: (content) => (content.trim() ? `~~${content}~~` : content),
  })
  service.addRule('image', {
    filter: 'img',
    replacement: (_content, node) => {
      const element = node as HTMLImageElement
      const src = (element.getAttribute('src') ?? '').trim()
      const alt = (element.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim()
      const title = (element.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim()
      // Embedded images: a token, replaced by the alt text (and later by the imported image).
      if (/^data:/i.test(src) && dataUrlType(src)) {
        collected.push({ alt, title, src })
        return `\uE000${collected.length - 1}\uE001`
      }
      // Local files (Word's file:///…/clip_image001.png) and blob: URLs cannot be read: the alt text stays.
      if (!src || /^(?:data|file|blob):/i.test(src)) {
        if (/^(?:file|blob):/i.test(src)) localImages++
        return alt ? escapeMarkdownText(alt) : ''
      }
      return `![${escapeImageAlt(alt)}](${formatImageSrc(src)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
    },
  })
  service.addRule('link', {
    filter: (node) => node.nodeName === 'A' && !!node.getAttribute('href'),
    replacement: (content, node) => {
      const href = (node as HTMLAnchorElement).getAttribute('href') ?? ''
      const text = content.trim()
      if (!text) return ''
      if (/^javascript:/i.test(href)) return content
      const title = (node as HTMLAnchorElement).getAttribute('title')
      return `[${text}](${formatImageSrc(href)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
    },
  })
  // GFM tables: one line per row, cell lines joined with `<br>`.
  service.addRule('tableSection', { filter: ['thead', 'tbody', 'tfoot'], replacement: (content) => content })
  service.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const first = !node.previousElementSibling
      return (first ? '| ' : ' ') + cellText(content) + ' |'
    },
  })
  service.addRule('tableRow', { filter: 'tr', replacement: (content) => '\n' + content })
  service.addRule('table', {
    filter: 'table',
    replacement: (content, node) => {
      const rows = content.split('\n').filter((row) => row.trim() !== '')
      if (rows.length === 0) return ''
      const element = node as HTMLTableElement
      const counts = Array.from(element.rows).map((row) => row.cells.length)
      const columns = Math.max(1, ...counts)
      const padded = rows.map((row, i) => row + ' |'.repeat(Math.max(0, columns - (counts[i] ?? columns))))
      const firstCells = Array.from(element.rows[0]?.cells ?? [])
      const rule = '|' + Array.from({ length: columns }, (_, i) => delimiterCell(firstCells[i])).join('')
      return '\n\n' + [padded[0], rule, ...padded.slice(1)].join('\n') + '\n\n'
    },
  })
  return service
}

let turndown: TurndownService | null = null
/** Embedded images met by the conversion in progress. */
let collected: { alt: string; title: string; src: string }[] = []
/** Local (`file:` / `blob:`) images met by the conversion in progress. */
let localImages = 0

export interface PastedHtml {
  /** The Markdown (line breaks `\n`); embedded images stand there as their alt text. */
  markdown: string
  /** Embedded (`data:`) images and where their alt text placeholders are. */
  images: PastedImage[]
  /** Images that pointed at local files (Word's clip files) and could not be kept. */
  localImages: number
}

/**
 * Converts clipboard HTML to Markdown, noting embedded images, or returns
 * null when the HTML has no formatting worth keeping (then the plain text
 * should be pasted).
 */
export function convertPastedHtml(html: string): PastedHtml | null {
  if (typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  cleanPastedHtml(doc)
  const body = doc.body
  if (!body || !body.querySelector(SEMANTIC)) return null
  normalizeTables(doc)
  // Non-breaking spaces from Word/Docs become normal spaces.
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */)
  while (walker.nextNode()) {
    const node = walker.currentNode as globalThis.Text
    if (node.data.includes('\u00a0')) node.data = node.data.replace(/\u00a0/g, ' ')
  }
  turndown ??= createTurndown()
  collected = []
  localImages = 0
  let converted: string
  let found: typeof collected
  let local: number
  try {
    converted = turndown
      .turndown(body)
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  } finally {
    found = collected
    local = localImages
    collected = []
    localImages = 0
  }
  // Tokens → alt text, remembering where each one is.
  const images: PastedImage[] = []
  let markdown = ''
  let last = 0
  for (const match of converted.matchAll(/\uE000(\d+)\uE001/g)) {
    markdown += converted.slice(last, match.index)
    last = match.index + match[0].length
    const image = found[Number(match[1])]
    if (!image) continue
    const placeholder = image.alt ? escapeMarkdownText(image.alt) : ''
    images.push({ offset: markdown.length, placeholder, alt: image.alt, title: image.title, src: image.src })
    markdown += placeholder
  }
  markdown += converted.slice(last)
  if (markdown.trim() === '' && images.length === 0) return null
  return { markdown, images, localImages: local }
}

/**
 * Converts clipboard HTML to Markdown, or returns null when the HTML has no
 * formatting worth keeping (then the plain text should be pasted). Line
 * breaks in the result are `\n`. Embedded images become their alt text.
 */
export function htmlToMarkdown(html: string): string | null {
  const markdown = (convertPastedHtml(html)?.markdown ?? '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
  return markdown === '' ? null : markdown
}

/**
 * Whether clipboard HTML holds text and not only images. Copying an image
 * in a browser gives `<img>` alone (the image file is pasted); copying from
 * Word gives the text and, on some systems, a picture of it as a file (the
 * text is pasted).
 */
export function htmlHasText(html: string): boolean {
  if (!html || typeof DOMParser === 'undefined') return false
  const body = new DOMParser().parseFromString(html, 'text/html').body
  for (const element of Array.from(body?.querySelectorAll('style,script,title,template') ?? [])) element.remove()
  return (body?.textContent ?? '').trim() !== ''
}

function inCode(state: EditorState, pos: number): boolean {
  const tree = ensureSyntaxTree(state, pos, 50) ?? syntaxTree(state)
  for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') return true
  }
  return false
}

const htmlPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const host = view.state.facet(editorHost)
    if (host.pasteHtmlAsMarkdown === false || view.state.readOnly) return false
    const html = event.clipboardData?.getData('text/html')
    if (!html || inCode(view.state, view.state.selection.main.from)) return false
    const pasted = convertPastedHtml(html)
    if (pasted === null) return false
    event.preventDefault()
    const main = view.state.selection.main
    const tr = view.state.update(view.state.replaceSelection(Text.of(pasted.markdown.split('\n'))), {
      userEvent: 'input.paste',
      scrollIntoView: true,
    })
    // Where the main selection's copy of the Markdown starts.
    const start = tr.changes.mapPos(main.from, -1)
    view.dispatch(tr)
    const onImageFiles = host.onImageFiles
    if (onImageFiles && pasted.images.length > 0) void importPastedImages(view, start, pasted.images, onImageFiles)
    if (pasted.localImages > 0) showPasteImageNotice(view, start)
    return true
  },
})

/** Pasting HTML as Markdown (turn off with the host's `pasteHtmlAsMarkdown: false`). */
export function pasteHtmlAsMarkdown(): Extension {
  return [htmlPaste, pastedImages()]
}
