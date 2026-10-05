//! Publishing to a `gh-pages`-style branch: build with Hugo into a temporary folder, put the
//! output on the branch through a temporary worktree outside the repository, commit and push.
//!
//! Git runs with `core.autocrlf=false` here, so the built files are published byte for byte.
//! Nothing is ever force-pushed, and the worktree is removed again whatever happens.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::git::errors::{GitErrorKind, git_error};
use crate::git::runner::{Git, LONG_TIMEOUT, write_lock};
use crate::hugo::output::strip_control;
use crate::hugo::short_command;

const BUILD_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Build,
    Prepare,
    Copy,
    Commit,
    Push,
    Cleanup,
    Done,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: Stage,
    /// English detail for logs (file counts, branch names).
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhPagesResult {
    pub branch: String,
    /// Short id of the new commit on the branch; `None` when nothing changed.
    pub commit: Option<String>,
    pub pushed: bool,
    /// The branch already had exactly this output.
    pub up_to_date: bool,
    /// Files in the built site.
    pub files: usize,
    /// git's output from the push, for showing to the user.
    pub output: String,
}

/// Builds the site and publishes the output to `branch` on `origin`.
pub async fn publish(
    hugo: &Path,
    root: &Path,
    branch: &str,
    message: &str,
    progress: impl Fn(Progress),
) -> AppResult<GhPagesResult> {
    let report = |stage, detail: String| progress(Progress { stage, detail });
    if message.trim().is_empty() {
        return Err(git_error(
            GitErrorKind::EmptyMessage,
            "the commit message is empty",
        ));
    }
    validate_branch(root, branch).await?;
    let _lock = write_lock().await;
    if remote_url(root).await?.is_none() {
        return Err(git_error(
            GitErrorKind::NoRemote,
            "there is no remote named origin",
        ));
    }
    let current = Git::new(root)
        .args(["branch", "--show-current"])
        .read_only()
        .run()
        .await?
        .stdout_text();
    if current.trim() == branch {
        return Err(AppError::Invalid(format!(
            "the site itself is on the {branch} branch; choose another branch for the built site"
        )));
    }

    report(Stage::Build, "hugo --gc --minify".into());
    let out = TempDir::new("out")?;
    build(hugo, root, &out.path).await?;
    if !out.path.join("index.html").is_file() {
        return Err(AppError::Hugo(
            "Hugo built the site, but there is no index.html in the output".into(),
        ));
    }
    let files = count_files(&out.path);

    let worktree = TempDir::new("worktree")?;
    // The folder must not exist for `git worktree add`; TempDir only reserves the name.
    let _ = fs::remove_dir_all(&worktree.path);
    let result = publish_in_worktree(
        root,
        branch,
        message,
        &out.path,
        &worktree.path,
        files,
        &report,
    )
    .await;
    report(Stage::Cleanup, "git worktree remove".into());
    let _ = Git::new(root)
        .args(["worktree", "remove", "--force"])
        .arg(&worktree.path)
        .output()
        .await;
    let _ = Git::new(root).args(["worktree", "prune"]).output().await;
    let result = result?;
    report(Stage::Done, String::new());
    Ok(result)
}

async fn publish_in_worktree(
    root: &Path,
    branch: &str,
    message: &str,
    out: &Path,
    worktree: &Path,
    files: usize,
    report: &impl Fn(Stage, String),
) -> AppResult<GhPagesResult> {
    report(Stage::Prepare, format!("branch {branch}"));
    let local = Git::new(root)
        .args(["rev-parse", "--verify", "--quiet"])
        .arg(format!("refs/heads/{branch}"))
        .read_only()
        .output()
        .await?
        .success;
    let remote = Git::new(root)
        .args(["ls-remote", "--exit-code", "--heads", "origin"])
        .arg(format!("refs/heads/{branch}"))
        .timeout(LONG_TIMEOUT)
        .output()
        .await?;
    let remote_exists = if remote.success {
        true
    } else if remote.stdout.is_empty() && remote.stderr.trim().is_empty() {
        // Exit code 2: the remote answered and has no such branch.
        false
    } else {
        return Err(remote.failure());
    };
    if remote_exists {
        Git::new(root)
            .args(["fetch", "origin"])
            .arg(format!("+refs/heads/{branch}:refs/remotes/origin/{branch}"))
            .timeout(LONG_TIMEOUT)
            .run()
            .await?;
    }

    // Checked out with the same line-ending setting the commands in the worktree use.
    let add = in_tree(root).args(["worktree", "add"]);
    if local {
        add.arg(worktree).arg(branch).run().await?;
        if remote_exists {
            in_tree(worktree)
                .args(["merge", "--ff-only"])
                .arg(format!("origin/{branch}"))
                .run()
                .await?;
        }
    } else if remote_exists {
        add.args(["--track", "-b", branch])
            .arg(worktree)
            .arg(format!("origin/{branch}"))
            .run()
            .await?;
    } else {
        let has_head = Git::new(root)
            .args(["rev-parse", "--verify", "--quiet", "HEAD"])
            .read_only()
            .output()
            .await?
            .success;
        if has_head {
            add.args(["--detach", "--no-checkout"])
                .arg(worktree)
                .run()
                .await?;
            // An orphan branch: no history shared with the site's sources.
            in_tree(worktree)
                .args(["switch", "--orphan", branch])
                .run()
                .await?;
        } else {
            add.args(["--orphan", "-b", branch])
                .arg(worktree)
                .run()
                .await?;
        }
    }

    report(Stage::Copy, format!("{files} files"));
    clear_except_git(worktree)?;
    copy_dir(out, worktree)?;

    report(Stage::Commit, String::new());
    in_tree(worktree).args(["add", "--all"]).run().await?;
    let changed = !in_tree(worktree)
        .args(["status", "--porcelain"])
        .run()
        .await?
        .stdout
        .is_empty();
    let unpushed = if !changed && remote_exists {
        let count = in_tree(worktree)
            .args(["rev-list", "--count"])
            .arg(format!("origin/{branch}..HEAD"))
            .run()
            .await?
            .stdout_text();
        count.trim() != "0"
    } else {
        !changed && !remote_exists
    };
    if !changed && !unpushed {
        return Ok(GhPagesResult {
            branch: branch.to_string(),
            commit: None,
            pushed: false,
            up_to_date: true,
            files,
            output: String::new(),
        });
    }
    let mut commit = None;
    if changed {
        let mut text = message.trim().to_string();
        text.push('\n');
        in_tree(worktree)
            .args(["commit", "-F", "-"])
            .stdin(text)
            .timeout(LONG_TIMEOUT)
            .run()
            .await?;
        let hash = in_tree(worktree)
            .args(["rev-parse", "--short", "HEAD"])
            .run()
            .await?;
        commit = Some(hash.stdout_text().trim().to_string());
    }

    report(Stage::Push, format!("origin {branch}"));
    let pushed = in_tree(worktree)
        .args(["push", "--set-upstream", "origin"])
        .arg(branch)
        .timeout(LONG_TIMEOUT)
        .run()
        .await?;
    Ok(GhPagesResult {
        branch: branch.to_string(),
        commit,
        pushed: true,
        up_to_date: false,
        files,
        output: pushed.combined(),
    })
}

