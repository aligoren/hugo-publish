//! Creating a new Hugo site and installing a theme from a GitHub repository archive.

use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::process::Command;

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::hugo::short_command;

/// Largest theme archive accepted (themes are usually well under 50 MB).
const MAX_ARCHIVE_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSiteOptions {
    /// Existing folder the site folder is created in.
    pub parent_dir: String,
    /// Folder name of the new site.
    pub name: String,
    pub title: String,
    /// Site language code, e.g. `tr` or `en`.
    pub language: String,
    /// Theme to install, if any.
    #[serde(default)]
    pub theme: Option<ThemeSource>,
    #[serde(default)]
    pub git_init: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSource {
    pub owner: String,
    pub repo: String,
    /// Branch, tag or commit; default branch when empty.
    #[serde(default)]
    pub reference: Option<String>,
    /// Folder name under `themes/` and the value of `theme` in the config.
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledTheme {
    pub name: String,
    /// Site-relative folder, e.g. `themes/PaperMod`.
    pub path: String,
    pub files: usize,
}

/// `owner`, `repo` and refs from the UI end up in a URL: keep them to safe characters.
fn check_segment(value: &str, what: &str) -> AppResult<()> {
    let ok = !value.is_empty()
        && value.len() <= 100
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
        && !value.contains("..");
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("invalid {what}: {value}")))
    }
}

fn check_folder_name(name: &str) -> AppResult<()> {
    let ok = !name.is_empty()
        && Path::new(name).components().count() == 1
        && matches!(
            Path::new(name).components().next(),
            Some(Component::Normal(_))
        )
        && !name.starts_with('.');
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("invalid folder name: {name}")))
    }
}

/// Downloads `https://codeload.github.com/<owner>/<repo>/zip/<ref>`.
async fn download_archive(source: &ThemeSource) -> AppResult<Vec<u8>> {
    check_segment(&source.owner, "owner")?;
    check_segment(&source.repo, "repository")?;
    let reference = source.reference.as_deref().unwrap_or("HEAD");
    check_segment(reference, "reference")?;
    let url = format!(
        "https://codeload.github.com/{}/{}/zip/{}",
        source.owner, source.repo, reference
    );
    let client = reqwest::Client::builder()
        .user_agent(concat!("HugoPublisher/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("download failed: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "download failed: {} returned {}",
            url,
            response.status()
        )));
    }
    if response.content_length().unwrap_or(0) > MAX_ARCHIVE_BYTES {
        return Err(AppError::Invalid("theme archive is too large".into()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("download failed: {e}")))?;
    Ok(bytes.to_vec())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub default_branch: String,
    /// Commit the requested reference (or the default branch) points to.
    pub commit: String,
    /// Newest tags first, as GitHub lists them (at most 100).
    pub tags: Vec<String>,
}

fn api_json(text: &str, what: &str) -> AppResult<serde_json::Value> {
    serde_json::from_str(text)
        .map_err(|e| AppError::Invalid(format!("unexpected answer from GitHub ({what}): {e}")))
}

