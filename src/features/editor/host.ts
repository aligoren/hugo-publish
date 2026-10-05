// What the host application (the document pane) gives the editor: site data
// and file operations. Exposed as one facet whose value is read lazily, so
// `MarkdownEditor` can pass an object with getters over its latest props and
// never has to reconfigure the editor when a callback changes identity.

import { Facet, type EditorState } from '@codemirror/state'
import type { EditorStats, InsertedImage, LinkTarget, SlashItem } from './contract'

export interface EditorHost {
  /** Site-relative path of the document. */
  readonly docPath?: string
  /** Pages for `[[` link completion. */
  readonly pages?: readonly LinkTarget[]
  /** Pasted or dropped image files; returns what to insert for each. */
  readonly onImageFiles?: (files: File[]) => Promise<InsertedImage[]>
  /** The slash menu / toolbar "Image" action; null when the user cancels. */
  readonly onRequestImage?: () => Promise<InsertedImage | null>
  /** A `data:` URL (or any displayable URL) for an image `src`, or null. */
  readonly resolveImage?: (src: string) => Promise<string | null>
  readonly onStats?: (stats: EditorStats) => void
  /** Convert pasted HTML to Markdown. Default true. */
  readonly pasteHtmlAsMarkdown?: boolean
  /** "Add to dictionary" in the spelling menu. */
  readonly onAddWord?: (word: string) => void
  /** Host-defined `/` menu entries. */
  readonly extraSlashItems?: readonly SlashItem[]
}

/** The host's callbacks and data. The last provided value wins. */
export const editorHost = Facet.define<EditorHost, EditorHost>({
  combine: (values) => (values.length > 0 ? values[values.length - 1] : {}),
})

export function getHost(state: EditorState): EditorHost {
  return state.facet(editorHost)
}
