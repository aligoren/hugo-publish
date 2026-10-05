//! Commands the UI can call. Every file operation is limited to the site opened with `site_open`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::config::toml_doc::{TomlEditor, json_to_value};
use crate::error::{AppError, AppResult};
use crate::hugo::detect::{HugoInfo, detect};
use crate::hugo::list::{PageEntry, list_all};
use crate::hugo::server::{self, RunningServer, ServerEvent, ServerOptions};
use crate::site::{self, ContentFile, SiteInfo, TextFile};

/// Event name for [`ServerEventPayload`].
pub const SERVER_EVENT: &str = "hugo-server";

#[derive(Default)]
pub struct AppState {
    site: Mutex<Option<SiteInfo>>,
    hugo: Mutex<Option<HugoInfo>>,
    server: tokio::sync::Mutex<Option<(u64, RunningServer)>>,
    next_server_id: AtomicU64,
    /// A site folder given on the command line (`hugo-publisher <folder>`), handed out once.
    startup_site: Mutex<Option<String>>,
    /// Hugo binary chosen by the user (app-managed version or a custom path); None = detect.
    preferred_hugo: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn with_startup_site(site: Option<String>) -> Self {
        Self {
            startup_site: Mutex::new(site),
            ..Self::default()
        }
    }

    pub(crate) fn site(&self) -> AppResult<SiteInfo> {
        self.site.lock().unwrap().clone().ok_or(AppError::NoSite)
    }

    pub(crate) async fn hugo(&self) -> AppResult<HugoInfo> {
        let cached = self.hugo.lock().unwrap().clone();
        match cached {
            Some(info) => Ok(info),
            None => {
                let preferred = self.preferred_hugo.lock().unwrap().clone();
                let info = detect(preferred.as_deref()).await?;
                *self.hugo.lock().unwrap() = Some(info.clone());
                Ok(info)
            }
        }
    }

    /// Uses `path` as the first Hugo candidate from now on (None: automatic detection)
    /// and forgets the cached detection result.
    pub(crate) fn set_preferred_hugo(&self, path: Option<PathBuf>) {
        *self.preferred_hugo.lock().unwrap() = path;
        *self.hugo.lock().unwrap() = None;
    }

    /// Stops the preview server, if one runs. Also used when the app exits.
    pub async fn stop_server(&self) -> AppResult<()> {
        if let Some((_, running)) = self.server.lock().await.take() {
            running.stop().await?;
        }
        Ok(())
    }
}

/// Server events carry the id of the server that produced them, so the UI can ignore late
/// events (such as `exited`) from a server it already replaced.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEventPayload {
    server_id: u64,
    #[serde(flatten)]
    event: ServerEvent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    server_id: u64,
    url: String,
    port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEdit {
    /// Site-relative config file path.
    pub(crate) path: String,
    pub(crate) before: String,
    pub(crate) after: String,
    /// Version of `before`; pass it to `site_write_text` to save `after` safely.
    pub(crate) version: String,
}

#[tauri::command]
pub async fn hugo_detect(
    state: State<'_, AppState>,
    custom_path: Option<String>,
) -> AppResult<HugoInfo> {
    match custom_path {
        Some(path) => {
            let info = detect(Some(Path::new(&path))).await?;
            *state.hugo.lock().unwrap() = Some(info.clone());
            Ok(info)
        }
        // Re-detect, honouring the Hugo the user chose (see `set_preferred_hugo`).
        None => {
            *state.hugo.lock().unwrap() = None;
            state.hugo().await
        }
    }
}

#[tauri::command]
pub async fn hugo_server_start(
    app: AppHandle,
    state: State<'_, AppState>,
    options: ServerOptions,
) -> AppResult<ServerStatus> {
    let site = state.site()?;
    let hugo = state.hugo().await?;
    let mut slot = state.server.lock().await;
    if let Some((_, previous)) = slot.take() {
        previous.stop().await?;
    }
    let server_id = state.next_server_id.fetch_add(1, Ordering::Relaxed) + 1;
    let running = server::start(&hugo.path, &site.root, &options, move |event| {
        let _ = app.emit(SERVER_EVENT, ServerEventPayload { server_id, event });
    })
    .await?;
    let status = ServerStatus {
        server_id,
        url: running.url.clone(),
        port: running.port,
    };
    *slot = Some((server_id, running));
    Ok(status)
}

#[tauri::command]
pub async fn hugo_server_stop(state: State<'_, AppState>) -> AppResult<()> {
    state.stop_server().await
}

#[tauri::command]
pub async fn hugo_server_status(state: State<'_, AppState>) -> AppResult<Option<ServerStatus>> {
    Ok(state
        .server
        .lock()
        .await
        .as_ref()
        .map(|(server_id, running)| ServerStatus {
            server_id: *server_id,
            url: running.url.clone(),
            port: running.port,
        }))
}

#[tauri::command]
pub async fn hugo_list_pages(state: State<'_, AppState>) -> AppResult<Vec<PageEntry>> {
    let site = state.site()?;
    let hugo = state.hugo().await?;
    list_all(&hugo.path, &site.root).await
}

