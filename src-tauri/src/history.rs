//! Local version history: snapshots of files taken on save, kept in the app's data folder so
//! they never end up in the site's git history.
//!
//! Layout: `<app data>/history/<site key>/<file key>/<unix ms>-<reason>.snap`, where the keys are
//! hashes of the site root and the site-relative path, plus a `path.txt` naming the file.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};

/// Snapshots kept per file; older ones are deleted.
const KEEP_PER_FILE: usize = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Opaque id for `history_read`.
    pub id: String,
    pub path: String,
    pub created_ms: u64,
    pub size: u64,
    /// save | manual | restore
    pub reason: String,
}

fn key(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn file_dir(base: &Path, site_root: &Path, path: &str) -> PathBuf {
    base.join(key(&site_root.to_string_lossy()))
        .join(key(&path.replace('\\', "/")))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Saves a snapshot unless the newest one already has the same text.
pub fn save(
    base: &Path,
    site_root: &Path,
    path: &str,
    text: &str,
    reason: &str,
) -> AppResult<Snapshot> {
    if !matches!(reason, "save" | "manual" | "restore") {
        return Err(AppError::Invalid(format!(
            "unknown snapshot reason {reason}"
        )));
    }
    let dir = file_dir(base, site_root, path);
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("path.txt"), path)?;
    let existing = list_in(&dir, path)?;
    if let Some(newest) = existing.first()
        && fs::read(dir.join(&newest.id))? == text.as_bytes()
    {
        return Ok(newest.clone());
    }
    let mut created = now_ms();
    // Two saves within the same millisecond must not overwrite each other.
    while existing.iter().any(|s| s.created_ms == created) {
        created += 1;
    }
    let id = format!("{created}-{reason}.snap");
    fs::write(dir.join(&id), text)?;
    for old in list_in(&dir, path)?.into_iter().skip(KEEP_PER_FILE) {
        let _ = fs::remove_file(dir.join(old.id));
    }
    Ok(Snapshot {
        id,
        path: path.to_string(),
        created_ms: created,
        size: text.len() as u64,
        reason: reason.to_string(),
    })
}

/// Snapshots of one file, newest first.
pub fn list(base: &Path, site_root: &Path, path: &str) -> AppResult<Vec<Snapshot>> {
    list_in(&file_dir(base, site_root, path), path)
}

fn list_in(dir: &Path, path: &str) -> AppResult<Vec<Snapshot>> {
    let mut snapshots = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(snapshots);
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(stem) = name.strip_suffix(".snap") else {
            continue;
        };
        let Some((millis, reason)) = stem.split_once('-') else {
            continue;
        };
        let Ok(created_ms) = millis.parse::<u64>() else {
            continue;
        };
        snapshots.push(Snapshot {
            id: name.clone(),
            path: path.to_string(),
            created_ms,
            size: entry.metadata().map_or(0, |m| m.len()),
            reason: reason.to_string(),
        });
    }
    snapshots.sort_by_key(|s| std::cmp::Reverse(s.created_ms));
    Ok(snapshots)
}

pub fn read(base: &Path, site_root: &Path, path: &str, id: &str) -> AppResult<String> {
    if id.contains(['/', '\\']) || !id.ends_with(".snap") {
        return Err(AppError::Invalid(format!("invalid snapshot id {id}")));
    }
    let bytes = fs::read(file_dir(base, site_root, path).join(id))?;
    String::from_utf8(bytes).map_err(|_| AppError::NotUtf8(id.to_string()))
}

fn base_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Invalid(format!("no app data folder: {e}")))?;
    Ok(dir.join("history"))
}

#[tauri::command]
pub async fn history_save(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    text: String,
    reason: String,
) -> AppResult<Snapshot> {
    let site = state.site()?;
    crate::site::resolve(&site.root, &path)?;
    save(&base_dir(&app)?, &site.root, &path, &text, &reason)
}

#[tauri::command]
pub async fn history_list(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Vec<Snapshot>> {
    let site = state.site()?;
    list(&base_dir(&app)?, &site.root, &path)
}

#[tauri::command]
pub async fn history_read(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    id: String,
) -> AppResult<String> {
    let site = state.site()?;
    read(&base_dir(&app)?, &site.root, &path, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_lists_and_reads_snapshots() {
        let base = tempfile::tempdir().unwrap();
        let root = Path::new("D:/site");
        let first = save(base.path(), root, "content/a.md", "bir", "save").unwrap();
        // Same text again: no new snapshot.
        let same = save(base.path(), root, "content/a.md", "bir", "save").unwrap();
        assert_eq!(first.id, same.id);
        let second = save(base.path(), root, "content/a.md", "iki\r\n", "manual").unwrap();
        let listed = list(base.path(), root, "content/a.md").unwrap();
        assert_eq!(
            listed.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            [second.id.as_str(), first.id.as_str()]
        );
        assert_eq!(
            read(base.path(), root, "content/a.md", &second.id).unwrap(),
            "iki\r\n"
        );
        assert!(list(base.path(), root, "content/b.md").unwrap().is_empty());
        // Another site with the same relative path is separate.
        assert!(
            list(base.path(), Path::new("D:/other"), "content/a.md")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn keeps_a_bounded_number_of_snapshots() {
        let base = tempfile::tempdir().unwrap();
        let root = Path::new("/site");
        for i in 0..(KEEP_PER_FILE + 5) {
            save(base.path(), root, "x.md", &i.to_string(), "save").unwrap();
        }
        let listed = list(base.path(), root, "x.md").unwrap();
        assert_eq!(listed.len(), KEEP_PER_FILE);
        assert_eq!(
            read(base.path(), root, "x.md", &listed[0].id).unwrap(),
            (KEEP_PER_FILE + 4).to_string()
        );
    }

    #[test]
    fn rejects_bad_ids_and_reasons() {
        let base = tempfile::tempdir().unwrap();
        let root = Path::new("/site");
        assert!(read(base.path(), root, "x.md", "../../etc.snap").is_err());
        assert!(save(base.path(), root, "x.md", "t", "other").is_err());
    }
}
