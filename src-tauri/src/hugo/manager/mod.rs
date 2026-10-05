//! App-managed Hugo versions: download from GitHub releases (checksum verified), keep several
//! side by side in the app data folder, and remember which one to use.
//!
//! - [`assets`]: which release file fits this computer, checksum parsing and verification
//! - [`github`]: the release list (cached) and streamed downloads
//! - [`archive`]: taking the `hugo` binary out of a `.zip`, `.tar.gz` or macOS `.pkg`
//! - [`install`]: the version folders in `<app data>/hugo/`
//! - [`settings`]: the preferred binary in `<app config>/settings.json`

pub mod archive;
pub mod assets;
pub mod github;
pub mod install;
pub mod semver;
pub mod settings;

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::detect::{HugoInfo, probe};
use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use assets::Platform;

/// Event with [`InstallProgress`] payloads while a version downloads.
pub const INSTALL_EVENT: &str = "hugo-install";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HugoRelease {
    /// Without the leading `v`, e.g. `0.167.0`.
    pub version: String,
    pub published_at: String,
    pub prerelease: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedHugo {
    pub version: String,
    pub extended: bool,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub version: String,
    pub received: u64,
    pub total: Option<u64>,
    /// download | verify | extract | done
    pub stage: String,
}

fn hugo_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Invalid(format!("no app data folder: {e}")))?;
    Ok(dir.join("hugo"))
}

fn settings_file(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Invalid(format!("no app config folder: {e}")))?;
    Ok(dir.join(settings::SETTINGS_FILE))
}

/// Called once at startup: loads the saved preference into the app state and removes
/// leftovers of installs that were interrupted by a crash.
pub fn init(app: &AppHandle) {
    if let Ok(file) = settings_file(app)
        && let Some(path) = settings::read_preferred(&file)
        && let Some(state) = app.try_state::<AppState>()
    {
        state.set_preferred_hugo(Some(path));
    }
    if let Ok(base) = hugo_dir(app) {
        tauri::async_runtime::spawn_blocking(move || install::remove_stale_staging(&base));
    }
}

#[tauri::command]
pub async fn hugo_releases() -> AppResult<Vec<HugoRelease>> {
    github::releases().await
}

#[tauri::command]
pub async fn hugo_installed(app: AppHandle) -> AppResult<Vec<ManagedHugo>> {
    Ok(install::scan_installed(
        &hugo_dir(&app)?,
        Platform::current(),
    ))
}

#[tauri::command]
pub async fn hugo_install(
    app: AppHandle,
    version: String,
    extended: bool,
) -> AppResult<ManagedHugo> {
    let base = hugo_dir(&app)?;
    let emitter = app.clone();
    let progress = move |event: InstallProgress| {
        let _ = emitter.emit(INSTALL_EVENT, event);
    };
    install::install(&base, &version, extended, Platform::current(), &progress).await
}

#[tauri::command]
pub async fn hugo_uninstall(app: AppHandle, version: String, extended: bool) -> AppResult<()> {
    let dir = install::version_dir(&hugo_dir(&app)?, &version, extended)?;
    if !dir.exists() {
        return Ok(());
    }
    let state = app.state::<AppState>();
    let file = settings_file(&app)?;
    let preferred = settings::read_preferred(&file);
    let was_preferred = preferred
        .as_deref()
        .is_some_and(|path| install::is_inside(path, &dir));
    if was_preferred {
        // The preview server may run this binary; Windows cannot delete a running program.
        state.stop_server().await?;
    }
    install::remove_dir_with_retry(&dir).await?;
    if was_preferred {
        settings::write_preferred(&file, None)?;
        state.set_preferred_hugo(None);
    } else {
        // Forget a cached detection result that might point into the removed folder.
        state.set_preferred_hugo(preferred);
    }
    Ok(())
}

/// Sets (and persists) the Hugo binary to use; `None` returns to automatic detection.
/// Returns the Hugo that is now active, if any.
#[tauri::command]
pub async fn hugo_set_preferred(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> AppResult<Option<HugoInfo>> {
    let file = settings_file(&app)?;
    match path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        None => {
            settings::write_preferred(&file, None)?;
            state.set_preferred_hugo(None);
        }
        Some(path) => {
            check_binary(Path::new(path)).await?;
            settings::write_preferred(&file, Some(path))?;
            state.set_preferred_hugo(Some(PathBuf::from(path)));
        }
    }
    Ok(state.hugo().await.ok())
}

/// Refuses paths that are not a working Hugo binary.
async fn check_binary(path: &Path) -> AppResult<HugoInfo> {
    if !path.is_file() {
        return Err(AppError::Invalid(format!(
            "{} is not a file",
            path.display()
        )));
    }
    probe(path)
        .await
        .map_err(|e| AppError::Hugo(format!("{} does not work as Hugo: {e}", path.display())))
}

#[tauri::command]
pub async fn hugo_preferred(app: AppHandle) -> AppResult<Option<String>> {
    Ok(settings::read_preferred(&settings_file(&app)?)
        .map(|path| path.to_string_lossy().into_owned()))
}
