//! Theme components as Hugo sees them: `hugo config mounts` lists every module (themes in the
//! themes folder, Hugo Modules in the module cache or `_vendor/`, local replacements) with its
//! folder and mounts. The UI reads theme files through the read-only commands here, which only
//! open folders that this listing returned for the open site.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::filehash::{FileHash, hash_files};
use super::short_command;
use crate::commands::AppState;
use crate::config::commands::messages;
use crate::error::{AppError, AppResult};
use crate::site::{self, SiteFile, TextFile};

/// Loading modules may download them (a first `hugo mod get` or a cold cache).
const MOUNTS_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleMount {
    /// Folder inside the module.
    pub source: String,
    /// Where it appears in Hugo's union file system (`layouts`, `assets/x`…).
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

/// One entry of `hugo config mounts`.
#[derive(Debug, Clone, Deserialize)]
struct RawModule {
    path: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    time: String,
    #[serde(default)]
    owner: String,
    #[serde(default)]
    dir: String,
    #[serde(default)]
    mounts: Vec<ModuleMount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HugoModule {
    /// Module path (`github.com/user/theme`), a theme folder name, or a replacement path.
    pub path: String,
    /// Version from go.mod (`v1.2.0`, a pseudo-version), empty for theme folders and replacements.
    pub version: String,
    pub time: String,
    /// The module that imports this one (`project` for the site's direct imports).
    pub owner: String,
    /// Absolute folder of the module, without a trailing separator.
    pub dir: String,
    pub mounts: Vec<ModuleMount>,
    /// Site-relative folder when the module lives inside the site (themes/, `_vendor/`).
    pub site_dir: Option<String>,
    /// Read from `<dir>/_vendor` of the site.
    pub vendored: bool,
    /// `module` line of the module's own go.mod, if it has one.
    pub module_path: Option<String>,
}

/// Parses Hugo's output: a sequence of JSON objects, one per module, not a JSON array.
pub fn parse_mounts(text: &str) -> AppResult<Vec<ParsedModule>> {
    let mut out = Vec::new();
    for value in serde_json::Deserializer::from_str(text).into_iter::<RawModule>() {
        let raw = value
            .map_err(|e| AppError::Hugo(format!("unexpected `hugo config mounts` output: {e}")))?;
        out.push(ParsedModule(raw));
    }
    Ok(out)
}

/// A parsed module before it is related to the site folder.
#[derive(Debug, Clone)]
pub struct ParsedModule(RawModule);

impl ParsedModule {
    pub fn path(&self) -> &str {
        &self.0.path
    }
    pub fn dir(&self) -> &str {
        &self.0.dir
    }
}

/// `canonicalize` without Windows' `\\?\` prefix (like the site root from `site::open`).
pub fn canonical(path: &Path) -> AppResult<PathBuf> {
    let canonical = fs::canonicalize(path)?;
    #[cfg(windows)]
    {
        let text = canonical.to_string_lossy();
        if let Some(stripped) = text.strip_prefix(r"\\?\")
            && !stripped.starts_with("UNC\\")
        {
            return Ok(PathBuf::from(stripped));
        }
    }
    Ok(canonical)
}

fn trim_dir(dir: &str) -> String {
    let trimmed = dir.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() || trimmed.ends_with(':') {
        dir.to_string()
    } else {
        trimmed.to_string()
    }
}

fn go_mod_module(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join("go.mod")).ok()?;
    text.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("module")?;
        if !rest.starts_with([' ', '\t']) {
            return None;
        }
        let name = rest.trim().trim_matches('"');
        (!name.is_empty()).then(|| name.to_string())
    })
}

/// Relates parsed modules to the site folder; the project module (the site itself) is left out.
pub fn modules_for_site(root: &Path, raw: Vec<ParsedModule>) -> Vec<HugoModule> {
    let canonical_root = canonical(root).unwrap_or_else(|_| root.to_path_buf());
    let vendor = canonical_root.join("_vendor");
    raw.into_iter()
        .map(|ParsedModule(m)| {
            let dir = trim_dir(&m.dir);
            let real = canonical(Path::new(&dir)).ok();
            (m, dir, real)
        })
        // The project module has no owner; its folder is the site itself.
        .filter(|(m, _, real)| !m.owner.is_empty() && real.as_ref() != Some(&canonical_root))
        .map(|(m, dir, real)| {
            let site_dir = real
                .as_ref()
                .and_then(|r| r.strip_prefix(&canonical_root).ok())
                .filter(|rel| !rel.as_os_str().is_empty())
                .map(|rel| rel.to_string_lossy().replace('\\', "/"));
            let vendored = real.as_ref().is_some_and(|r| r.starts_with(&vendor));
            let module_path = real.as_deref().and_then(go_mod_module);
            HugoModule {
                path: m.path,
                version: m.version,
                time: m.time,
                owner: m.owner,
                dir,
                mounts: m.mounts,
                site_dir,
                vendored,
                module_path,
            }
        })
        .collect()
}

