import { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffView } from '../../components/DiffView'
import { ErrorNote } from '../../components/ErrorNote'
import { api } from '../../lib/api'
import { joinFrontMatter } from '../../lib/frontmatter'
import { ChecksPanel } from '../checks/DocumentChecks'
import type { CheckIssue } from '../checks/runChecks'
import { useDocumentChecks } from '../checks/useDocumentChecks'
import {
  EditorStatusBar,
  EditorToolbar,
  MarkdownEditor,
  type AlertLabels,
  type EditorStats,
  type SlashItem,
  type MarkdownEditorHandle,
} from '../editor'
import { useSite } from '../site/SiteContext'
import { DocumentHeader } from './DocumentHeader'
import { asText, fieldAccess, setDraft, taxonomyLabel } from './frontMatterFields'
import { findKey } from './frontMatterOps'
import { FrontMatterForm } from './FrontMatterForm'
import { HistoryDrawer } from './HistoryDrawer'
import { imageReference, MediaPickerDialog } from './mediaBridge'
import { imageTargetDir } from './imagePaths'
import { MetaLine, type MetaTaxonomy } from './MetaLine'
import { displayDate, postStatus } from './postStatus'
import { contentFolders, docLocation } from './rename'
import { RenameDialog } from './RenameDialog'
import { DEFAULT_TAXONOMIES } from './siteSettings'
import { startPosition } from './startPosition'
import { TitleField } from './TitleField'
import { useDocument } from './useDocument'
import { useEditorIntegration } from './useEditorIntegration'
import { useFrontMatter } from './useFrontMatter'
import { useMediaPicker } from './useMediaPicker'
import { useAi } from './useAi'
import { useRename } from './useRename'
import { snippetInsertion } from './snippets/insert'
import { SnippetsHost, type SnippetsMode } from './snippets/SnippetsHost'
import { useSnippets } from './snippets/useSnippets'
import { useSiteSettings, useSiteTerms, useThemeImageParams } from './useSiteData'
import type { MenuItem } from './workspace/OverflowMenu'
import { paneKind, useNarrowWindow, usePanePrefs, type PaneTab } from './workspace/panePrefs'
import { SidePane, type PaneTabDef } from './workspace/SidePane'

interface Props {
  /** Site-relative path of the file being edited. */
  path: string
  alertLabels: AlertLabels
  onDirtyChange(dirty: boolean): void
  onSaved(path: string): void
  /** The site preview, shown in the side pane's Preview tab (no tab without it). */
  preview?: ReactNode
  /** The user opened the Preview tab (e.g. start the preview server). */
  onPreviewOpen?: () => void
  /** The post was just created: put the cursor where writing starts. */
  fresh?: boolean
  onFreshHandled?: () => void
}

/** Width of the writing column: the title and the editor's text line up in it. */
const COLUMN = '46rem'

const countNewlines = (text: string) => text.split('\n').length - 1

/** The field a check issue without a body line is about. */
function issueField(issue: CheckIssue): string | null {
  switch (issue.rule) {
    case 'title-missing':
      return 'title'
    case 'description-empty':
    case 'description-long':
      return 'description'
    case 'draft':
      return 'draft'
    case 'front-matter-invalid':
      return 'source'
    case 'archetype-leftover':
      return typeof issue.params?.field === 'string' ? issue.params.field : null
    case 'body-empty':
      return 'body'
    default:
      return null
  }
}

