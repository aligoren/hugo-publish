import type { StateCommand } from '@codemirror/state'
import type { Command } from '@codemirror/view'
import type { ChangeEvent, MouseEvent, ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { requestImage } from './images'
import {
  insertCodeBlock,
  insertTable,
  insertAlert,
  insertHorizontalRule,
  insertLink,
  insertRtlBlock,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleItalic,
} from './commands'
import {
  ALERT_TYPES,
  DEFAULT_ALERT_LABELS,
  DEFAULT_TOOLBAR_LABELS,
  isAlertType,
  type AlertLabels,
  type ToolbarLabels,
} from './config'
import type { MarkdownEditorHandle } from './MarkdownEditor'

export interface EditorToolbarProps {
  editor: RefObject<MarkdownEditorHandle | null>
  alertLabels?: Partial<AlertLabels>
  labels?: Partial<ToolbarLabels>
  /** When given, a live preview / raw source toggle is shown. */
  livePreview?: boolean
  onLivePreviewChange?: (enabled: boolean) => void
  /** When given, a focus mode toggle is shown. */
  focusMode?: boolean
  onFocusModeChange?: (enabled: boolean) => void
  disabled?: boolean
  className?: string
}

const buttonClass =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm text-current ' +
  'hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ' +
  'disabled:opacity-40 dark:hover:bg-white/10 aria-pressed:bg-black/10 dark:aria-pressed:bg-white/15'

const selectClass =
  'h-8 rounded-md border border-black/10 bg-transparent px-1 text-sm text-current ' +
  'hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10'

/** Keeps the editor's focus and selection when a toolbar button is pressed. */
const keepFocus = (event: MouseEvent) => event.preventDefault()

function ToolButton(props: { label: string; onRun: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={buttonClass}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onMouseDown={keepFocus}
      onClick={props.onRun}
    >
      {props.children}
    </button>
  )
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function Separator() {
  return <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
}

/** Formatting toolbar for {@link MarkdownEditor}. Users never need to type Markdown syntax. */
export function EditorToolbar({
  editor,
  alertLabels,
  labels,
  livePreview,
  onLivePreviewChange,
  focusMode,
  onFocusModeChange,
  disabled,
  className,
}: EditorToolbarProps) {
  const { t } = useTranslation()
  // Translated defaults (`editor.toolbar.*`); the `labels` prop still overrides them.
  const translated = Object.fromEntries(
    (Object.keys(DEFAULT_TOOLBAR_LABELS) as (keyof ToolbarLabels)[]).map((key) => [
      key,
      t(`editor.toolbar.${key}`, { defaultValue: DEFAULT_TOOLBAR_LABELS[key] }),
    ]),
  ) as unknown as ToolbarLabels
  const text = { ...translated, ...labels }
  const alertText = { ...DEFAULT_ALERT_LABELS, ...alertLabels }
  const run = (command: StateCommand | Command) => () => editor.current?.run(command)

  const onHeading = (event: ChangeEvent<HTMLSelectElement>) => {
    const level = Number(event.target.value)
    event.target.value = ''
    if (Number.isInteger(level)) editor.current?.run(setHeading(level))
  }

  const onAlert = (event: ChangeEvent<HTMLSelectElement>) => {
    const type = event.target.value
    event.target.value = ''
    if (isAlertType(type)) editor.current?.run(insertAlert(type))
  }

  return (
    <div
      role="toolbar"
      aria-label={text.toolbar}
      className={`flex flex-wrap items-center gap-0.5 ${className ?? ''}`}
    >
      <ToolButton label={text.bold} onRun={run(toggleBold)} disabled={disabled}>
        <strong>B</strong>
      </ToolButton>
      <ToolButton label={text.italic} onRun={run(toggleItalic)} disabled={disabled}>
        <em className="font-serif">I</em>
      </ToolButton>
      <select className={selectClass} aria-label={text.heading} title={text.heading} defaultValue="" onChange={onHeading} disabled={disabled}>
        <option value="" disabled hidden>
          {text.heading}
        </option>
        <option value="0">{text.paragraph}</option>
        {[1, 2, 3, 4, 5, 6].map((level) => (
          <option key={level} value={level}>
            {`${text.heading} ${level}`}
          </option>
        ))}
      </select>
      <Separator />
      <ToolButton label={text.quote} onRun={run(toggleBlockquote)} disabled={disabled}>
        <span aria-hidden="true" className="font-serif text-lg leading-none">“</span>
      </ToolButton>
      <select className={selectClass} aria-label={text.alert} title={text.alert} defaultValue="" onChange={onAlert} disabled={disabled}>
        <option value="" disabled hidden>
          {text.alert}
        </option>
        {ALERT_TYPES.map((type) => (
          <option key={type} value={type}>
            {alertText[type]}
          </option>
        ))}
      </select>
      <ToolButton label={text.rtlBlock} onRun={run(insertRtlBlock)} disabled={disabled}>
        <span aria-hidden="true" dir="rtl">
          ع
        </span>
      </ToolButton>
      <Separator />
      <ToolButton label={text.link} onRun={run(insertLink())} disabled={disabled}>
        <Icon><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" /></Icon>
      </ToolButton>
      <ToolButton label={text.image} onRun={run(requestImage)} disabled={disabled}>
        <Icon><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></Icon>
      </ToolButton>
      <ToolButton label={text.table} onRun={run(insertTable)} disabled={disabled}>
        <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M12 4v16" /></Icon>
      </ToolButton>
      <ToolButton label={text.codeBlock} onRun={run(insertCodeBlock)} disabled={disabled}>
        <Icon><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></Icon>
      </ToolButton>
      <ToolButton label={text.horizontalRule} onRun={run(insertHorizontalRule)} disabled={disabled}>
        <span aria-hidden="true">―</span>
      </ToolButton>
      {(onLivePreviewChange || onFocusModeChange) && <Separator />}
      {onLivePreviewChange && (
        <ToolButton
          label={text.livePreview}
          pressed={livePreview ?? true}
          onRun={() => onLivePreviewChange(!(livePreview ?? true))}
        >
          <Icon><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Icon>
        </ToolButton>
      )}
      {onFocusModeChange && (
        <ToolButton label={text.focusMode} pressed={focusMode ?? false} onRun={() => onFocusModeChange(!(focusMode ?? false))}>
          <Icon><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 12h8" /></Icon>
        </ToolButton>
      )}
    </div>
  )
}