/// Runs `hugo config mounts` for the site. `ignore_vendor` resolves modules from the module
/// cache even when the site has a `_vendor/` folder (to see a version just fetched with
/// `hugo mod get` before it is vendored).
pub async fn config_mounts(
    hugo: &Path,
    root: &Path,
    ignore_vendor: bool,
) -> AppResult<Vec<HugoModule>> {
    let mut command = short_command(hugo);
    command
        .args(["config", "mounts", "--noBuildLock", "--source"])
        .arg(root);
    if ignore_vendor {
        command.args(["--ignoreVendorPaths", "**"]);
    }
    let output = tokio::time::timeout(MOUNTS_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::Hugo("`hugo config mounts` timed out".into()))??;
    if !output.status.success() {
        let text = messages(&output.stderr)
            .into_iter()
            .map(|m| m.text)
            .collect::<Vec<_>>()
            .join("\n");
        return Err(AppError::Hugo(text));
    }
    let raw = parse_mounts(&String::from_utf8_lossy(&output.stdout))?;
    Ok(modules_for_site(root, raw))
}

/// The canonical folder of `dir` when it is one of `modules`; anything else is refused.
pub fn allowed_dir(modules: &[HugoModule], dir: &str) -> AppResult<PathBuf> {
    let refused = || AppError::PathOutsideSite(dir.to_string());
    let wanted = canonical(Path::new(dir)).map_err(|_| refused())?;
    modules
        .iter()
        .filter_map(|m| canonical(Path::new(&m.dir)).ok())
        .find(|known| *known == wanted)
        .ok_or_else(refused)
}

/// Files under `sub` (module-relative, `.` for all) of a module folder, paths relative to it.
pub fn list_module_files(dir: &Path, sub: &str, extensions: &[String]) -> AppResult<Vec<SiteFile>> {
    let sub = if sub.trim().is_empty() { "." } else { sub };
    site::list_files(dir, sub, extensions)
}

pub fn read_module_text(dir: &Path, path: &str) -> AppResult<TextFile> {
    site::read_text(dir, path)
}

// ---- Commands -------------------------------------------------------------------------------

/// Module folders the UI may read, per site root (both the vendored and the cache listing).
fn known() -> &'static Mutex<HashMap<PathBuf, Vec<HugoModule>>> {
    static KNOWN: OnceLock<Mutex<HashMap<PathBuf, Vec<HugoModule>>>> = OnceLock::new();
    KNOWN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember(root: &Path, modules: &[HugoModule]) {
    let mut map = known().lock().unwrap();
    let list = map.entry(root.to_path_buf()).or_default();
    for module in modules {
        if !list.iter().any(|m| m.dir == module.dir) {
            list.push(module.clone());
        }
    }
}

/// The folder of a module of the open site; the module list is loaded again when `dir` is not
/// (yet) known, e.g. after `hugo mod get` moved a module to a new version.
async fn module_dir(state: &AppState, dir: &str) -> AppResult<PathBuf> {
    let root = state.site()?.root;
    let cached = known().lock().unwrap().get(&root).cloned();
    if let Some(found) = cached.and_then(|list| allowed_dir(&list, dir).ok()) {
        return Ok(found);
    }
    let hugo = state.hugo().await?;
    let mut fresh = config_mounts(&hugo.path, &root, false).await?;
    if root.join("_vendor").is_dir() {
        fresh.extend(
            config_mounts(&hugo.path, &root, true)
                .await
                .unwrap_or_default(),
        );
    }
    remember(&root, &fresh);
    allowed_dir(&fresh, dir)
}

/// The theme components of the open site (Hugo's order, the site itself left out).
#[tauri::command]
pub async fn hugo_module_list(
    state: State<'_, AppState>,
    ignore_vendor: Option<bool>,
) -> AppResult<Vec<HugoModule>> {
    let root = state.site()?.root;
    let hugo = state.hugo().await?;
    let modules = config_mounts(&hugo.path, &root, ignore_vendor.unwrap_or(false)).await?;
    remember(&root, &modules);
    Ok(modules)
}

