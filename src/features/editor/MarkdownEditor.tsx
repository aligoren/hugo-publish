import '@fontsource/amiri/400.css'
import '@fontsource/amiri/700.css'
import { Annotation, EditorState, type Compartment, type Extension, type StateCommand } from '@codemirror/state'
import { EditorView, type Command } from '@codemirror/view'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore, type Ref, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { alertLabels, knownShortcodes, livePreviewEnabled, type AlertLabels, type LinkStyle } from './config'
import type { EditorIntegrationProps } from './contract'
import { focusMode } from './focusMode'
import type { EditorHost } from './host'
import { editorPhrases } from './phrases'
import {
  createCompartments,
  createEditorState,
  directionExtension,
  editorEolInfo,
  eolExtension,
  linksExtension,
  readOnlyExtension,
  replaceDocSpec,
  spellcheckExtension,
  type ColorScheme,
  type EditorCompartments,
  type EditorEol,
  type MarkdownEditorOptions,
  type TextDirection,
} from './setup'
import { shortcodeDefinitions } from './shortcodeDefs'
import { SpellClient, type SpellWorkerLike } from './spell/client'
import type { SpellLanguage } from './spell/protocol'
import { editorTheme } from './theme'

/** Imperative access to the editor, e.g. for a toolbar. */
export interface MarkdownEditorHandle {
  /** The CodeMirror view; null before mount and after unmount. */
  readonly view: EditorView | null
  /** Runs a command (see `./commands`; view commands such as `requestImage` too) and focuses the editor. */
  run(command: StateCommand | Command): boolean
  focus(): void
  /** The document exactly as it should be saved. */
  getValue(): string
}

export interface MarkdownEditorProps extends EditorIntegrationProps {
  /** The Markdown body (without front matter). */
  value: string
  /**
   * Line separator of `value`. When omitted, the most common line ending of
   * the document is used (fixed per document). CRLF stays CRLF byte for byte.
   */
  eol?: EditorEol
  /** Called with the full document text after every edit made in the editor. */
  onChange?: (value: string) => void
  /**
   * Changing this resets the editor (new document, fresh undo history), for
   * example the file path when another post is opened.
   */
  documentKey?: string | number
  alertLabels?: Partial<AlertLabels>
  /** Site and theme shortcode names, in addition to Hugo's built-ins (and `shortcodes`). */
  knownShortcodes?: readonly string[]
  /** Base text direction. Default `ltr`. */
  dir?: TextDirection
  /** Live preview (default) or raw source mode. */
  livePreview?: boolean
  readOnly?: boolean
  /** `auto` (default) follows `prefers-color-scheme`. */
  colorScheme?: ColorScheme | 'auto'
  /** What `[[` completion inserts: a `relref` shortcode (default) or the permalink path. */
  linkStyle?: LinkStyle
  /** Creates the spelling worker (default: the bundled module worker). For tests or custom hosting. */
  spellWorker?: () => SpellWorkerLike
  /** The site's content folder for `relref` paths. Default `content`. */
  contentDir?: string
  className?: string
  /** Accessible name of the editing area. */
  ariaLabel?: string
  autoFocus?: boolean
  ref?: Ref<MarkdownEditorHandle>
}

