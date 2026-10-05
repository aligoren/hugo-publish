// Pure helpers for deploying: forge remotes (GitHub, GitLab, Gitea/Forgejo), Cloudflare preview
// URLs, check aggregation, live page verification, scheduled-post detection and the
// scheduled-rebuild workflow.

import type { PageEntry } from '../../lib/api'
import type { DeployCheck, ForgeKind } from './deployApi'

export interface GitHubRepo {
  owner: string
  repo: string
}

/** `owner/repo` of a github.com remote (https, ssh and scp-like forms); `null` otherwise. */
export function parseGitHubRemote(url: string | null | undefined): GitHubRepo | null {
  const text = url?.trim() ?? ''
  let path: string
  const scheme = /^([a-z+]+):\/\/([^/]+)\/(.*)$/i.exec(text)
  if (scheme) {
    if (!/^(https?|ssh|git)$/i.test(scheme[1])) return null
    const host = scheme[2].split('@').at(-1)!.split(':')[0].toLowerCase()
    if (!['github.com', 'www.github.com', 'ssh.github.com'].includes(host)) return null
    path = scheme[3]
  } else {
    const scp = /^(?:[^@/]+@)?([^:/]+):([^/].*)$/.exec(text)
    if (!scp || scp[1].toLowerCase() !== 'github.com') return null
    path = scp[2]
  }
  const parts = path.replace(/\/+$/, '').split('/')
  if (parts.length !== 2) return null
  const [owner, rawRepo] = parts
  const repo = rawRepo.replace(/\.git$/, '')
  const valid = (s: string) => /^[A-Za-z0-9._-]+$/.test(s)
  return valid(owner) && valid(repo) ? { owner, repo } : null
}

const GITLAB_HOSTS = [
  'gitlab.com',
  'framagit.org',
  'salsa.debian.org',
  'gitlab.gnome.org',
  'invent.kde.org',
  'gitlab.freedesktop.org',
  'gitlab.archlinux.org',
]
const GITEA_HOSTS = ['codeberg.org', 'gitea.com', 'code.forgejo.org', 'next.forgejo.org', 'git.disroot.org']

/** The forge of a well-known host (the same list as `src-tauri/src/git/deploy/forge.rs`). */
export function knownForge(host: string): ForgeKind | null {
  const name = host.toLowerCase()
  if (['github.com', 'www.github.com', 'ssh.github.com'].includes(name)) return 'github'
  if (GITLAB_HOSTS.includes(name) || name.startsWith('gitlab.')) return 'gitlab'
  if (GITEA_HOSTS.includes(name) || name.startsWith('gitea.') || name.startsWith('forgejo.')) return 'gitea'
  return null
}

/** Host of a remote URL (https, ssh, git and scp-like forms), lower case; `null` for local paths. */
export function remoteHost(url: string | null | undefined): string | null {
  const text = url?.trim() ?? ''
  const scheme = /^([a-z+]+):\/\/([^/]+)\/./i.exec(text)
  if (scheme) {
    if (!/^(https?|ssh|git|git\+ssh|ssh\+git)$/i.test(scheme[1])) return null
    return scheme[2].split('@').at(-1)!.split(':')[0].toLowerCase() || null
  }
  // scp-like `git@host:owner/repo`; `C:/x` and `/x` are local paths.
  const scp = /^(?:[^@/]+@)?([^:/\\]{2,}):([^/\\].*)$/.exec(text)
  return scp ? scp[1].toLowerCase() : null
}

/**
 * Which forge's API can report the deploy status of `origin`: the `forge` setting for a
 * self-hosted server, otherwise a well-known host. `null` when neither applies.
 */
export function detectForge(url: string | null | undefined, setting: ForgeKind | '' = ''): ForgeKind | null {
  const host = remoteHost(url)
  if (!host) return null
  return setting || knownForge(host)
}

export function secretsUrl(repo: GitHubRepo): string {
  return `https://github.com/${repo.owner}/${repo.repo}/settings/secrets/actions`
}

