// Test helpers for the Publish feature.

import type { GitFile, GitStatus } from '../../lib/api'

const LETTERS: Record<GitFile['kind'], [string, string]> = {
  modified: ['.', 'M'],
  added: ['A', '.'],
  deleted: ['.', 'D'],
  renamed: ['R', '.'],
  untracked: ['?', '?'],
  conflicted: ['U', 'U'],
  typechange: ['.', 'T'],
}

export function gitFile(path: string, kind: GitFile['kind'] = 'modified', origPath: string | null = null): GitFile {
  return { path, origPath, index: LETTERS[kind][0], worktree: LETTERS[kind][1], kind }
}

export function gitStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    isRepo: true,
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    files: [],
    userName: 'Yazar',
    userEmail: '1+yazar@users.noreply.github.com',
    remoteUrl: 'https://github.com/yazar/blog.git',
    ...overrides,
  }
}
