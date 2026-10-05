// Typed wrappers for the deploy commands in src-tauri/src/git/deploy/commands.rs.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { GitResult } from '../../lib/api'

export type DeployStage = 'build' | 'prepare' | 'copy' | 'commit' | 'push' | 'cleanup' | 'done'

export interface DeployProgress {
  stage: DeployStage
  /** English detail (file counts, branch). */
  detail: string
}

export interface GhPagesResult {
  branch: string
  /** Short id of the new commit on the branch; `null` when nothing changed. */
  commit: string | null
  pushed: boolean
  upToDate: boolean
  files: number
  output: string
}

export interface DeployCheck {
  name: string
  /** queued | in_progress | completed */
  status: string
  conclusion: string | null
  url: string | null
}

/** Where `origin` lives; `gitea` also stands for Forgejo (Codeberg). */
export type ForgeKind = 'github' | 'gitlab' | 'gitea'

export interface DeployStatus {
  /** User or group (GitLab: the whole namespace, `group/subgroup`). */
  owner: string
  repo: string
  sha: string
  checks: DeployCheck[]
  source: 'gh' | 'api'
  /** Private repository: no signed-in `gh` (GitHub), or a GitLab/Gitea project read anonymously. */
  needsAuth: boolean
  forge: ForgeKind
}

export interface CommitFiles {
  sha: string
  /** Site-relative paths the commit changed. */
  files: string[]
}

export const DEPLOY_PROGRESS_EVENT = 'deploy-progress'

export const deployApi = {
  /** Builds the site and publishes it to `branch` (e.g. `gh-pages`). */
  ghPages: (branch: string, message: string) => invoke<GhPagesResult>('deploy_gh_pages', { branch, message }),
  /**
   * Check runs, statuses and pipelines of `rev` (default `HEAD`) from the forge of `origin`
   * (GitHub, GitLab, Gitea/Forgejo; `[deploy] forge` in the site settings for self-hosted ones).
   */
  status: (rev?: string) => invoke<DeployStatus>('deploy_status', { rev }),
  commitFiles: (rev?: string) => invoke<CommitFiles>('deploy_commit_files', { rev }),
  /** Pushes `HEAD` to `origin` as `preview/<name>`. */
  previewPush: (branch: string) => invoke<GitResult>('deploy_preview_push', { branch }),
  previewDelete: (branch: string) => invoke<GitResult>('deploy_preview_delete', { branch }),
  previewList: () => invoke<string[]>('deploy_preview_list'),
  onProgress: (handler: (progress: DeployProgress) => void): Promise<UnlistenFn> =>
    listen<DeployProgress>(DEPLOY_PROGRESS_EVENT, (event) => handler(event.payload)),
}