export function actionsUrl(repo: GitHubRepo): string {
  return `https://github.com/${repo.owner}/${repo.repo}/actions`
}

/** Cloudflare Pages cuts branch aliases to this many characters. */
export const ALIAS_MAX_LENGTH = 28

/**
 * Cloudflare Pages' alias for a branch (the `<alias>.<project>.pages.dev` preview address), as
 * Cloudflare documents it: lower-cased, every character that is not a letter or digit replaced
 * by `-` (one `-` per character; runs are not merged), cut to 28 characters, then `-` trimmed
 * from both ends. `fix/api` → `fix-api`. Empty when nothing is left.
 */
export function branchAlias(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '-')
    .slice(0, ALIAS_MAX_LENGTH)
    .replace(/^-+|-+$/g, '')
}

export function cloudflarePreviewUrl(branch: string, project: string): string | null {
  const alias = branchAlias(branch)
  const name = project.trim().toLowerCase()
  if (!alias || !/^[a-z0-9][a-z0-9-]*$/.test(name)) return null
  return `https://${alias}.${name}.pages.dev/`
}

// ---------------------------------------------------------------------------
// Checks

export type DeployOutcome = 'none' | 'pending' | 'success' | 'failure'

const OK_CONCLUSIONS = ['success', 'neutral', 'skipped']

/** One verdict for all checks of a commit. */
export function aggregateChecks(checks: DeployCheck[]): DeployOutcome {
  if (checks.length === 0) return 'none'
  if (checks.some((c) => c.status === 'completed' && c.conclusion !== null && !OK_CONCLUSIONS.includes(c.conclusion))) {
    return 'failure'
  }
  if (checks.some((c) => c.status !== 'completed' || c.conclusion === null)) return 'pending'
  return 'success'
}

export type CheckHost = 'cloudflare' | 'githubPages' | 'netlify' | 'vercel' | 'actions' | 'gitlabPages' | 'gitlabCi' | 'ci'

/** Which host a check comes from, to label it. `forge` is where the repository lives. */
export function checkHost(check: DeployCheck, forge: ForgeKind = 'github'): CheckHost {
  const text = `${check.name} ${check.url ?? ''}`.toLowerCase()
  if (text.includes('cloudflare')) return 'cloudflare'
  if (text.includes('netlify')) return 'netlify'
  if (text.includes('vercel')) return 'vercel'
  if (forge === 'gitlab') return /^pages(:|$)/.test(check.name.toLowerCase()) ? 'gitlabPages' : 'gitlabCi'
  if (forge === 'gitea') return 'ci'
  if (/pages build and deployment|github-pages|github pages|\bpages\b/.test(text)) return 'githubPages'
  return 'actions'
}

// ---------------------------------------------------------------------------
// Live verification

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

const normalizeText = (text: string) => decodeEntities(text).replace(/\s+/g, ' ').trim()

/** The text of the page's `<title>`, decoded; `null` when there is none. */
export function extractTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? normalizeText(match[1]) : null
}

/** The page's title contains the expected one (themes add the site name around it). */
export function titleMatches(html: string, expected: string): boolean {
  const title = extractTitle(html)
  if (title === null) return false
  const want = normalizeText(expected)
  if (want === '') return true
  const variants = (s: string) => [s.toLowerCase(), s.toLocaleLowerCase('tr')]
  return variants(title).some((t) => variants(want).some((w) => t.includes(w)))
}

/** The page's address on the live site: its permalink, moved to `liveUrl`'s host when set. */
export function liveUrlFor(permalink: string, liveUrl?: string | null): string {
  if (!liveUrl?.trim()) return permalink
  try {
    const page = new URL(permalink)
    const live = new URL(liveUrl.trim())
    return `${live.origin}${page.pathname}${page.search}`
  } catch {
    return permalink
  }
}

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '')

/** Published pages among the files a commit changed. */
export function pagesForFiles(files: string[], pages: PageEntry[]): PageEntry[] {
  const changed = new Set(files.map(normalizePath))
  return pages.filter((p) => changed.has(normalizePath(p.path)) && !p.draft && !isFuture(p, new Date()))
}

