import { describe, expect, it } from 'vitest'

import type { PageEntry } from '../../lib/api'
import {
  aggregateChecks,
  ALIAS_MAX_LENGTH,
  branchAlias,
  checkHost,
  cloudflarePreviewUrl,
  decodeEntities,
  detectForge,
  extractTitle,
  formatStamp,
  futurePages,
  knownForge,
  liveUrlFor,
  pagesForFiles,
  parseGitHubRemote,
  previewBranch,
  remoteHost,
  scheduledWorkflowYaml,
  secretsUrl,
  titleMatches,
  urlsForBuiltFiles,
} from './deploy'
import type { DeployCheck } from './deployApi'

function page(path: string, overrides: Partial<PageEntry> = {}): PageEntry {
  const slug = path.replace(/^content\//, '').replace(/(\/index)?\.md$/, '')
  return {
    path,
    slug,
    title: slug,
    date: '2026-01-01T00:00:00Z',
    expiryDate: '',
    publishDate: '2026-01-01T00:00:00Z',
    draft: false,
    permalink: `https://example.org/${slug}/`,
    kind: 'page',
    section: slug.split('/')[0],
    ...overrides,
  }
}

const check = (status: string, conclusion: string | null, name = 'x'): DeployCheck => ({ name, status, conclusion, url: null })

describe('parseGitHubRemote', () => {
  it('reads https, ssh and scp-like github.com remotes', () => {
    for (const url of [
      'https://github.com/ali/blog.git',
      'https://github.com/ali/blog',
      'https://token@github.com/ali/blog/',
      'git@github.com:ali/blog.git',
      'ssh://git@github.com/ali/blog.git',
      'ssh://git@ssh.github.com:443/ali/blog.git',
      ' HTTPS://GitHub.com/ali/blog.git ',
    ]) {
      expect(parseGitHubRemote(url), url).toEqual({ owner: 'ali', repo: 'blog' })
    }
    for (const url of ['https://gitlab.com/ali/blog.git', 'git@codeberg.org:ali/blog.git', 'https://github.com/ali', 'D:/r/blog.git', '', null]) {
      expect(parseGitHubRemote(url), String(url)).toBeNull()
    }
    expect(secretsUrl({ owner: 'ali', repo: 'blog' })).toBe('https://github.com/ali/blog/settings/secrets/actions')
  })
})

describe('forge detection', () => {
  it('recognises GitHub, GitLab and Gitea/Forgejo hosts', () => {
    expect(detectForge('git@github.com:ali/blog.git')).toBe('github')
    expect(detectForge('https://gitlab.com/group/sub/blog.git')).toBe('gitlab')
    expect(detectForge('ssh://git@gitlab.example.org:2222/a/b.git')).toBe('gitlab')
    expect(detectForge('git@codeberg.org:ali/blog.git')).toBe('gitea')
    expect(detectForge('https://forgejo.example.net/ali/blog')).toBe('gitea')
    expect(knownForge('salsa.debian.org')).toBe('gitlab')
    expect(knownForge('example.org')).toBeNull()
  })

  it('uses the setting for self-hosted servers', () => {
    expect(detectForge('https://git.example.org/team/blog.git')).toBeNull()
    expect(detectForge('https://git.example.org/team/blog.git', 'gitea')).toBe('gitea')
    expect(detectForge('https://gitlab.example.org/team/blog.git', 'gitea')).toBe('gitea')
    expect(detectForge('D:/repos/blog.git', 'gitlab')).toBeNull()
    expect(detectForge(null, 'gitlab')).toBeNull()
    expect(remoteHost('https://user:pw@Git.Example.org:8443/a/b')).toBe('git.example.org')
    expect(remoteHost('file:///srv/blog.git')).toBeNull()
    expect(remoteHost('/srv/blog.git')).toBeNull()
  })
})

describe('Cloudflare branch previews', () => {
  it('makes branch aliases like Cloudflare Pages', () => {
    expect(branchAlias('preview/İlk_Yazı')).toBe('preview-i-lk-yaz')
    expect(branchAlias('preview/ilk-yazi')).toBe('preview-ilk-yazi')
    expect(branchAlias('Feature/ABC.def')).toBe('feature-abc-def')
    expect(branchAlias('preview/a-very-long-branch-name-for-testing')).toBe('preview-a-very-long-branch-n')
    expect(branchAlias('--x--')).toBe('x')
    expect(cloudflarePreviewUrl('preview/ilk-yazi', 'Benim-Blog')).toBe('https://preview-ilk-yazi.benim-blog.pages.dev/')
    expect(cloudflarePreviewUrl('preview/x', 'bad name')).toBeNull()
  })

  it('follows each documented rule', () => {
    // Lower case; Cloudflare's own example: fix/api → fix-api.
    expect(branchAlias('main')).toBe('main')
    expect(branchAlias('MAIN')).toBe('main')
    expect(branchAlias('fix/api')).toBe('fix-api')
    // Every non-alphanumeric character becomes one dash; runs are kept, not merged.
    expect(branchAlias('a_b.c+d@e')).toBe('a-b-c-d-e')
    expect(branchAlias('a..b//c')).toBe('a--b--c')
    expect(branchAlias('Çiçek/şu')).toBe('i-ek--u')
    expect(branchAlias('feat/🚀-launch')).toBe('feat---launch')
    // At most 28 characters, cut before trimming.
    expect(ALIAS_MAX_LENGTH).toBe(28)
    expect(branchAlias('a'.repeat(28))).toBe('a'.repeat(28))
    expect(branchAlias('a'.repeat(40))).toBe('a'.repeat(28))
    expect(branchAlias('dependabot/npm_and_yarn/hugo-0.140.0')).toBe('dependabot-npm-and-yarn-hugo')
    expect(branchAlias(`${'b'.repeat(26)}/-x`)).toBe('b'.repeat(26))
    expect(branchAlias(`_${'c'.repeat(30)}`)).toBe('c'.repeat(27))
    // Trimmed at both ends; nothing left means no alias.
    expect(branchAlias('-release-')).toBe('release')
    expect(branchAlias('___')).toBe('')
    expect(cloudflarePreviewUrl('___', 'blog')).toBeNull()
    for (const branch of ['preview/İlk_Yazı', 'x/'.repeat(30), 'Ünlü/çiçek 2026', '🚀🚀']) {
      const alias = branchAlias(branch)
      expect(alias.length).toBeLessThanOrEqual(28)
      expect(alias).toMatch(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?)?$/)
    }
  })

  it('names preview branches safely', () => {
    expect(previewBranch('Ilk yazi -- taslak')).toBe('preview/ilk-yazi-taslak')
    expect(previewBranch('  ')).toBeNull()
    expect(previewBranch('../x')).toBe('preview/x')
  })
})

