// Git failures from the Rust side: `AppError { code: 'invalid', message: 'git_conflict: <output>' }`
// today, or a dedicated `code: 'git_conflict'` should AppError get a git variant.

import { isAppError } from '../../lib/api'

export const GIT_ERROR_CODES = [
  'git_not_found',
  'git_timeout',
  'git_unsafe_repository',
  'git_not_repo',
  'git_empty_message',
  'git_nothing_to_commit',
  'git_no_identity',
  'git_no_upstream',
  'git_no_remote',
  'git_detached',
  'git_conflict',
  'git_rejected',
  'git_auth',
  'git_network',
  'git_failed',
] as const

export type GitErrorCode = (typeof GIT_ERROR_CODES)[number]

export interface GitError {
  code: GitErrorCode
  /** Git's own output, for the details. */
  detail: string
}

export function gitError(error: unknown): GitError | null {
  if (!isAppError(error)) return null
  if (isGitCode(error.code)) return { code: error.code, detail: error.message.replace(/^git_[a-z_]+: /, '') }
  const match = /^(git_[a-z_]+): ?([\s\S]*)$/.exec(error.message)
  if (error.code === 'invalid' && match && isGitCode(match[1])) return { code: match[1], detail: match[2] }
  return null
}

function isGitCode(code: string): code is GitErrorCode {
  return (GIT_ERROR_CODES as readonly string[]).includes(code)
}