/**
 * Pages behind the HTML files of a built-site commit (gh-pages): `posts/a/index.html` is the
 * page whose permalink path is `/posts/a/`. Files without a known page are matched by URL only.
 */
export function urlsForBuiltFiles(
  files: string[],
  pages: PageEntry[],
  base: string,
): { url: string; title: string | null }[] {
  let root: URL
  try {
    root = new URL(base)
  } catch {
    return []
  }
  const prefix = root.pathname.endsWith('/') ? root.pathname : `${root.pathname}/`
  const byPath = new Map<string, PageEntry>()
  for (const page of pages) {
    try {
      byPath.set(new URL(page.permalink).pathname, page)
    } catch {
      // Ignore pages without a usable permalink.
    }
  }
  return files
    .filter((f) => /(^|\/)index\.html$/.test(f))
    .map((f) => {
      const path = `${prefix}${f.replace(/index\.html$/, '')}`
      return { url: `${root.origin}${path}`, title: byPath.get(path)?.title ?? null }
    })
}

// ---------------------------------------------------------------------------
// Scheduled posts

function publishTime(page: PageEntry): number | null {
  for (const value of [page.publishDate, page.date]) {
    if (!value || value.startsWith('0001-')) continue
    const time = Date.parse(value)
    if (Number.isFinite(time)) return time
  }
  return null
}

function isFuture(page: PageEntry, now: Date): boolean {
  const time = publishTime(page)
  return time !== null && time > now.getTime()
}

/** Pages that will only appear after a future date (sorted by that date). */
export function futurePages(pages: PageEntry[], now = new Date()): { page: PageEntry; date: Date }[] {
  return pages
    .filter((p) => !p.draft && p.kind === 'page' && isFuture(p, now))
    .map((page) => ({ page, date: new Date(publishTime(page)!) }))
    .toSorted((a, b) => a.date.getTime() - b.date.getTime())
}

export const WORKFLOW_PATH = '.github/workflows/scheduled-rebuild.yml'

/**
 * A GitHub Actions workflow that asks the host to rebuild the site every day, so posts with a
 * future date appear on time. The deploy hook URL stays in the `DEPLOY_HOOK_URL` secret.
 */
export function scheduledWorkflowYaml({ hourUtc = 0, minute = 5 }: { hourUtc?: number; minute?: number } = {}): string {
  const hour = Math.min(23, Math.max(0, Math.trunc(hourUtc)))
  const min = Math.min(59, Math.max(0, Math.trunc(minute)))
  return [
    '# Rebuilds the site every day so posts with a future date are published on time.',
    '# Static hosts only build when something is pushed; this calls the host\'s deploy hook.',
    '# The hook URL is kept in the repository secret DEPLOY_HOOK_URL',
    '# (Settings → Secrets and variables → Actions). Created by Hugo Publisher.',
    'name: Scheduled rebuild',
    '',
    'on:',
    '  schedule:',
    `    - cron: '${min} ${hour} * * *'`,
    '  workflow_dispatch:',
    '',
    'permissions: {}',
    '',
    'jobs:',
    '  rebuild:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Call the deploy hook',
    '        env:',
    '          DEPLOY_HOOK_URL: ${{ secrets.DEPLOY_HOOK_URL }}',
    '        run: |',
    '          if [ -z "$DEPLOY_HOOK_URL" ]; then',
    '            echo "::error::The DEPLOY_HOOK_URL secret is not set."',
    '            exit 1',
    '          fi',
    '          curl --fail --silent --show-error --max-time 60 -X POST "$DEPLOY_HOOK_URL"',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Messages and names

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD HH:MM` in local time, for publish commit messages. */
export function formatStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const PREVIEW_PREFIX = 'preview/'

/** `preview/<slug>` from what the user typed. */
export function previewBranch(slug: string): string | null {
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return clean ? `${PREVIEW_PREFIX}${clean}` : null
}
