import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type GitFile, type GitStatus } from '../../lib/api'
import { IssueList } from '../checks/IssueList'
import { loadCheckContext } from '../checks/context'
import { archetypeForDocument, isProblem, runChecks, type CheckIssue } from '../checks/runChecks'
import { useSite } from '../site/SiteContext'
import { suggestCommitMessage } from './commitMessage'
import { GitErrorNote } from './GitErrorNote'
import { DeploySection } from './DeploySection'
import { deployApi } from './deployApi'
import { gitError } from './gitErrors'
import {
  commitPaths,
  displayName,
  groupChanges,
  isContentDocument,
  isNoreplyEmail,
  toChangeItems,
  type ChangeItem,
} from './groups'
import { UnifiedDiffView } from './UnifiedDiffView'

type Action = 'commit' | 'commitPush' | 'pull' | 'push'

interface DiffState {
  text?: string
  error?: unknown
}

interface CheckResult {
  path: string
  issues: CheckIssue[]
}

/** At most this many changed posts are read and checked before publishing. */
const MAX_CHECKED = 100

const KIND_STYLE: Record<GitFile['kind'], string> = {
  added: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100',
  untracked: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100',
  modified: 'bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100',
  renamed: 'bg-violet-100 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100',
  typechange: 'bg-violet-100 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100',
  deleted: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100',
  conflicted: 'bg-red-100 text-red-900 dark:bg-red-900/60 dark:text-red-100',
}

