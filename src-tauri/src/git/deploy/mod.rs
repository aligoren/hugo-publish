//! Deploying beyond a plain push: the `gh-pages` method, deploy status from GitHub, GitLab and
//! Gitea/Forgejo, the files a commit changed (for live verification) and draft share links on
//! `preview/*` branches.

pub mod commands;
pub mod forge;
pub mod gh_pages;
pub mod gitea;
pub mod github;
pub mod gitlab;

use std::path::Path;

use serde::Serialize;

use super::errors::{GitErrorKind, git_error};
use super::ops::GitResult;
use super::runner::{Git, LONG_TIMEOUT, write_lock};
use crate::error::{AppError, AppResult};

/// Branches for draft share links live under this prefix.
pub const PREVIEW_PREFIX: &str = "preview/";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFiles {
    /// Full id of the commit.
    pub sha: String,
    /// Paths it changed, relative to the site folder (files outside it are left out).
    pub files: Vec<String>,
}

/// The commit `rev` (default `HEAD`) and the site files it changed.
pub async fn commit_files(root: &Path, rev: Option<&str>) -> AppResult<CommitFiles> {
    let rev = rev.unwrap_or("HEAD");
    if rev.starts_with('-') {
        return Err(AppError::Invalid(format!("not a revision: {rev}")));
    }
    let sha = Git::new(root)
        .args(["rev-parse", "--verify", "--quiet"])
        .arg(format!("{rev}^{{commit}}"))
        .read_only()
        .run()
        .await?
        .stdout_text()
        .trim()
        .to_string();
    let output = Git::new(root)
        .args([
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-only",
            "-r",
            "-z",
            "--relative",
            "--no-renames",
        ])
        .arg(&sha)
        .read_only()
        .run()
        .await?;
    let files = output
        .stdout
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8_lossy(p).into_owned())
        .collect();
    Ok(CommitFiles { sha, files })
}

async fn check_preview_branch(root: &Path, branch: &str) -> AppResult<()> {
    let ok = branch.starts_with(PREVIEW_PREFIX)
        && branch.len() > PREVIEW_PREFIX.len()
        && Git::new(root)
            .args(["check-ref-format", "--branch", branch])
            .read_only()
            .output()
            .await?
            .success;
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(format!(
            "share links use branches named {PREVIEW_PREFIX}<name>: {branch}"
        )))
    }
}

/// Pushes the current commit to `origin` as `branch` (`preview/…`). Never forces: a branch that
/// moved elsewhere on the remote is rejected.
pub async fn push_preview(root: &Path, branch: &str) -> AppResult<GitResult> {
    check_preview_branch(root, branch).await?;
    let _lock = write_lock().await;
    let output = Git::new(root)
        .args(["push", "origin"])
        .arg(format!("HEAD:refs/heads/{branch}"))
        .timeout(LONG_TIMEOUT)
        .run()
        .await?;
    Ok(GitResult {
        output: output.combined(),
    })
}

/// Deletes a share-link branch from `origin`.
pub async fn delete_preview(root: &Path, branch: &str) -> AppResult<GitResult> {
    check_preview_branch(root, branch).await?;
    let _lock = write_lock().await;
    let output = Git::new(root)
        .args(["push", "origin", "--delete"])
        .arg(format!("refs/heads/{branch}"))
        .timeout(LONG_TIMEOUT)
        .run()
        .await?;
    Ok(GitResult {
        output: output.combined(),
    })
}

/// Share-link branches that exist on `origin` (asks the remote).
pub async fn list_previews(root: &Path) -> AppResult<Vec<String>> {
    let output = Git::new(root)
        .args(["ls-remote", "--heads", "origin"])
        .arg(format!("refs/heads/{PREVIEW_PREFIX}*"))
        .timeout(LONG_TIMEOUT)
        .output()
        .await?;
    if !output.success {
        let error = output.failure();
        return Err(if output.combined().contains("No such remote") {
            git_error(GitErrorKind::NoRemote, "there is no remote named origin")
        } else {
            error
        });
    }
    let mut branches: Vec<String> = output
        .stdout_text()
        .lines()
        .filter_map(|line| line.split('\t').nth(1))
        .filter_map(|r| r.strip_prefix("refs/heads/"))
        .map(str::to_string)
        .collect();
    branches.sort();
    Ok(branches)
}
