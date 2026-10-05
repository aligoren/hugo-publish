// @vitest-environment jsdom
import { act, createElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfigOp, ContentFile, PageEntry, Snapshot } from '../../lib/api'
import type { CheckIssue } from '../checks/runChecks'
import type { EditorIntegrationProps } from '../editor'

const h = vi.hoisted(() => ({
  /** Props of the latest MarkdownEditor render. */
  editor: { current: null as null | (EditorIntegrationProps & { value: string; documentKey?: string | number; focusMode?: boolean }) },
  /** The CodeMirror view behind the editor's ref (the document as it was mounted). */
  view: { current: null as null | import('@codemirror/view').EditorView },
  disk: new Map<string, { text: string; version: string }>(),
  pickResult: 'static/images/eski-yazi/secilen.png',
  versions: 0,
  /** What the (mocked) checks report. */
  issues: [] as CheckIssue[],
}))

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    api: {
      readText: vi.fn(),
      writeText: vi.fn(),
      historySave: vi.fn(),
      historyList: vi.fn(),
      historyRead: vi.fn(),
      renameFile: vi.fn(),
      tomlParseText: vi.fn(),
      tomlEditText: vi.fn(),
      configEffective: vi.fn(),
      mediaImportBytes: vi.fn(),
      mediaThumbnail: vi.fn(),
      listFiles: vi.fn(),
      aiStatus: vi.fn(),
      aiDescribe: vi.fn(),
      aiTitles: vi.fn(),
      aiAltText: vi.fn(),
    },
  }
})

vi.mock('../editor', async () => {
  const { createElement, useImperativeHandle, useRef, useState } = await import('react')
  const { EditorState } = await import('@codemirror/state')
  const { EditorView } = await import('@codemirror/view')
  return {
    MarkdownEditor: (props: Record<string, unknown>) => {
      h.editor.current = props as never
      const onChange = useRef(props.onChange as (v: string) => void)
      onChange.current = props.onChange as (v: string) => void
      const [view] = useState(
        () =>
          new EditorView({
            state: EditorState.create({
              doc: props.value as string,
              extensions: [
                EditorState.lineSeparator.of(props.eol === 'crlf' ? '\r\n' : '\n'),
                EditorView.updateListener.of((u) => {
                  if (u.docChanged) onChange.current(u.state.sliceDoc())
                }),
              ],
            }),
          }),
      )
      h.view.current = view
      useImperativeHandle(props.ref as never, () => ({ view, focus: () => view.focus(), getValue: () => view.state.sliceDoc(), run: () => true }))
      return createElement('textarea', {
        'aria-label': 'Body',
        value: props.value as string,
        onChange: (e: { target: { value: string } }) => (props.onChange as (v: string) => void)?.(e.target.value),
      })
    },
    EditorToolbar: () => null,
    EditorStatusBar: () => null,
    editorEolInfo: (text: string, fallback = 'lf') => ({
      eol: text.includes('\r\n') ? 'crlf' : text.includes('\n') ? 'lf' : fallback,
      mixed: false,
    }),
    discoverShortcodes: async () => [{ name: 'figure', params: [], paired: false, source: 'builtin' }],
  }
})

vi.mock('../checks/useDocumentChecks', () => ({ useDocumentChecks: () => h.issues }))

vi.mock('./mediaBridge', async () => {
  const { createElement } = await import('react')
  const { imageReference } = await vi.importActual<typeof import('../media/reference')>('../media/reference')
  // The real picker is replaced; the reference helper is the media feature's own.
  return {
    imageReference,
    MediaPickerDialog: (props: { defaultTargetDir?: string; onPick(path: string): void; onClose(): void }) =>
      createElement(
        'div',
        { role: 'dialog', 'aria-label': 'Media picker' },
        createElement('span', { 'data-testid': 'picker-dir' }, props.defaultTargetDir),
        createElement('button', { onClick: () => props.onPick(h.pickResult) }, 'pick'),
        createElement('button', { onClick: props.onClose }, 'cancel picker'),
      ),
  }
})

import i18n from '../../i18n'
import { api } from '../../lib/api'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'
import { DocumentPane } from './DocumentPane'
import { PANE_PREFS_KEY } from './workspace/panePrefs'
import { button, click, field, mount, press, settle, typeInto, unmountAll } from './testing/harness'
import { fakeTomlEdit, fakeTomlParse } from './testing/fakeToml'

const mocked = vi.mocked(api)

const POST_PATH = 'content/posts/eski-yazi.md'
const POST = [
  '---',
  'title: "Eski yazı"',
  'date: 2026-10-03T00:11:40+03:00',
  'draft: false',
  'description: ""',
  'tags: ["kitap", "deneme"]',
  'categories:',
  '  - notlar',
  'aliases: []',
  'params:',
  '  toc: true',
  'series:',
  '  - ilk',
  '---',
  '',
  'Merhaba dünya.',
  '',
].join('\n')

const TOML_PATH = 'content/posts/toml.md'
const TOML_POST = ['+++', 'title = "TOML yazısı"', 'date = 2026-10-03T00:11:40+03:00', 'draft = true', "tags = ['toml']", '+++', '', 'Gövde.', ''].join('\n')

let siteCounter = 0

function page(path: string, permalink: string, draft = false): PageEntry {
  return { path, slug: '', title: 'Eski yazı', date: '', expiryDate: '', publishDate: '', draft, permalink, kind: 'page', section: 'posts' }
}

