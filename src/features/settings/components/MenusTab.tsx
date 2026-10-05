import { useId, useMemo, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type KeyPath, type PageEntry } from '../../../lib/api'
import { useSite } from '../../site/SiteContext'
import { useSettingsEditor } from '../editor/context'
import { editableValues, type PageMenuItem } from '../hooks/usePageMenus'
import { enableCommentedMenu, findCommentedMenus, type CommentedMenuEntry } from '../model/commentedMenus'
import { listMode, rowsOf, type ListMode, type ListRow } from '../model/lists'
import { changedItems, dropItem, indentItem, itemKey, itemName, itemTree, moveItem, outdentItem, type DropPosition, type MenuItem } from '../model/menuEdit'
import { findMenus, menuId, menuOfPath, newMenuTarget, nextWeight } from '../model/menus'
import { pageRefOf } from '../model/pageRefs'
import { layerFor, shortName, toGlobalPath, type LoadedSource } from '../model/sources'
import { deepEqual, formatValue, type Tree } from '../model/values'
import { FileChangesDialog, type FileChange } from './FileChangesDialog'
import { BADGE, CARD, INPUT, LINK_BUTTON, NOTE, SMALL_BUTTON, WARNING_NOTE } from './styles'

interface MenuRef {
  source: LoadedSource
  filePath: KeyPath
  lang: string | null
  name: string
  entries: Tree[] | null
  mode: ListMode
  overridden: boolean
}

/** A menu card: config entries (when a config file defines the menu) plus entries from pages. */
interface Card {
  key: string
  name: string
  lang: string | null
  config: MenuRef | null
  pages: PageMenuItem[]
}

interface PendingText {
  title: string
  prepare(): Promise<FileChange[]>
}

/** Menus from config files and page front matter, edited entry by entry; changes join the pending changes. */
export function MenusTab() {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  const { notifyConfigChanged } = useSite()
  const [text, setText] = useState<PendingText | null>(null)
  const existing: MenuRef[] = findMenus(editor.sources, editor.env)
  const known = new Set(existing.map((m) => `${m.source.path}|${m.filePath.join('.')}`))
  // New menus exist only as drafts until they are written.
  const created: MenuRef[] = Object.values(editor.lists.drafts).flatMap((draft) => {
    const source = editor.sources.find((s) => s.path === draft.file)
    if (!source || draft.disk !== null || known.has(`${draft.file}|${draft.path.join('.')}`)) return []
    const menu = menuOfPath(toGlobalPath(source, draft.path))
    return menu ? [{ source, filePath: draft.path, ...menu, entries: null, mode: draft.mode, overridden: false }] : []
  })
  const menus = [...existing, ...created]

  const cards = ((): Card[] => {
    const items = editor.pageMenus.items
    const used = new Set<PageMenuItem>()
    const matches = (item: PageMenuItem, name: string, lang: string | null) =>
      item.menu.toLowerCase() === name.toLowerCase() && (item.lang ?? '').toLowerCase() === (lang ?? '').toLowerCase()
    const out: Card[] = menus.map((m) => {
      const pages = m.overridden ? [] : items.filter((i) => matches(i, m.name, m.lang))
      pages.forEach((p) => used.add(p))
      return { key: `${m.source.path}|${m.filePath.join('.')}`, name: m.name, lang: m.lang, config: m, pages }
    })
    // Menus that only pages define.
    for (const item of items) {
      if (used.has(item)) continue
      const pages = items.filter((i) => !used.has(i) && matches(i, item.menu, item.lang))
      pages.forEach((p) => used.add(p))
      out.push({ key: `pages|${menuId(item.lang, item.menu)}`, name: item.menu, lang: item.lang, config: null, pages })
    }
    return out
  })()

  const commented = useMemo(() => layerFor(editor.sources, editor.env).filter((s) => s.editable).flatMap(findCommentedMenus), [editor.sources, editor.env])

  function enable(entry: CommentedMenuEntry) {
    setText({
      title: t('settings.menus.enableTitle'),
      prepare: async () => {
        const file = await api.readText(entry.file)
        return [{ path: entry.file, before: file.text, after: enableCommentedMenu(file.text, entry), version: file.version, validate: true }]
      },
    })
  }

  return (
    <div className="max-w-4xl space-y-4 px-5 py-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t('settings.menus.title')}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('settings.menus.intro')}</p>
      </header>
      <p className={NOTE}>{t('settings.menus.frontMatterNote')}</p>
      {editor.pageMenus.loading && <p className="text-xs text-zinc-500">{t('settings.menus.readingPages')}</p>}
      {commented.length > 0 && <CommentedEntries entries={commented} onEnable={enable} />}
      {cards.length === 0 && <p className="text-sm text-zinc-500">{t('settings.menus.none')}</p>}
      {cards.map((card) => (
        <MenuEditor key={card.key} card={card} />
      ))}
      <NewMenuForm taken={menus.filter((m) => !m.overridden).map((m) => menuId(m.lang, m.name))} />
      {text && (
        <FileChangesDialog
          title={text.title}
          prepare={text.prepare}
          hugoAvailable={editor.hugoAvailable}
          onClose={() => setText(null)}
          onWritten={() => {
            setText(null)
            notifyConfigChanged()
          }}
        />
      )}
    </div>
  )
}