describe('aggregateChecks', () => {
  it('combines check results into one verdict', () => {
    expect(aggregateChecks([])).toBe('none')
    expect(aggregateChecks([check('completed', 'success'), check('completed', 'skipped')])).toBe('success')
    expect(aggregateChecks([check('completed', 'success'), check('in_progress', null)])).toBe('pending')
    expect(aggregateChecks([check('queued', null), check('completed', 'failure')])).toBe('failure')
    expect(aggregateChecks([check('completed', 'cancelled')])).toBe('failure')
    expect(aggregateChecks([check('completed', 'neutral')])).toBe('success')
  })

  it('labels hosts', () => {
    expect(checkHost(check('completed', 'success', 'Cloudflare Pages'))).toBe('cloudflare')
    expect(checkHost(check('completed', 'success', 'pages build and deployment'))).toBe('githubPages')
    expect(checkHost(check('completed', 'success', 'netlify/blog/deploy-preview'))).toBe('netlify')
    expect(checkHost(check('completed', 'success', 'build'))).toBe('actions')
    expect(checkHost(check('completed', 'success', 'pages'), 'gitlab')).toBe('gitlabPages')
    expect(checkHost(check('completed', 'success', 'pages:deploy'), 'gitlab')).toBe('gitlabPages')
    expect(checkHost(check('completed', 'success', 'pipeline #3 (main)'), 'gitlab')).toBe('gitlabCi')
    expect(checkHost(check('completed', 'success', 'netlify/blog/deploy-preview'), 'gitlab')).toBe('netlify')
    expect(checkHost(check('completed', 'success', 'ci/woodpecker/push/pages'), 'gitea')).toBe('ci')
  })
})

