//! Updating a theme that is a Hugo Module: `hugo mod get <module>@<version>` changes only the
//! site's go.mod and go.sum, so the UI keeps both texts from before and can put them back.
//!
//! `hugo mod get` hands its arguments to `go get` unparsed (Hugo flags such as `--source` would
//! end up there too), so it runs inside the site folder with the module argument alone.

use std::fs;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::mounts::config_mounts;
use super::output::strip_control;
use super::short_command;
use crate::commands::AppState;
use crate::error::{AppError, AppResult};

/// Downloads can take a while on a slow connection.
const MOD_TIMEOUT: Duration = Duration::from_secs(300);
const BUILD_LOCK: &str = ".hugo_build.lock";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoModTexts {
    /// None when the file does not exist.
    pub go_mod: Option<String>,
    pub go_sum: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModGetResult {
    pub before: GoModTexts,
    pub after: GoModTexts,
    /// What Hugo / Go printed.
    pub output: String,
}

fn read_optional(path: &Path) -> AppResult<Option<String>> {
    match fs::read(path) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| AppError::NotUtf8(path.display().to_string())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn read_go_mod_texts(root: &Path) -> AppResult<GoModTexts> {
    Ok(GoModTexts {
        go_mod: read_optional(&root.join("go.mod"))?,
        go_sum: read_optional(&root.join("go.sum"))?,
    })
}

fn write_optional(path: &Path, text: Option<&str>) -> AppResult<()> {
    match text {
        Some(text) => fs::write(path, text)?,
        None => {
            if path.is_file() {
                fs::remove_file(path)?;
            }
        }
    }
    Ok(())
}

/// Puts go.mod and go.sum back as they were (`None` removes the file).
pub fn restore_go_mod_texts(root: &Path, texts: &GoModTexts) -> AppResult<()> {
    if let Some(go_mod) = &texts.go_mod
        && !go_mod.lines().any(|l| l.trim_start().starts_with("module"))
    {
        return Err(AppError::Invalid("not a go.mod file".into()));
    }
    write_optional(&root.join("go.mod"), texts.go_mod.as_deref())?;
    write_optional(&root.join("go.sum"), texts.go_sum.as_deref())
}

/// Module paths and versions end up on a command line: keep them to Go's own characters.
pub fn check_module_arg(module: &str, version: &str) -> AppResult<String> {
    let path_ok = !module.is_empty()
        && module.len() <= 300
        && !module.starts_with(['-', '/', '.'])
        && !module.contains("..")
        && module
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '~' | '/'));
    let version_ok = !version.is_empty()
        && version.len() <= 200
        && !version.starts_with('-')
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+' | '/'));
    if !path_ok {
        return Err(AppError::Invalid(format!("invalid module path: {module}")));
    }
    if !version_ok {
        return Err(AppError::Invalid(format!(
            "invalid module version: {version}"
        )));
    }
    Ok(format!("{module}@{version}"))
}