/// The folder passed on the command line, if any. Returns it only on the first call.
#[tauri::command]
pub async fn startup_site(state: State<'_, AppState>) -> AppResult<Option<String>> {
    Ok(state.startup_site.lock().unwrap().take())
}

/// Which of `paths` are still folders, for marking recent sites that were moved or deleted.
#[tauri::command]
pub async fn paths_exist(paths: Vec<String>) -> AppResult<Vec<bool>> {
    Ok(paths.iter().map(|p| Path::new(p).is_dir()).collect())
}

#[tauri::command]
pub async fn site_open(state: State<'_, AppState>, path: String) -> AppResult<SiteInfo> {
    let info = site::open(Path::new(&path))?;
    state.stop_server().await?;
    *state.site.lock().unwrap() = Some(info.clone());
    Ok(info)
}

/// Re-reads the open site's info (config files, content folder…) after its config changed,
/// without stopping the preview server.
#[tauri::command]
pub async fn site_refresh(state: State<'_, AppState>) -> AppResult<SiteInfo> {
    let root = state.site()?.root;
    let info = site::open(&root)?;
    *state.site.lock().unwrap() = Some(info.clone());
    Ok(info)
}

#[tauri::command]
pub async fn site_list_content(state: State<'_, AppState>) -> AppResult<Vec<ContentFile>> {
    site::list_content(&state.site()?)
}

#[tauri::command]
pub async fn site_read_text(state: State<'_, AppState>, path: String) -> AppResult<TextFile> {
    site::read_text(&state.site()?.root, &path)
}

#[tauri::command]
pub async fn site_write_text(
    state: State<'_, AppState>,
    path: String,
    text: String,
    expected_version: Option<String>,
) -> AppResult<String> {
    site::write_text(
        &state.site()?.root,
        &path,
        &text,
        expected_version.as_deref(),
    )
}

/// Computes the result of setting a config value without writing it, so the UI can show a diff.
#[tauri::command]
pub async fn config_preview_set_value(
    state: State<'_, AppState>,
    path: String,
    key_path: Vec<String>,
    value: serde_json::Value,
) -> AppResult<ConfigEdit> {
    edit_toml(&state, path, |editor| {
        let keys: Vec<&str> = key_path.iter().map(String::as_str).collect();
        editor.set_value(&keys, json_to_value(&value)?)
    })
}

/// Computes the result of adding a menu entry (`[[menu.<name>]]` or `[[menus.<name>]]`).
#[tauri::command]
pub async fn config_preview_add_menu_entry(
    state: State<'_, AppState>,
    path: String,
    menu: String,
    entry: serde_json::Map<String, serde_json::Value>,
) -> AppResult<ConfigEdit> {
    edit_toml(&state, path, |editor| {
        // Hugo accepts both `menu` and `menus`; extend whichever the file already uses.
        let root = if editor.contains(&["menu"]) {
            "menu"
        } else {
            "menus"
        };
        let values = entry
            .iter()
            .map(|(key, value)| Ok((key.clone(), json_to_value(value)?)))
            .collect::<AppResult<Vec<_>>>()?;
        editor.append_array_table(&[root, &menu], &values)
    })
}

fn edit_toml(
    state: &AppState,
    path: String,
    edit: impl FnOnce(&mut TomlEditor) -> AppResult<()>,
) -> AppResult<ConfigEdit> {
    if !path.to_ascii_lowercase().ends_with(".toml") {
        return Err(AppError::Invalid(
            "only TOML config files can be edited so far".into(),
        ));
    }
    let site = state.site()?;
    let file = site::read_text(&site.root, &path)?;
    let mut editor = TomlEditor::parse(&file.text)?;
    edit(&mut editor)?;
    Ok(ConfigEdit {
        path,
        after: editor.render(),
        before: file.text,
        version: file.version,
    })
}

/// Files under a site-relative folder (recursive). `extensions` without dots; empty means all.
#[tauri::command]
pub async fn site_list_files(
    state: State<'_, AppState>,
    dir: String,
    extensions: Vec<String>,
) -> AppResult<Vec<site::SiteFile>> {
    site::list_files(&state.site()?.root, &dir, &extensions)
}

/// Renames or moves a file or folder inside the site (never overwrites). Returns the new path.
#[tauri::command]
pub async fn site_rename(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> AppResult<String> {
    site::rename(&state.site()?.root, &from, &to)
}

/// Deletes a content file or page bundle (only under `content/`).
#[tauri::command]
pub async fn site_delete(state: State<'_, AppState>, path: String) -> AppResult<()> {
    site::delete_content(&state.site()?.root, &path)
}

/// Deletes a site file that overrides a theme file (layouts/, assets/, i18n/, archetypes/).
#[tauri::command]
pub async fn site_delete_override(state: State<'_, AppState>, path: String) -> AppResult<()> {
    site::delete_override(&state.site()?.root, &path)
}

/// Content hashes of site files (site-relative paths) for the theme lock: SHA-256 of the bytes,
/// with line endings normalised in text files (see `hugo::filehash`). Missing files are left out.
#[tauri::command]
pub async fn site_hash_files(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> AppResult<Vec<crate::hugo::filehash::FileHash>> {
    let root = state.site()?.root;
    tauri::async_runtime::spawn_blocking(move || crate::hugo::filehash::hash_files(&root, &paths))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?
}
