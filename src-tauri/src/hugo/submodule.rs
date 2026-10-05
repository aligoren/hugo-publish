//! Themes that are git submodules (`themes/x` listed in `.gitmodules`). An update is reviewed
//! like any other (the new version is staged from GitHub for the drift review) and then applied
//! with `git fetch --tags origin` + `git checkout <ref>` inside the submodule. Never forced:
//! a submodule with local changes is refused, and git itself refuses to overwrite files.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::git::runner::{Git, LONG_TIMEOUT, write_lock};
use crate::site;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub name: String,
    /// Path relative to the site folder (forward slashes).
    pub path: String,
    pub url: String,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleStatus {
    pub path: String,
    /// False when the submodule folder is not checked out (`git submodule update --init`).
    pub initialized: bool,
    pub head: Option<String>,
    /// `git describe --tags --always`, e.g. `v7.0` or `v7.0-3-gabc1234`.
    pub describe: Option<String>,
    /// Tracked files with local changes (`git status --porcelain`, untracked files left out).
    pub changes: Vec<String>,
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .unwrap_or(value)
        .to_string()
}

/// Parses a `.gitmodules` file. `prefix` is the site folder relative to the repository root
/// (`""` when the site is the repository); submodules outside the site are left out.
pub fn parse_gitmodules(text: &str, prefix: &str) -> Vec<Submodule> {
    let mut out = Vec::new();
    /// A `[submodule "name"]` section being read.
    #[derive(Default)]
    struct Section {
        name: String,
        path: Option<String>,
        url: Option<String>,
        branch: Option<String>,
    }
    let mut current: Option<Section> = None;
    let mut flush = |entry: Option<Section>| {
        if let Some(Section {
            name,
            path: Some(path),
            url,
            branch,
        }) = entry
        {
            let path = path.replace('\\', "/");
            let prefix = prefix.trim_end_matches('/');
            let relative = if prefix.is_empty() {
                Some(path.as_str())
            } else {
                path.strip_prefix(prefix).and_then(|p| p.strip_prefix('/'))
            };
            if let Some(relative) = relative.filter(|p| !p.is_empty()) {
                out.push(Submodule {
                    name,
                    path: relative.trim_end_matches('/').to_string(),
                    url: url.unwrap_or_default(),
                    branch,
                });
            }
        }
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(header) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            flush(current.take());
            let header = header.trim();
            current = header.strip_prefix("submodule").map(|rest| Section {
                name: unquote(rest),
                ..Section::default()
            });
            continue;
        }
        let Some(entry) = current.as_mut() else {
            continue;
        };
        if let Some((key, value)) = line.split_once('=') {
            match key.trim().to_ascii_lowercase().as_str() {
                "path" => entry.path = Some(unquote(value)),
                "url" => entry.url = Some(unquote(value)),
                "branch" => entry.branch = Some(unquote(value)),
                _ => {}
            }
        }
    }
    flush(current.take());
    out
}

/// The repository root and the site's path inside it, or None outside a repository.
async fn repo_of(root: &Path) -> AppResult<Option<(PathBuf, String)>> {
    let output = Git::new(root)
        .args(["rev-parse", "--show-toplevel", "--show-prefix"])
        .read_only()
        .output()
        .await?;
    if !output.success {
        return Ok(None);
    }
    let text = output.stdout_text();
    let mut lines = text.lines();
    let top = lines.next().unwrap_or_default().trim();
    let prefix = lines.next().unwrap_or_default().trim().to_string();
    if top.is_empty() {
        return Ok(None);
    }
    Ok(Some((PathBuf::from(top), prefix)))
}

/// Submodules inside the site folder.
pub async fn list_submodules(root: &Path) -> AppResult<Vec<Submodule>> {
    let Some((top, prefix)) = repo_of(root).await? else {
        return Ok(Vec::new());
    };
    match fs::read_to_string(top.join(".gitmodules")) {
        Ok(text) => Ok(parse_gitmodules(&text, &prefix)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.into()),
    }
}

/// The folder of a submodule of the site; anything not in `.gitmodules` is refused.
async fn submodule_dir(root: &Path, path: &str) -> AppResult<PathBuf> {
    let wanted = path.replace('\\', "/").trim_end_matches('/').to_string();
    let known = list_submodules(root).await?;
    if !known.iter().any(|s| s.path == wanted) {
        return Err(AppError::Invalid(format!("{path} is not a git submodule")));
    }
    site::resolve(root, &wanted)
}