/// Git in the worktree, with line endings left exactly as Hugo wrote them.
fn in_tree(worktree: &Path) -> Git<'_> {
    Git::new(worktree).args(["-c", "core.autocrlf=false", "-c", "core.safecrlf=false"])
}

async fn remote_url(root: &Path) -> AppResult<Option<String>> {
    let output = Git::new(root)
        .args(["remote", "get-url", "origin"])
        .read_only()
        .output()
        .await?;
    let url = output.stdout_text().trim().to_string();
    Ok((output.success && !url.is_empty()).then_some(url))
}

async fn validate_branch(root: &Path, branch: &str) -> AppResult<()> {
    let valid = !branch.is_empty()
        && !branch.starts_with('-')
        && Git::new(root)
            .args(["check-ref-format", "--branch", branch])
            .read_only()
            .output()
            .await?
            .success;
    if valid {
        Ok(())
    } else {
        Err(AppError::Invalid(format!(
            "not a valid branch name: {branch}"
        )))
    }
}

async fn build(hugo: &Path, root: &Path, out: &Path) -> AppResult<()> {
    let mut command = short_command(hugo);
    command
        .args(["--gc", "--minify", "--noBuildLock", "--source"])
        .arg(root)
        .arg("--destination")
        .arg(out);
    let output = tokio::time::timeout(BUILD_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::Hugo("the Hugo build timed out".into()))??;
    if !output.status.success() {
        let text = [&output.stderr[..], &output.stdout[..]]
            .iter()
            .flat_map(|b| {
                String::from_utf8_lossy(b)
                    .lines()
                    .map(strip_control)
                    .filter(|l| !l.trim().is_empty())
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        return Err(AppError::Hugo(text));
    }
    Ok(())
}

fn clear_except_git(dir: &Path) -> AppResult<()> {
    for entry in fs::read_dir(dir)?.flatten() {
        if entry.file_name() == ".git" {
            continue;
        }
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            fs::remove_dir_all(&path)?;
        } else {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> AppResult<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)?.flatten() {
        let source = entry.path();
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&source, &target)?;
        } else {
            fs::copy(&source, &target)?;
        }
    }
    Ok(())
}

fn count_files(dir: &Path) -> usize {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| match e.file_type() {
                    Ok(t) if t.is_dir() => count_files(&e.path()),
                    _ => 1,
                })
                .sum()
        })
        .unwrap_or(0)
}

/// A folder in the system temp directory (outside any repository), removed when dropped.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> AppResult<Self> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "hugo-publisher-ghpages-{label}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path)?;
        Ok(Self { path })
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_and_clears_trees() {
        let from = TempDir::new("t-from").unwrap();
        let to = TempDir::new("t-to").unwrap();
        fs::create_dir_all(from.path.join("a/b")).unwrap();
        fs::write(from.path.join("index.html"), "x\r\n").unwrap();
        fs::write(from.path.join("a/b/c.css"), "y").unwrap();
        fs::create_dir_all(to.path.join(".git")).unwrap();
        fs::write(to.path.join(".git/keep"), "").unwrap();
        fs::write(to.path.join("old.html"), "").unwrap();
        fs::create_dir_all(to.path.join("old")).unwrap();

        clear_except_git(&to.path).unwrap();
        copy_dir(&from.path, &to.path).unwrap();
        let mut names: Vec<String> = fs::read_dir(&to.path)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec![".git", "a", "index.html"]);
        assert_eq!(fs::read(to.path.join("index.html")).unwrap(), b"x\r\n");
        assert_eq!(count_files(&from.path), 2);
    }
}
