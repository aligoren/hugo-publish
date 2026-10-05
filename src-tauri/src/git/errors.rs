//! Git failures the UI can explain.
//!
//! A git failure travels as [`AppError::Git`]: its serialized `code` is a stable `git_*` code
//! (e.g. `git_conflict`) and its message is git's own output. The Publish view shows a
//! translated explanation for the code.

use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitErrorKind {
    /// No `git` binary was found.
    NotFound,
    /// Git did not finish in time.
    Timeout,
    /// Git refuses to work in a folder owned by another user (`safe.directory`).
    UnsafeRepository,
    /// The site folder is not inside a git repository.
    NotRepo,
    EmptyMessage,
    NothingToCommit,
    /// `user.name` / `user.email` are not set.
    NoIdentity,
    /// The branch does not track a remote branch.
    NoUpstream,
    /// There is no `origin` remote to push to.
    NoRemote,
    /// HEAD is not on a branch.
    Detached,
    /// A merge or rebase stopped with conflicts, or one is still unresolved.
    Conflict,
    /// The remote has commits this branch lacks; pull first.
    Rejected,
    /// The remote refused the credentials (or none could be asked for).
    Auth,
    /// The remote could not be reached.
    Network,
    /// Anything else; the detail holds git's own output.
    Failed,
}

impl GitErrorKind {
    pub fn code(self) -> &'static str {
        match self {
            GitErrorKind::NotFound => "git_not_found",
            GitErrorKind::Timeout => "git_timeout",
            GitErrorKind::UnsafeRepository => "git_unsafe_repository",
            GitErrorKind::NotRepo => "git_not_repo",
            GitErrorKind::EmptyMessage => "git_empty_message",
            GitErrorKind::NothingToCommit => "git_nothing_to_commit",
            GitErrorKind::NoIdentity => "git_no_identity",
            GitErrorKind::NoUpstream => "git_no_upstream",
            GitErrorKind::NoRemote => "git_no_remote",
            GitErrorKind::Detached => "git_detached",
            GitErrorKind::Conflict => "git_conflict",
            GitErrorKind::Rejected => "git_rejected",
            GitErrorKind::Auth => "git_auth",
            GitErrorKind::Network => "git_network",
            GitErrorKind::Failed => "git_failed",
        }
    }
}

/// Longest git output kept in an error message.
const MAX_DETAIL: usize = 8_000;

pub fn git_error(kind: GitErrorKind, detail: impl AsRef<str>) -> AppError {
    let detail = detail.as_ref().trim();
    let detail = if detail.len() > MAX_DETAIL {
        let mut start = detail.len() - MAX_DETAIL;
        while !detail.is_char_boundary(start) {
            start += 1;
        }
        format!("…{}", &detail[start..])
    } else {
        detail.to_string()
    };
    AppError::Git {
        code: kind.code(),
        detail,
    }
}

/// The `git_*` code of an error made by [`git_error`].
pub fn git_error_code(error: &AppError) -> Option<&str> {
    match error {
        AppError::Git { code, .. } => Some(code),
        // The older form, `git_xxx: detail` inside `Invalid`.
        AppError::Invalid(message) => {
            let code = message.split(':').next()?;
            (code.starts_with("git_") && !code.contains(' ')).then_some(code)
        }
        _ => None,
    }
}

/// Guesses why a git command failed from its output (git runs with English messages).
pub fn classify(output: &str) -> GitErrorKind {
    let has = |needle: &str| output.contains(needle);
    let lower = output.to_ascii_lowercase();
    if has("not a git repository") {
        GitErrorKind::NotRepo
    } else if has("dubious ownership") {
        GitErrorKind::UnsafeRepository
    } else if has("Please tell me who you are")
        || has("empty ident name")
        || has("unable to auto-detect email address")
    {
        GitErrorKind::NoIdentity
    } else if has("CONFLICT")
        || has("could not apply")
        || has("unmerged files")
        || has("Unmerged paths")
        || has("you need to resolve your current index first")
        || has("resulted in conflicts")
    {
        GitErrorKind::Conflict
    } else if has("[rejected]")
        || has("non-fast-forward")
        || has("(fetch first)")
        || has("Updates were rejected")
    {
        GitErrorKind::Rejected
    } else if has("Authentication failed")
        || has("could not read Username")
        || has("could not read Password")
        || has("terminal prompts disabled")
        || has("Permission denied (publickey")
        || has("Host key verification failed")
        || lower.contains("the requested url returned error: 401")
        || lower.contains("the requested url returned error: 403")
    {
        GitErrorKind::Auth
    } else if has("Could not resolve host")
        || has("unable to access")
        || has("Connection timed out")
        || has("Connection refused")
        || has("Could not read from remote repository")
    {
        GitErrorKind::Network
    } else if has("no tracking information") || has("has no upstream branch") {
        GitErrorKind::NoUpstream
    } else {
        GitErrorKind::Failed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_round_trip() {
        let error = git_error(GitErrorKind::Conflict, "CONFLICT (content): a.md\n");
        assert_eq!(git_error_code(&error), Some("git_conflict"));
        assert_eq!(error.to_string(), "CONFLICT (content): a.md");
        // The UI receives the git code as the error code.
        let serialized = serde_json::to_value(&error).unwrap();
        assert_eq!(serialized["code"], "git_conflict");
        assert_eq!(serialized["message"], "CONFLICT (content): a.md");
        // The older `Invalid` form is still understood.
        assert_eq!(
            git_error_code(&AppError::Invalid("git_rejected: x".into())),
            Some("git_rejected")
        );
        assert_eq!(
            git_error_code(&AppError::Invalid("bad: thing".into())),
            None
        );
        assert_eq!(git_error_code(&AppError::NoSite), None);
    }

    #[test]
    fn long_details_keep_the_end() {
        let detail = format!("{}ğ son satır", "x".repeat(MAX_DETAIL * 2));
        let message = git_error(GitErrorKind::Failed, &detail).to_string();
        assert!(message.ends_with("ğ son satır"));
        assert!(message.len() < MAX_DETAIL + 64);
    }

    #[test]
    fn classifies_common_failures() {
        let cases = [
            (
                "fatal: not a git repository (or any of the parent directories): .git",
                GitErrorKind::NotRepo,
            ),
            (
                "fatal: detected dubious ownership in repository at 'D:/x'",
                GitErrorKind::UnsafeRepository,
            ),
            (
                "Author identity unknown\n\n*** Please tell me who you are.",
                GitErrorKind::NoIdentity,
            ),
            (
                "CONFLICT (content): Merge conflict in a.md\nerror: could not apply 1234abc... x",
                GitErrorKind::Conflict,
            ),
            (
                " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs",
                GitErrorKind::Rejected,
            ),
            (
                "fatal: Authentication failed for 'https://github.com/x/y.git/'",
                GitErrorKind::Auth,
            ),
            (
                "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
                GitErrorKind::Auth,
            ),
            (
                "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
                GitErrorKind::Auth,
            ),
            (
                "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com",
                GitErrorKind::Network,
            ),
            (
                "There is no tracking information for the current branch.",
                GitErrorKind::NoUpstream,
            ),
            ("error: something odd", GitErrorKind::Failed),
        ];
        for (output, kind) in cases {
            assert_eq!(classify(output), kind, "{output}");
        }
    }
}
