// Types shared by the editor (src/features/editor) and the document pane (src/features/document).
import type { EditorView } from '@codemirror/view'

// The document pane supplies site data and file operations; the editor stays free of Tauri calls.

/** A page the `[[` link completion can offer. */
export interface LinkTarget {
  title: string
  /** Site-relative content path, e.g. `content/posts/x.md`. */
  path: string
  permalink: string
}

export interface ShortcodeParam {
  name: string
  /** Index for positional parameters (`{{< youtube abc >}}` → 0). */
  positional?: number
  /**
   * The parameter can only be given by position (`{{< highlight go >}}`);
   * `name` is then just a label. Without this flag a parameter with
   * `positional` can be written either way (`{{< youtube id="abc" >}}`).
   */
  positionalOnly?: boolean
  /** Value type; `boolean` and `number` values are written unquoted (`autoplay=true`). Default `string`. */
  type?: 'string' | 'boolean' | 'number'
  required?: boolean
  description?: string
}

export interface ShortcodeDef {
  name: string
  params: ShortcodeParam[]
  /** Has a closing tag (`{{< x >}}…{{< /x >}}`). */
  paired: boolean
  /** Inner content is Markdown (`{{% %}}` style). */
  markdown?: boolean
  source: 'builtin' | 'site' | 'theme'
  description?: string
}

/** An image to insert: `src` is what goes into `![alt](src)`. */
export interface InsertedImage {
  src: string
  alt: string
}

export interface SpellcheckOptions {
  /**
   * Dictionary language; null turns spellchecking off. `tr` and `en` use the
   * bundled Hunspell dictionaries (personal words apply); any other BCP 47
   * tag (e.g. `ar`) uses the browser's own spellchecker.
   */
  language: 'tr' | 'en' | (string & {}) | null
  /** The user's own words (also accepted as correct). */
  personalWords: readonly string[]
  onAddWord(word: string): void
}

export interface EditorStats {
  words: number
  characters: number
  /** Rounded up, at least 1 for non-empty text. */
  readingMinutes: number
  selectionWords: number
}

/** A host-defined entry of the `/` menu (e.g. a user snippet). */
export interface SlashItem {
  id: string
  label: string
  /** Section heading; default "Snippets" (translated). */
  section?: string
  /** Extra words the menu filter matches. */
  keywords?: string[]
  /** Runs after the typed `/query` has been removed; the cursor is where it was. */
  run(view: EditorView): void
}

/** Optional props the document pane passes to `MarkdownEditor`. */
export interface EditorIntegrationProps {
  /** Site-relative path of the document, for resolving relative image paths. */
  docPath?: string
  /** Pages for `[[` link completion. */
  pages?: readonly LinkTarget[]
  /** Site and theme shortcodes (merged with Hugo's built-ins). */
  shortcodes?: readonly ShortcodeDef[]
  /** Pasted or dropped image files; returns what to insert for each. */
  onImageFiles?: (files: File[]) => Promise<InsertedImage[]>
  /** The slash menu / toolbar "Image" action; null when the user cancels. */
  onRequestImage?: () => Promise<InsertedImage | null>
  /** A `data:` URL preview for an image `src` used in the document, or null. */
  resolveImage?: (src: string) => Promise<string | null>
  spellcheck?: SpellcheckOptions
  /** Dims everything but the current paragraph and keeps the cursor line centred. */
  focusMode?: boolean
  onStats?: (stats: EditorStats) => void
  /** Convert pasted HTML (Word, Google Docs, web pages) to Markdown. Default true. */
  pasteHtmlAsMarkdown?: boolean
  /** Extra `/` menu entries (e.g. user snippets); read when the menu opens. */
  extraSlashItems?: readonly SlashItem[]
}
