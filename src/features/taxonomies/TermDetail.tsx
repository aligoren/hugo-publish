import { useTranslation } from 'react-i18next'

import type { TaxonomyDef, TaxonomySettings } from './config'
import { termPagesEnabled } from './config'
import type { TermInfo } from './indexer'
import { TermPageEditor } from './TermPageEditor'
import { termUrl } from './urlize'

interface Props {
  term: TermInfo
  taxonomy: TaxonomyDef
  settings: TaxonomySettings
  /** Other spellings Hugo puts on the same page. */
  sameUrlTerms: readonly string[]
  pagePath: string | null
  newPagePath: string
  eol: '\n' | '\r\n'
  onRename(): void
  onDelete(): void
  onOpen(path: string): void
  onSaved(path: string): Promise<void>
}

export function TermDetail({ term, taxonomy, settings, sameUrlTerms, pagePath, newPagePath, eol, onRename, onDelete, onOpen, onSaved }: Props) {
  const { t } = useTranslation()
  const pages = termPagesEnabled(settings)
  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start gap-2">
        <div className="mr-auto min-w-0">
          <h2 className="text-xl font-semibold break-words">{term.name}</h2>
          <p className="text-sm text-zinc-500">{t('taxonomies.posts', { count: term.posts.length })}</p>
        </div>
        <button className="btn" onClick={onRename}>
          {t('taxonomies.rename')}
        </button>
        <button className="btn" onClick={onDelete}>
          {t('taxonomies.delete')}
        </button>
      </header>

      {pages ? (
        <p className="text-sm">
          <span className="text-zinc-500">{t('taxonomies.address')}: </span>
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">{termUrl(taxonomy.plural, term.name, settings)}</code>
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('taxonomies.termPagesDisabled')}</p>
      )}
      {sameUrlTerms.length > 0 && (
        <p className="text-sm text-sky-800 dark:text-sky-300">
          {t('taxonomies.sameUrl', { terms: sameUrlTerms.map((name) => `“${name}”`).join(', ') })}
        </p>
      )}

      {pages && (
        <TermPageEditor key={term.name} term={term.name} pagePath={pagePath} newPath={newPagePath} eol={eol} onSaved={onSaved} onOpen={onOpen} />
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('taxonomies.postsHeading')}</h3>
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {term.posts.map((post) => (
            <li key={post.path}>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => onOpen(post.path)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{post.title}</span>
                  <span className="block truncate font-mono text-xs text-zinc-500">{post.path}</span>
                </span>
                {post.draft && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
                    {t('taxonomies.draft')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