/** Marks transactions that apply a new `value` from the host, so they are not echoed to `onChange`. */
const externalChange = Annotation.define<boolean>()

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribeColorScheme(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function systemColorScheme(): ColorScheme {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light'
}

/** Reconfigures one compartment when `key` changes (not on mount: the state was created with it). */
function useCompartment(
  view: RefObject<EditorView | null>,
  compartment: () => Compartment,
  key: unknown,
  extension: () => Extension,
): void {
  const applied = useRef(key)
  useLayoutEffect(() => {
    if (Object.is(applied.current, key) || !view.current) return
    applied.current = key
    view.current.dispatch({ effects: compartment().reconfigure(extension()) })
  })
}

function isBundledLanguage(language: string | null | undefined): language is SpellLanguage {
  return language === 'tr' || language === 'en'
}

/** The spellcheck option without a worker client (the client is attached after mount). */
function initialSpellcheck(props: MarkdownEditorProps): MarkdownEditorOptions['spellcheck'] {
  const language = props.spellcheck?.language
  return language && !isBundledLanguage(language) ? { native: language } : null
}

/**
 * CodeMirror 6 Markdown editor with live preview and Hugo-aware decorations
 * (alerts, RTL blocks, shortcodes), slash menu, `[[` links, images, HTML
 * paste, spellchecking and focus mode. The view is created once; prop
 * changes reconfigure it in place.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const { value, documentKey, className, ref } = props
  const { t, i18n } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const compartments = useRef<EditorCompartments>(null)
  if (compartments.current === null) compartments.current = createCompartments()
  const c = (key: keyof EditorCompartments) => () => (compartments.current as EditorCompartments)[key]

  const system = useSyncExternalStore(subscribeColorScheme, systemColorScheme, () => 'light' as const)
  const scheme: ColorScheme = !props.colorScheme || props.colorScheme === 'auto' ? system : props.colorScheme
  const phrases = editorPhrases(t)
  const phrasesKey = `${i18n?.language ?? ''}|${JSON.stringify(phrases)}`

  // Latest props for callbacks that outlive a render (update listener, document reset, host).
  const latest = useRef({ props, scheme, phrases })
  useLayoutEffect(() => {
    latest.current = { props, scheme, phrases }
  })

  // The host facet reads the latest props lazily, so it never needs reconfiguring.
  const host = useRef<EditorHost>(null)
  if (host.current === null) {
    const p = () => latest.current.props
    host.current = {
      get docPath() {
        return p().docPath
      },
      get pages() {
        return p().pages
      },
      get onImageFiles() {
        return p().onImageFiles
      },
      get onRequestImage() {
        return p().onRequestImage
      },
      get resolveImage() {
        return p().resolveImage
      },
      get onStats() {
        return p().onStats
      },
      get pasteHtmlAsMarkdown() {
        return p().pasteHtmlAsMarkdown
      },
      get onAddWord() {
        return p().spellcheck?.onAddWord
      },
      get extraSlashItems() {
        return p().extraSlashItems
      },
    }
  }

  // The separator used for the current document (from the prop, or detected once per document).
  const docEol = useRef<EditorEol>(props.eol ?? editorEolInfo(value).eol)
  const spellClient = useRef<SpellClient | null>(null)

  const spellcheckOption = (): MarkdownEditorOptions['spellcheck'] => {
    const client = spellClient.current
    if (client) return { client, onAddWord: (word) => latest.current.props.spellcheck?.onAddWord(word) }
    return initialSpellcheck(latest.current.props)
  }

  const makeState = (doc: string): EditorState => {
    const { props: p, scheme: s, phrases: ph } = latest.current
    docEol.current = p.eol ?? editorEolInfo(doc).eol
    return createEditorState(
      doc,
      {
        eol: docEol.current,
        alertLabels: p.alertLabels,
        knownShortcodes: p.knownShortcodes,
        livePreview: p.livePreview ?? true,
        dir: p.dir ?? 'ltr',
        readOnly: p.readOnly ?? false,
        colorScheme: s,
        shortcodes: p.shortcodes,
        focusMode: p.focusMode ?? false,
        linkStyle: p.linkStyle,
        contentDir: p.contentDir,
        host: host.current as EditorHost,
        phrases: ph,
        spellcheck: spellcheckOption(),
      },
      compartments.current as EditorCompartments,
      [
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          if (update.transactions.some((tr) => tr.annotation(externalChange))) return
          latest.current.props.onChange?.(update.state.sliceDoc())
        }),
        EditorView.contentAttributes.of(p.ariaLabel ? { 'aria-label': p.ariaLabel } : {}),
      ],
    )
  }

  // Create the view once per mount.
  useLayoutEffect(() => {
    const parent = hostRef.current
    if (!parent) return
    const view = new EditorView({ state: makeState(latest.current.props.value), parent })
    viewRef.current = view
    if (latest.current.props.autoFocus) view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Another document: replace the whole state (this also clears undo history).
  const shownKey = useRef(documentKey)
  useLayoutEffect(() => {
    if (Object.is(shownKey.current, documentKey)) return
    shownKey.current = documentKey
    viewRef.current?.setState(makeState(latest.current.props.value))
  }, [documentKey])

  // `value` changed outside the editor: replace only the part that differs.
  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return
    const spec = replaceDocSpec(view.state, value)
    if (spec) view.dispatch({ ...spec, annotations: externalChange.of(true) })
  }, [value])

  useCompartment(viewRef, c('eol'), props.eol, () => eolExtension((docEol.current = props.eol ?? docEol.current)))
  useCompartment(viewRef, c('alertLabels'), JSON.stringify(props.alertLabels ?? {}), () =>
    alertLabels.of(props.alertLabels ?? {}),
  )
  useCompartment(viewRef, c('knownShortcodes'), (props.knownShortcodes ?? []).join('\n'), () =>
    knownShortcodes.of(props.knownShortcodes ?? []),
  )
  useCompartment(viewRef, c('livePreview'), props.livePreview ?? true, () => livePreviewEnabled.of(props.livePreview ?? true))
  useCompartment(viewRef, c('dir'), props.dir ?? 'ltr', () => directionExtension(props.dir ?? 'ltr'))
  useCompartment(viewRef, c('readOnly'), props.readOnly ?? false, () => readOnlyExtension(props.readOnly ?? false))
  useCompartment(viewRef, c('theme'), scheme, () => editorTheme(scheme))
  useCompartment(viewRef, c('shortcodes'), JSON.stringify(props.shortcodes ?? []), () => shortcodeDefinitions.of(props.shortcodes ?? []))
  useCompartment(viewRef, c('focusMode'), props.focusMode ?? false, () => focusMode(props.focusMode ?? false))
  useCompartment(viewRef, c('links'), `${props.linkStyle ?? ''}|${props.contentDir ?? ''}`, () =>
    linksExtension(props.linkStyle, props.contentDir),
  )
  useCompartment(viewRef, c('phrases'), phrasesKey, () => EditorState.phrases.of(phrases))

  // Spellchecking: one worker for the bundled dictionaries (Turkish, English), created after
  // mount and closed on unmount; switching between them reuses it. Other languages use the
  // browser's own checker.
  const language = props.spellcheck?.language ?? null
  // One key for both bundled languages: switching between them keeps the worker.
  const spellMode = isBundledLanguage(language) ? 'worker' : language
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const compartment = (compartments.current as EditorCompartments).spellcheck
    const wanted = latest.current.props.spellcheck?.language ?? null
    if (!isBundledLanguage(wanted)) {
      view.dispatch({ effects: compartment.reconfigure(spellcheckExtension(initialSpellcheck(latest.current.props))) })
      return
    }
    let client: SpellClient
    try {
      client = new SpellClient(wanted, latest.current.props.spellcheck?.personalWords ?? [], latest.current.props.spellWorker)
    } catch {
      // No Worker support: fall back to the browser's checker.
      view.dispatch({ effects: compartment.reconfigure(spellcheckExtension({ native: wanted })) })
      return
    }
    spellClient.current = client
    view.dispatch({ effects: compartment.reconfigure(spellcheckExtension(spellcheckOption())) })
    return () => {
      client.destroy()
      spellClient.current = null
      viewRef.current?.dispatch({ effects: compartment.reconfigure([]) })
    }
  }, [spellMode])

  useEffect(() => {
    if (isBundledLanguage(language)) spellClient.current?.setLanguage(language)
  }, [language])

  const personalKey = (props.spellcheck?.personalWords ?? []).join('\n')
  useEffect(() => {
    spellClient.current?.setPersonal(latest.current.props.spellcheck?.personalWords ?? [])
  }, [personalKey])

  useImperativeHandle(
    ref,
    (): MarkdownEditorHandle => ({
      get view() {
        return viewRef.current
      },
      run(command) {
        const view = viewRef.current
        if (!view) return false
        const result = (command as Command)(view)
        view.focus()
        return result
      },
      focus() {
        viewRef.current?.focus()
      },
      getValue() {
        return viewRef.current?.state.sliceDoc() ?? latest.current.props.value
      },
    }),
    [],
  )

  return <div ref={hostRef} className={className} data-markdown-editor="" />
}
