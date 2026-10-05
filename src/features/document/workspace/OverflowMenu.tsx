import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

export interface MenuItem {
  id: string
  label: string
  /** Shown on the right, e.g. a keyboard shortcut. */
  hint?: string
  /** A checkable item (focus mode). */
  checked?: boolean
  disabled?: boolean
  run(): void
}

interface Props {
  label: string
  items: readonly MenuItem[]
  className?: string
}

/** The header's "…" menu: keyboard friendly, closes on Escape, Tab and outside clicks. */
export function OverflowMenu({ label, items, className = '' }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not([disabled])')?.focus()
    function onPointerDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function close(refocus: boolean) {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    const entries = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])') ?? [])]
    const index = entries.indexOf(document.activeElement as HTMLButtonElement)
    const go = (next: number) => {
      event.preventDefault()
      entries[(next + entries.length) % entries.length]?.focus()
    }
    if (event.key === 'ArrowDown') go(index + 1)
    else if (event.key === 'ArrowUp') go(index - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(entries.length - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') close(false)
  }

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        className="btn px-2 py-1"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-40 mt-1 min-w-60 rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              disabled={item.disabled}
              tabIndex={-1}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none disabled:opacity-50 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
              onClick={() => {
                close(false)
                item.run()
              }}
            >
              <span className="w-4 shrink-0 text-center text-sky-700 dark:text-sky-400" aria-hidden="true">
                {item.checked ? '✓' : ''}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="text-xs text-zinc-400">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
