//! Deploy commands. TypeScript wrappers: `src/features/publish/deployApi.ts`.

use tauri::{AppHandle, Emitter, State};

use super::forge::{self, ForgeKind};
use super::gh_pages::{self, GhPagesResult};
use super::github::{self, DeployStatus};
use super::{CommitFiles, commit_files, delete_preview, list_previews, push_preview};
use super::{gitea, gitlab};
use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::git::ops::GitResult;
use crate::git::runner::Git;

/// Event name for [`gh_pages::Progress`].
pub const DEPLOY_PROGRESS_EVENT: &str = "deploy-progress";

/// Builds the site and publishes it to `branch` (e.g. `gh-pages`) with `message`.
#[tauri::command]
pub async fn deploy_gh_pages(
    app: AppHandle,
    state: State<'_, AppState>,
    branch: String,
    message: String,
) -> AppResult<GhPagesResult> {
    let site = state.site()?;
    let hugo = state.hugo().await?;
    gh_pages::publish(&hugo.path, &site.root, &branch, &message, |progress| {
        let _ = app.emit(DEPLOY_PROGRESS_EVENT, progress);
    })
    .await
}

/// Checks and statuses the forge of `origin` (GitHub, GitLab, Gitea/Forgejo) has for `rev`
/// (default `HEAD`). A self-hosted forge is named by `forge` in `[deploy]` of the site settings.
#[tauri::command]
pub async fn deploy_status(
    state: State<'_, AppState>,
    rev: Option<String>,
) -> AppResult<DeployStatus> {
    let root = state.site()?.root;
    let url = Git::new(&root)
        .args(["remote", "get-url", "origin"])
        .read_only()
        .run()
        .await?
        .stdout_text();
    let repo = forge::detect(&url, forge::read_setting(&root)).ok_or_else(|| {
        AppError::Invalid(format!(
            "the origin remote is not on GitHub, GitLab or Gitea/Forgejo; for a self-hosted \
             server set forge = \"github\", \"gitlab\" or \"gitea\" under [deploy] in {}",
            forge::SETTINGS_FILE
        ))
    })?;
    let commit = commit_files(&root, rev.as_deref()).await?;
    match repo.kind {
        ForgeKind::Github => github::deploy_status(&repo, &commit.sha).await,
        ForgeKind::Gitlab => gitlab::deploy_status(&repo, &commit.sha).await,
        ForgeKind::Gitea => gitea::deploy_status(&repo, &commit.sha).await,
    }
}

/// The commit `rev` (default `HEAD`) and the site files it changed.
#[tauri::command]
pub async fn deploy_commit_files(
    state: State<'_, AppState>,
    rev: Option<String>,
) -> AppResult<CommitFiles> {
    commit_files(&state.site()?.root, rev.as_deref()).await
}

/// Pushes the current commit to `origin` as `preview/<name>` for a share link.
#[tauri::command]
pub async fn deploy_preview_push(
    state: State<'_, AppState>,
    branch: String,
) -> AppResult<GitResult> {
    push_preview(&state.site()?.root, &branch).await
}

/// Deletes a `preview/<name>` branch from `origin`.
#[tauri::command]
pub async fn deploy_preview_delete(
    state: State<'_, AppState>,
    branch: String,
) -> AppResult<GitResult> {
    delete_preview(&state.site()?.root, &branch).await
}

/// `preview/*` branches on `origin`.
#[tauri::command]
pub async fn deploy_preview_list(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    list_previews(&state.site()?.root).await
}
