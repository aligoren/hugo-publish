import { open } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import { api } from '../../lib/api'
import { slugify } from '../../lib/slug'
import { THEME_CATALOG } from '../../lib/themeCatalog'

interface Props {
  onCreated(path: string): Promise<void>
  onClose(): void
}

export function NewSiteDialog({ onCreated, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const [parentDir, setParentDir] = useState('')
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState('')
  const [folderEdited, setFolderEdited] = useState(false)
  const [language, setLanguage] = useState(i18n.resolvedLanguage === 'tr' ? 'tr' : 'en')
  const [themeName, setThemeName] = useState(THEME_CATALOG[0].name)
  const [gitInit, setGitInit] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const name = folderEdited ? folder : slugify(title)
  const theme = THEME_CATALOG.find((x) => x.name === themeName) ?? null
  const lang = i18n.resolvedLanguage === 'tr' ? 'tr' : 'en'

  async function chooseParent() {
    const selected = await open({ directory: true, multiple: false, title: t('newSite.chooseParent') })
    if (typeof selected === 'string') setParentDir(selected)
  }

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const path = await api.siteCreate({
        parentDir,
        name,
        title: title.trim(),
        language: language.trim() || 'en',
        theme: theme && { owner: theme.owner, repo: theme.repo, reference: theme.reference, name: theme.name },
        gitInit,
      })
      await onCreated(path)
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-auto rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
        <div>
          <h2 className="text-lg font-semibold">{t('newSite.title')}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('newSite.intro')}</p>
        </div>

        <div className="grid gap-3 text-sm">
          <label className="field">
            <span>{t('newSite.siteTitle')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <label className="field">
              <span>{t('newSite.parent')}</span>
              <input value={parentDir} readOnly placeholder={t('newSite.parentPlaceholder')} />
            </label>
            <button className="btn" onClick={() => void chooseParent()}>
              {t('newSite.browse')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="field">
              <span>{t('newSite.folder')}</span>
              <input
                value={name}
                onChange={(e) => {
                  setFolderEdited(true)
                  setFolder(e.target.value)
                }}
              />
            </label>
            <label className="field">
              <span>{t('newSite.language')}</span>
              <input value={language} onChange={(e) => setLanguage(e.target.value)} list="new-site-languages" />
              <datalist id="new-site-languages">
                {['tr', 'en', 'de', 'fr', 'es', 'ar', 'fa', 'nl', 'ja'].map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </label>
          </div>
          {parentDir && name && (
            <p className="font-mono text-xs text-zinc-500">
              {parentDir.replace(/[\\/]+$/, '')}
              {parentDir.includes('\\') ? '\\' : '/'}
              {name}
            </p>
          )}

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('newSite.theme')}</legend>
            <div className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">
              {THEME_CATALOG.map((item) => (
                <label
                  key={item.name}
                  className={`flex cursor-pointer gap-2 rounded-md border p-2 ${
                    themeName === item.name ? 'border-sky-600 bg-sky-50 dark:bg-sky-950' : 'border-zinc-200 dark:border-zinc-700'
                  }`}
                >
                  <input type="radio" name="theme" checked={themeName === item.name} onChange={() => setThemeName(item.name)} />
                  <span>
                    <span className="block font-medium">{item.name}</span>
                    <span className="block text-xs text-zinc-600 dark:text-zinc-400">{item.description[lang]}</span>
                    {item.needsExtended && <span className="block text-xs text-amber-700">{t('newSite.needsExtended')}</span>}
                  </span>
                </label>
              ))}
              <label
                className={`flex cursor-pointer gap-2 rounded-md border p-2 ${
                  themeName === '' ? 'border-sky-600 bg-sky-50 dark:bg-sky-950' : 'border-zinc-200 dark:border-zinc-700'
                }`}
              >
                <input type="radio" name="theme" checked={themeName === ''} onChange={() => setThemeName('')} />
                <span>
                  <span className="block font-medium">{t('newSite.noTheme')}</span>
                  <span className="block text-xs text-zinc-600 dark:text-zinc-400">{t('newSite.noThemeHint')}</span>
                </span>
              </label>
            </div>
            {theme && <p className="text-xs text-zinc-500">{t('newSite.download', { repo: `github.com/${theme.owner}/${theme.repo}` })}</p>}
          </fieldset>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} />
            {t('newSite.gitInit')}
          </label>
        </div>

        {error !== null && <ErrorNote error={error} />}

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy || !title.trim() || !parentDir || !name} onClick={() => void create()}>
            {busy ? t('newSite.creating') : t('newSite.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
