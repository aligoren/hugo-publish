import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { effectiveValueAt } from '../../config-edit'
import { useSettingsEditor } from '../editor/context'
import { resolveKey } from '../model/owner'
import { concretePath, isLanguageTemplate, SETTINGS, type Level } from '../schema'
import { SettingField } from './SettingField'
import { BADGE, CARD, INPUT, LINK_BUTTON } from './styles'

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/

/** Per-language settings (`languages.<lang>.label`…), one card per language, plus adding one. */
export function LanguagesSection({ level }: { level: Level }) {
  const { t } = useTranslation()
  const editor = useSettingsEditor()
  const [code, setCode] = useState('')
  const templates = SETTINGS.filter(isLanguageTemplate).filter((s) => level === 'advanced' || s.level === 'basic')
  const defaultLanguage = String(
    resolveKey(editor.sources, editor.env, ['defaultContentLanguage'], editor.valuesOf).owner?.value ??
      (editor.effective ? effectiveValueAt(editor.effective, ['defaultContentLanguage']) : undefined) ??
      'en',
  )
  const languages = editor.options.languages.length > 0 ? editor.options.languages : [defaultLanguage]
  const trimmed = code.trim()
  const valid = LANGUAGE_TAG.test(trimmed) && !languages.some((l) => l.toLowerCase() === trimmed.toLowerCase())

  function add() {
    if (!valid) return
    editor.editValue(['languages', trimmed, 'label'], trimmed, undefined)
    editor.editValue(['languages', trimmed, 'weight'], (languages.length + 1) * 10, undefined)
    setCode('')
  }

  return (
    <section className="space-y-3" aria-labelledby="settings-languages">
      <h3 id="settings-languages" className="text-sm font-semibold">
        {t('settings.languages.title')}
      </h3>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('settings.languages.intro')}</p>
      {languages.map((lang) => {
        const defined = resolveKey(editor.sources, editor.env, ['languages', lang]).layerLocations.some((l) => l.source.editable)
        return (
          <details key={lang} open className={CARD}>
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <span className="font-mono">{lang}</span>
              {lang.toLowerCase() === defaultLanguage.toLowerCase() && (
                <span className={`${BADGE} bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300`}>{t('settings.languages.default')}</span>
              )}
              {defined && (
                <button
                  type="button"
                  className={`${LINK_BUTTON} ml-auto`}
                  onClick={(e) => {
                    e.preventDefault()
                    editor.resetPath(['languages', lang])
                  }}
                >
                  {t('settings.languages.remove')}
                </button>
              )}
            </summary>
            <div className="mt-2">
              {templates.map((setting) => (
                <SettingField key={setting.path.join('.')} setting={setting} path={concretePath(setting, lang)} />
              ))}
            </div>
          </details>
        )
      })}
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={t('settings.languages.newCode')}
          placeholder={t('settings.languages.newCode')}
          className={`${INPUT} w-40 font-mono`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" className="btn" disabled={!valid} onClick={add}>
          {t('settings.languages.add')}
        </button>
        {trimmed !== '' && !valid && <span className="text-xs text-red-700 dark:text-red-400">{t('settings.languages.invalidCode')}</span>}
      </div>
    </section>
  )
}
