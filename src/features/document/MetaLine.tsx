import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

export interface MetaTaxonomy {
  name: string
  label: string
  /** "+ Add tags" */
  addLabel: string
  terms: readonly string[]
}

interface Props {
  /** The date as people read it, or null when the post has none. */
  date: string | null
  taxonomies: readonly MetaTaxonomy[]
  /** Opens the post settings at this field. */
  onOpen(field: string): void
}

const linkClass =
  'rounded px-1 py-0.5 -mx-1 hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-2 focus-visible:outline-sky-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
const addClass = `${linkClass} text-zinc-400 dark:text-zinc-500`

/** One quiet line under the title: date · categories · tags; each opens its setting. */
export function MetaLine({ date, taxonomies, onOpen }: Props) {
  const { t } = useTranslation()
  const items = [
    <button key="date" type="button" className={date ? linkClass : addClass} title={t('document.fieldDate')} onClick={() => onOpen('date')}>
      {date ?? `+ ${t('document.addDate')}`}
    </button>,
    ...taxonomies.map((taxonomy) =>
      taxonomy.terms.length > 0 ? (
        <button
          key={taxonomy.name}
          type="button"
          className={`${linkClass} inline-flex flex-wrap items-center gap-1`}
          aria-label={`${taxonomy.label}: ${taxonomy.terms.join(', ')}`}
          title={taxonomy.label}
          onClick={() => onOpen(taxonomy.name)}
        >
          {taxonomy.terms.map((term, index) => (
            <span
              key={`${term}-${index}`}
              className="rounded-full bg-zinc-100 px-2 py-px text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {term}
            </span>
          ))}
        </button>
      ) : (
        <button key={taxonomy.name} type="button" className={addClass} onClick={() => onOpen(taxonomy.name)}>
          + {taxonomy.addLabel}
        </button>
      ),
    ),
  ]
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400" aria-label={t('document.metaLabel')} role="group">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && (
            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">
              ·
            </span>
          )}
          {item}
        </Fragment>
      ))}
    </div>
  )
}