describe('live verification', () => {
  it('extracts and matches titles', () => {
    const html = '<html><head><TITLE>\n  İlk yazı: &quot;Merhaba&quot; &amp; d&#252;nya &#x1F600; | Blog</TITLE></head></html>'
    expect(extractTitle(html)).toBe('İlk yazı: "Merhaba" & dünya 😀 | Blog')
    expect(titleMatches(html, 'İlk yazı: "Merhaba" & dünya')).toBe(true)
    expect(titleMatches(html, 'ilk YAZI')).toBe(true)
    expect(titleMatches(html, 'Başka yazı')).toBe(false)
    expect(titleMatches('<p>no title</p>', 'x')).toBe(false)
    expect(decodeEntities('&unknown; &#99999999;')).toBe('&unknown; &#99999999;')
  })

  it('moves permalinks to the live address', () => {
    expect(liveUrlFor('http://localhost:1313/yazi/?a=1', 'https://example.com/')).toBe('https://example.com/yazi/?a=1')
    expect(liveUrlFor('https://example.org/yazi/', '')).toBe('https://example.org/yazi/')
    expect(liveUrlFor('not a url', 'https://x.org')).toBe('not a url')
  })

  it('finds the published pages a commit changed', () => {
    const pages = [page('content/posts/a.md'), page('content/posts/b.md', { draft: true }), page('content/posts/c.md', { publishDate: '2999-01-01T00:00:00Z' })]
    expect(pagesForFiles(['content/posts/a.md', 'content/posts/b.md', 'content/posts/c.md', 'hugo.toml'], pages).map((p) => p.path)).toEqual([
      'content/posts/a.md',
    ])
  })

  it('maps built HTML files to live URLs and titles', () => {
    const pages = [page('content/posts/a.md', { permalink: 'https://u.github.io/blog/posts/a/', title: 'A yazısı' })]
    expect(urlsForBuiltFiles(['index.html', 'posts/a/index.html', 'css/x.css', 'posts/b/index.html'], pages, 'https://u.github.io/blog/')).toEqual([
      { url: 'https://u.github.io/blog/', title: null },
      { url: 'https://u.github.io/blog/posts/a/', title: 'A yazısı' },
      { url: 'https://u.github.io/blog/posts/b/', title: null },
    ])
    expect(urlsForBuiltFiles(['index.html'], [], 'nope')).toEqual([])
  })
})

describe('scheduled posts', () => {
  const now = new Date('2026-10-04T12:00:00Z')

  it('finds future-dated, non-draft pages in date order', () => {
    const pages = [
      page('content/posts/later.md', { publishDate: '2026-12-01T09:00:00+03:00' }),
      page('content/posts/soon.md', { publishDate: '2026-10-05T09:00:00+03:00' }),
      page('content/posts/past.md'),
      page('content/posts/draft.md', { draft: true, publishDate: '2026-11-01T00:00:00Z' }),
      page('content/posts/by-date.md', { publishDate: '0001-01-01T00:00:00Z', date: '2026-10-10T00:00:00Z' }),
      page('content/posts/_index.md', { kind: 'section', publishDate: '2027-01-01T00:00:00Z' }),
    ]
    expect(futurePages(pages, now).map((f) => f.page.path)).toEqual(['content/posts/soon.md', 'content/posts/by-date.md', 'content/posts/later.md'])
  })

  it('generates the rebuild workflow', () => {
    const yaml = scheduledWorkflowYaml({ hourUtc: 6 })
    expect(yaml).toContain("    - cron: '5 6 * * *'")
    expect(yaml).toContain('  workflow_dispatch:')
    expect(yaml).toContain('DEPLOY_HOOK_URL: ${{ secrets.DEPLOY_HOOK_URL }}')
    expect(yaml).toContain('curl --fail --silent --show-error --max-time 60 -X POST "$DEPLOY_HOOK_URL"')
    expect(yaml).not.toContain('\t')
    expect(yaml.endsWith('\n')).toBe(true)
    expect(scheduledWorkflowYaml({ hourUtc: 99, minute: -3 })).toContain("cron: '0 23 * * *'")
  })
})

describe('formatStamp', () => {
  it('formats local date and time', () => {
    expect(formatStamp(new Date(2026, 9, 4, 7, 5))).toBe('2026-10-04 07:05')
  })
})
