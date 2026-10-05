import type { PageEntry } from '../../../lib/api'
import type { ShortcodeDef } from '../../editor'
import { SnippetInsertDialog } from './SnippetInsertDialog'
import { SnippetManager } from './SnippetManager'
import type { SnippetsController } from './useSnippets'

export type SnippetsMode = 'insert' | 'manage'

interface Props {
  snippets: SnippetsController
  mode: SnippetsMode
  /** Snippet to open the form of right away (from the `/` menu). */
  initialId?: string | null
  onModeChange(mode: SnippetsMode | null): void
  pages: readonly PageEntry[]
  contentDir: string
  shortcodes: readonly ShortcodeDef[] | undefined
  pickImage(): Promise<string | null>
  onInsert(text: string): void
}

/** The snippet picker and the snippet manager. */
export function SnippetsHost({ snippets, mode, initialId, onModeChange, pages, contentDir, shortcodes, pickImage, onInsert }: Props) {
  return mode === 'insert' ? (
    <SnippetInsertDialog
      snippets={snippets}
      initialId={initialId ?? null}
      pages={pages}
      contentDir={contentDir}
      pickImage={pickImage}
      onInsert={onInsert}
      onManage={() => onModeChange('manage')}
      onClose={() => onModeChange(null)}
    />
  ) : (
    <SnippetManager
      snippets={snippets}
      shortcodes={shortcodes}
      pages={pages}
      contentDir={contentDir}
      pickImage={pickImage}
      onClose={() => onModeChange('insert')}
    />
  )
}
