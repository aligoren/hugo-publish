//! Finding a usable `hugo` binary.
//!
//! GUI apps do not always inherit the shell's PATH (macOS in particular, and Windows right after a
//! winget install), so well-known install locations are checked as well.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use super::short_command;
use super::version::{HugoVersion, parse_version};
use crate::error::{AppError, AppResult};

/// Environment variable that points the app at a specific Hugo binary.
pub const HUGO_PATH_ENV: &str = "HUGO_PUBLISHER_HUGO";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HugoInfo {
    pub path: PathBuf,
    pub version: HugoVersion,
    /// The first line of `hugo version`, shown to the user as-is.
    pub raw: String,
}

/// Returns the first candidate that runs and reports a parseable version.
pub async fn detect(custom: Option<&Path>) -> AppResult<HugoInfo> {
    for candidate in candidates(custom) {
        if let Ok(info) = probe(&candidate).await {
            return Ok(info);
        }
    }
    Err(AppError::HugoNotFound)
}

pub async fn probe(path: &Path) -> AppResult<HugoInfo> {
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        short_command(path).arg("version").output(),
    )
    .await
    .map_err(|_| AppError::Hugo("`hugo version` timed out".into()))??;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw = stdout.lines().next().unwrap_or_default().trim().to_string();
    let version = parse_version(&raw)
        .ok_or_else(|| AppError::Hugo(format!("unexpected `hugo version` output: {raw}")))?;
    Ok(HugoInfo {
        path: path.to_path_buf(),
        version,
        raw,
    })
}

fn candidates(custom: Option<&Path>) -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Some(path) = custom {
        list.push(path.to_path_buf());
    }
    if let Some(path) = std::env::var_os(HUGO_PATH_ENV) {
        list.push(PathBuf::from(path));
    }
    if let Ok(path) = which::which("hugo") {
        list.push(path);
    }
    list.extend(well_known_locations());
    list.dedup();
    list.into_iter().filter(|p| p.is_file()).collect()
}

#[cfg(windows)]
fn well_known_locations() -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        let winget = local.join("Microsoft").join("WinGet");
        list.push(winget.join("Links").join("hugo.exe"));
        // winget packages live in versioned folders such as Hugo.Hugo.Extended_Microsoft.Winget.Source_8wekyb3d8bbwe.
        if let Ok(entries) = std::fs::read_dir(winget.join("Packages")) {
            let mut dirs: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with("Hugo.Hugo"))
                })
                .collect();
            // Prefer the extended edition, matching what most hosting setups use.
            dirs.sort_by_key(|p| !p.to_string_lossy().contains("Extended"));
            list.extend(dirs.into_iter().map(|d| d.join("hugo.exe")));
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        list.push(home.join("scoop").join("shims").join("hugo.exe"));
    }
    list.push(PathBuf::from(r"C:\ProgramData\chocolatey\bin\hugo.exe"));
    list
}

#[cfg(not(windows))]
fn well_known_locations() -> Vec<PathBuf> {
    let mut list: Vec<PathBuf> = [
        "/opt/homebrew/bin/hugo",
        "/usr/local/bin/hugo",
        "/usr/bin/hugo",
        "/snap/bin/hugo",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        list.push(home.join(".local").join("bin").join("hugo"));
        list.push(home.join("go").join("bin").join("hugo"));
    }
    list
}
