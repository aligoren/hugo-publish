//! The app-wide `settings.json` in the app config folder. Only `preferredHugo` belongs to this
//! module; every other key is kept exactly as found.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{Map, Value};

use crate::error::{AppError, AppResult};

pub const SETTINGS_FILE: &str = "settings.json";
pub const PREFERRED_HUGO_KEY: &str = "preferredHugo";

/// Serializes read-modify-write cycles within this process.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// The stored Hugo binary, if any. A missing or unreadable file means "none".
pub fn read_preferred(file: &Path) -> Option<PathBuf> {
    let map = read_map(file).ok()?;
    map.get(PREFERRED_HUGO_KEY)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// Stores (or with `None` removes) the preferred Hugo binary, keeping all other keys.
pub fn write_preferred(file: &Path, path: Option<&str>) -> AppResult<()> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut map = read_map(file)?;
    match path {
        Some(path) => {
            map.insert(PREFERRED_HUGO_KEY.into(), Value::String(path.to_string()));
        }
        None => {
            map.shift_remove(PREFERRED_HUGO_KEY);
        }
    }
    let mut text = serde_json::to_string_pretty(&Value::Object(map))
        .map_err(|e| AppError::Invalid(format!("could not write settings: {e}")))?;
    text.push('\n');
    atomic_write(file, text.as_bytes())
}

/// The settings object. A missing file is empty; a file that is not a JSON object is an error,
/// so it is never overwritten (and its content lost) by accident.
fn read_map(file: &Path) -> AppResult<Map<String, Value>> {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(e.into()),
    };
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(AppError::Invalid(format!(
            "{} does not contain a JSON object; fix or remove it",
            file.display()
        ))),
        Err(e) => Err(AppError::Invalid(format!(
            "{} is not valid JSON ({e}); fix or remove it",
            file.display()
        ))),
    }
}

fn atomic_write(file: &Path, bytes: &[u8]) -> AppResult<()> {
    let dir = file
        .parent()
        .ok_or_else(|| AppError::Invalid(format!("no folder for {}", file.display())))?;
    fs::create_dir_all(dir)?;
    let temp = dir.join(format!(".{SETTINGS_FILE}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut out = fs::File::create(&temp)?;
        out.write_all(bytes)?;
        out.sync_all()?;
        drop(out);
        fs::rename(&temp, file)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    Ok(result?)
}
