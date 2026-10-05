//! Git operations on a site folder. The Tauri commands in [`super::commands`] are thin wrappers
//! around these, so they can be tested against real repositories.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

use super::errors::{GitErrorKind, git_error, git_error_code};
use super::runner::{Git, LONG_TIMEOUT, write_lock};
use super::status::{GitFileKind, GitStatus, Porcelain, parse_porcelain_v2, redact_remote_url};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitResult {
    /// Combined git output, for showing to the user.
    pub output: String,
}

/// Longest diff returned to the UI; larger diffs are cut at a line break.
const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
/// Marker line appended to a cut diff (a `\` line, like git's "No newline" notes).
pub const DIFF_TRUNCATED: &str = "\\ (diff truncated)";

/// Status of the repository the site folder belongs to, limited to the site folder.
/// A folder outside any repository gives `is_repo: false` rather than an error.
pub async fn status(root: &Path) -> AppResult<GitStatus> {
    let Some(porcelain) = porcelain(root, true).await? else {
        return Ok(GitStatus::not_a_repo());
    };
    let remote = porcelain
        .upstream
        .as_deref()
        .and_then(|upstream| upstream.split_once('/'))
        .map_or("origin", |(remote, _)| remote)
        .to_string();
    let (user_name, user_email, remote_url) = tokio::join!(
        config_value(root, "user.name"),
        config_value(root, "user.email"),
        remote_url(root, &remote),
    );
    Ok(GitStatus {
        is_repo: true,
        branch: porcelain.branch,
        upstream: porcelain.upstream,
        ahead: porcelain.ahead,
        behind: porcelain.behind,
        files: porcelain.files,
        user_name: user_name?,
        user_email: user_email?,
        remote_url: remote_url?.map(|url| redact_remote_url(&url)),
    })
}

/// Unified diff of one file against HEAD (staged and unstaged changes together). Untracked files
/// show as entirely added; a repository without commits diffs against the empty tree.
pub async fn diff(root: &Path, path: &str) -> AppResult<String> {
    let path = repo_path(path)?;
    // The whole folder, not just `path`: a rename is only seen with both of its sides.
    let porcelain = porcelain(root, true).await?.ok_or_else(not_a_repo)?;
    let entry = porcelain.files.iter().find(|f| f.path == path);
    let output = if entry.is_some_and(|f| f.kind == GitFileKind::Untracked) {
        // Exit code 1 means "the files differ", which is the point.
        let output = Git::new(root)
            .args(["diff", "--no-index", "--no-color", "--no-ext-diff"])
            .args(["--src-prefix=a/", "--dst-prefix=b/", "--", "/dev/null"])
            .arg(&path)
            .read_only()
            .output()
            .await?;
        if !output.success && output.stdout.is_empty() {
            return Err(output.failure());
        }
        output
    } else {
        let base = if porcelain.has_commits {
            "HEAD".to_string()
        } else {
            empty_tree(root).await?
        };
        let mut git = Git::new(root)
            .args(["diff", "--no-color", "--no-ext-diff", "-M"])
            .args(["--src-prefix=a/", "--dst-prefix=b/"])
            .arg(base)
            .arg("--")
            .arg(&path);
        if let Some(orig) = entry.and_then(|f| f.orig_path.as_deref()) {
            git = git.arg(orig);
        }
        git.read_only().literal_pathspecs().run().await?
    };
    Ok(limit_diff(
        String::from_utf8_lossy(&output.stdout).into_owned(),
    ))
}

