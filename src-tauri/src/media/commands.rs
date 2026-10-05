//! Media commands. See `src/lib/api.ts` (Media section) for the TypeScript side.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::library;
use crate::commands::AppState;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    pub path: String,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// jpeg | png | webp | gif | svg | avif | other
    pub format: Option<String>,
    /// GPS coordinates found (EXIF, XMP, or an embedded preview image).
    pub has_gps: bool,
    /// Metadata that `media_strip_metadata` would remove: EXIF (beyond the orientation), XMP,
    /// IPTC, comments, PNG text, embedded previews. ICC colour profiles do not count, since
    /// cleaning keeps them.
    pub has_metadata: bool,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEntry {
    pub group: String,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsPosition {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaDetails {
    pub file: MediaFile,
    pub entries: Vec<MetadataEntry>,
    pub camera: Option<String>,
    pub taken_at: Option<String>,
    pub gps: Option<GpsPosition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    /// Site-relative folder, e.g. `static/images` or a page bundle folder.
    pub target_dir: String,
    pub strip_metadata: bool,
    /// Downscale wider images to this width (keeps aspect ratio). None = keep size.
    #[serde(default)]
    pub max_width: Option<u32>,
    /// File name to use instead of the source name (extension kept or given).
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub overwrite: bool,
}

/// Runs blocking file and image work off the async runtime.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| AppError::Invalid(format!("media task failed: {e}")))?
}

#[tauri::command]
pub async fn media_list(state: State<'_, AppState>) -> AppResult<Vec<MediaFile>> {
    let site = state.site()?;
    blocking(move || library::list(&site.root)).await
}

#[tauri::command]
pub async fn media_details(state: State<'_, AppState>, path: String) -> AppResult<MediaDetails> {
    let site = state.site()?;
    blocking(move || library::details(&site.root, &path)).await
}

/// Copies files from anywhere on disk (absolute paths picked by the user) into the site.
#[tauri::command]
pub async fn media_import_files(
    state: State<'_, AppState>,
    sources: Vec<String>,
    options: ImportOptions,
) -> AppResult<Vec<String>> {
    let site = state.site()?;
    blocking(move || library::import_files(&site.root, &sources, &options)).await
}

/// Imports a pasted image (base64 bytes).
#[tauri::command]
pub async fn media_import_bytes(
    state: State<'_, AppState>,
    file_name: String,
    data_base64: String,
    options: ImportOptions,
) -> AppResult<String> {
    let site = state.site()?;
    blocking(move || library::import_bytes(&site.root, &file_name, &data_base64, &options)).await
}

/// Removes EXIF/XMP/IPTC (GPS included) without re-encoding the pixels.
#[tauri::command]
pub async fn media_strip_metadata(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<MediaFile> {
    let site = state.site()?;
    blocking(move || library::strip_file(&site.root, &path)).await
}

#[tauri::command]
pub async fn media_delete(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let site = state.site()?;
    blocking(move || library::delete(&site.root, &path)).await
}

/// A small preview as a `data:` URL (the webview cannot load site files directly).
#[tauri::command]
pub async fn media_thumbnail(
    state: State<'_, AppState>,
    path: String,
    max_size: u32,
) -> AppResult<String> {
    let site = state.site()?;
    blocking(move || library::thumbnail(&site.root, &path, max_size)).await
}