function CommentedEntries({ entries, onEnable }: { entries: CommentedMenuEntry[]; onEnable(entry: CommentedMenuEntry): void }) {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  return (
    <section className={CARD} aria-labelledby="settings-commented-menus">
      <h3 id="settings-commented-menus" className="text-sm font-semibold">
        {t('settings.menus.commentedTitle')}
      </h3>
      <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">{t('settings.menus.commentedIntro')}</p>
      <ul className="space-y-2">
        {entries.map((entry) => {
          const pending = (editor.draft.opsByFile[entry.file]?.length ?? 0) + (editor.lists.opsByFile[entry.file]?.length ?? 0) > 0
          const label = String(entry.values.name ?? entry.values.pageRef ?? entry.values.url ?? '') || t('settings.menus.unnamed')
          return (
            <li key={`${entry.file}:${entry.start}`} className="rounded-md border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{label}</span>
                {entry.count > 1 && <span className="text-xs text-zinc-500">{t('settings.menus.commentedMore', { count: entry.count - 1 })}</span>}
                <span className={`${BADGE} bg-zinc-100 font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>
                  {entry.lang ? t('settings.menus.menuInLanguage', { name: entry.menu, lang: entry.lang }) : entry.menu}
                </span>
                <span className="text-xs text-zinc-500">
                  {t('settings.menus.commentedAt', { file: shortName(entry.file), line: entry.start + 1 })}
                </span>
                <button
                  type="button"
                  className="btn ml-auto"
                  disabled={!entry.safe || pending}
                  aria-label={t('settings.menus.enableEntry', { label })}
                  onClick={() => onEnable(entry)}
                >
                  {t('settings.menus.enable')}
                </button>
              </div>
              <pre className="mt-1 overflow-auto font-mono text-[11px] text-zinc-500">{entry.lines.join('\n')}</pre>
              {!entry.safe && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {/.ya?ml$/i.test(entry.file) ? t('settings.menus.unsafeCommentYaml') : t('settings.menus.unsafeComment')}
                </p>
              )}
              {entry.safe && pending && <p className="text-xs text-amber-700 dark:text-amber-400">{t('settings.menus.pendingFirst')}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function pageItemId(item: PageMenuItem): string {
  return `p:${item.file}`
}

function MenuEditor({ card }: { card: Card }) {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  const { pageMenus } = editor
  const menu = card.config
  const draft = menu ? editor.lists.get(menu.source.path, menu.filePath) : undefined
  const rows: ListRow[] = draft?.rows ?? rowsOf(menu?.entries ?? [])
  const configReadOnly = menu !== null && (!menu.source.editable || menu.overridden)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; position: DropPosition } | null>(null)

  const items: MenuItem[] = [
    ...rows.map((row, i) => ({ id: `c:${i}`, values: row.values })),
    ...card.pages.map((p) => ({
      id: pageItemId(p),
      values: pageMenus.draftOf(p.file, p.menu)?.values ?? editableValues(p.values),
      fallbackName: p.title,
      fallbackWeight: p.weight,
    })),
  ]
  const tree = itemTree(items)
  const keys = [...new Set(items.map(itemKey).filter((k) => k !== ''))]

  function updateRows(next: ListRow[]) {
    if (!menu) return
    editor.lists.update({ file: menu.source.path, path: menu.filePath, mode: menu.mode, disk: menu.entries, rows: next })
  }

  function apply(next: MenuItem[] | null) {
    if (!next) return
    const changed = changedItems(items, next)
    if (changed.some((i) => i.id.startsWith('c:'))) {
      if (configReadOnly) return
      updateRows(rows.map((row, i) => ({ ...row, values: next.find((n) => n.id === `c:${i}`)?.values ?? row.values })))
    }
    for (const item of changed) {
      const page = card.pages.find((p) => pageItemId(p) === item.id)
      if (!page) continue
      if (deepEqual(item.values, editableValues(page.values))) pageMenus.dropDraft(page.file, page.menu)
      else pageMenus.setDraft({ file: page.file, menu: page.menu, values: item.values })
    }
  }

  function setField(id: string, key: string, value: unknown) {
    apply(items.map((item) => (item.id !== id ? item : { ...item, values: withField(item.values, key, value) })))
  }

  function onDragOver(e: DragEvent<HTMLLIElement>, id: string) {
    if (drag === null || drag === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / Math.max(rect.height, 1)
    const position: DropPosition = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
    if (over?.id !== id || over.position !== position) setOver({ id, position })
  }

  function onDrop(e: DragEvent<HTMLLIElement>, id: string) {
    e.preventDefault()
    if (drag !== null && over && over.id === id) apply(dropItem(items, drag, id, over.position))
    setDrag(null)
    setOver(null)
  }

  // Moves rewrite the weights of every sibling, so a read-only config list locks the whole menu.
  const locked = configReadOnly && rows.length > 0
  const title = card.lang ? t('settings.menus.menuInLanguage', { name: card.name, lang: card.lang }) : card.name
  const hasPageDrafts = card.pages.some((p) => pageMenus.draftOf(p.file, p.menu))
  return (
    <section className={CARD} aria-label={title}>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-sm font-semibold">{title}</h3>
        {menu && <span className={`${BADGE} bg-sky-100 font-mono text-sky-800 dark:bg-sky-950 dark:text-sky-300`}>{shortName(menu.source.path)}</span>}
        {!menu && <span className={`${BADGE} bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300`}>{t('settings.menus.pagesOnly')}</span>}
        {menu?.entries === null && <span className={`${BADGE} bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200`}>{t('settings.menus.newMenu')}</span>}
        {menu?.overridden && <span className="text-xs text-amber-700 dark:text-amber-400">{t('settings.menus.overridden')}</span>}
        {menu && !menu.source.editable && <span className="text-xs text-zinc-500">{t('settings.readOnlyJson')}</span>}
        {(draft || hasPageDrafts) && (
          <button
            type="button"
            className={`${LINK_BUTTON} ml-auto`}
            onClick={() => {
              if (menu) editor.lists.drop(menu.source.path, menu.filePath)
              for (const p of card.pages) pageMenus.dropDraft(p.file, p.menu)
            }}
          >
            {t('settings.field.undo')}
          </button>
        )}
      </header>

      {items.length === 0 && <p className="text-sm text-zinc-500">{t('settings.menus.empty')}</p>}
      {items.length > 1 && !configReadOnly && <p className="mb-2 text-[11px] text-zinc-500">{t('settings.menus.dragHint')}</p>}
      <ol className="space-y-2">
        {tree.map(({ item, depth }) => {
          const label = itemName(item) || String(item.values.pageRef ?? item.values.url ?? '') || t('settings.menus.unnamed')
          const page = card.pages.find((p) => pageItemId(p) === item.id)
          const rowIndex = page ? -1 : Number(item.id.slice(2))
          const readOnly = locked
          const indicator =
            over?.id === item.id
              ? over.position === 'before'
                ? 'border-t-2 border-t-sky-500'
                : over.position === 'after'
                  ? 'border-b-2 border-b-sky-500'
                  : 'ring-2 ring-sky-500'
              : ''
          return (
            <li
              key={item.id}
              style={{ marginLeft: `${depth * 1.5}rem` }}
              className={`rounded-md border p-2 ${page ? 'border-violet-200 dark:border-violet-900' : 'border-zinc-200 dark:border-zinc-700'} ${drag === item.id ? 'opacity-50' : ''} ${indicator}`}
              aria-label={label}
              onDragOver={(e) => onDragOver(e, item.id)}
              onDragLeave={() => over?.id === item.id && setOver(null)}
              onDrop={(e) => onDrop(e, item.id)}
            >
              <div className="mb-1 flex items-center gap-2">
                {!readOnly && (
                  <span
                    draggable
                    role="button"
                    tabIndex={-1}
                    title={t('settings.menus.dragHandle')}
                    aria-hidden="true"
                    className="cursor-grab select-none text-zinc-400"
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', item.id)
                      e.dataTransfer.effectAllowed = 'move'
                      const li = e.currentTarget.closest('li')
                      if (li) e.dataTransfer.setDragImage(li, 12, 12)
                      setDrag(item.id)
                    }}
                    onDragEnd={() => {
                      setDrag(null)
                      setOver(null)
                    }}
                  >
                    ⠿
                  </span>
                )}
                {page && <PageBadge page={page} />}
              </div>
              {page ? (
                <PageEntryFields item={item} page={page} keys={keys} onChange={(k, v) => setField(item.id, k, v)} />
              ) : (
                <ConfigEntryFields item={item} keys={keys} disabled={readOnly} onChange={(k, v) => setField(item.id, k, v)} />
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className={SMALL_BUTTON} disabled={readOnly} aria-label={t('settings.menus.moveUp', { label })} onClick={() => apply(moveItem(items, item.id, -1))}>
                  ↑
                </button>
                <button type="button" className={SMALL_BUTTON} disabled={readOnly} aria-label={t('settings.menus.moveDown', { label })} onClick={() => apply(moveItem(items, item.id, 1))}>
                  ↓
                </button>
                <button type="button" className={SMALL_BUTTON} disabled={readOnly} aria-label={t('settings.menus.indent', { label })} title={t('settings.menus.indent', { label })} onClick={() => apply(indentItem(items, item.id))}>
                  →
                </button>
                <button type="button" className={SMALL_BUTTON} disabled={readOnly} aria-label={t('settings.menus.outdent', { label })} title={t('settings.menus.outdent', { label })} onClick={() => apply(outdentItem(items, item.id))}>
                  ←
                </button>
                {!page && (
                  <button
                    type="button"
                    className={`${SMALL_BUTTON} ml-auto`}
                    disabled={readOnly}
                    aria-label={t('settings.menus.removeEntry', { label })}
                    onClick={() => updateRows(rows.filter((_, i) => i !== rowIndex))}
                  >
                    {t('settings.menus.remove')}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {menu && !configReadOnly && <AddEntry rows={rows} onAdd={updateRows} />}
      {!menu && <p className="mt-2 text-xs text-zinc-500">{t('settings.menus.pagesOnlyHint')}</p>}
    </section>
  )
}

function withField(values: Tree, key: string, value: unknown): Tree {
  const next = { ...values }
  if (value === undefined || value === '') delete next[key]
  else next[key] = value
  return next
}

function PageBadge({ page }: { page: PageMenuItem }) {
  const { t } = useTranslation()
  const { openFile } = useSite()
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
      <span className={`${BADGE} bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300`}>{t('settings.menus.fromPage')}</span>
      <span className="truncate font-medium">{page.title}</span>
      <span className="truncate font-mono text-zinc-500">{page.file}</span>
      <button type="button" className={`${LINK_BUTTON} ml-auto`} onClick={() => openFile(page.file)}>
        {t('settings.menus.openPage')}
      </button>
    </span>
  )
}

function weightValue(raw: string, current: unknown): unknown {
  if (raw === '') return undefined
  const n = Number(raw)
  return Number.isInteger(n) ? n : current
}

function ParentSelect({ item, keys, disabled, onChange }: { item: MenuItem; keys: string[]; disabled?: boolean; onChange(value: string): void }) {
  const { t } = useTranslation()
  const current = String(item.values.parent ?? '')
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
      {t('settings.menus.parent')}
      <select className={INPUT} value={current} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('settings.menus.noParent')}</option>
        {[...new Set([...keys, current])]
          .filter((p) => p !== '' && p !== itemKey(item))
          .map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
      </select>
    </label>
  )
}

function ConfigEntryFields({ item, keys, disabled, onChange }: { item: MenuItem; keys: string[]; disabled: boolean; onChange(key: string, value: unknown): void }) {
  const { t } = useTranslation()
  const listId = useId()
  const pages = usePageRefs()
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
        <MenuInput label={t('settings.menus.name')} value={item.values.name} disabled={disabled} onChange={(v) => onChange('name', v)} />
        <MenuInput label={t('settings.menus.url')} value={item.values.url} mono disabled={disabled} onChange={(v) => onChange('url', v)} />
        <MenuInput label={t('settings.menus.pageRef')} value={item.values.pageRef} mono disabled={disabled} list={listId} onChange={(v) => onChange('pageRef', v)} />
        <MenuInput label={t('settings.menus.weight')} value={item.values.weight} mono disabled={disabled} onChange={(v) => onChange('weight', weightValue(v, item.values.weight))} />
        <MenuInput label={t('settings.menus.identifier')} value={item.values.identifier} mono disabled={disabled} onChange={(v) => onChange('identifier', v)} />
        <ParentSelect item={item} keys={keys} disabled={disabled} onChange={(v) => onChange('parent', v)} />
      </div>
      <datalist id={listId}>
        {pages.map((p) => (
          <option key={p.ref} value={p.ref}>
            {p.title}
          </option>
        ))}
      </datalist>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-zinc-500">{t('settings.menus.more')}</summary>
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
          <MenuInput label="pre" value={item.values.pre} mono disabled={disabled} onChange={(v) => onChange('pre', v)} />
          <MenuInput label="post" value={item.values.post} mono disabled={disabled} onChange={(v) => onChange('post', v)} />
          <MenuInput label={t('settings.menus.titleAttr')} value={item.values.title} disabled={disabled} onChange={(v) => onChange('title', v)} />
        </div>
      </details>
    </>
  )
}

function PageEntryFields({ item, page, keys, onChange }: { item: MenuItem; page: PageMenuItem; keys: string[]; onChange(key: string, value: unknown): void }) {
  const { t } = useTranslation()
  const extra = Object.keys(page.values).filter((k) => !(k in item.values) && !['name', 'weight', 'parent', 'identifier', 'pre', 'post', 'title'].includes(k))
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
      <MenuInput label={t('settings.menus.name')} value={item.values.name} placeholder={page.title} onChange={(v) => onChange('name', v)} />
      <MenuInput
        label={t('settings.menus.weight')}
        value={item.values.weight}
        placeholder={page.weight === undefined ? undefined : formatValue(page.weight)}
        mono
        onChange={(v) => onChange('weight', weightValue(v, item.values.weight))}
      />
      <MenuInput label={t('settings.menus.identifier')} value={item.values.identifier} mono onChange={(v) => onChange('identifier', v)} />
      <ParentSelect item={item} keys={keys} onChange={(v) => onChange('parent', v)} />
      {extra.length > 0 && <p className="col-span-full text-[11px] text-zinc-500">{t('settings.menus.otherFields', { fields: extra.join(', ') })}</p>}
    </div>
  )
}

/** Pages for the pageRef picker. */
function usePageRefs(): { ref: string; title: string }[] {
  const { pages, site } = useSite()
  return useMemo(() => {
    const seen = new Set<string>()
    return pages
      .filter((p: PageEntry) => p.path !== '')
      .map((p) => ({ ref: pageRefOf(p.path, site.contentDir), title: p.title || p.path }))
      .filter((p) => (seen.has(p.ref) ? false : (seen.add(p.ref), true)))
      .sort((a, b) => a.ref.localeCompare(b.ref))
  }, [pages, site.contentDir])
}

function AddEntry({ rows, onAdd }: { rows: ListRow[]; onAdd(rows: ListRow[]): void }) {
  const { t } = useTranslation()
  const pages = usePageRefs()
  const [page, setPage] = useState('')
  const weight = nextWeight(rows)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className="btn" onClick={() => onAdd([...rows, { orig: null, values: { name: '', url: '/', weight } }])}>
        {t('settings.menus.addEntry')}
      </button>
      {pages.length > 0 && (
        <>
          <select aria-label={t('settings.menus.pickPage')} className={`${INPUT} max-w-xs`} value={page} onChange={(e) => setPage(e.target.value)}>
            <option value="">{t('settings.menus.pickPage')}</option>
            {pages.map((p) => (
              <option key={p.ref} value={p.ref}>
                {p.title} ({p.ref})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={page === ''}
            onClick={() => {
              const picked = pages.find((p) => p.ref === page)
              onAdd([...rows, { orig: null, values: { name: picked?.title ?? '', pageRef: page, weight } }])
              setPage('')
            }}
          >
            {t('settings.menus.addPage')}
          </button>
        </>
      )}
    </div>
  )
}

function MenuInput({
  label,
  value,
  onChange,
  disabled,
  mono,
  list,
  placeholder,
}: {
  label: string
  value: unknown
  onChange(value: string): void
  disabled?: boolean
  mono?: boolean
  list?: string
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
      {label}
      <input
        className={`${INPUT} ${mono ? 'font-mono' : ''}`}
        value={value === undefined || value === null ? '' : String(value)}
        disabled={disabled}
        list={list}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function NewMenuForm({ taken }: { taken: string[] }) {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  const [name, setName] = useState('')
  const [lang, setLang] = useState('')
  const trimmed = name.trim()
  const language = lang === '' ? null : lang
  const valid = /^[A-Za-z0-9_-]+$/.test(trimmed) && !taken.includes(menuId(language, trimmed))
  const target = valid ? newMenuTarget(editor.sources, editor.env, language, trimmed) : null

  function create() {
    if (!target) return
    editor.lists.update({
      file: target.source.path,
      path: target.filePath,
      mode: listMode(target.source, target.filePath, false),
      disk: null,
      rows: [{ orig: null, values: { name: '', url: '/', weight: 10 } }],
    })
    setName('')
  }

  return (
    <section className={CARD} aria-labelledby="settings-new-menu">
      <h3 id="settings-new-menu" className="mb-2 text-sm font-semibold">
        {t('settings.menus.addMenu')}
      </h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
          {t('settings.menus.menuName')}
          <input className={`${INPUT} w-40 font-mono`} value={name} placeholder="footer" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
          {t('settings.menus.language')}
          <select className={INPUT} value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="">{t('settings.menus.allLanguages')}</option>
            {editor.options.languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={!target} onClick={create}>
          {t('settings.menus.create')}
        </button>
      </div>
      {target && <p className="mt-1 text-xs text-zinc-500">{t('settings.menus.willGoTo', { file: shortName(target.source.path) })}</p>}
      {valid && !target && <p className={`${WARNING_NOTE} mt-1`}>{t('settings.field.noTarget')}</p>}
    </section>
  )
}