/// Parses the answers of `/repos/{o}/{r}`, `/repos/{o}/{r}/commits/{ref}` and `/tags`.
pub fn parse_repo_info(repo: &str, commit: &str, tags: &str) -> AppResult<RepoInfo> {
    let repo = api_json(repo, "repository")?;
    let commit = api_json(commit, "commit")?;
    let tags = api_json(tags, "tags")?;
    let text = |value: &serde_json::Value, key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .ok_or_else(|| AppError::Invalid(format!("GitHub answer without `{key}`")))
    };
    Ok(RepoInfo {
        default_branch: text(&repo, "default_branch")?,
        commit: text(&commit, "sha")?,
        tags: tags
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|tag| tag.get("name")?.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// The default branch, the commit a reference resolves to, and the tags of a GitHub repository
/// (unauthenticated GitHub API, three requests).
pub async fn repo_info(owner: &str, repo: &str, reference: Option<&str>) -> AppResult<RepoInfo> {
    use crate::hugo::manager::github::fetch_text;
    check_segment(owner, "owner")?;
    check_segment(repo, "repository")?;
    let base = format!("https://api.github.com/repos/{owner}/{repo}");
    let repo_text = fetch_text(&base).await?;
    let reference = match reference.filter(|r| !r.is_empty()) {
        Some(reference) => reference.to_owned(),
        None => api_json(&repo_text, "repository")?
            .get("default_branch")
            .and_then(|v| v.as_str())
            .unwrap_or("HEAD")
            .to_owned(),
    };
    check_segment(&reference, "reference")?;
    let commit_text = fetch_text(&format!("{base}/commits/{reference}")).await?;
    let tags_text = fetch_text(&format!("{base}/tags?per_page=100")).await?;
    parse_repo_info(&repo_text, &commit_text, &tags_text)
}

#[tauri::command]
pub async fn theme_repo_info(
    owner: String,
    repo: String,
    reference: Option<String>,
) -> AppResult<RepoInfo> {
    repo_info(&owner, &repo, reference.as_deref()).await
}

/// Extracts a GitHub zip archive (one top-level folder) into `target`, dropping that folder,
/// `.github/` and the `exampleSite/` (themes' demo content, often large).
pub fn extract_archive(bytes: &[u8], target: &Path) -> AppResult<usize> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| AppError::Invalid(format!("not a zip archive: {e}")))?;
    let mut written = 0;
    let mut total: u64 = 0;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| AppError::Invalid(format!("broken archive: {e}")))?;
        // `enclosed_name` rejects absolute paths and `..` components.
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let mut parts = name.components();
        parts.next(); // the `<repo>-<ref>/` folder
        let relative: PathBuf = parts.collect();
        let first = relative
            .components()
            .next()
            .map(|c| c.as_os_str().to_owned());
        if relative.as_os_str().is_empty()
            || first.as_deref() == Some(".github".as_ref())
            || first.as_deref() == Some("exampleSite".as_ref())
        {
            continue;
        }
        let destination = target.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination)?;
            continue;
        }
        total += entry.size();
        if total > MAX_ARCHIVE_BYTES {
            return Err(AppError::Invalid("theme archive is too large".into()));
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut contents = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut contents)?;
        fs::write(&destination, contents)?;
        written += 1;
    }
    if written == 0 {
        return Err(AppError::Invalid("the archive is empty".into()));
    }
    Ok(written)
}

/// Downloads a theme into `<site>/themes/<name>`. Refuses to replace an existing folder.
pub async fn install_theme(site_root: &Path, source: &ThemeSource) -> AppResult<InstalledTheme> {
    check_folder_name(&source.name)?;
    let themes = site_root.join("themes");
    let target = themes.join(&source.name);
    if target.exists() {
        return Err(AppError::Invalid(format!(
            "themes/{} already exists",
            source.name
        )));
    }
    let bytes = download_archive(source).await?;
    // Extract next to the final folder, then rename, so a failure never leaves half a theme.
    let staging = themes.join(format!(".{}.download", source.name));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging)?;
    let result = extract_archive(&bytes, &staging).and_then(|files| {
        fs::rename(&staging, &target)?;
        Ok(files)
    });
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    Ok(InstalledTheme {
        name: source.name.clone(),
        path: format!("themes/{}", source.name),
        files: result?,
    })
}

/// Where a downloaded theme update waits for review: inside the site, so the UI can read it with
/// the normal site-scoped commands, but in the app's own hidden folder.
pub fn update_dir(name: &str) -> String {
    format!(".hugo-publisher/theme-update/{name}")
}

/// Downloads a new version of an installed theme next to the site for review (see
/// [`apply_theme_update`]). An earlier staged update of the same theme is replaced.
pub async fn stage_theme_update(
    site_root: &Path,
    source: &ThemeSource,
) -> AppResult<InstalledTheme> {
    check_folder_name(&source.name)?;
    let target = site_root.join(update_dir(&source.name));
    let bytes = download_archive(source).await?;
    let _ = fs::remove_dir_all(&target);
    fs::create_dir_all(&target)?;
    match extract_archive(&bytes, &target) {
        Ok(files) => Ok(InstalledTheme {
            name: source.name.clone(),
            path: update_dir(&source.name),
            files,
        }),
        Err(error) => {
            let _ = fs::remove_dir_all(&target);
            Err(error)
        }
    }
}