/// Files of a module folder returned by [`hugo_module_list`]; paths relative to that folder.
#[tauri::command]
pub async fn hugo_module_list_files(
    state: State<'_, AppState>,
    dir: String,
    sub: String,
    extensions: Vec<String>,
) -> AppResult<Vec<SiteFile>> {
    let base = module_dir(&state, &dir).await?;
    list_module_files(&base, &sub, &extensions)
}

/// A text file inside a module folder returned by [`hugo_module_list`].
#[tauri::command]
pub async fn hugo_module_read_text(
    state: State<'_, AppState>,
    dir: String,
    path: String,
) -> AppResult<TextFile> {
    let base = module_dir(&state, &dir).await?;
    read_module_text(&base, &path)
}

/// Content hashes of files inside a module folder (see [`super::filehash`]).
#[tauri::command]
pub async fn hugo_module_hash_files(
    state: State<'_, AppState>,
    dir: String,
    paths: Vec<String>,
) -> AppResult<Vec<FileHash>> {
    let base = module_dir(&state, &dir).await?;
    tauri::async_runtime::spawn_blocking(move || hash_files(&base, &paths))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
   "path": "project",
   "version": "",
   "time": "0001-01-01T00:00:00Z",
   "owner": "",
   "dir": "C:\\site",
   "mounts": [{"source": "content", "target": "content"}]
}
{
   "path": "github.com/acme/theme",
   "version": "v1.2.0",
   "time": "2026-01-01T00:00:00Z",
   "owner": "project",
   "dir": "C:\\cache\\github.com\\acme\\theme@v1.2.0\\",
   "mounts": [{"source": "layouts", "target": "layouts"}, {"source": "i18n", "target": "i18n", "lang": "en"}]
}
"#;

    #[test]
    fn parses_a_stream_of_objects_and_drops_the_project() {
        let raw = parse_mounts(SAMPLE).unwrap();
        assert_eq!(raw.len(), 2);
        assert_eq!(raw[0].path(), "project");
        let modules = modules_for_site(Path::new("C:\\site"), raw);
        assert_eq!(modules.len(), 1);
        let module = &modules[0];
        assert_eq!(module.path, "github.com/acme/theme");
        assert_eq!(module.version, "v1.2.0");
        assert_eq!(module.dir, "C:\\cache\\github.com\\acme\\theme@v1.2.0");
        assert_eq!(module.mounts[1].lang.as_deref(), Some("en"));
        assert!(!module.vendored);
        assert_eq!(parse_mounts("").unwrap().len(), 0);
        assert!(parse_mounts("{ broken").is_err());
    }

    #[test]
    fn relates_modules_to_the_site_and_refuses_unknown_folders() {
        let site = tempfile::tempdir().unwrap();
        let root = canonical(site.path()).unwrap();
        let theme = root.join("_vendor/github.com/acme/theme");
        fs::create_dir_all(&theme).unwrap();
        fs::write(
            theme.join("go.mod"),
            "module github.com/acme/theme\n\ngo 1.20\n",
        )
        .unwrap();
        let outside = tempfile::tempdir().unwrap();
        let json = serde_json::json!([
            {"path": "project", "owner": "", "dir": root},
            {"path": "github.com/acme/theme", "version": "v1.0.0", "owner": "project", "dir": format!("{}{}", theme.display(), std::path::MAIN_SEPARATOR)},
            {"path": "../x", "owner": "project", "dir": outside.path()},
        ]);
        let text: String = json
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let modules = modules_for_site(&root, parse_mounts(&text).unwrap());
        assert_eq!(modules.len(), 2);
        assert_eq!(
            modules[0].site_dir.as_deref(),
            Some("_vendor/github.com/acme/theme")
        );
        assert!(modules[0].vendored);
        assert_eq!(
            modules[0].module_path.as_deref(),
            Some("github.com/acme/theme")
        );
        assert_eq!(modules[1].site_dir, None);

        assert!(allowed_dir(&modules, &theme.to_string_lossy()).is_ok());
        assert!(allowed_dir(&modules, &outside.path().to_string_lossy()).is_ok());
        assert!(allowed_dir(&modules, &root.to_string_lossy()).is_err());
        assert!(allowed_dir(&modules, &root.join("_vendor").to_string_lossy()).is_err());
        assert!(allowed_dir(&modules, "Z:\\nowhere").is_err());
    }
}
