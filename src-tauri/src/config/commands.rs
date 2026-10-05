//! Config commands for the Settings and Theme views. See `src/lib/api.ts` for the TypeScript side.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::toml_doc::{PathKey, TomlEditor, json_to_value};
use crate::commands::{AppState, ConfigEdit};
use crate::error::{AppError, AppResult};
use crate::hugo::output::{Level, classify, strip_control};
use crate::hugo::short_command;
use crate::site;

const HUGO_CONFIG_TIMEOUT: Duration = Duration::from_secs(60);

/// One change to a config file; a batch becomes one diff and one write.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum ConfigOp {
    Set {
        path: Vec<PathKey>,
        value: serde_json::Value,
    },
    Remove {
        path: Vec<PathKey>,
    },
    AppendTable {
        path: Vec<String>,
        entries: serde_json::Map<String, serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct TomlReadResult {
    values: serde_json::Value,
    comments: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HugoMessage {
    pub(crate) level: Level,
    pub(crate) text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EffectiveConfig {
    values: serde_json::Value,
    messages: Vec<HugoMessage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigValidation {
    ok: bool,
    messages: Vec<HugoMessage>,
}

pub fn apply_ops(editor: &mut TomlEditor, ops: &[ConfigOp]) -> AppResult<()> {
    for op in ops {
        match op {
            ConfigOp::Set { path, value } => editor.set_at(path, json_to_value(value)?)?,
            ConfigOp::Remove { path } => {
                editor.remove_at(path)?;
            }
            ConfigOp::AppendTable { path, entries } => {
                let keys: Vec<&str> = path.iter().map(String::as_str).collect();
                let values = entries
                    .iter()
                    .map(|(key, value)| Ok((key.clone(), json_to_value(value)?)))
                    .collect::<AppResult<Vec<_>>>()?;
                editor.append_array_table(&keys, &values)?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn toml_read(state: State<'_, AppState>, path: String) -> AppResult<TomlReadResult> {
    let site = state.site()?;
    let file = site::read_text(&site.root, &path)?;
    // Reading does not need the exact line endings, so mixed endings are fine here.
    let editor = TomlEditor::parse(&file.text.replace("\r\n", "\n"))?;
    Ok(TomlReadResult {
        values: editor.to_json(),
        comments: editor.comments(),
    })
}

#[tauri::command]
pub async fn config_preview_ops(
    state: State<'_, AppState>,
    path: String,
    ops: Vec<ConfigOp>,
) -> AppResult<ConfigEdit> {
    if !path.to_ascii_lowercase().ends_with(".toml") {
        return Err(AppError::Invalid(
            "only TOML files are edited on the Rust side".into(),
        ));
    }
    let site = state.site()?;
    // A missing file counts as empty, so a review can also create it. Its version is "",
    // which `site_write_text` accepts only while the file still does not exist.
    let file = if site::resolve(&site.root, &path)?.exists() {
        site::read_text(&site.root, &path)?
    } else {
        site::TextFile {
            text: String::new(),
            version: String::new(),
        }
    };
    let mut editor = TomlEditor::parse(&file.text)?;
    apply_ops(&mut editor, &ops)?;
    Ok(ConfigEdit {
        path,
        after: editor.render(),
        before: file.text,
        version: file.version,
    })
}

#[tauri::command]
pub async fn config_validate(
    state: State<'_, AppState>,
    path: String,
    text: String,
) -> AppResult<ConfigValidation> {
    let site = state.site()?;
    let hugo = state.hugo().await?;
    site::resolve(&site.root, &path)?;
    validate(&hugo.path, &site.root, &path, &text).await
}

#[tauri::command]
pub async fn config_effective(
    state: State<'_, AppState>,
    environment: Option<String>,
) -> AppResult<EffectiveConfig> {
    let site = state.site()?;
    let hugo = state.hugo().await?;
    effective(&hugo.path, &site.root, environment.as_deref()).await
}

pub async fn effective(
    hugo: &Path,
    root: &Path,
    environment: Option<&str>,
) -> AppResult<EffectiveConfig> {
    let mut command = short_command(hugo);
    command
        .args([
            "config",
            "--format",
            "json",
            "--printZero",
            "--noBuildLock",
            "--source",
        ])
        .arg(root);
    if let Some(environment) = environment {
        command.args(["--environment", environment]);
    }
    let output = tokio::time::timeout(HUGO_CONFIG_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::Hugo("`hugo config` timed out".into()))??;
    let messages = messages(&output.stderr);
    if !output.status.success() {
        return Err(AppError::Hugo(join_messages(&messages)));
    }
    let values = serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::Hugo(format!("unexpected `hugo config` output: {e}")))?;
    Ok(EffectiveConfig { values, messages })
}

/// Loads the site with `text` standing in for the config file at `relative`, without touching
/// the site: the text goes into a temporary file (or a temporary copy of `config/`) that Hugo
/// is pointed at with `--config` / `--configDir`.
pub async fn validate(
    hugo: &Path,
    root: &Path,
    relative: &str,
    text: &str,
) -> AppResult<ConfigValidation> {
    let relative = relative.replace('\\', "/");
    let temp = TempDir::new()?;
    let mut command = short_command(hugo);
    command
        .args(["config", "--format", "json", "--noBuildLock", "--source"])
        .arg(root);
    if let Some(inside) = relative.strip_prefix("config/") {
        let config_copy = temp.path.join("config");
        copy_dir(&root.join("config"), &config_copy)?;
        let target = config_copy.join(inside);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, text)?;
        command.arg("--configDir").arg(&config_copy);
    } else if !relative.contains('/') {
        let file = temp.path.join(&relative);
        fs::write(&file, text)?;
        command.arg("--config").arg(&file);
    } else {
        // Not a file Hugo reads as site config (theme defaults, i18n…): nothing to check here.
        return Ok(ConfigValidation {
            ok: true,
            messages: Vec::new(),
        });
    }
    let output = tokio::time::timeout(HUGO_CONFIG_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::Hugo("`hugo config` timed out".into()))??;
    Ok(ConfigValidation {
        ok: output.status.success(),
        messages: messages(&output.stderr),
    })
}

/// A config file's new text, or `None` when the file is to be removed.
#[derive(Debug, Clone, Deserialize)]
pub struct ConfigFileText {
    pub path: String,
    pub text: Option<String>,
}

#[tauri::command]
pub async fn config_validate_files(
    state: State<'_, AppState>,
    files: Vec<ConfigFileText>,
) -> AppResult<ConfigValidation> {
    let site = state.site()?;
    let hugo = state.hugo().await?;
    for file in &files {
        site::resolve(&site.root, &file.path)?;
    }
    validate_files(&hugo.path, &site.root, &files).await
}

/// Loads the site with several config files changed at once (e.g. a root file split into
/// `config/_default/`), from temporary copies: the site itself is not touched.
pub async fn validate_files(
    hugo: &Path,
    root: &Path,
    files: &[ConfigFileText],
) -> AppResult<ConfigValidation> {
    let temp = TempDir::new()?;
    let config_copy = temp.path.join("config");
    copy_dir(&root.join("config"), &config_copy)?;
    let root_copy = temp.path.join("root");
    fs::create_dir_all(&root_copy)?;
    for name in site::ROOT_CONFIG_NAMES {
        if root.join(name).is_file() {
            fs::copy(root.join(name), root_copy.join(name))?;
        }
    }
    for file in files {
        let relative = file.path.replace('\\', "/");
        let target = if let Some(inside) = relative.strip_prefix("config/") {
            config_copy.join(inside)
        } else if site::ROOT_CONFIG_NAMES.contains(&relative.as_str()) {
            root_copy.join(&relative)
        } else {
            return Err(AppError::Invalid(format!(
                "`{relative}` is not a site config file"
            )));
        };
        match &file.text {
            Some(text) => {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&target, text)?;
            }
            None => {
                if target.is_file() {
                    fs::remove_file(&target)?;
                }
            }
        }
    }
    // `--config` replaces Hugo's own lookup of the root file, so a removed root file stays
    // removed; an empty stand-in keeps `--configDir` the only source in that case.
    let root_file = site::ROOT_CONFIG_NAMES
        .iter()
        .map(|name| root_copy.join(name))
        .find(|path| path.is_file())
        .unwrap_or_else(|| root_copy.join("empty.toml"));
    if !root_file.exists() {
        fs::write(&root_file, "")?;
    }
    let mut command = short_command(hugo);
    command
        .args(["config", "--format", "json", "--noBuildLock", "--source"])
        .arg(root)
        .arg("--config")
        .arg(&root_file)
        .arg("--configDir")
        .arg(&config_copy);
    let output = tokio::time::timeout(HUGO_CONFIG_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::Hugo("`hugo config` timed out".into()))??;
    Ok(ConfigValidation {
        ok: output.status.success(),
        messages: messages(&output.stderr),
    })
}

/// Hugo's stderr as messages (escape codes removed, empty lines dropped).
pub(crate) fn messages(stderr: &[u8]) -> Vec<HugoMessage> {
    String::from_utf8_lossy(stderr)
        .lines()
        .map(strip_control)
        .filter(|line| !line.trim().is_empty())
        .map(|text| HugoMessage {
            level: classify(&text),
            text,
        })
        .collect()
}

fn join_messages(messages: &[HugoMessage]) -> String {
    messages
        .iter()
        .map(|m| m.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn copy_dir(from: &Path, to: &Path) -> AppResult<()> {
    fs::create_dir_all(to)?;
    if !from.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(from)?.flatten() {
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            copy_dir(&source, &target)?;
        } else {
            fs::copy(&source, &target)?;
        }
    }
    Ok(())
}

/// A folder under the system temp directory, removed when dropped.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> AppResult<Self> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "hugo-publisher-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path)?;
        Ok(Self { path })
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// Applies config ops to a TOML text (e.g. TOML front matter) and returns the new text.
#[tauri::command]
pub async fn toml_edit_text(text: String, ops: Vec<ConfigOp>) -> AppResult<String> {
    let mut editor = TomlEditor::parse(&text)?;
    apply_ops(&mut editor, &ops)?;
    Ok(editor.render())
}

/// Parses a TOML text with its comments (see [`toml_read`]).
#[tauri::command]
pub async fn toml_parse_text(text: String) -> AppResult<TomlReadResult> {
    let editor = TomlEditor::parse(&text.replace("\r\n", "\n"))?;
    Ok(TomlReadResult {
        values: editor.to_json(),
        comments: editor.comments(),
    })
}
