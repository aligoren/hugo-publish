// `[[` internal link completion: typing `[[` and part of a title or path
// lists the site's pages; picking one replaces `[[query` with
// `[Title]({{< relref "posts/x.md" >}})` (or the permalink path, see the
// `linkStyle` facet).

import { pickedCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { contentDir, linkStyle } from './config'
import type { LinkTarget } from './contract'
import { editorHost } from './host'
import { inLiteralText } from './slashMenu'
import { matchScore } from './text'

/** The page path relative to the content folder: `content/posts/x.md` → `posts/x.md`. */
export function contentRelativePath(path: string, dir = 'content'): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  const prefix = dir.replace(/^\/+|\/+$/g, '') + '/'
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
}

/** The path part of a permalink (`https://site/posts/x/` → `/posts/x/`). */
export function permalinkPath(permalink: string): string {
  try {
    const url = new URL(permalink, 'http://localhost/')
    return url.pathname + url.search + url.hash
  } catch {
    return permalink
  }
}

function escapeLinkText(text: string): string {
  return text.replace(/[\\[\]]/g, (ch) => '\\' + ch)
}

/** The Markdown inserted for a page. */
export function pageLinkMarkdown(state: EditorState, page: LinkTarget): string {
  const relative = contentRelativePath(page.path, state.facet(contentDir))
  const text = escapeLinkText(page.title.trim() || relative)
  if (state.facet(linkStyle) === 'permalink' && page.permalink) {
    const target = permalinkPath(page.permalink)
    return `[${text}](${/[\s()<>]/.test(target) ? `<${target}>` : target})`
  }
  return `[${text}]({{< relref "${relative.replace(/"/g, '\\"')}" >}})`
}

const LINK_QUERY = /\[\[([^[\]\n]{0,80})$/
const MAX_OPTIONS = 60

/** Completion source for `[[`. */
export function linkCompletionSource(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context
  const pages = state.facet(editorHost).pages
  if (!pages || pages.length === 0) return null
  const line = state.doc.lineAt(pos)
  const match = LINK_QUERY.exec(state.sliceDoc(line.from, pos))
  if (!match) return null
  const from = pos - match[0].length
  if (inLiteralText(state, from)) return null
  const query = match[1]
  const dir = state.facet(contentDir)
  // A `]]` the user typed (or an editor added) after the cursor is replaced too.
  const to = state.sliceDoc(pos, pos + 2) === ']]' ? pos + 2 : pos
  const scored = pages
    .map((page, index) => {
      const relative = contentRelativePath(page.path, dir)
      return { page, relative, index, score: matchScore(query, page.title, relative) }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_OPTIONS)
  if (scored.length === 0) return null
  const options: Completion[] = scored.map(({ page, relative }) => ({
    label: page.title.trim() || relative,
    detail: relative,
    type: 'page',
    apply: (view: EditorView, completion: Completion, applyFrom: number) => {
      const insert = pageLinkMarkdown(view.state, page)
      view.dispatch({
        changes: { from: applyFrom, to, insert },
        selection: { anchor: applyFrom + insert.length },
        annotations: pickedCompletion.of(completion),
        userEvent: 'input.complete',
        scrollIntoView: true,
      })
    },
  }))
  return { from, to: pos, options, filter: false }
}
