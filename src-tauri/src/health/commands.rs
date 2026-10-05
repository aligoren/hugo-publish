//! Health commands. See `src/lib/api.ts` (Build & health section) for the TypeScript side.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::{build, net};
use crate::commands::AppState;
use crate::config::commands::HugoMessage;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOptions {
    #[serde(default)]
    pub drafts: bool,
    #[serde(default)]
    pub future: bool,
    #[serde(default)]
    pub environment: Option<String>,
    /// Build this git revision (e.g. `HEAD`) from a temporary worktree instead of the files on disk.
    #[serde(default)]
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildFile {
    pub path: String,
    pub size: u64,
    /// Content hash (hex), for comparing two builds.
    pub hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub ok: bool,
    /// Absolute path of the temporary output folder (pass to `read_build_file`/`discard_build`).
    pub output_dir: String,
    pub files: Vec<BuildFile>,
    pub messages: Vec<HugoMessage>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkCheck {
    pub url: String,
    pub ok: bool,
    pub status: Option<u16>,
    pub final_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedPage {
    pub status: u16,
    pub final_url: String,
    /// The body as text, cut at 2 MB.
    pub body: String,
}

#[tauri::command]
pub async fn build_site(
    state: State<'_, AppState>,
    options: BuildOptions,
) -> AppResult<BuildResult> {
    let site = state.site()?;
    let hugo = state.hugo().await?;
    build::build(&hugo.path, &site.root, &options).await
}

/// Reads a text file (HTML, CSS, XML…) from a folder returned by `build_site`.
#[tauri::command]
pub async fn read_build_file(output_dir: String, path: String) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || build::read_file(&output_dir, &path))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?
}

/// Deletes a folder returned by `build_site`.
#[tauri::command]
pub async fn discard_build(output_dir: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || build::discard(&output_dir))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?
}

/// Checks external http(s) links (HEAD, then GET when HEAD is refused).
#[tauri::command]
pub async fn check_links(urls: Vec<String>) -> AppResult<Vec<LinkCheck>> {
    net::check_links(urls).await
}

/// GET of a page on the local preview server (`http://localhost:*` / `127.0.0.1:*` only).
#[tauri::command]
pub async fn fetch_preview(url: String) -> AppResult<String> {
    net::fetch_preview(&url).await
}

/// GET of a public http(s) page, e.g. to verify the live site after publishing.
#[tauri::command]
pub async fn fetch_page(url: String) -> AppResult<FetchedPage> {
    net::fetch_page(&url).await
}
