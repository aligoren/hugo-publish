import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { suggestTerms, type TermCount } from '../termIndex'

interface Props {
  label: string
  values: readonly string[]
  /** Terms used elsewhere on the site, most used first. */
  suggestions: readonly TermCount[]
  onChange(values: string[]): void
  disabled?: boolean
}

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/** Taxonomy terms as chips, with autocomplete from the terms the site already uses. */
export function ChipInput({ label, values, suggestions, onChange, disabled }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const matches = useMemo(() => suggestTerms(suggestions, query, values), [suggestions, query, values])
  const listId = `${id}-list`

  function add(term: string) {
    const clean = term.trim()
    setQuery('')
    setActive(-1)
    if (!clean || values.some((v) => same(v, clean))) return
    // Reuse the spelling the site already uses (`Kitap` rather than `kitap`).
    const existing = suggestions.find((s) => same(s.term, clean))
    onChange([...values, existing?.term ?? clean])
  }

  function removeAt(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && matches.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActive((a) => (a + 1) % matches.length)
    } else if (event.key === 'ArrowUp' && matches.length > 0) {
      event.preventDefault()
      setActive((a) => (a <= 0 ? matches.length - 1 : a - 1))
    } else if (event.key === 'Enter' || event.key === ',' || (event.key === 'Tab' && query.trim() !== '')) {
      if (event.key === 'Tab' && !open) return
      if (query.trim() === '' && active < 0) return
      event.preventDefault()
      add(open && active >= 0 && matches[active] ? matches[active].term : query)
    } else if (event.key === 'Backspace' && query === '' && values.length > 0) {
      removeAt(values.length - 1)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const showList = open && !disabled && matches.length > 0

  return (
    <div className="field">
      <span id={`${id}-label`}>{label}</span>
      <div className="relative">
        <div
          className={`flex flex-wrap items-center gap-1 rounded-md border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-900 ${disabled ? 'opacity-60' : ''}`}
        >
          <ul className="contents" aria-labelledby={`${id}-label`}>
            {values.map((value, index) => (
              <li
                key={`${value}-${index}`}
                className="inline-flex items-center gap-1 rounded-full bg-sky-100 py-0.5 pr-1 pl-2 text-xs text-sky-900 dark:bg-sky-900/60 dark:text-sky-100"
              >
                {value}
                <button
                  type="button"
                  className="rounded-full px-1 leading-none hover:bg-sky-200 dark:hover:bg-sky-800"
                  aria-label={t('document.removeTerm', { term: value })}
                  disabled={disabled}
                  onClick={() => removeAt(index)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <input
            role="combobox"
            aria-label={label}
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            className="min-w-24 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
            value={query}
            disabled={disabled}
            placeholder={values.length === 0 ? t('document.addTermPlaceholder') : undefined}
            onChange={(e) => {
              setQuery(e.target.value.replace(/,/g, ''))
              setOpen(true)
              setActive(-1)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
        </div>
        {showList && (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {matches.map((match, index) => (
              <li
                key={match.term}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={`flex cursor-pointer items-center justify-between px-2 py-1 ${index === active ? 'bg-sky-100 dark:bg-sky-900/60' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                // Keep the input focused while choosing.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(match.term)}
              >
                <span>{match.term}</span>
                <span className="text-xs text-zinc-500">{match.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
