import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { slugify } from '../../lib/slug'
import { cloudflarePreviewUrl, previewBranch } from './deploy'
import { deployApi } from './deployApi'
import { GitErrorNote } from './GitErrorNote'

interface Props {
  cloudflareProject: string
  /** Suggested preview name, e.g. the title of the post being worked on. */
  suggestedName: string
  disabled: boolean
}

/** Draft share links: push the current commit to `preview/<name>`, list and delete such branches. */
export function SharePanel({ cloudflareProject, suggestedName, disabled }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [pushed, setPushed] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const value = name ?? (slugify(suggestedName) || 'taslak')
  const branch = previewBranch(value)

  async function act(work: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await work()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const share = () =>
    act(async () => {
      if (!branch) return
      await deployApi.previewPush(branch)
      setPushed(branch)
      if (branches) setBranches([...new Set([...branches, branch])].toSorted())
    })

  const list = () => act(async () => setBranches(await deployApi.previewList()))

  const remove = (target: string) =>
    act(async () => {
      await deployApi.previewDelete(target)
      setBranches((current) => current && current.filter((b) => b !== target))
      if (pushed === target) setPushed(null)
      setNotice(t('publish.deploy.share.deleted', { branch: target }))
    })

  const url = pushed && cloudflareProject ? cloudflarePreviewUrl(pushed, cloudflareProject) : null

  return (
    <details className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer font-semibold">{t('publish.deploy.share.title')}</summary>
      <div className="mt-2 space-y-2">
        <p className="text-zinc-700 dark:text-zinc-300">{t('publish.deploy.share.intro')}</p>
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {t('publish.deploy.share.warning')}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="field">
            <span>{t('publish.deploy.share.name')}</span>
            <input className="font-mono" value={value} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={disabled || busy || !branch} onClick={() => void share()}>
            {t('publish.deploy.share.push')}
          </button>
          <code className="text-xs text-zinc-500">{branch ?? t('publish.deploy.share.invalid')}</code>
        </div>
        {pushed && (
          <div role="status" className="space-y-1 text-xs">
            <p>{t('publish.deploy.share.pushed', { branch: pushed })}</p>
            {url ? (
              <p>
                {t('publish.deploy.share.url')}{' '}
                <a className="font-mono text-sky-700 hover:underline dark:text-sky-400" href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </p>
            ) : (
              <p className="text-zinc-600 dark:text-zinc-400">{t('publish.deploy.share.noProject', { branch: pushed })}</p>
            )}
          </div>
        )}
        <button className="text-xs text-sky-700 hover:underline dark:text-sky-400" disabled={busy} onClick={() => void list()}>
          {t('publish.deploy.share.list')}
        </button>
        {branches && (
          branches.length === 0 ? (
            <p className="text-xs text-zinc-500">{t('publish.deploy.share.none')}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {branches.map((b) => (
                <li key={b} className="flex items-center gap-2">
                  <code className="flex-1">{b}</code>
                  {cloudflareProject && cloudflarePreviewUrl(b, cloudflareProject) && (
                    <a className="text-sky-700 hover:underline dark:text-sky-400" href={cloudflarePreviewUrl(b, cloudflareProject)!} target="_blank" rel="noreferrer">
                      {cloudflarePreviewUrl(b, cloudflareProject)}
                    </a>
                  )}
                  <button className="btn" disabled={busy} onClick={() => void remove(b)}>
                    {t('publish.deploy.share.delete')}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {notice && <p role="status" className="text-xs text-emerald-800 dark:text-emerald-300">{notice}</p>}
        {error !== null && <GitErrorNote error={error} />}
      </div>
    </details>
  )
}