export function DocumentPane({ path, alertLabels, onDirtyChange, onSaved, preview, onPreviewOpen, fresh = false, onFreshHandled }: Props) {
  const { t, i18n } = useTranslation()
  const site = useSite()
  const editor = useRef<MarkdownEditorHandle>(null)
  const root = useRef<HTMLDivElement>(null)
  const titleInput = useRef<HTMLTextAreaElement>(null)
  const flushFrontMatter = useRef<() => Promise<void>>(async () => {})
  const doc = useDocument({ path, onSaved, beforeSave: () => flushFrontMatter.current() })
  const fm = useFrontMatter({
    parts: doc.parts,
    getParts: doc.getParts,
    setParts: doc.setParts,
    original: doc.loaded?.original ?? null,
    generation: doc.generation,
  })
  useEffect(() => {
    flushFrontMatter.current = fm.flush
  }, [fm.flush])

  const settings = useSiteSettings()
  const terms = useSiteTerms(settings?.taxonomies ?? null)
  const themeImages = useThemeImageParams(settings)
  const picker = useMediaPicker()
  const ai = useAi(settings)
  const rename = useRename(path, doc, fm)
  const page = site.pages.find((p) => p.path === path)
  const issues = useDocumentChecks(path, doc.text ?? '')
  const problems = issues.filter((issue) => issue.severity !== 'info').length

  const [livePreview, setLivePreview] = useState(true)
  const [focusMode, setFocusMode] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [conflictDiff, setConflictDiff] = useState(false)
  const [stats, setStats] = useState<EditorStats | null>(null)
  const [snippetsMode, setSnippetsMode] = useState<SnippetsMode | null>(null)
  const [snippetId, setSnippetId] = useState<string | null>(null)
  const [sourceMode, setSourceMode] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{ field: string; at: number } | null>(null)

  // The side pane: open or closed, its tab and width are remembered across documents.
  const [prefs, updatePrefs] = usePanePrefs()
  const narrow = useNarrowWindow()
  const hasPreview = preview !== undefined
  const tab: PaneTab = prefs.tab === 'preview' && !hasPreview ? 'settings' : prefs.tab
  const paneOpen = prefs.open && !focusMode
  const [visited, setVisited] = useState<PaneTab[]>([])
  const mounted = visited.includes(tab) ? visited : [...visited, tab]

  const showTab = useCallback(
    (next: PaneTab) => {
      setFocusMode(false)
      updatePrefs({ open: true, tab: next })
      setVisited((list) => (list.includes(next) ? list : [...list, next]))
      if (next === 'preview') onPreviewOpen?.()
    },
    [onPreviewOpen, updatePrefs],
  )
  const closePane = useCallback(() => updatePrefs({ open: false }), [updatePrefs])
  const togglePane = useCallback(
    (next: PaneTab) => {
      if (paneOpen && tab === next) closePane()
      else showTab(next)
    },
    [closePane, paneOpen, showTab, tab],
  )
  /** Opens the post settings at one field ('source' for the front matter as text). */
  const openSettingsAt = useCallback(
    (field: string) => {
      setSourceMode(field === 'source')
      showTab('settings')
      setFocusRequest({ field, at: Date.now() })
    },
    [showTab],
  )

  const snippets = useSnippets()
  const openSnippets = useCallback((id: string | null) => {
    setSnippetId(id)
    setSnippetsMode('insert')
  }, [])
  const slashItems = useMemo<SlashItem[]>(
    () =>
      (snippets.file?.snippets ?? []).map((snippet) => ({
        id: `snippet:${snippet.id}`,
        label: snippet.name,
        keywords: [snippet.id, ...(snippet.description ? [snippet.description] : [])],
        run: () => openSnippets(snippet.id),
      })),
    [openSnippets, snippets.file],
  )

  const values = fm.values
  const access = fieldAccess(fm)
  const slugValue = values ? values[findKey(values, 'slug') ?? 'slug'] : undefined
  const integration = useEditorIntegration({
    path,
    slug: slugValue,
    settings,
    pickImage: picker.pick,
    onError: doc.setError,
  })

  // Front matter edits still on their way through the TOML editor count as unsaved too.
  const unsaved = doc.dirty || fm.pending
  useEffect(() => {
    onDirtyChange(unsaved)
  }, [unsaved, onDirtyChange])

  // Keyboard shortcuts read the latest actions without re-subscribing.
  const keys = useRef({ save: doc.save, togglePane, hasPreview })
  useEffect(() => {
    keys.current = { save: doc.save, togglePane, hasPreview }
  })
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 's' && !event.shiftKey) {
        event.preventDefault()
        void keys.current.save()
      } else if (key === 'p' && event.shiftKey && keys.current.hasPreview) {
        event.preventDefault()
        keys.current.togglePane('preview')
      } else if (event.key === '.' && !event.shiftKey) {
        event.preventDefault()
        keys.current.togglePane('settings')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // A drawer over the text takes the focus; a docked pane leaves it where the writer is.
  useEffect(() => {
    if (paneOpen && narrow) root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
  }, [paneOpen, narrow])

  // Shows the field asked for (from the meta line or a check) once the settings are rendered.
  useEffect(() => {
    if (!focusRequest) return
    const target = root.current?.querySelector<HTMLElement>(`[role="tabpanel"] [data-field=${JSON.stringify(focusRequest.field)}]`)
    if (!target) return
    const details = target.closest('details')
    if (details && !details.open) details.open = true
    target.scrollIntoView?.({ block: 'center' })
    target.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)')?.focus()
  }, [focusRequest])

  /** Selects body lines in the editor (1-based, inclusive columns) and scrolls them into view. */
  const selectInBody = useCallback((line: number, from?: number, to?: number) => {
    const view = editor.current?.view
    if (!view) return
    const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
    const anchor = from === undefined ? target.from : Math.min(target.to, target.from + from)
    const head = to === undefined ? target.to : Math.min(target.to, target.from + to)
    view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
    view.focus()
  }, [])

  const goToIssue = useCallback(
    (issue: CheckIssue) => {
      const parts = doc.getParts()
      if (!parts) return
      const bodyLine = countNewlines(parts.open + parts.frontMatterText + parts.close) + 1
      if (issue.line !== undefined && issue.line >= bodyLine) {
        if (narrow) closePane()
        selectInBody(issue.line - bodyLine + 1)
        return
      }
      const field = issue.line !== undefined ? null : issueField(issue)
      if (field === 'title' || field === 'body') {
        if (narrow) closePane()
        if (field === 'title') titleInput.current?.focus()
        else editor.current?.focus()
        return
      }
      // In the front matter (a line there, or a field).
      if (field) openSettingsAt(field)
      else showTab('settings')
    },
    [closePane, doc, narrow, openSettingsAt, selectInBody, showTab],
  )

  // A new post: the cursor goes to the title when it is empty, else to the first placeholder.
  const freshDone = useRef(false)
  useEffect(() => {
    if (!fresh || freshDone.current || !doc.parts || doc.generation === 0) return
    // TOML values arrive after a round trip; wait for them unless the front matter is broken.
    if (values === null && doc.parts.format !== null && fm.error === null) return
    if (!editor.current?.view) return
    freshDone.current = true
    if (asText(access.get('title')).trim() === '' && fm.editable) {
      titleInput.current?.focus()
    } else {
      const start = startPosition(doc.parts.body)
      selectInBody(start.line, start.from, start.to)
    }
    onFreshHandled?.()
  })

  const restore = useCallback(
    async (text: string) => {
      await fm.flush()
      const parts = doc.getParts()
      // The text being replaced is kept, so the restore can be undone from history too.
      if (parts) await api.historySave(path, joinFrontMatter(parts), 'restore')
      doc.replaceText(text)
      setHistoryOpen(false)
    },
    [doc, fm, path],
  )

  const insertSnippet = useCallback((text: string) => {
    setSnippetsMode(null)
    const view = editor.current?.view
    if (!view) return
    view.dispatch(snippetInsertion(view.state, text))
    view.focus()
  }, [])

  const folders = useMemo(
    () => contentFolders(site.files, site.site.contentDir, docLocation(path).parent),
    [path, site.files, site.site.contentDir],
  )

  const { parts, loaded, eolInfo, text } = doc
  if (!parts || !loaded || !eolInfo || text === null) {
    return doc.error !== null ? (
      <div className="p-4">
        <ErrorNote error={doc.error} />
      </div>
    ) : (
      <p className="p-6 text-sm text-zinc-500">{t('common.loading')}</p>
    )
  }

  const aliases = (() => {
    const raw = values ? values[findKey(values, 'aliases') ?? 'aliases'] : undefined
    return Array.isArray(raw) ? raw.map(String) : []
  })()

  const status = values ? postStatus(access.get) : null
  const title = asText(access.get('title'))
  const metaTaxonomies: MetaTaxonomy[] = (settings?.taxonomies ?? DEFAULT_TAXONOMIES).map((name) => {
    const raw = access.get(name)
    const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw !== '' ? [raw] : []
    const label = taxonomyLabel(name, t)
    return {
      name,
      label,
      addLabel:
        name === 'categories' ? t('document.addCategories') : name === 'tags' ? t('document.addTags') : t('document.addTerms', { name: label }),
      terms: list,
    }
  })

  const tabs: PaneTabDef[] = [
    { id: 'settings', label: t('document.paneSettings') },
    { id: 'checks', label: t('document.paneChecks', { count: issues.length }) },
    ...(hasPreview ? [{ id: 'preview' as const, label: t('preview.title') }] : []),
  ]

  const menu: MenuItem[] = [
    { id: 'snippets', label: t('document.menuSnippets'), run: () => openSnippets(null) },
    { id: 'history', label: t('document.history'), run: () => setHistoryOpen(true) },
    {
      id: 'rename',
      label: t('document.menuRename'),
      run: () => {
        rename.clearError()
        setRenameOpen(true)
      },
    },
    { id: 'focus', label: t('document.menuFocus'), checked: focusMode, run: () => setFocusMode((on) => !on) },
    { id: 'source', label: t('document.menuSource'), run: () => openSettingsAt('source') },
  ]

  function renderPanel(panel: PaneTab): ReactNode {
    if (panel === 'settings') {
      return (
        <FrontMatterForm
          fm={fm}
          parts={parts!}
          getParts={doc.getParts}
          docPath={path}
          settings={settings}
          terms={terms}
          themeImages={themeImages}
          page={page}
          pickImage={picker.pick}
          previewImage={integration.resolveImage}
          ai={ai}
          sourceMode={sourceMode}
          onSourceModeChange={setSourceMode}
        />
      )
    }
    if (panel === 'checks') return <ChecksPanel issues={issues} onSelect={goToIssue} />
    return preview
  }

  return (
    <div ref={root} className="relative flex h-full flex-col">
      <DocumentHeader
        path={path}
        status={status}
        statusDisabled={!fm.editable}
        onToggleDraft={() => setDraft(access, status !== 'draft')}
        unsaved={unsaved}
        saveState={doc.saveState}
        onSave={() => void doc.save()}
        paneTab={paneOpen ? tab : null}
        onToggleSettings={() => togglePane('settings')}
        onTogglePreview={hasPreview ? () => togglePane('preview') : undefined}
        problems={problems}
        menu={menu}
        focusMode={focusMode}
        onExitFocus={() => setFocusMode(false)}
      />

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col bg-[#fffefb] dark:bg-[#1b1d21]">
          <div className="min-h-0 flex-1 overflow-auto" style={{ ['--hp-editor-max-width' as string]: COLUMN }}>
            {(doc.conflict || eolInfo.mixed || doc.error !== null) && (
              <div className="mx-auto space-y-2 px-4 pt-4" style={{ maxWidth: COLUMN }}>
                {doc.conflict && (
                  <div
                    role="alert"
                    className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
                  >
                    <p>{t('document.conflict')}</p>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn" onClick={() => void doc.reloadFromDisk()}>
                        {t('document.reload')}
                      </button>
                      <button className="btn" onClick={() => void doc.overwrite()}>
                        {t('document.overwrite')}
                      </button>
                      {doc.conflict.disk && (
                        <button className="btn" aria-pressed={conflictDiff} onClick={() => setConflictDiff((v) => !v)}>
                          {t('document.showDifferences')}
                        </button>
                      )}
                    </div>
                    {conflictDiff && doc.conflict.disk && (
                      <>
                        <p className="text-xs">{t('document.conflictDiff')}</p>
                        <DiffView before={doc.conflict.disk.text} after={text} />
                      </>
                    )}
                  </div>
                )}
                {eolInfo.mixed && <p className="rounded-md bg-zinc-100 p-2 text-xs dark:bg-zinc-800">{t('document.mixedEol')}</p>}
                {doc.error !== null && <ErrorNote error={doc.error} />}
              </div>
            )}

            <div className="mx-auto px-4 pt-12 pb-2" style={{ maxWidth: COLUMN }}>
              <TitleField
                inputRef={titleInput}
                value={title}
                disabled={!fm.editable || values === null}
                onChange={(next) => access.setOrDrop('title', next, next === '')}
                onContinue={() => editor.current?.focus()}
                ai={ai}
                getBody={() => doc.getParts()?.body ?? ''}
              />
              {!focusMode && values !== null && (
                <MetaLine date={displayDate(access.get('date'), i18n.language)} taxonomies={metaTaxonomies} onOpen={openSettingsAt} />
              )}
            </div>

            <div className="sticky top-0 z-10 border-b border-zinc-200/70 bg-[#fffefb]/95 backdrop-blur dark:border-zinc-800 dark:bg-[#1b1d21]/95">
              <div className="mx-auto flex items-center gap-1 px-2" style={{ maxWidth: COLUMN }}>
                <EditorToolbar
                  editor={editor}
                  alertLabels={alertLabels}
                  labels={{
                    bold: t('toolbar.bold'),
                    italic: t('toolbar.italic'),
                    heading: t('toolbar.heading'),
                    paragraph: t('toolbar.paragraph'),
                    quote: t('toolbar.quote'),
                    alert: t('toolbar.alert'),
                    rtlBlock: t('toolbar.rtlBlock'),
                    link: t('toolbar.link'),
                    horizontalRule: t('toolbar.horizontalRule'),
                    livePreview: t('toolbar.livePreview'),
                  }}
                  livePreview={livePreview}
                  onLivePreviewChange={setLivePreview}
                  className="min-w-0 flex-1 py-1 text-zinc-600 dark:text-zinc-300"
                />
                <button
                  type="button"
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
                  title={t('document.snippetInsertHint')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => openSnippets(null)}
                >
                  {t('document.snippetInsertButton')}
                </button>
              </div>
            </div>

            <MarkdownEditor
              ref={editor}
              documentKey={`${path}:${doc.generation}`}
              value={parts.body}
              eol={eolInfo.eol}
              onChange={doc.setBody}
              alertLabels={alertLabels}
              livePreview={livePreview}
              ariaLabel={path}
              contentDir={site.site.contentDir}
              extraSlashItems={slashItems}
              focusMode={focusMode}
              onStats={setStats}
              {...integration}
            />
          </div>

          <EditorStatusBar stats={stats} className="border-t border-zinc-200 px-4 py-1 dark:border-zinc-800" />
        </div>

        {paneOpen && narrow && <div className="absolute inset-0 z-20 bg-black/20" aria-hidden="true" onClick={closePane} />}
        {paneOpen && (
          <SidePane
            tabs={tabs}
            active={tab}
            onSelect={showTab}
            onClose={closePane}
            width={prefs.widths[paneKind(tab)]}
            onWidthChange={(width) => updatePrefs((current) => ({ widths: { ...current.widths, [paneKind(tab)]: width } }))}
            overlay={narrow}
            mounted={mounted}
            renderPanel={renderPanel}
          />
        )}
      </div>

      {historyOpen && <HistoryDrawer path={path} currentText={text} onRestore={restore} onClose={() => setHistoryOpen(false)} />}

      {renameOpen && (
        <RenameDialog
          path={path}
          title={asText(values?.[findKey(values, 'title') ?? 'title'])}
          slug={asText(slugValue)}
          folders={folders}
          page={page}
          aliases={aliases}
          baseURL={settings?.baseURL ?? null}
          dirty={unsaved}
          busy={rename.busy}
          error={rename.error}
          onCancel={() => setRenameOpen(false)}
          onConfirm={(request) => {
            void rename.rename(request).then((result) => {
              if (result !== 'failed') setRenameOpen(false)
            })
          }}
        />
      )}

      {snippetsMode && (
        <SnippetsHost
          snippets={snippets}
          mode={snippetsMode}
          initialId={snippetId}
          onModeChange={(mode) => {
            if (mode !== 'insert') setSnippetId(null)
            setSnippetsMode(mode)
          }}
          pages={site.pages}
          contentDir={site.site.contentDir}
          shortcodes={integration.shortcodes}
          pickImage={() => picker.pick(imageTargetDir(path, slugValue)).then((picked) => (picked ? imageReference(picked, path) : null))}
          onInsert={insertSnippet}
        />
      )}

      {picker.open && (
        <MediaPickerDialog
          defaultTargetDir={picker.open.defaultTargetDir}
          onPick={(picked) => picker.finish(picked)}
          onClose={() => picker.finish(null)}
        />
      )}
    </div>
  )
}