fn combined(stdout: &[u8], stderr: &[u8]) -> String {
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    );
    text.lines()
        .map(strip_control)
        .filter(|l| !l.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Runs `hugo mod <args>` in the site folder and removes a build lock it left behind.
async fn run_mod(hugo: &Path, root: &Path, args: &[&str]) -> AppResult<String> {
    let lock_existed = root.join(BUILD_LOCK).exists();
    let mut command = short_command(hugo);
    command.arg("mod").args(args).current_dir(root);
    let result = tokio::time::timeout(MOD_TIMEOUT, command.output()).await;
    if !lock_existed {
        let _ = fs::remove_file(root.join(BUILD_LOCK));
    }
    let output =
        result.map_err(|_| AppError::Hugo(format!("`hugo mod {}` timed out", args[0])))??;
    let text = combined(&output.stdout, &output.stderr);
    if output.status.success() {
        Ok(text)
    } else {
        Err(AppError::Hugo(text))
    }
}

/// `hugo mod get <module>@<version>` for a module the site uses. On failure go.mod and go.sum
/// are put back as they were.
pub async fn mod_get(
    hugo: &Path,
    root: &Path,
    module: &str,
    version: &str,
) -> AppResult<ModGetResult> {
    let arg = check_module_arg(module, version)?;
    if !root.join("go.mod").is_file() {
        return Err(AppError::Invalid(
            "the site has no go.mod: it does not use Hugo Modules".into(),
        ));
    }
    let before = read_go_mod_texts(root)?;
    match run_mod(hugo, root, &["get", &arg]).await {
        Ok(output) => Ok(ModGetResult {
            before,
            after: read_go_mod_texts(root)?,
            output,
        }),
        Err(error) => {
            let _ = restore_go_mod_texts(root, &before);
            Err(error)
        }
    }
}

/// `hugo mod vendor`: refreshes `_vendor/` from go.mod.
pub async fn mod_vendor(hugo: &Path, root: &Path) -> AppResult<String> {
    run_mod(hugo, root, &["vendor", "--noBuildLock"]).await
}

/// Updates a theme module of the open site to `version` (a tag, a commit or `latest`).
#[tauri::command]
pub async fn hugo_mod_get(
    state: State<'_, AppState>,
    module: String,
    version: String,
) -> AppResult<ModGetResult> {
    let root = state.site()?.root;
    let hugo = state.hugo().await?;
    // Only modules the site already uses: this is an update, not a way to add dependencies.
    let modules = config_mounts(&hugo.path, &root, false).await?;
    if !modules
        .iter()
        .any(|m| m.path == module || m.module_path.as_deref() == Some(module.as_str()))
    {
        return Err(AppError::Invalid(format!(
            "{module} is not a module of this site"
        )));
    }
    mod_get(&hugo.path, &root, &module, &version).await
}

/// Undoes [`hugo_mod_get`]: writes go.mod and go.sum back (`null` removes the file).
#[tauri::command]
pub async fn hugo_mod_restore(state: State<'_, AppState>, texts: GoModTexts) -> AppResult<()> {
    restore_go_mod_texts(&state.site()?.root, &texts)
}

#[tauri::command]
pub async fn hugo_mod_vendor(state: State<'_, AppState>) -> AppResult<String> {
    let root = state.site()?.root;
    let hugo = state.hugo().await?;
    mod_vendor(&hugo.path, &root).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_module_arguments() {
        assert_eq!(
            check_module_arg("github.com/acme/theme/v2", "v2.1.0").unwrap(),
            "github.com/acme/theme/v2@v2.1.0"
        );
        assert!(check_module_arg("github.com/acme/theme", "latest").is_ok());
        assert!(
            check_module_arg(
                "github.com/acme/theme",
                "v0.0.0-20260101120000-abcdef123456"
            )
            .is_ok()
        );
        assert!(check_module_arg("-x", "v1").is_err());
        assert!(check_module_arg("github.com/acme/theme", "--help").is_err());
        assert!(check_module_arg("github.com/../x", "v1").is_err());
        assert!(check_module_arg("github.com/acme theme", "v1").is_err());
        assert!(check_module_arg("github.com/acme/theme", "").is_err());
    }

    #[test]
    fn restores_go_mod_and_go_sum() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("go.mod"), "module x\n\nrequire a v2\n").unwrap();
        fs::write(root.join("go.sum"), "a v2 h1:x\n").unwrap();
        restore_go_mod_texts(
            root,
            &GoModTexts {
                go_mod: Some("module x\n\nrequire a v1\n".into()),
                go_sum: None,
            },
        )
        .unwrap();
        assert_eq!(
            read_go_mod_texts(root).unwrap(),
            GoModTexts {
                go_mod: Some("module x\n\nrequire a v1\n".into()),
                go_sum: None
            }
        );
        assert!(
            restore_go_mod_texts(
                root,
                &GoModTexts {
                    go_mod: Some("not go".into()),
                    go_sum: None
                }
            )
            .is_err()
        );
    }
}