/// Stages `paths` (everything in the site folder when empty) and commits exactly those paths
/// with `message`. Returns the new commit's short hash. Hooks run as usual.
pub async fn commit(root: &Path, message: &str, paths: &[String]) -> AppResult<String> {
    if message.trim().is_empty() {
        return Err(git_error(
            GitErrorKind::EmptyMessage,
            "the commit message is empty",
        ));
    }
    let paths = paths
        .iter()
        .map(|p| repo_path(p))
        .collect::<AppResult<Vec<_>>>()?;
    let _lock = write_lock().await;

    let before = porcelain(root, false).await?.ok_or_else(not_a_repo)?;
    ensure_no_conflicts(root, &before).await?;

    let to_stage = if paths.is_empty() {
        vec![".".to_string()]
    } else {
        stageable(root, &paths).await?
    };
    if !to_stage.is_empty() {
        Git::new(root)
            .args(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"])
            .stdin(nul_separated(&to_stage))
            .literal_pathspecs()
            .run()
            .await?;
    }

    let after = porcelain(root, false).await?.ok_or_else(not_a_repo)?;
    let wanted: HashSet<&str> = paths.iter().map(String::as_str).collect();
    let anything_staged = after.files.iter().any(|f| {
        f.kind != GitFileKind::Untracked
            && f.index != "."
            && (wanted.is_empty()
                || wanted.contains(f.path.as_str())
                || f.orig_path.as_deref().is_some_and(|o| wanted.contains(o)))
    });
    if !anything_staged {
        return Err(git_error(
            GitErrorKind::NothingToCommit,
            "there are no changes to commit in the chosen files",
        ));
    }

    // Only the chosen paths go into the commit, even if other files were staged before.
    let spec = if paths.is_empty() {
        vec![".".to_string()]
    } else {
        paths
    };
    let spec_file = TempFile::create("pathspec", &nul_separated(&spec))?;
    let mut message = message.to_string();
    if !message.ends_with('\n') {
        message.push('\n');
    }
    Git::new(root)
        .args(["commit", "-F", "-"])
        .arg(format!("--pathspec-from-file={}", spec_file.path.display()))
        .arg("--pathspec-file-nul")
        .stdin(message)
        .literal_pathspecs()
        .timeout(LONG_TIMEOUT)
        .run()
        .await?;
    drop(spec_file);

    let hash = Git::new(root)
        .args(["rev-parse", "--short", "HEAD"])
        .read_only()
        .run()
        .await?;
    Ok(hash.stdout_text().trim().to_string())
}

/// `git pull --rebase --autostash` from the upstream branch. Conflicts are reported, not
/// resolved: the repository is left as git left it, for the user to finish or abort.
pub async fn pull(root: &Path) -> AppResult<GitResult> {
    let _lock = write_lock().await;
    let porcelain = porcelain(root, false).await?.ok_or_else(not_a_repo)?;
    // Checked first: HEAD is detached while a rebase waits for conflicts to be resolved.
    ensure_no_conflicts(root, &porcelain).await?;
    if porcelain.branch.is_none() {
        return Err(detached());
    }
    if porcelain.upstream.is_none() {
        return Err(git_error(
            GitErrorKind::NoUpstream,
            "the current branch does not track a remote branch",
        ));
    }
    let output = Git::new(root)
        .args(["pull", "--rebase", "--autostash"])
        .timeout(LONG_TIMEOUT)
        .output()
        .await?;
    let text = output.combined();
    if !output.success {
        if operation_in_progress(root).await? {
            return Err(git_error(GitErrorKind::Conflict, text));
        }
        return Err(output.failure());
    }
    // The pull worked, but putting the user's own uncommitted changes back did not.
    if text.contains("resulted in conflicts") {
        return Err(git_error(GitErrorKind::Conflict, text));
    }
    Ok(GitResult { output: text })
}

/// `git push`; a branch without upstream is pushed with `-u origin <branch>`. Never forces.
pub async fn push(root: &Path) -> AppResult<GitResult> {
    let _lock = write_lock().await;
    let porcelain = porcelain(root, false).await?.ok_or_else(not_a_repo)?;
    ensure_no_conflicts(root, &porcelain).await?;
    let Some(branch) = porcelain.branch else {
        return Err(detached());
    };
    if !porcelain.has_commits {
        return Err(git_error(
            GitErrorKind::NothingToCommit,
            "the repository has no commits to push yet",
        ));
    }
    let git = if porcelain.upstream.is_some() {
        Git::new(root).arg("push")
    } else {
        if remote_url(root, "origin").await?.is_none() {
            return Err(git_error(
                GitErrorKind::NoRemote,
                "there is no remote named origin",
            ));
        }
        Git::new(root).args(["push", "-u", "origin"]).arg(branch)
    };
    let output = git.timeout(LONG_TIMEOUT).run().await?;
    Ok(GitResult {
        output: output.combined(),
    })
}

/// `git fetch`, so the ahead/behind counts in [`status`] are current.
pub async fn fetch(root: &Path) -> AppResult<GitResult> {
    let _lock = write_lock().await;
    let output = Git::new(root)
        .arg("fetch")
        .timeout(LONG_TIMEOUT)
        .run()
        .await?;
    Ok(GitResult {
        output: output.combined(),
    })
}

/// Porcelain status of the site folder (`-- .`), or `None` outside a repository. Paths are made
/// relative to the site folder (porcelain output is relative to the repository root, which is a
/// parent folder when the site lives inside a bigger repository).
async fn porcelain(root: &Path, untracked: bool) -> AppResult<Option<Porcelain>> {
    let output = Git::new(root)
        .args(["status", "--porcelain=v2", "--branch", "-z"])
        .arg(if untracked {
            "--untracked-files=all"
        } else {
            "--untracked-files=no"
        })
        .args(["--", "."])
        .read_only()
        .literal_pathspecs()
        .output()
        .await?;
    if !output.success {
        let error = output.failure();
        return if git_error_code(&error) == Some(GitErrorKind::NotRepo.code()) {
            Ok(None)
        } else {
            Err(error)
        };
    }
    let mut porcelain = parse_porcelain_v2(&output.stdout);
    let prefix = Git::new(root)
        .args(["rev-parse", "--show-prefix"])
        .read_only()
        .run()
        .await?
        .stdout_text();
    let prefix = prefix.trim_end_matches(['\r', '\n']);
    if !prefix.is_empty() {
        for file in &mut porcelain.files {
            if let Some(inside) = file.path.strip_prefix(prefix) {
                file.path = inside.to_string();
            }
            // The old side of a rename from outside the site cannot be named from inside it.
            file.orig_path = file
                .orig_path
                .take()
                .and_then(|orig| orig.strip_prefix(prefix).map(str::to_string));
        }
    }
    Ok(Some(porcelain))
}

async fn config_value(root: &Path, key: &str) -> AppResult<Option<String>> {
    let output = Git::new(root)
        .args(["config", "--get", key])
        .read_only()
        .output()
        .await?;
    Ok(non_empty(output.success, &output.stdout_text()))
}

async fn remote_url(root: &Path, remote: &str) -> AppResult<Option<String>> {
    let output = Git::new(root)
        .args(["remote", "get-url"])
        .arg(remote)
        .read_only()
        .output()
        .await?;
    Ok(non_empty(output.success, &output.stdout_text()))
}

fn non_empty(success: bool, text: &str) -> Option<String> {
    let text = text.trim();
    (success && !text.is_empty()).then(|| text.to_string())
}

/// The empty tree's id in this repository's hash format.
async fn empty_tree(root: &Path) -> AppResult<String> {
    let output = Git::new(root)
        .args(["hash-object", "-t", "tree", "--stdin"])
        .read_only()
        .run()
        .await?;
    Ok(output.stdout_text().trim().to_string())
}

/// Refuses to start a write while a merge or rebase waits for conflicts to be resolved.
async fn ensure_no_conflicts(root: &Path, porcelain: &Porcelain) -> AppResult<()> {
    let conflicted: Vec<&str> = porcelain
        .files
        .iter()
        .filter(|f| f.kind == GitFileKind::Conflicted)
        .map(|f| f.path.as_str())
        .collect();
    if !conflicted.is_empty() {
        return Err(git_error(
            GitErrorKind::Conflict,
            format!("unresolved conflicts in: {}", conflicted.join(", ")),
        ));
    }
    if operation_in_progress(root).await? {
        return Err(git_error(
            GitErrorKind::Conflict,
            "a rebase or merge is in progress; finish it (git rebase --continue) or undo it (git rebase --abort / git merge --abort) first",
        ));
    }
    Ok(())
}

/// True while a rebase or merge waits for the user.
async fn operation_in_progress(root: &Path) -> AppResult<bool> {
    let output = Git::new(root)
        .args(["rev-parse", "--git-dir"])
        .read_only()
        .run()
        .await?;
    let git_dir = PathBuf::from(output.stdout_text().trim());
    let git_dir = if git_dir.is_absolute() {
        git_dir
    } else {
        root.join(git_dir)
    };
    Ok(["rebase-merge", "rebase-apply", "MERGE_HEAD"]
        .iter()
        .any(|name| git_dir.join(name).exists()))
}

/// The chosen paths `git add` can match: present on disk or still in the index. (A path that is
/// gone from both, such as the old side of a staged rename, would make `git add` fail.)
async fn stageable(root: &Path, paths: &[String]) -> AppResult<Vec<String>> {
    let (present, missing): (Vec<&String>, Vec<&String>) = paths
        .iter()
        .partition(|p| root.join(p.as_str()).symlink_metadata().is_ok());
    let mut result: Vec<String> = present.into_iter().cloned().collect();
    if !missing.is_empty() {
        let output = Git::new(root)
            .args(["ls-files", "-z", "--cached", "--", "."])
            .read_only()
            .literal_pathspecs()
            .run()
            .await?;
        let indexed: HashSet<String> = output
            .stdout
            .split(|b| *b == 0)
            .map(|p| String::from_utf8_lossy(p).into_owned())
            .collect();
        result.extend(
            missing
                .into_iter()
                .filter(|p| indexed.contains(*p))
                .cloned(),
        );
    }
    Ok(result)
}

/// A site-relative path for git: forward slashes, nothing that leaves the folder.
fn repo_path(path: &str) -> AppResult<String> {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_start_matches("./");
    let inside = !trimmed.is_empty()
        && !trimmed.starts_with('/')
        && Path::new(trimmed)
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
        && Path::new(trimmed)
            .components()
            .any(|c| matches!(c, Component::Normal(_)));
    if inside {
        Ok(trimmed.to_string())
    } else {
        Err(AppError::PathOutsideSite(path.to_string()))
    }
}

fn nul_separated(paths: &[String]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for path in paths {
        bytes.extend_from_slice(path.as_bytes());
        bytes.push(0);
    }
    bytes
}

fn limit_diff(mut text: String) -> String {
    if text.len() <= MAX_DIFF_BYTES {
        return text;
    }
    let mut cut = MAX_DIFF_BYTES;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    let cut = text[..cut].rfind('\n').map_or(cut, |i| i + 1);
    text.truncate(cut);
    text.push_str(DIFF_TRUNCATED);
    text.push('\n');
    text
}

fn not_a_repo() -> AppError {
    git_error(
        GitErrorKind::NotRepo,
        "the site folder is not inside a git repository",
    )
}

fn detached() -> AppError {
    git_error(
        GitErrorKind::Detached,
        "HEAD is not on a branch (detached HEAD)",
    )
}

/// A file in the system temp folder, removed when dropped.
struct TempFile {
    path: PathBuf,
}

impl TempFile {
    fn create(label: &str, bytes: &[u8]) -> AppResult<Self> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "hugo-publisher-{label}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, bytes)?;
        Ok(Self { path })
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_paths_stay_inside_the_site() {
        assert_eq!(
            repo_path(r"content\yazılar\ğ.md").unwrap(),
            "content/yazılar/ğ.md"
        );
        assert_eq!(repo_path("./hugo.toml").unwrap(), "hugo.toml");
        assert_eq!(repo_path("notlar[1] *.md").unwrap(), "notlar[1] *.md");
        for bad in ["", "../x", "/etc/passwd", "a/../../b", r"C:\x", "C:/x", "."] {
            assert!(repo_path(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn long_diffs_are_cut_at_a_line_break() {
        let line = "+ğüşıöç satırı\n";
        let text = line.repeat(MAX_DIFF_BYTES / line.len() + 10);
        let limited = limit_diff(text);
        assert!(limited.len() <= MAX_DIFF_BYTES + DIFF_TRUNCATED.len() + 1);
        assert!(limited.ends_with(&format!("{line}{DIFF_TRUNCATED}\n")));
        assert_eq!(limit_diff("small\n".into()), "small\n");
    }
}