/** Git changes, commit, pull and push. */
export function PublishView() {
  const { t, i18n } = useTranslation()
  const { site, files: contentFiles, reloadFiles, openFile } = useSite()
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Paths seen in the previous status: new ones start selected, deselected ones stay deselected.
  const known = useRef<Set<string>>(new Set())
  const [editedMessage, setEditedMessage] = useState<string | null>(null)
  const [openDiffs, setOpenDiffs] = useState<Set<string>>(new Set())
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({})
  const [busy, setBusy] = useState<Action | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [checks, setChecks] = useState<CheckResult[] | null>([])
  const [confirming, setConfirming] = useState<'commit' | 'commitPush' | null>(null)
  const [fetching, setFetching] = useState(false)
  const [pushedSha, setPushedSha] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<GitStatus | null> => {
    setLoading(true)
    try {
      const next = await api.gitStatus()
      const paths = next.files.map((f) => f.path)
      const seen = known.current
      setSelected((previous) => new Set(paths.filter((p) => previous.has(p) || !seen.has(p))))
      known.current = new Set(paths)
      setStatus(next)
      setDiffs({})
      setLoadError(null)
      return next
    } catch (error) {
      setStatus(null)
      setLoadError(error)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // `git fetch` first, so ahead/behind are current; network problems are not worth a message here.
  const fetchAndRefresh = useCallback(async () => {
    setFetching(true)
    try {
      await api.gitFetch()
    } catch {
      // Offline or no access: the local status is still useful.
    } finally {
      setFetching(false)
    }
    await refresh()
  }, [refresh])

  useEffect(() => {
    // Read the repository on mount (fast), then fetch in the background and read it again.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh().then((first) => {
      if (first?.isRepo && first.remoteUrl) void fetchAndRefresh()
    })
  }, [refresh, fetchAndRefresh])

  async function rememberPush() {
    try {
      setPushedSha((await deployApi.commitFiles()).sha)
    } catch {
      // Without the commit id there is nothing to follow.
    }
  }

  const items = useMemo(
    () => (status ? toChangeItems(status.files, contentFiles, site.contentDir) : []),
    [status, contentFiles, site.contentDir],
  )
  const groups = useMemo(() => groupChanges(items), [items])
  const chosen = useMemo(() => items.filter((i) => selected.has(i.file.path)), [items, selected])
  const suggestion = useMemo(() => suggestCommitMessage(chosen, t, i18n.resolvedLanguage), [chosen, t, i18n.resolvedLanguage])
  const message = editedMessage ?? suggestion

  // Pre-publish checks of the chosen posts.
  const checkPaths = useMemo(
    () =>
      chosen
        .filter((i) => i.action !== 'deleted' && i.file.kind !== 'conflicted' && isContentDocument(i.file.path, site.contentDir))
        .map((i) => i.file.path),
    [chosen, site.contentDir],
  )
  const checkKey = checkPaths.join('\n')
  // The file list only seeds the cached check context; a newer list need not re-run the checks.
  const contentFilesRef = useRef(contentFiles)
  useEffect(() => {
    contentFilesRef.current = contentFiles
  }, [contentFiles])
  useEffect(() => {
    let alive = true
    const paths = checkKey === '' ? [] : checkKey.split('\n').slice(0, MAX_CHECKED)
    void (async () => {
      if (paths.length === 0) {
        if (alive) setChecks([])
        return
      }
      if (alive) setChecks(null)
      const context = await loadCheckContext(site.root, contentFilesRef.current)
      const results = await Promise.all(
        paths.map(async (path): Promise<CheckResult> => {
          try {
            const { text } = await api.readText(path)
            const archetypeText = archetypeForDocument(path, text, context.archetypes)
            return { path, issues: runChecks({ path, text, archetypeText, siteUsesDescription: context.siteUsesDescription, rawHtmlAllowed: context.rawHtmlAllowed }) }
          } catch {
            return { path, issues: [] }
          }
        }),
      )
      if (alive) setChecks(results.filter((r) => r.issues.length > 0))
    })()
    return () => {
      alive = false
    }
  }, [checkKey, status, site.root])

  const problemCount = (checks ?? []).reduce((sum, r) => sum + r.issues.filter(isProblem).length, 0)

  function toggle(paths: string[], on: boolean) {
    setSelected((previous) => {
      const next = new Set(previous)
      for (const path of paths) {
        if (on) next.add(path)
        else next.delete(path)
      }
      return next
    })
    setConfirming(null)
  }

  async function toggleDiff(path: string) {
    const isOpen = openDiffs.has(path)
    setOpenDiffs((previous) => {
      const next = new Set(previous)
      if (isOpen) next.delete(path)
      else next.add(path)
      return next
    })
    if (isOpen || diffs[path]) return
    try {
      const text = await api.gitDiff(path)
      setDiffs((previous) => ({ ...previous, [path]: { text } }))
    } catch (error) {
      setDiffs((previous) => ({ ...previous, [path]: { error } }))
    }
  }

  async function run(action: Action, work: () => Promise<void>) {
    setBusy(action)
    setActionError(null)
    setNotice(null)
    setOutput(null)
    setConfirming(null)
    try {
      await work()
    } catch (error) {
      setActionError(error)
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  function commit(push: boolean) {
    const action = push ? 'commitPush' : 'commit'
    if (problemCount > 0 && confirming !== action) {
      setConfirming(action)
      return
    }
    void run(action, async () => {
      const hash = await api.gitCommit(message, commitPaths(chosen.map((i) => i.file)))
      setEditedMessage(null)
      setNotice(t('publish.committed', { hash }))
      if (push) {
        const result = await api.gitPush()
        setOutput(result.output)
        setNotice(`${t('publish.committed', { hash })} ${t('publish.pushed')}`)
        await rememberPush()
      }
    })
  }

  function pull() {
    void run('pull', async () => {
      try {
        const result = await api.gitPull()
        setOutput(result.output)
        setNotice(t('publish.pulled'))
      } finally {
        // Even a stopped pull can change files (conflict markers).
        await reloadFiles()
      }
    })
  }

  function push() {
    void run('push', async () => {
      const result = await api.gitPush()
      setOutput(result.output)
      setNotice(t('publish.pushed'))
      await rememberPush()
    })
  }

  const header = (
    <header className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold">{t('publish.title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{t('publish.intro')}</p>
      </div>
      <button
        className="btn"
        onClick={() => void (status?.remoteUrl ? fetchAndRefresh() : refresh())}
        disabled={loading || fetching || busy !== null}
      >
        {t('publish.refresh')}
      </button>
    </header>
  )

  if (!status) {
    const missingGit = gitError(loadError)?.code === 'git_not_found'
    return (
      <div className="space-y-4 p-6">
        {header}
        {loading && <p className="text-sm text-zinc-500">{t('publish.loading')}</p>}
        {!loading && missingGit && (
          <Guide>
            <p>{t('publish.guide.noGit')}</p>
            <Command>{t('publish.guide.noGitHow')}</Command>
          </Guide>
        )}
        {!loading && loadError !== null && !missingGit && <GitErrorNote error={loadError} />}
      </div>
    )
  }

  if (!status.isRepo) {
    return (
      <div className="space-y-4 p-6">
        {header}
        <Guide>
          <p>{t('publish.guide.notRepo')}</p>
          <Command>{'git init -b main\ngit add -A\ngit commit -m "Hugo site"'}</Command>
        </Guide>
      </div>
    )
  }

  const conflicted = status.files.some((f) => f.kind === 'conflicted')
  const shareName = (chosen.find((i) => i.group === 'content') ?? items.find((i) => i.group === 'content'))?.title ?? ''
  const canPush = status.branch !== null && (status.ahead > 0 || (status.upstream === null && status.remoteUrl !== null))
  const working = busy !== null

  return (
    <div className="space-y-5 p-6">
      {header}

      <RepoSummary status={status} />
      {fetching && <p className="text-xs text-zinc-500">{t('publish.fetching')}</p>}
      <IdentityNote name={status.userName} email={status.userEmail} />

      {status.remoteUrl === null && (
        <Guide>
          <p>{t('publish.guide.noRemote')}</p>
          <Command>{`git remote add origin https://github.com/<user>/<repository>.git`}</Command>
        </Guide>
      )}
      {conflicted && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          {t('publish.guide.conflicts')}
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          {notice}
        </p>
      )}
      {actionError !== null && <GitErrorNote error={actionError} />}
      {output && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500">{t('publish.output')}</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-zinc-100 p-2 font-mono whitespace-pre-wrap dark:bg-zinc-900">{output}</pre>
        </details>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('publish.noChanges')}</p>
      ) : (
        <section className="space-y-4">
          <p className="text-xs text-zinc-500">{t('publish.selectedCount', { selected: chosen.length, total: items.length })}</p>
          {groups.map(({ group, items: groupItems }) => {
            const paths = groupItems.map((i) => i.file.path)
            const all = paths.every((p) => selected.has(p))
            const some = paths.some((p) => selected.has(p))
            const label = t(`publish.groups.${group}`)
            return (
              <section key={group} aria-label={label} className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 text-sm font-semibold dark:border-zinc-800">
                  <input
                    type="checkbox"
                    aria-label={t('publish.selectGroup', { group: label })}
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = some && !all
                    }}
                    onChange={(e) => toggle(paths, e.target.checked)}
                  />
                  {label}
                  <span className="font-normal text-zinc-500">({groupItems.length})</span>
                </h2>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {groupItems.map((item) => (
                    <ChangeRow
                      key={item.file.path}
                      item={item}
                      selected={selected.has(item.file.path)}
                      onSelect={(on) => toggle([item.file.path], on)}
                      diffOpen={openDiffs.has(item.file.path)}
                      diff={diffs[item.file.path]}
                      onToggleDiff={() => void toggleDiff(item.file.path)}
                      onOpen={
                        item.group === 'content' && item.action !== 'deleted' && isContentDocument(item.file.path, site.contentDir)
                          ? () => openFile(item.file.path)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </section>
      )}

      {checkPaths.length > 0 && (
        <section aria-label={t('publish.checks.title')} className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">{t('publish.checks.title')}</h2>
          {checks === null ? (
            <p className="text-xs text-zinc-500">{t('publish.checks.running')}</p>
          ) : checks.length === 0 ? (
            <p className="text-xs text-emerald-800 dark:text-emerald-300">{t('publish.checks.none')}</p>
          ) : (
            <>
              {problemCount > 0 && <p className="text-xs">{t('publish.checks.problems', { count: problemCount })}</p>}
              {checks.map((result) => {
                const item = items.find((i) => i.file.path === result.path)
                return (
                  <div key={result.path}>
                    <p className="text-xs font-medium">{item?.title ?? displayName(result.path)}</p>
                    <IssueList issues={result.issues} className="mt-1 pl-2" />
                  </div>
                )
              })}
            </>
          )}
          {checkPaths.length > MAX_CHECKED && <p className="text-xs text-zinc-500">{t('publish.checks.limited', { count: MAX_CHECKED })}</p>}
        </section>
      )}

      <section className="space-y-3">
        {items.length > 0 && (
          <label className="field">
            <span>{t('publish.message')}</span>
            <textarea
              rows={Math.min(8, Math.max(3, message.split('\n').length + 1))}
              value={message}
              onChange={(e) => setEditedMessage(e.target.value)}
              className="font-mono"
            />
            <small className="flex flex-wrap items-center gap-2 text-zinc-500">
              {t('publish.messageHint')}
              {editedMessage !== null && (
                <button type="button" className="text-sky-700 hover:underline dark:text-sky-400" onClick={() => setEditedMessage(null)}>
                  {t('publish.resetMessage')}
                </button>
              )}
            </small>
          </label>
        )}

        {confirming && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <span className="flex-1">{t('publish.confirmProblems', { count: problemCount })}</span>
            <button className="btn" onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={() => commit(confirming === 'commitPush')}>
              {t('publish.continueAnyway')}
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {items.length > 0 && (
            <>
              <button
                className="btn btn-primary"
                disabled={working || chosen.length === 0 || message.trim() === '' || conflicted}
                onClick={() => commit(false)}
              >
                {busy === 'commit' ? t('publish.working.commit') : t('publish.commit')}
              </button>
              {status.remoteUrl !== null && status.branch !== null && (
                <button
                  className="btn"
                  disabled={working || chosen.length === 0 || message.trim() === '' || conflicted}
                  onClick={() => commit(true)}
                >
                  {busy === 'commitPush' ? t('publish.working.commitPush') : t('publish.commitAndPush')}
                </button>
              )}
            </>
          )}
          {status.upstream !== null && (
            <button
              className={status.behind > 0 ? 'btn btn-primary' : 'btn'}
              disabled={working || conflicted}
              title={t('publish.pullHint')}
              onClick={pull}
            >
              {busy === 'pull' ? t('publish.working.pull') : t('publish.pull')}
              {status.behind > 0 && <Badge>↓{status.behind}</Badge>}
            </button>
          )}
          {canPush && (
            <button className="btn" disabled={working || conflicted} onClick={push}>
              {busy === 'push' ? t('publish.working.push') : t('publish.push')}
              {status.ahead > 0 && <Badge>↑{status.ahead}</Badge>}
            </button>
          )}
        </div>
      </section>

      <DeploySection
        status={status}
        pushedSha={pushedSha}
        busy={working}
        shareName={shareName}
        onPublished={() => void refresh()}
      />
    </div>
  )
}

function ChangeRow({
  item,
  selected,
  onSelect,
  diffOpen,
  diff,
  onToggleDiff,
  onOpen,
}: {
  item: ChangeItem
  selected: boolean
  onSelect(on: boolean): void
  diffOpen: boolean
  diff: DiffState | undefined
  onToggleDiff(): void
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const { file } = item
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          aria-label={t('publish.selectFile', { path: file.path })}
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_STYLE[file.kind]}`}>{t(`publish.kinds.${file.kind}`)}</span>
            {onOpen ? (
              <button className="truncate text-left text-sm font-medium hover:underline" title={t('publish.openInEditor')} onClick={onOpen}>
                {item.title ?? displayName(file.path)}
              </button>
            ) : (
              <span className="truncate text-sm">{item.title ?? displayName(file.path)}</span>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-zinc-500" title={file.path}>
            {file.path}
            {file.origPath && ` · ${t('publish.movedFrom', { path: file.origPath })}`}
          </p>
        </div>
        <button className="shrink-0 text-xs text-sky-700 hover:underline dark:text-sky-400" aria-expanded={diffOpen} onClick={onToggleDiff}>
          {diffOpen ? t('publish.hideDiff') : t('publish.showDiff')}
        </button>
      </div>
      {diffOpen && (
        <div className="mt-2 pl-6">
          {diff === undefined ? (
            <p className="text-xs text-zinc-500">{t('publish.loadingDiff')}</p>
          ) : diff.error !== undefined ? (
            <GitErrorNote error={diff.error} />
          ) : (
            <UnifiedDiffView text={diff.text ?? ''} />
          )}
        </div>
      )}
    </li>
  )
}

function RepoSummary({ status }: { status: GitStatus }) {
  const { t } = useTranslation()
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="text-zinc-500">{t('publish.branch')}</dt>
      <dd className="flex flex-wrap items-center gap-x-2">
        <span className="font-mono">{status.branch ?? t('publish.detached')}</span>
        <span className="text-zinc-500">
          {status.upstream ? t('publish.tracks', { upstream: status.upstream }) : status.branch ? t('publish.noUpstream') : null}
        </span>
        {status.upstream && status.ahead > 0 && <Badge>{t('publish.ahead', { count: status.ahead })}</Badge>}
        {status.upstream && status.behind > 0 && <Badge>{t('publish.behind', { count: status.behind })}</Badge>}
        {status.upstream && status.ahead === 0 && status.behind === 0 && (
          <span className="text-xs text-zinc-500">{t('publish.inSync')}</span>
        )}
      </dd>
      {status.remoteUrl && (
        <>
          <dt className="text-zinc-500">{t('publish.remote')}</dt>
          <dd className="truncate font-mono text-xs leading-5" title={status.remoteUrl}>
            {status.remoteUrl}
          </dd>
        </>
      )}
    </dl>
  )
}

function IdentityNote({ name, email }: { name: string | null; email: string | null }) {
  const { t } = useTranslation()
  const missing = !name || !email
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-zinc-500">{t('publish.identity.label')}:</span>{' '}
        <span className="font-mono">
          {name ?? t('publish.identity.unknown')} &lt;{email ?? t('publish.identity.unknown')}&gt;
        </span>
      </p>
      {missing ? (
        <Guide tone="warn">
          <p>{t('publish.identity.missing')}</p>
          <Command>{'git config user.name "…"\ngit config user.email "…@users.noreply.github.com"'}</Command>
        </Guide>
      ) : (
        !isNoreplyEmail(email) && (
          <Guide>
            <p>{t('publish.identity.tip')}</p>
            <Command>{'git config user.email "<id>+<username>@users.noreply.github.com"'}</Command>
          </Guide>
        )
      )}
    </div>
  )
}

function Guide({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const style =
    tone === 'warn'
      ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
      : 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100'
  return <div className={`space-y-2 rounded-md border p-3 text-sm ${style}`}>{children}</div>
}

function Command({ children }: { children: string }) {
  return (
    <pre className="overflow-auto rounded bg-white/70 px-2 py-1 font-mono text-xs whitespace-pre-wrap select-all dark:bg-black/30">
      {children}
    </pre>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800">{children}</span>
}