/// Replaces `themes/<name>` with the staged update. The old folder is kept until the new one is
/// in place, and restored if the swap fails.
pub fn apply_theme_update(site_root: &Path, name: &str) -> AppResult<()> {
    check_folder_name(name)?;
    let staged = site_root.join(update_dir(name));
    if !staged.is_dir() {
        return Err(AppError::Invalid(format!("no staged update for {name}")));
    }
    let current = site_root.join("themes").join(name);
    let backup = site_root.join("themes").join(format!(".{name}.previous"));
    let _ = fs::remove_dir_all(&backup);
    if current.exists() {
        fs::rename(&current, &backup)?;
    }
    if let Err(error) = fs::rename(&staged, &current) {
        if backup.exists() {
            let _ = fs::rename(&backup, &current);
        }
        return Err(error.into());
    }
    let _ = fs::remove_dir_all(&backup);
    Ok(())
}

#[tauri::command]
pub async fn theme_stage_update(
    state: State<'_, AppState>,
    source: ThemeSource,
) -> AppResult<InstalledTheme> {
    let site = state.site()?;
    stage_theme_update(&site.root, &source).await
}

#[tauri::command]
pub async fn theme_apply_update(state: State<'_, AppState>, name: String) -> AppResult<()> {
    let site = state.site()?;
    apply_theme_update(&site.root, &name)
}

#[tauri::command]
pub async fn theme_discard_update(state: State<'_, AppState>, name: String) -> AppResult<()> {
    let site = state.site()?;
    check_folder_name(&name)?;
    let staged = site.root.join(update_dir(&name));
    if staged.exists() {
        fs::remove_dir_all(staged)?;
    }
    Ok(())
}

