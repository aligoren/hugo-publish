import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSite } from '../../site/SiteContext'
import { useSettingsEditor } from '../editor/context'
import { concretePath, GROUPS, isLanguageTemplate, messageId, SETTINGS, type GroupId, type Level, type SettingDef } from '../schema'
import { LanguagesSection } from './LanguagesSection'
import { PermalinkTester } from './PermalinkTester'
import { SettingField } from './SettingField'
import { DANGER_NOTE, INPUT, LINK_BUTTON, NOTE } from './styles'

/** Lower-cased search text of a setting in the current UI language. */
function useSearchText() {
  const { t } = useTranslation()
  return (setting: SettingDef) => {
    const id = messageId(setting.path)
    return [setting.path.join('.'), t(`settings.keys.${id}.label`), t(`settings.keys.${id}.help`), t(`settings.groups.${setting.group}.label`)]
      .join(' ')
      .toLocaleLowerCase()
  }
}

export function SettingsTab({ onShowMenus }: { onShowMenus(): void }) {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<Level>('basic')
  const [selected, setSelected] = useState<GroupId>('identity')
  const searchText = useSearchText()

  const visible = (s: SettingDef) => level === 'advanced' || s.level === 'basic'
  const groups = GROUPS.filter((g) => SETTINGS.some((s) => s.group === g.id && visible(s)))
  const group = groups.find((g) => g.id === selected) ?? groups[0]
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matches = terms.length > 0 ? SETTINGS.filter((s) => terms.every((term) => searchText(s).includes(term))) : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <input
          type="search"
          aria-label={t('settings.search')}
          placeholder={t('settings.search')}
          className={`${INPUT} w-72`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div role="radiogroup" aria-label={t('settings.level.label')} className="inline-flex overflow-hidden rounded-md border border-zinc-300 text-sm dark:border-zinc-700">
          {(['basic', 'advanced'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={level === l}
              className={`px-3 py-1 ${level === l ? 'bg-sky-700 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
              onClick={() => setLevel(l)}
            >
              {t(`settings.level.${l}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {terms.length === 0 && (
          <nav aria-label={t('settings.groupsNav')} className="w-52 shrink-0 overflow-auto border-r border-zinc-200 p-2 dark:border-zinc-800">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-current={g.id === group.id ? 'true' : undefined}
                onClick={() => setSelected(g.id)}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  g.id === group.id ? 'bg-sky-100 font-medium dark:bg-sky-900/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                } ${g.danger ? 'text-red-700 dark:text-red-400' : ''}`}
              >
                {t(`settings.groups.${g.id}.label`)}
              </button>
            ))}
          </nav>
        )}

        <div className="min-w-0 flex-1 overflow-auto px-5 py-4">
          {terms.length > 0 ? (
            <section aria-label={t('settings.searchResults')}>
              <p className="mb-2 text-xs text-zinc-500">{t('settings.matchCount', { count: matches.length })}</p>
              {matches.flatMap((s) =>
                isLanguageTemplate(s)
                  ? editor.options.languages.map((lang) => <SettingField key={`${lang}:${s.path.join('.')}`} setting={s} path={concretePath(s, lang)} />)
                  : [<SettingField key={s.path.join('.')} setting={s} path={[...s.path]} />],
              )}
            </section>
          ) : (
            group && <GroupSection id={group.id} level={level} danger={group.danger === true} onShowMenus={onShowMenus} />
          )}
        </div>
      </div>
    </div>
  )
}

function GroupSection({ id, level, danger, onShowMenus }: { id: GroupId; level: Level; danger: boolean; onShowMenus(): void }) {
  const { t } = useTranslation()
  const { showView } = useSite()
  const settings = SETTINGS.filter((s) => s.group === id && !isLanguageTemplate(s) && (level === 'advanced' || s.level === 'basic'))
  return (
    <section aria-labelledby={`settings-group-${id}`} className="max-w-3xl space-y-3">
      <header className="space-y-1">
        <h2 id={`settings-group-${id}`} className="text-lg font-semibold">
          {t(`settings.groups.${id}.label`)}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t(`settings.groups.${id}.help`)}</p>
      </header>
      {danger && <p className={DANGER_NOTE}>{t('settings.notes.security')}</p>}
      {id === 'identity' && (
        <p className={NOTE}>
          {t('settings.notes.params')}{' '}
          <button type="button" className={LINK_BUTTON} onClick={() => showView('theme')}>
            {t('settings.notes.openTheme')}
          </button>
        </p>
      )}
      {id === 'taxonomies' && (
        <p className={NOTE}>
          {t('settings.notes.menus')}{' '}
          <button type="button" className={LINK_BUTTON} onClick={onShowMenus}>
            {t('settings.notes.openMenus')}
          </button>
        </p>
      )}
      {id === 'server' && <p className={NOTE}>{t('settings.notes.server')}</p>}
      {id === 'caches' && <p className={NOTE}>{t('settings.notes.caches')}</p>}
      <div>
        {settings.map((s) => (
          <SettingField key={s.path.join('.')} setting={s} path={[...s.path]} />
        ))}
      </div>
      {id === 'languages' && <LanguagesSection level={level} />}
      {id === 'urls' && <PermalinkTester />}
    </section>
  )
}