function setup(
  options: {
    path?: string
    files?: Record<string, string>
    disk?: Record<string, string>
    pages?: PageEntry[]
    config?: Record<string, unknown>
    preview?: ReactNode
    fresh?: boolean
  } = {},
) {
  const path = options.path ?? POST_PATH
  const texts = options.files ?? { [POST_PATH]: POST }
  h.disk.clear()
  for (const [p, text] of Object.entries({ ...texts, ...options.disk })) h.disk.set(p, { text, version: `v${++h.versions}` })
  const files: ContentFile[] = Object.keys(texts).map((p) => ({ path: p, title: null, modifiedMs: 1 }))
  const site: SiteContextValue = {
    site: { root: `/site-${++siteCounter}`, name: 'Site', configFiles: ['hugo.toml'], contentDir: 'content', isGitRepo: true },
    hugo: null,
    files,
    pagesAt: '2026-01-01T00:00:00.000Z',
    pages: options.pages ?? [],
    reloadFiles: vi.fn(async () => {}),
    reloadPages: vi.fn(async () => {}),
    refreshHugo: vi.fn(async () => {}),
    openFile: vi.fn(),
    showView: vi.fn(),
    configVersion: 0,
    notifyConfigChanged: vi.fn(),
  }
  mocked.configEffective.mockResolvedValue({
    values: options.config ?? { taxonomies: { category: 'categories', tag: 'tags' }, baseurl: 'https://example.org/', defaultcontentlanguage: 'tr' },
    messages: [],
  })
  const onDirtyChange = vi.fn()
  const onSaved = vi.fn()
  const onPreviewOpen = vi.fn()
  const onFreshHandled = vi.fn()
  const element = (): ReactElement => (
    <SiteContext.Provider value={site}>
      <DocumentPane
        path={path}
        alertLabels={{ note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }}
        onDirtyChange={onDirtyChange}
        onSaved={onSaved}
        preview={options.preview}
        onPreviewOpen={onPreviewOpen}
        fresh={options.fresh}
        onFreshHandled={onFreshHandled}
      />
    </SiteContext.Provider>
  )
  const view = mount(element())
  return { ...view, element, site, onDirtyChange, onSaved, onPreviewOpen, onFreshHandled, path }
}

/** Opens the side pane on the post settings. */
function openSettings(container: HTMLElement) {
  click(button(container, 'Settings'))
}

/** Runs an item of the header's "…" menu. */
function menuItem(container: HTMLElement, name: string) {
  click(button(container, 'More actions'))
  const menu = container.querySelector('[role="menu"]')!
  click(button(menu, name))
}

function tabs(container: HTMLElement) {
  return [...container.querySelectorAll('[role="tab"]')].map((tab) => `${tab.textContent}${tab.getAttribute('aria-selected') === 'true' ? ' *' : ''}`)
}

function storedPrefs() {
  return JSON.parse(localStorage.getItem(PANE_PREFS_KEY) ?? 'null') as { open: boolean; tab: string; widths: Record<string, number> } | null
}

/** The text last written to `path`. */
function written(path: string): string {
  const call = mocked.writeText.mock.calls.filter((c) => c[0] === path).at(-1)
  if (!call) throw new Error(`nothing written to ${path}`)
  return call[1]
}

async function save(container: HTMLElement) {
  await settle()
  click(button(container, 'Save'))
  await settle()
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
  // jsdom has no layout; CodeMirror measures text after a change that scrolls into view.
  const empty = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getClientRects ??= empty
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  h.issues = []
  h.editor.current = null
  mocked.readText.mockImplementation(async (path: string) => {
    const file = h.disk.get(path)
    if (!file) throw { code: 'io', message: `${path} not found` }
    return { ...file }
  })
  mocked.writeText.mockImplementation(async (path: string, text: string, expected?: string) => {
    const current = h.disk.get(path)
    if (expected !== undefined && (current?.version ?? '') !== expected) throw { code: 'conflict', message: 'changed on disk' }
    const version = `v${++h.versions}`
    h.disk.set(path, { text, version })
    return version
  })
  mocked.historySave.mockImplementation(async (path: string, text: string, reason: Snapshot['reason']) => ({
    id: `s${++h.versions}`,
    path,
    createdMs: 0,
    size: text.length,
    reason,
  }))
  mocked.historyList.mockResolvedValue([])
  mocked.renameFile.mockImplementation(async (_from: string, to: string) => to)
  mocked.tomlParseText.mockImplementation(async (text: string) => ({ values: fakeTomlParse(text), comments: {} }))
  mocked.tomlEditText.mockImplementation(async (text: string, ops: ConfigOp[]) => fakeTomlEdit(text, ops))
  mocked.listFiles.mockResolvedValue([])
  mocked.mediaThumbnail.mockResolvedValue('data:image/png;base64,AAAA')
  mocked.aiStatus.mockResolvedValue({ enabled: false, hasKey: false, model: '' })
})

afterEach(() => unmountAll())

