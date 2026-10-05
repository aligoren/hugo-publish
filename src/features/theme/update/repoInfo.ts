// GitHub lookups for theme updates: default branch, the commit a reference points to, and tags.
// Everything here is optional: offline or rate-limited, the update flow works without it.
import { useEffect, useState } from 'react'

import { api } from '../../../lib/api'

export interface RepoInfo {
  defaultBranch: string
  commit: string
  /** Newest first. */
  tags: string[]
}

export type RepoLookup = { ok: true; info: RepoInfo } | { ok: false; error: unknown }

function versionParts(tag: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)/i.exec(tag.trim())
  return m ? m[1].split('.').map(Number) : null
}

/** Version tags newest first (v8.0 > v7.10 > v7.2); other tags keep GitHub's order, after them. */
export function sortTagsNewestFirst(tags: string[]): string[] {
  const indexed = tags.map((tag, index) => ({ tag, index, parts: versionParts(tag) }))
  return indexed
    .sort((a, b) => {
      if (a.parts && b.parts) {
        for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
          const d = (b.parts[i] ?? 0) - (a.parts[i] ?? 0)
          if (d !== 0) return d
        }
        // A plain release sorts before its pre-releases (v1.0 before v1.0-rc1).
        return a.tag.length - b.tag.length || a.index - b.index
      }
      if (a.parts) return -1
      if (b.parts) return 1
      return a.index - b.index
    })
    .map((x) => x.tag)
}

export function shortSha(sha: string | undefined | null): string {
  return sha ? sha.slice(0, 7) : ''
}

export async function lookupRepo(owner: string, repo: string, reference?: string): Promise<RepoLookup> {
  try {
    const info = await api.themeRepoInfo(owner, repo, reference?.trim() || null)
    return { ok: true, info: { ...info, tags: sortTagsNewestFirst(info.tags) } }
  } catch (error) {
    return { ok: false, error }
  }
}

/** Tags of a repository for a reference picker; `failed` when GitHub could not be reached. */
export function useRepoTags(repo: { owner: string; repo: string } | null): { tags: string[]; failed: boolean; defaultBranch: string | null } {
  const key = repo ? `${repo.owner}/${repo.repo}` : ''
  const [state, setState] = useState<{ key: string; tags: string[]; failed: boolean; defaultBranch: string | null } | null>(null)
  useEffect(() => {
    if (!key) return
    let cancelled = false
    const [owner, name] = key.split('/')
    // Wait a moment so typing a URL does not fire a request per keystroke.
    const timer = setTimeout(() => {
      void lookupRepo(owner, name).then((result) => {
        if (cancelled) return
        setState(result.ok ? { key, tags: result.info.tags, failed: false, defaultBranch: result.info.defaultBranch } : { key, tags: [], failed: true, defaultBranch: null })
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key])
  return state && state.key === key ? state : { tags: [], failed: false, defaultBranch: null }
}

/** `github.com/owner/repo[/vN]` → the repository and the module's major version (0/1 without a suffix). */
export function githubModule(path: string): { owner: string; repo: string; major: number | null } | null {
  const m = /^github\.com\/([\w.-]+)\/([\w.-]+?)(?:\/v(\d+))?$/i.exec(path.trim())
  return m ? { owner: m[1], repo: m[2], major: m[3] ? Number(m[3]) : null } : null
}

/**
 * Tags `go get` can use for a module path: semantic versions of its major version (v2+ needs the
 * `/vN` suffix; without it v0 and v1). Newest first.
 */
export function moduleTags(tags: string[], major: number | null): string[] {
  return sortTagsNewestFirst(tags).filter((tag) => {
    const m = /^v(\d+)\.\d+\.\d+(?:[-+][\w.-]+)?$/.exec(tag)
    if (!m) return false
    const tagMajor = Number(m[1])
    return major === null ? tagMajor <= 1 : tagMajor === major
  })
}