async fn git_text(dir: &Path, args: &[&str]) -> AppResult<Option<String>> {
    let output = Git::new(dir).args(args).read_only().output().await?;
    Ok(output
        .success
        .then(|| output.stdout_text().trim().to_string())
        .filter(|t| !t.is_empty()))
}

pub async fn submodule_status(root: &Path, path: &str) -> AppResult<SubmoduleStatus> {
    let dir = submodule_dir(root, path).await?;
    let path = path.replace('\\', "/");
    // A submodule checkout has its own `.git` file (or folder); otherwise git would answer
    // for the parent repository.
    if !dir.join(".git").exists() {
        return Ok(SubmoduleStatus {
            path,
            initialized: false,
            head: None,
            describe: None,
            changes: Vec::new(),
        });
    }
    let head = git_text(&dir, &["rev-parse", "HEAD"]).await?;
    let describe = git_text(&dir, &["describe", "--tags", "--always"]).await?;
    let changes = git_text(&dir, &["status", "--porcelain", "--untracked-files=no"])
        .await?
        .map(|text| {
            text.lines()
                .filter_map(|l| l.get(3..))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Ok(SubmoduleStatus {
        path,
        initialized: true,
        head,
        describe,
        changes,
    })
}

/// Branch, tag or commit names that are safe to hand to git (never an option).
pub fn check_reference(reference: &str) -> AppResult<()> {
    let ok = !reference.is_empty()
        && reference.len() <= 200
        && !reference.starts_with('-')
        && !reference.contains("..")
        && reference
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '/' | '+'));
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("invalid reference: {reference}")))
    }
}

/// `git fetch --tags origin` and `git checkout <reference>` inside the submodule. Refused when
/// the submodule has local changes. The parent repository then shows a changed submodule
/// pointer, which the user commits like any other change.
pub async fn submodule_checkout(
    root: &Path,
    path: &str,
    reference: &str,
) -> AppResult<SubmoduleStatus> {
    check_reference(reference)?;
    let before = submodule_status(root, path).await?;
    if !before.initialized {
        return Err(AppError::Invalid(format!(
            "{path} is not checked out (run `git submodule update --init`)"
        )));
    }
    if !before.changes.is_empty() {
        return Err(AppError::Invalid(format!(
            "{path} has local changes: {}",
            before.changes.join(", ")
        )));
    }
    let dir = submodule_dir(root, path).await?;
    {
        let _lock = write_lock().await;
        Git::new(&dir)
            .args(["fetch", "--tags", "origin"])
            .timeout(LONG_TIMEOUT)
            .run()
            .await?;
        Git::new(&dir)
            .args(["checkout", "--quiet", reference, "--"])
            .run()
            .await?;
    }
    submodule_status(root, path).await
}

#[tauri::command]
pub async fn theme_submodules(state: State<'_, AppState>) -> AppResult<Vec<Submodule>> {
    list_submodules(&state.site()?.root).await
}

#[tauri::command]
pub async fn theme_submodule_status(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<SubmoduleStatus> {
    submodule_status(&state.site()?.root, &path).await
}

#[tauri::command]
pub async fn theme_submodule_checkout(
    state: State<'_, AppState>,
    path: String,
    reference: String,
) -> AppResult<SubmoduleStatus> {
    submodule_checkout(&state.site()?.root, &path, &reference).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const GITMODULES: &str = r#"
[submodule "themes/PaperMod"]
	path = themes/PaperMod
	url = https://github.com/adityatelange/hugo-PaperMod.git
	branch = master
# comment
[submodule "site/themes/ananke"]
	path = site/themes/ananke
	url = git@github.com:theNewDynamic/gohugo-theme-ananke.git
[submodule "broken"]
	url = https://example.org/x.git
"#;

    #[test]
    fn parses_gitmodules() {
        let all = parse_gitmodules(GITMODULES, "");
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "themes/PaperMod");
        assert_eq!(all[0].path, "themes/PaperMod");
        assert_eq!(all[0].branch.as_deref(), Some("master"));
        let nested = parse_gitmodules(GITMODULES, "site/");
        assert_eq!(nested.len(), 1);
        assert_eq!(nested[0].path, "themes/ananke");
        assert_eq!(
            nested[0].url,
            "git@github.com:theNewDynamic/gohugo-theme-ananke.git"
        );
    }

    #[test]
    fn checks_references() {
        for good in ["v7.0", "main", "origin/HEAD", "0123abc", "release/1.0+x"] {
            assert!(check_reference(good).is_ok(), "{good}");
        }
        for bad in ["", "-f", "--force", "a..b", "a b", "x;y"] {
            assert!(check_reference(bad).is_err(), "{bad}");
        }
    }
}