describe('loading and saving', () => {
  it('saves with the expected version, keeps history and does not reset the editor', async () => {
    const { container, onDirtyChange, onSaved } = setup()
    await settle()
    expect(h.editor.current?.value).toBe('\nMerhaba dünya.\n')
    const key = h.editor.current?.documentKey

    typeInto(field(container, 'Title'), 'Yeni başlık')
    expect(container.textContent).toContain('Unsaved changes')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    press(window as unknown as Element, 's', { ctrlKey: true })
    await settle()
    const expected = POST.replace('title: "Eski yazı"', 'title: "Yeni başlık"')
    expect(mocked.writeText).toHaveBeenCalledWith(POST_PATH, expected, 'v1')
    expect(mocked.historySave.mock.calls).toEqual([
      [POST_PATH, POST, 'save'],
      [POST_PATH, expected, 'save'],
    ])
    expect(onSaved).toHaveBeenCalledWith(POST_PATH)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    expect(container.textContent).toContain('Saved')
    expect(h.editor.current?.documentKey).toBe(key)

    // Nothing to save: no write.
    press(window as unknown as Element, 's', { metaKey: true })
    await settle()
    expect(mocked.writeText).toHaveBeenCalledTimes(1)
  })

  it('handles a conflict: show differences, keep my version', async () => {
    const { container } = setup()
    await settle()
    typeInto(field(container, 'Body'), '\nBenim metnim.\n')
    h.disk.set(POST_PATH, { text: POST.replace('Merhaba', 'Selam'), version: 'other' })
    await save(container)

    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('changed by another program')
    click(button(container, 'Show differences'))
    expect(alert.textContent).toContain('Selam dünya.')

    mocked.historySave.mockClear()
    click(button(container, 'Keep my version'))
    await settle()
    const mine = POST.replace('\nMerhaba dünya.\n', '\nBenim metnim.\n')
    expect(mocked.historySave).toHaveBeenCalledWith(POST_PATH, POST.replace('Merhaba', 'Selam'), 'save')
    expect(mocked.writeText).toHaveBeenLastCalledWith(POST_PATH, mine, undefined)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('handles a conflict: reload from disk keeps my edits in history', async () => {
    const { container } = setup()
    await settle()
    typeInto(field(container, 'Body'), '\nBenim metnim.\n')
    const disk = POST.replace('Merhaba', 'Selam')
    h.disk.set(POST_PATH, { text: disk, version: 'other' })
    await save(container)

    click(button(container, 'Reload from disk'))
    await settle()
    expect(mocked.historySave).toHaveBeenCalledWith(POST_PATH, POST.replace('\nMerhaba dünya.\n', '\nBenim metnim.\n'), 'manual')
    expect(h.editor.current?.value).toBe('\nSelam dünya.\n')
    expect(container.textContent).not.toContain('Unsaved changes')
  })
})

describe('front matter form', () => {
  it('keeps flow and block list styles for taxonomy chips and suggests site terms', async () => {
    const other = '---\ntags: ["roman", "kitap"]\n---\n'
    const { container } = setup({ files: { [POST_PATH]: POST, 'content/posts/diger.md': other } })
    await settle()
    openSettings(container)

    const tags = field(container, 'Tags') as HTMLInputElement
    typeInto(tags, 'ro')
    const option = [...container.querySelectorAll('[role="option"]')].find((o) => o.textContent?.startsWith('roman'))
    expect(option).toBeDefined()
    press(tags, 'ArrowDown')
    press(tags, 'Enter')

    const categories = field(container, 'Categories') as HTMLInputElement
    typeInto(categories, 'yeni')
    press(categories, 'Enter')

    click(button(container, 'Remove kitap'))
    await save(container)
    expect(written(POST_PATH)).toBe(
      POST.replace('tags: ["kitap", "deneme"]', 'tags: ["deneme", "roman"]').replace('  - notlar\n', '  - notlar\n  - yeni\n'),
    )
  })

  it('keeps the date format and offset', async () => {
    const { container } = setup()
    await settle()
    openSettings(container)
    typeInto(field(container, 'Date'), '2026-10-05T10:30:00')
    await save(container)
    expect(written(POST_PATH)).toBe(POST.replace('date: 2026-10-03T00:11:40+03:00', 'date: 2026-10-05T10:30:00+03:00'))
  })

  it('keeps a date-only value date-only and adds new dates in the same format', async () => {
    const text = POST.replace('2026-10-03T00:11:40+03:00', '2026-10-03')
    const { container } = setup({ files: { [POST_PATH]: text } })
    await settle()
    openSettings(container)
    const date = field(container, 'Date') as HTMLInputElement
    expect(date.type).toBe('date')
    typeInto(date, '2026-11-20')
    typeInto(field(container, 'Last modified'), '2026-11-21')
    await save(container)
    expect(written(POST_PATH)).toBe(text.replace('date: 2026-10-03', 'date: 2026-11-20').replace('  - ilk\n', '  - ilk\nlastmod: 2026-11-21\n'))
  })

  it('removes an emptied field that was not in the file, keeps one that was', async () => {
    const { container } = setup()
    await settle()
    openSettings(container)
    typeInto(field(container, 'Summary'), 'Kısa')
    typeInto(field(container, 'Summary'), '')
    typeInto(field(container, 'Description'), 'x'.repeat(161))
    expect(container.textContent).toContain('161 characters')
    typeInto(field(container, 'Description'), '')
    expect(container.textContent).not.toContain('Unsaved changes')
  })

  it('shows other fields by type and adds and removes fields', async () => {
    const { container } = setup()
    await settle()
    openSettings(container)
    expect(container.textContent).toContain('Other fields (2)')
    // `params` is a group of simple values: its `toc` is a checkbox.
    const toc = field(container, 'toc') as HTMLInputElement
    expect(toc.type).toBe('checkbox')
    click(toc)
    click(button(container, 'Remove field series'))
    typeInto(field(container, 'New field'), 'rating')
    typeInto(field(container, 'Type'), 'number')
    click(button(container, 'Add field'))
    await save(container)
    expect(written(POST_PATH)).toBe(POST.replace('toc: true', 'toc: false').replace('series:\n  - ilk\n', 'rating: 0\n'))
  })

  it('hides a page from lists with build.list and sets the slug with an alias for the old address', async () => {
    const { container } = setup({ pages: [page(POST_PATH, 'https://example.org/posts/eski-yazi/')] })
    await settle()
    openSettings(container)
    click(field(container, 'Hide from lists'))
    typeInto(field(container, 'URL slug'), 'yeni-yazi')
    expect(container.textContent).toContain('https://example.org/posts/yeni-yazi/')
    const keep = [...container.querySelectorAll('label')].find((l) => l.textContent?.includes('Keep old links working'))!
    click(keep.querySelector('input'))
    await save(container)
    expect(written(POST_PATH)).toBe(
      POST.replace('aliases: []', 'aliases: ["/posts/eski-yazi/"]').replace('  - ilk\n', '  - ilk\nbuild:\n  list: never\nslug: "yeni-yazi"\n'),
    )
  })

  it('edits TOML front matter through toml_edit and keeps a bare date bare', async () => {
    const { container } = setup({ path: TOML_PATH, files: { [TOML_PATH]: TOML_POST } })
    await settle()
    openSettings(container)
    expect((field(container, 'Title') as HTMLInputElement).value).toBe('TOML yazısı')
    typeInto(field(container, 'Title'), 'Yeni')
    // Shown at once, before the Rust side answers.
    expect((field(container, 'Title') as HTMLInputElement).value).toBe('Yeni')
    typeInto(field(container, 'Date'), '2026-10-05T10:30:00')
    click(field(container, 'Draft (not published)'))
    const tags = field(container, 'Tags') as HTMLInputElement
    typeInto(tags, 'yeni')
    press(tags, 'Enter')
    await save(container)
    expect(mocked.tomlEditText).toHaveBeenCalled()
    expect(mocked.tomlEditText.mock.calls[0][1]).toEqual([{ op: 'set', path: ['title'], value: 'Yeni' }])
    expect(written(TOML_PATH)).toBe(
      TOML_POST.replace('"TOML yazısı"', '"Yeni"')
        .replace('2026-10-03T00:11:40+03:00', '2026-10-05T10:30:00+03:00')
        .replace('draft = true', 'draft = false')
        .replace("tags = ['toml']", "tags = ['toml', 'yeni']"),
    )
  })

  it('edits nested values as text and checks them', async () => {
    const { container } = setup()
    await settle()
    openSettings(container)
    click(button(container, 'Edit as YAML'))
    const snippet = field(container, 'params as YAML')
    expect(snippet.value).toBe('params:\n  toc: true')
    typeInto(snippet, 'params:\n  toc: true\ntitle: x')
    click(button(container, 'Apply'))
    await settle()
    expect(container.textContent).toContain('This is not valid')
    typeInto(snippet, 'params:\n  toc: true\n  math: true')
    click(button(container, 'Apply'))
    await settle()
    await save(container)
    expect(written(POST_PATH)).toBe(POST.replace('  toc: true\n', '  toc: true\n  math: true\n'))
  })
})

describe('editor integration', () => {
  it('imports pasted images into static/images/<slug> without metadata', async () => {
    setup({ pages: [page(POST_PATH, 'https://example.org/posts/eski-yazi/'), page('content/posts/diger.md', 'https://example.org/posts/diger/')] })
    await settle()
    const props = h.editor.current!
    expect(props.docPath).toBe(POST_PATH)
    expect(props.pages).toEqual([{ title: 'Eski yazı', path: 'content/posts/diger.md', permalink: 'https://example.org/posts/diger/' }])
    expect(props.shortcodes?.map((s) => s.name)).toEqual(['figure'])
    expect(props.spellcheck?.language).toBe('tr')
    expect(props.pasteHtmlAsMarkdown).toBe(true)

    mocked.mediaImportBytes.mockResolvedValue('static/images/eski-yazi/kitap-kapagi.png')
    const file = new File([new Uint8Array([1, 2, 3])], 'Kitap Kapağı.png', { type: 'image/png' })
    const inserted = await props.onImageFiles!([file])
    expect(mocked.mediaImportBytes).toHaveBeenCalledWith('Kitap Kapağı.png', 'AQID', { targetDir: 'static/images/eski-yazi', stripMetadata: true })
    expect(inserted).toEqual([{ src: '/images/eski-yazi/kitap-kapagi.png', alt: 'Kitap Kapağı' }])
  })

  it('imports into the page bundle for index.md and previews images with a cache', async () => {
    const path = 'content/posts/kitap/index.md'
    setup({ path, files: { [path]: POST } })
    await settle()
    const props = h.editor.current!
    mocked.mediaImportBytes.mockResolvedValue('content/posts/kitap/kapak.png')
    const inserted = await props.onImageFiles!([new File(['x'], 'kapak.png', { type: 'image/png' })])
    expect(mocked.mediaImportBytes.mock.calls[0][2]).toEqual({ targetDir: 'content/posts/kitap', stripMetadata: true })
    expect(inserted).toEqual([{ src: 'kapak.png', alt: 'Kapak' }])

    expect(await props.resolveImage!('kapak.png')).toBe('data:image/png;base64,AAAA')
    expect(await props.resolveImage!('kapak.png')).toBe('data:image/png;base64,AAAA')
    expect(await props.resolveImage!('/images/a.png')).toBe('data:image/png;base64,AAAA')
    expect(await props.resolveImage!('https://example.org/x.png')).toBeNull()
    expect(mocked.mediaThumbnail.mock.calls.map((c) => c[0])).toEqual(['content/posts/kitap/kapak.png', 'static/images/a.png'])
  })

  it('opens the media picker for the image action', async () => {
    const { container } = setup()
    await settle()
    let result: unknown = 'pending'
    void h.editor.current!.onRequestImage!().then((r) => (result = r))
    await settle(2)
    expect(container.querySelector('[data-testid="picker-dir"]')?.textContent).toBe('static/images/eski-yazi')
    click(button(container, 'pick'))
    await settle(2)
    expect(result).toEqual({ src: '/images/eski-yazi/secilen.png', alt: 'Secilen' })

    void h.editor.current!.onRequestImage!().then((r) => (result = r))
    await settle(2)
    click(button(container, 'cancel picker'))
    await settle(2)
    expect(result).toBeNull()
    expect(container.querySelector('[aria-label="Media picker"]')).toBeNull()
  })

  it('turns focus mode on from the menu, hiding the side pane and the header extras', async () => {
    const { container } = setup()
    await settle()
    openSettings(container)
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(h.editor.current?.focusMode).toBe(false)
    menuItem(container, 'Focus mode')
    expect(h.editor.current?.focusMode).toBe(true)
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    expect(container.querySelector('[aria-label="Settings"]')).toBeNull()
    expect(container.querySelector('[aria-label="Date, categories and tags"]')).toBeNull()
    click(button(container, 'Exit focus mode'))
    expect(h.editor.current?.focusMode).toBe(false)
    // The pane comes back as it was.
    expect(tabs(container)).toEqual(['Post settings *', 'Checks (0)'])
  })
})

describe('local history', () => {
  it('restores a version as an unsaved change after keeping the current text', async () => {
    const old = POST.replace('Eski yazı', 'Çok eski').replace('Merhaba dünya.', 'İlk taslak.')
    mocked.historyList.mockResolvedValue([
      { id: 's2', path: POST_PATH, createdMs: Date.UTC(2026, 9, 3, 12), size: POST.length, reason: 'save' },
      { id: 's1', path: POST_PATH, createdMs: Date.UTC(2026, 9, 2, 12), size: old.length, reason: 'manual' },
    ])
    mocked.historyRead.mockImplementation(async (_path: string, id: string) => (id === 's1' ? old : POST))
    const { container, onDirtyChange } = setup()
    await settle()
    const key = h.editor.current?.documentKey

    menuItem(container, 'History')
    await settle()
    const drawer = container.querySelector('[role="dialog"][aria-label="History"]')!
    expect(drawer.textContent).toContain('Version')
    click(drawer.querySelectorAll('li button')[1])
    await settle()
    expect(drawer.textContent).toContain('İlk taslak.')

    click(button(drawer, 'Save a version'))
    await settle()
    expect(mocked.historySave).toHaveBeenLastCalledWith(POST_PATH, POST, 'manual')

    click(button(drawer, 'Restore this version'))
    await settle()
    expect(mocked.historySave).toHaveBeenLastCalledWith(POST_PATH, POST, 'restore')
    expect(h.editor.current?.value).toBe('\nİlk taslak.\n')
    expect(h.editor.current?.documentKey).not.toBe(key)
    expect((field(container, 'Title') as HTMLInputElement).value).toBe('Çok eski')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(container.querySelector('[aria-label="History"][role="dialog"]')).toBeNull()

    await save(container)
    expect(written(POST_PATH)).toBe(old)
  })
})

describe('rename and move', () => {
  it('saves first, adds the old address to aliases, moves the file and opens it', async () => {
    const { container, site } = setup({ pages: [page(POST_PATH, 'https://example.org/posts/eski-yazi/')] })
    await settle()
    typeInto(field(container, 'Title'), 'Yeni yazı')

    menuItem(container, 'Rename or move…')
    const dialog = container.querySelector('form[role="dialog"]')!
    expect(dialog.textContent).toContain('Your unsaved changes are saved first.')
    typeInto(field(dialog, 'File name'), 'Yeni Yazı')
    expect(dialog.textContent).toContain('Saved as “yeni-yazi”.')
    expect(dialog.textContent).toContain('https://example.org/posts/yeni-yazi/')
    const alias = [...dialog.querySelectorAll('label')].find((l) => l.textContent?.includes('Keep old links working'))!
    expect((alias.querySelector('input') as HTMLInputElement).checked).toBe(true)

    click(button(dialog, 'Rename'))
    await settle()
    const saved = POST.replace('title: "Eski yazı"', 'title: "Yeni yazı"')
    const withAlias = saved.replace('aliases: []', 'aliases: ["/posts/eski-yazi/"]')
    expect(mocked.writeText.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [POST_PATH, saved],
      [POST_PATH, withAlias],
    ])
    expect(mocked.renameFile).toHaveBeenCalledWith(POST_PATH, 'content/posts/yeni-yazi.md')
    expect(mocked.historySave).toHaveBeenCalledWith('content/posts/yeni-yazi.md', withAlias, 'save')
    expect(site.reloadFiles).toHaveBeenCalled()
    expect(site.reloadPages).toHaveBeenCalled()
    expect(site.openFile).toHaveBeenCalledWith('content/posts/yeni-yazi.md')
  })

  it('moves a page bundle folder and puts the text back when the move fails', async () => {
    const path = 'content/posts/kitap/index.md'
    const { container, site } = setup({ path, files: { [path]: POST }, pages: [page(path, 'https://example.org/posts/kitap/')] })
    await settle()
    mocked.renameFile.mockRejectedValueOnce({ code: 'invalid', message: 'content/posts/roman already exists' })
    menuItem(container, 'Rename or move…')
    const dialog = container.querySelector('form[role="dialog"]')!
    typeInto(field(dialog, 'Folder name (page bundle)'), 'roman')
    click(button(dialog, 'Rename'))
    await settle()
    expect(mocked.renameFile).toHaveBeenCalledWith('content/posts/kitap', 'content/posts/roman')
    expect(dialog.textContent).toContain('already exists')
    expect(h.disk.get(path)?.text).toBe(POST)
    expect(site.openFile).not.toHaveBeenCalled()
  })

  it('does not offer an alias for drafts', async () => {
    const { container } = setup({ pages: [page(POST_PATH, 'https://example.org/posts/eski-yazi/', true)] })
    await settle()
    menuItem(container, 'Rename or move…')
    const dialog = container.querySelector('form[role="dialog"]')!
    typeInto(field(dialog, 'File name'), 'yeni')
    expect(dialog.textContent).not.toContain('Keep old links working')
    click(button(dialog, 'Rename'))
    await settle()
    expect(mocked.writeText).not.toHaveBeenCalled()
    expect(mocked.renameFile).toHaveBeenCalledWith(POST_PATH, 'content/posts/yeni.md')
  })
})

describe('AI suggestions', () => {
  const COVER = POST.replace('series:\n  - ilk\n', 'cover:\n  image: "/images/kapak.png"\n  alt: ""\n')

  it('are hidden unless the assistant is on and has a key', async () => {
    mocked.aiStatus.mockResolvedValue({ enabled: true, hasKey: false, model: 'm' })
    const { container } = setup()
    await settle()
    expect(container.querySelector('[aria-label="Suggest titles with the AI assistant"]')).toBeNull()
  })

  it('suggests titles to pick from, a description and alt text', async () => {
    mocked.aiStatus.mockResolvedValue({ enabled: true, hasKey: true, model: 'm' })
    mocked.aiTitles.mockResolvedValue(['Birinci öneri', 'İkinci öneri'])
    mocked.aiDescribe.mockResolvedValue('  Kısa bir açıklama.  ')
    mocked.aiAltText.mockResolvedValue('Bir kitap kapağı')
    const { container } = setup({ files: { [POST_PATH]: COVER } })
    await settle()

    click(button(container, 'Suggest titles with the AI assistant'))
    await settle()
    expect(mocked.aiTitles).toHaveBeenCalledWith('Eski yazı', '\nMerhaba dünya.\n', 'tr')
    click(button(container, 'İkinci öneri'))
    expect((field(container, 'Title') as HTMLInputElement).value).toBe('İkinci öneri')

    openSettings(container)
    click(button(container, 'Suggest a description with the AI assistant'))
    await settle()
    expect(mocked.aiDescribe).toHaveBeenCalledWith('İkinci öneri', '\nMerhaba dünya.\n', 'tr')

    click(button(container, 'Suggest alt text with the AI assistant'))
    await settle()
    expect(mocked.aiAltText).toHaveBeenCalledWith('static/images/kapak.png', 'İkinci öneri', 'tr')

    await save(container)
    expect(written(POST_PATH)).toBe(
      COVER.replace('title: "Eski yazı"', 'title: "İkinci öneri"')
        .replace('description: ""', 'description: "Kısa bir açıklama."')
        .replace('alt: ""', 'alt: "Bir kitap kapağı"'),
    )
  })

  it('shows errors', async () => {
    mocked.aiStatus.mockResolvedValue({ enabled: true, hasKey: true, model: 'm' })
    mocked.aiDescribe.mockRejectedValue({ code: 'ai', message: 'rate limited' })
    const { container } = setup()
    await settle()
    openSettings(container)
    click(button(container, 'Suggest a description with the AI assistant'))
    await settle()
    expect(container.textContent).toContain('rate limited')
  })
})

describe('snippets', () => {
  const SNIPPETS = [
    '# kalıplar',
    '[[snippet]]',
    'id = "kitap"',
    'name = "Kitap künyesi"',
    'fields = [{ key = "title", label = "Kitap adı", kind = "text", required = true }, { key = "author", label = "Yazar", kind = "text" }, { key = "page", label = "İlgili yazı", kind = "page" }]',
    'template = """',
    '> **{{title}}**{{#author}} · {{author}}{{/author}}',
    '{{#page}}',
    '> Bkz. [{{page|title}}]({{< ref "{{page}}" >}})',
    '{{/page}}',
    '"""',
    '',
  ].join('\n')

  it('fills in a snippet and inserts it at the cursor', async () => {
    const { container } = setup({
      disk: { '.hugo-publisher/snippets.toml': SNIPPETS },
      pages: [page('content/posts/diger.md', 'https://example.org/posts/diger/')],
    })
    await settle()
    menuItem(container, 'Snippets…')
    await settle()
    const dialog = container.querySelector('[role="dialog"][aria-label="Snippets"]')!
    click(button(dialog, /Kitap künyesi/))
    const insert = button(dialog, 'Insert')
    expect(insert.disabled).toBe(true)
    expect(dialog.textContent).toContain('Fill in: Kitap adı')
    typeInto(field(dialog, 'Kitap adı *'), 'Suç ve Ceza')
    typeInto(field(dialog, 'Yazar'), 'Dostoyevski')
    typeInto(dialog.querySelector('[aria-labelledby]'), 'eski')
    click(button(dialog, /content\/posts\/diger\.md/))
    const preview = dialog.querySelector('pre')!
    expect(preview.textContent).toBe('> **Suç ve Ceza** · Dostoyevski\n> Bkz. [Eski yazı]({{< ref "posts/diger.md" >}})\n')
    click(button(dialog, 'Insert'))
    await settle()
    expect(container.querySelector('[aria-label="Snippets"]')).toBeNull()
    await save(container)
    expect(written(POST_PATH)).toBe(
      POST.replace('\nMerhaba dünya.\n', '> **Suç ve Ceza** · Dostoyevski\n> Bkz. [Eski yazı]({{< ref "posts/diger.md" >}})\n\nMerhaba dünya.\n'),
    )
  })

  it('lists snippets in the / menu and opens their form', async () => {
    const { container } = setup({ disk: { '.hugo-publisher/snippets.toml': SNIPPETS } })
    await settle()
    const items = h.editor.current!.extraSlashItems!
    expect(items.map((i) => i.label)).toEqual(['Kitap künyesi'])
    click(button(container, '+ Snippet'))
    click(container.querySelector('[aria-label="Snippets"] [aria-label="Close"]'))
    expect(container.querySelector('[role="dialog"][aria-label="Snippets"]')).toBeNull()
    act(() => items[0].run(h.view.current!))
    expect(container.querySelector('[role="dialog"][aria-label="Snippets"] h2')?.textContent).toBe('Kitap künyesi')
  })

  it('adds a starter snippet after showing the diff, creating the file', async () => {
    const { container } = setup()
    await settle()
    menuItem(container, 'Snippets…')
    await settle()
    click(button(container, 'Manage snippets…'))
    const manager = container.querySelector('[role="dialog"][aria-label="Snippets of this site"]')!
    click(button(manager, 'Use this'))
    expect((field(manager, 'Name') as HTMLInputElement).value).toBe('Book card')
    click(button(manager, 'Review and save…'))
    await settle()
    expect(manager.textContent).toContain('These changes will be written to .hugo-publisher/snippets.toml')
    click(button(manager, 'Write to file'))
    await settle()
    const [path, text, expected] = mocked.writeText.mock.calls.at(-1)!
    expect(path).toBe('.hugo-publisher/snippets.toml')
    expect(expected).toBe('')
    expect(text).toContain('[[snippet]]\nid = "book"\nname = "Book card"')
    expect(manager.textContent).toContain('Book card')
    expect(button(manager, 'Delete Book card')).toBeDefined()
  })
})

describe('side pane', () => {
  beforeAll(() => {
    // Room for a docked pane next to the text.
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
  })

  it('opens on a tab, remembers the tab and its width across documents, and closes', async () => {
    const preview = createElement('p', null, 'PREVIEW CONTENT')
    const first = setup({ preview })
    await settle()
    expect(first.container.querySelector('[role="tablist"]')).toBeNull()

    openSettings(first.container)
    expect(tabs(first.container)).toEqual(['Post settings *', 'Checks (0)', 'Preview'])
    expect(button(first.container, 'Settings').getAttribute('aria-pressed')).toBe('true')
    expect(field(first.container, 'Description')).toBeDefined()
    expect(storedPrefs()).toMatchObject({ open: true, tab: 'settings' })

    // Arrow keys move between tabs; each tab controls its panel.
    press(first.container.querySelector('[role="tab"][aria-selected="true"]')!, 'ArrowRight')
    expect(tabs(first.container)).toEqual(['Post settings', 'Checks (0) *', 'Preview'])
    const selected = first.container.querySelector('[role="tab"][aria-selected="true"]')!
    const panel = first.container.querySelector('[role="tabpanel"]:not([hidden])')!
    expect(selected.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(selected.id)
    expect(panel.textContent).toContain('Nothing to fix')

    // The splitter changes (and remembers) the width of settings and checks.
    press(first.container.querySelector('[role="separator"]')!, 'ArrowLeft')
    expect(storedPrefs()?.widths).toEqual({ panel: 424, preview: 600 })
    first.unmount()

    const second = setup({ preview })
    await settle()
    expect(tabs(second.container)).toEqual(['Post settings', 'Checks (0) *', 'Preview'])
    expect((second.container.querySelector('aside') as HTMLElement).style.width).toBe('424px')
    click(button(second.container, 'Close panel'))
    expect(second.container.querySelector('[role="tablist"]')).toBeNull()
    expect(storedPrefs()?.open).toBe(false)
  })

  it('opens the preview from the header and with shortcuts, asking for the preview server', async () => {
    const { container, onPreviewOpen } = setup({ preview: createElement('p', null, 'PREVIEW CONTENT') })
    await settle()
    click(button(container, 'Preview'))
    expect(onPreviewOpen).toHaveBeenCalledTimes(1)
    expect(tabs(container)).toEqual(['Post settings', 'Checks (0)', 'Preview *'])
    expect(container.textContent).toContain('PREVIEW CONTENT')
    expect(button(container, 'Preview').getAttribute('aria-pressed')).toBe('true')

    press(window as unknown as Element, 'P', { ctrlKey: true, shiftKey: true })
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    press(window as unknown as Element, '.', { ctrlKey: true })
    expect(tabs(container)).toEqual(['Post settings *', 'Checks (0)', 'Preview'])
    expect(onPreviewOpen).toHaveBeenCalledTimes(1)
    press(window as unknown as Element, 'p', { metaKey: true, shiftKey: true })
    expect(tabs(container)).toEqual(['Post settings', 'Checks (0)', 'Preview *'])
    expect(onPreviewOpen).toHaveBeenCalledTimes(2)
    press(window as unknown as Element, '.', { ctrlKey: true })
    press(window as unknown as Element, '.', { ctrlKey: true })
    expect(container.querySelector('[role="tablist"]')).toBeNull()
  })

  it('edits the front matter as source from the menu', async () => {
    const { container } = setup()
    await settle()
    menuItem(container, 'Edit front matter as source')
    expect(tabs(container)).toEqual(['Post settings *', 'Checks (0)'])
    const source = field(container, 'Front matter (YAML)')
    expect(document.activeElement).toBe(source)
    expect(source.value).toBe(POST.split('---\n')[1])
    click(button(container, 'Form'))
    expect(container.querySelector('[data-field="source"]')).toBeNull()
  })

  it('closes the menu with Escape and gives the focus back', async () => {
    const { container } = setup()
    await settle()
    const trigger = button(container, 'More actions')
    click(trigger)
    const menu = container.querySelector('[role="menu"]')!
    expect([...menu.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent)).toEqual([
      'Snippets…',
      'History',
      'Rename or move…',
      'Focus mode',
      'Edit front matter as source',
    ])
    expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]'))
    press(document.activeElement!, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('History')
    press(document.activeElement!, 'Escape')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('status pill', () => {
  const PUBLISHED = 'Published – click to turn it back into a draft'
  const DRAFT = 'Draft – click to mark it ready to publish'

  it('turns a YAML post into a draft and back, changing only that line', async () => {
    const { container } = setup()
    await settle()
    expect(button(container, PUBLISHED).textContent).toBe('Published')
    click(button(container, PUBLISHED))
    expect(button(container, DRAFT).textContent).toBe('Draft')
    await save(container)
    expect(written(POST_PATH)).toBe(POST.replace('draft: false', 'draft: true'))
    click(button(container, DRAFT))
    await save(container)
    expect(written(POST_PATH)).toBe(POST)
  })

  it('adds draft when the file has none and takes it out again without a trace', async () => {
    const text = POST.replace('draft: false\n', '')
    const { container } = setup({ files: { [POST_PATH]: text } })
    await settle()
    click(button(container, PUBLISHED))
    expect(container.textContent).toContain('Unsaved changes')
    click(button(container, DRAFT))
    expect(container.textContent).not.toContain('Unsaved changes')
    click(button(container, PUBLISHED))
    await save(container)
    expect(written(POST_PATH)).toBe(text.replace('  - ilk\n', '  - ilk\ndraft: true\n'))
  })

  it('publishes a TOML draft through toml_edit', async () => {
    const { container } = setup({ path: TOML_PATH, files: { [TOML_PATH]: TOML_POST } })
    await settle()
    click(button(container, DRAFT))
    await save(container)
    expect(written(TOML_PATH)).toBe(TOML_POST.replace('draft = true', 'draft = false'))
    click(button(container, PUBLISHED))
    await save(container)
    expect(written(TOML_PATH)).toBe(TOML_POST)
  })

  it('shows a post dated in the future as scheduled', async () => {
    const { container } = setup({ files: { [POST_PATH]: POST.replace('2026-10-03T00:11:40+03:00', '2099-01-01T09:00:00+03:00') } })
    await settle()
    expect(button(container, 'Scheduled – click to turn it back into a draft').textContent).toBe('Scheduled')
  })
})

describe('title and meta line', () => {
  it('shows the date, categories and tags, each opening its setting', async () => {
    const { container } = setup()
    await settle()
    const title = field(container, 'Title')
    expect(title.tagName).toBe('TEXTAREA')
    expect(title.value).toBe('Eski yazı')
    const meta = container.querySelector('[aria-label="Date, categories and tags"]')!
    expect([...meta.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Oct 3, 2026',
      'Categories: notlar',
      'Tags: kitap, deneme',
    ])

    click(button(container, 'Tags: kitap, deneme'))
    await settle(2)
    expect(tabs(container)).toEqual(['Post settings *', 'Checks (0)'])
    expect(document.activeElement).toBe(field(container, 'Tags'))

    click(button(container, 'Oct 3, 2026'))
    await settle(2)
    expect(document.activeElement).toBe(field(container, 'Date'))
  })

  it('offers to add a missing date, categories and tags', async () => {
    const text = POST.replace('date: 2026-10-03T00:11:40+03:00\n', '').replace('tags: ["kitap", "deneme"]\n', '').replace('categories:\n  - notlar\n', '')
    const { container } = setup({ files: { [POST_PATH]: text } })
    await settle()
    const meta = container.querySelector('[aria-label="Date, categories and tags"]')!
    expect([...meta.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['+ Add date', '+ Add categories', '+ Add tags'])
    click(button(meta, '+ Add categories'))
    await settle(2)
    expect(document.activeElement).toBe(field(container, 'Categories'))
  })

  it('removes an emptied title that was not in the file', async () => {
    const text = POST.replace('title: "Eski yazı"\n', '')
    const { container } = setup({ files: { [POST_PATH]: text } })
    await settle()
    typeInto(field(container, 'Title'), 'Yeni')
    expect(container.textContent).toContain('Unsaved changes')
    typeInto(field(container, 'Title'), '')
    expect(container.textContent).not.toContain('Unsaved changes')
  })
})

describe('checks in the side pane', () => {
  it('counts problems on the Settings button and goes to the line or the field of an issue', async () => {
    h.issues = [
      { rule: 'title-missing', severity: 'error', messageKey: 'rules.titleMissing' },
      { rule: 'description-empty', severity: 'warn', messageKey: 'rules.descriptionEmpty' },
      { rule: 'placeholder', severity: 'warn', messageKey: 'rules.placeholder', params: { text: '[TODO]' }, line: 16 },
      { rule: 'draft', severity: 'info', messageKey: 'rules.draft' },
    ]
    const { container } = setup()
    await settle()
    const toggle = button(container, 'Settings')
    expect(toggle.textContent).toBe('Settings33 checks need attention')
    const describedBy = toggle.getAttribute('aria-describedby')!
    expect(document.getElementById(describedBy)?.textContent).toContain('3 checks need attention')

    openSettings(container)
    click(button(container, 'Checks (4)'))
    const panel = () => container.querySelector('[role="tabpanel"]:not([hidden])')!

    // A line of the text: the editor selects it.
    click(button(panel(), /Placeholder left in the text/))
    const view = h.view.current!
    const selection = view.state.selection.main
    expect(view.state.sliceDoc(selection.from, selection.to)).toBe('Merhaba dünya.')

    // A front matter field: the settings show it.
    click(button(panel(), /The description is empty/))
    await settle(2)
    expect(tabs(container)[0]).toBe('Post settings *')
    expect(document.activeElement).toBe(field(container, 'Description'))

    // The title is above the text.
    click(button(container, 'Checks (4)'))
    click(button(panel(), /The title is missing/))
    expect(document.activeElement).toBe(field(container, 'Title'))
  })
})

describe('a new post', () => {
  it('selects the first placeholder of the template, so typing replaces it', async () => {
    const text = '---\r\ntitle: "Yeni yazı"\r\ndraft: true\r\n---\r\n\r\n## Giriş\r\n\r\n[Buraya giriş paragrafını yaz]\r\n'
    const { onFreshHandled } = setup({ files: { [POST_PATH]: text }, fresh: true })
    await settle()
    const view = h.view.current!
    const selection = view.state.selection.main
    expect(view.state.sliceDoc(selection.from, selection.to)).toBe('[Buraya giriş paragrafını yaz]')
    expect(onFreshHandled).toHaveBeenCalledTimes(1)
  })

  it('puts the cursor at the end of the text when there is no placeholder', async () => {
    setup({ files: { [POST_PATH]: '---\ntitle: "Yeni"\n---\n\nİlk.\n\n' }, fresh: true })
    await settle()
    const view = h.view.current!
    expect(view.state.selection.main.empty).toBe(true)
    expect(view.state.selection.main.head).toBe('\nİlk.'.length)
  })

  it('focuses the title when it is empty', async () => {
    const { container } = setup({ files: { [POST_PATH]: '+++\ntitle = ""\n+++\n\n[Metin]\n' }, fresh: true })
    await settle()
    expect(document.activeElement).toBe(field(container, 'Title'))
    expect(h.view.current!.state.selection.main.head).toBe(0)
  })

  it('leaves the cursor alone for a post that was not just created', async () => {
    const { container, onFreshHandled } = setup()
    await settle()
    expect(document.activeElement).not.toBe(field(container, 'Title'))
    expect(h.view.current!.state.selection.main.head).toBe(0)
    expect(onFreshHandled).not.toHaveBeenCalled()
  })
})
