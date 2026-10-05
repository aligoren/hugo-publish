//! Commands for the Publish view. See `src/lib/api.ts` for the matching TypeScript types.
//! Failures are `AppError::Invalid("git_<code>: <git output>")`; see [`super::errors`].

use tauri::State;

use super::ops;
pub use super::ops::GitResult;
pub use super::status::{GitFile, GitFileKind, GitStatus};
use crate::commands::AppState;
use crate::error::AppResult;

#[tauri::command]
pub async fn git_status(state: State<'_, AppState>) -> AppResult<GitStatus> {
    ops::status(&state.site()?.root).await
}

#[tauri::command]
pub async fn git_diff(state: State<'_, AppState>, path: String) -> AppResult<String> {
    ops::diff(&state.site()?.root, &path).await
}

#[tauri::command]
pub async fn git_commit(
    state: State<'_, AppState>,
    message: String,
    paths: Vec<String>,
) -> AppResult<String> {
    ops::commit(&state.site()?.root, &message, &paths).await
}

#[tauri::command]
pub async fn git_pull(state: State<'_, AppState>) -> AppResult<GitResult> {
    ops::pull(&state.site()?.root).await
}

#[tauri::command]
pub async fn git_push(state: State<'_, AppState>) -> AppResult<GitResult> {
    ops::push(&state.site()?.root).await
}

/// `git fetch`, so ahead/behind are current.
#[tauri::command]
pub async fn git_fetch(state: State<'_, AppState>) -> AppResult<GitResult> {
    ops::fetch(&state.site()?.root).await
}
