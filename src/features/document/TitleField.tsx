import { useLayoutEffect, useState, type Ref, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { AiSuggestButton, TitleChoices } from './fields/AiSuggest'
import type { AiHelper } from './useAi'

interface Props {
  value: string
  disabled: boolean
  onChange(title: string): void
  /** Enter (or the down arrow at the end) moves on to the text. */
  onContinue(): void
  ai: AiHelper | null
  /** The body, for title suggestions. */
  getBody(): string
  inputRef: RefObject<HTMLTextAreaElement | null>
}

/** The post title as a large, borderless heading above the text. */
export function TitleField({ value, disabled, onChange, onContinue, ai, getBody, inputRef }: Props) {
  const { t } = useTranslation()
  const [choices, setChoices] = useState<string[] | null>(null)

  // Grows with the title, so long titles wrap instead of scrolling sideways.
  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`
  }, [value, inputRef])

  return (
    <div className="group">
      <div className="flex items-start gap-2">
        <textarea
          ref={inputRef as Ref<HTMLTextAreaElement>}
          aria-label={t('document.fieldTitle')}
          placeholder={t('document.titlePlaceholder')}
          rows={1}
          spellCheck
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, ' '))}
          onKeyDown={(e) => {
            const atEnd = e.currentTarget.selectionStart === e.currentTarget.value.length
            if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEnd)) {
              e.preventDefault()
              onContinue()
            }
          }}
          className="hp-writing-font min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 text-[2rem] leading-tight font-bold text-zinc-900 placeholder:text-zinc-300 focus:outline-none disabled:opacity-70 dark:text-zinc-100 dark:placeholder:text-zinc-600"
        />
        {ai && !disabled && (
          <div className="flex shrink-0 flex-wrap items-center pt-2 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <AiSuggestButton
              label={t('document.aiSuggestTitle')}
              run={() => ai.titles(value, getBody())}
              onResult={(titles) => setChoices(titles.filter((title) => title.trim() !== ''))}
            />
          </div>
        )}
      </div>
      {choices && choices.length > 0 && (
        <div className="mt-2">
          <TitleChoices
            titles={choices}
            onPick={(title) => {
              onChange(title)
              setChoices(null)
            }}
            onClose={() => setChoices(null)}
          />
        </div>
      )}
    </div>
  )
}