fn quote_toml(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

/// The `hugo.toml` of a new site.
pub fn initial_config(title: &str, language: &str, theme: Option<&str>) -> String {
    let mut config = format!(
        "baseURL = \"https://example.org/\"\nlocale = {}\ndefaultContentLanguage = {}\ntitle = {}\n",
        quote_toml(language),
        quote_toml(language),
        quote_toml(title)
    );
    if let Some(theme) = theme {
        config.push_str(&format!("theme = {}\n", quote_toml(theme)));
    }
    config
}

const GITIGNORE: &str = "# Hugo output and caches\n/public/\n/resources/_gen/\n.hugo_build.lock\n";

async fn git(dir: &Path, args: &[&str]) -> AppResult<()> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(crate::hugo::CREATE_NO_WINDOW);
    let output = tokio::time::timeout(Duration::from_secs(60), command.output())
        .await
        .map_err(|_| AppError::Invalid("git timed out".into()))??;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::Invalid(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

pub async fn create_site(hugo: &Path, options: &NewSiteOptions) -> AppResult<PathBuf> {
    check_folder_name(&options.name)?;
    let parent = fs::canonicalize(&options.parent_dir)?;
    if !parent.is_dir() {
        return Err(AppError::Invalid(format!(
            "{} is not a folder",
            options.parent_dir
        )));
    }
    let root = parent.join(&options.name);
    if root.exists() {
        return Err(AppError::Invalid(format!(
            "{} already exists",
            root.display()
        )));
    }
    let output = tokio::time::timeout(
        Duration::from_secs(60),
        short_command(hugo)
            .args(["new", "project"])
            .arg(&root)
            .args(["--format", "toml"])
            .output(),
    )
    .await
    .map_err(|_| AppError::Hugo("`hugo new project` timed out".into()))??;
    if !output.status.success() {
        return Err(AppError::Hugo(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    let theme_name = match &options.theme {
        Some(source) => Some(install_theme(&root, source).await?.name),
        None => None,
    };
    fs::write(
        root.join("hugo.toml"),
        initial_config(&options.title, &options.language, theme_name.as_deref()),
    )?;
    fs::write(root.join(".gitignore"), GITIGNORE)?;

    if options.git_init {
        git(&root, &["init", "-b", "main"]).await?;
    }
    Ok(root)
}

/// Creates a new site and returns its folder (open it with `site_open`).
#[tauri::command]
pub async fn site_create(state: State<'_, AppState>, options: NewSiteOptions) -> AppResult<String> {
    let hugo = state.hugo().await?;
    let root = create_site(&hugo.path, &options).await?;
    Ok(root.to_string_lossy().into_owned())
}

/// Installs a theme into the open site's `themes/` folder from a GitHub archive.
#[tauri::command]
pub async fn theme_install(
    state: State<'_, AppState>,
    source: ThemeSource,
) -> AppResult<InstalledTheme> {
    let site = state.site()?;
    install_theme(&site.root, &source).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default();
            for (name, text) in files {
                writer.start_file(*name, options).unwrap();
                writer.write_all(text.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    #[test]
    fn extracts_without_the_top_folder_examples_and_ci() {
        let bytes = zip_of(&[
            ("PaperMod-master/theme.toml", "name = 'x'"),
            ("PaperMod-master/layouts/baseof.html", "<html>"),
            ("PaperMod-master/exampleSite/hugo.toml", "big"),
            ("PaperMod-master/.github/workflows/ci.yml", "ci"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let count = extract_archive(&bytes, dir.path()).unwrap();
        assert_eq!(count, 2);
        assert!(dir.path().join("theme.toml").is_file());
        assert!(dir.path().join("layouts/baseof.html").is_file());
        assert!(!dir.path().join("exampleSite").exists());
        assert!(!dir.path().join(".github").exists());
    }

    #[test]
    fn applies_a_staged_update_and_keeps_the_old_one_on_failure() {
        let site = tempfile::tempdir().unwrap();
        let root = site.path();
        fs::create_dir_all(root.join("themes/T/layouts")).unwrap();
        fs::write(root.join("themes/T/old.txt"), "old").unwrap();
        assert!(apply_theme_update(root, "T").is_err());
        assert!(root.join("themes/T/old.txt").exists());

        let staged = root.join(update_dir("T"));
        fs::create_dir_all(&staged).unwrap();
        fs::write(staged.join("new.txt"), "new").unwrap();
        apply_theme_update(root, "T").unwrap();
        assert!(root.join("themes/T/new.txt").exists());
        assert!(!root.join("themes/T/old.txt").exists());
        assert!(!staged.exists());
        assert!(!root.join("themes/.T.previous").exists());
    }

    #[test]
    fn reads_repo_info_answers() {
        let info = parse_repo_info(
            r#"{"default_branch":"master","name":"x"}"#,
            r#"{"sha":"abc123","commit":{}}"#,
            r#"[{"name":"v8.0"},{"name":"v7.0"}]"#,
        )
        .unwrap();
        assert_eq!(info.default_branch, "master");
        assert_eq!(info.commit, "abc123");
        assert_eq!(info.tags, ["v8.0", "v7.0"]);
        assert!(parse_repo_info("{}", "{}", "[]").is_err());
    }

    #[test]
    fn refuses_unsafe_names() {
        assert!(check_segment("adityatelange", "owner").is_ok());
        assert!(check_segment("hugo-PaperMod", "repo").is_ok());
        assert!(check_segment("v8.0", "ref").is_ok());
        assert!(check_segment("../x", "ref").is_err());
        assert!(check_segment("a b", "owner").is_err());
        assert!(check_segment("", "owner").is_err());
        assert!(check_folder_name("PaperMod").is_ok());
        assert!(check_folder_name("../x").is_err());
        assert!(check_folder_name("a/b").is_err());
        assert!(check_folder_name(".hidden").is_err());
    }

    #[test]
    fn writes_an_escaped_initial_config() {
        let config = initial_config("Deniz'in \"notları\"", "tr", Some("PaperMod"));
        assert_eq!(
            config,
            "baseURL = \"https://example.org/\"\nlocale = \"tr\"\ndefaultContentLanguage = \"tr\"\ntitle = \"Deniz'in \\\"notları\\\"\"\ntheme = \"PaperMod\"\n"
        );
        assert!(config.parse::<toml_edit::DocumentMut>().is_ok());
    }
}
