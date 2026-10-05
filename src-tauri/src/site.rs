//! The opened Hugo site: discovery, safe path resolution, and exact text reads and writes.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const ROOT_CONFIG_NAMES: [&str; 6] = [
    "hugo.toml",
    "hugo.yaml",
    "hugo.json",
    "config.toml",
    "config.yaml",
    "config.json",
];
const CONTENT_EXTENSIONS: [&str; 3] = ["md", "markdown", "mdown"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteInfo {
    pub root: PathBuf,
    pub name: String,
    /// Config files relative to the root, in Hugo's precedence order (root file first).
    pub config_files: Vec<String>,
    pub content_dir: String,
    pub is_git_repo: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    /// Exact file contents (BOM and CRLF included).
    pub text: String,
    /// Opaque version for detecting changes made by other programs.
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentFile {
    pub path: String,
    pub title: Option<String>,
    pub modified_ms: u64,
}

pub fn open(path: &Path) -> AppResult<SiteInfo> {
    let root = dunce_canonicalize(path)?;
    if !root.is_dir() {
        return Err(AppError::NotASite(path.display().to_string()));
    }
    let mut config_files: Vec<String> = ROOT_CONFIG_NAMES
        .iter()
        .filter(|name| root.join(name).is_file())
        .map(|name| name.to_string())
        .collect();
    let default_dir = root.join("config").join("_default");
    if let Ok(entries) = fs::read_dir(&default_dir) {
        let mut split: Vec<String> = entries
            .flatten()
            .filter(|e| e.path().is_file())
            .map(|e| format!("config/_default/{}", e.file_name().to_string_lossy()))
            .collect();
        split.sort();
        config_files.extend(split);
    }
    let content_dir = "content".to_string();
    if config_files.is_empty() && !root.join(&content_dir).is_dir() {
        return Err(AppError::NotASite(root.display().to_string()));
    }
    Ok(SiteInfo {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        is_git_repo: root.join(".git").exists(),
        root,
        config_files,
        content_dir,
    })
}

/// Resolves a site-relative path, refusing anything that could leave the site folder.
pub fn resolve(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let outside = || AppError::PathOutsideSite(relative.to_string());
    let candidate = Path::new(relative);
    if relative.is_empty()
        || candidate
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(outside());
    }
    let joined = root.join(candidate);
    // Symlinks could still point elsewhere: check the real location of the deepest existing part.
    let mut existing = joined.as_path();
    while !existing.exists() {
        existing = existing.parent().ok_or_else(outside)?;
    }
    if !dunce_canonicalize(existing)?.starts_with(root) {
        return Err(outside());
    }
    Ok(joined)
}

pub fn read_text(root: &Path, relative: &str) -> AppResult<TextFile> {
    let path = resolve(root, relative)?;
    let bytes = fs::read(&path)?;
    let version = version_of(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| AppError::NotUtf8(relative.to_string()))?;
    Ok(TextFile { text, version })
}

/// Writes `text` exactly as given. When `expected_version` is set and the file on disk no longer
/// matches it, nothing is written and [`AppError::Conflict`] is returned.
pub fn write_text(
    root: &Path,
    relative: &str,
    text: &str,
    expected_version: Option<&str>,
) -> AppResult<String> {
    let path = resolve(root, relative)?;
    if let Some(expected) = expected_version {
        let current = fs::read(&path).map(|b| version_of(&b)).unwrap_or_default();
        if current != expected {
            return Err(AppError::Conflict);
        }
    }
    atomic_write(&path, text.as_bytes())?;
    Ok(version_of(text.as_bytes()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteFile {
    pub path: String,
    pub size: u64,
}

/// Upper bound for [`list_files`], so a stray huge folder cannot freeze the UI.
const MAX_LISTED_FILES: usize = 50_000;

/// Files under a site-relative folder (`.` for the whole site), skipping hidden entries and
/// `node_modules`. `extensions` are compared case-insensitively, without dots; empty means all.
pub fn list_files(root: &Path, dir: &str, extensions: &[String]) -> AppResult<Vec<SiteFile>> {
    let base = resolve(root, dir)?;
    let wanted: Vec<String> = extensions
        .iter()
        .map(|e| e.trim_start_matches('.').to_ascii_lowercase())
        .collect();
    let mut files = Vec::new();
    if base.is_dir() {
        walk_filtered(&base, &mut |path| {
            if files.len() >= MAX_LISTED_FILES {
                return;
            }
            let matches = wanted.is_empty()
                || path
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| wanted.contains(&e.to_ascii_lowercase()));
            if matches {
                files.push(SiteFile {
                    path: path
                        .strip_prefix(root)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .replace('\\', "/"),
                    size: fs::metadata(path).map_or(0, |m| m.len()),
                });
            }
        })?;
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Deletes a content file, or a page bundle folder (one with `index.md` or `_index.md`).
/// Anything outside `content/` is refused.
pub fn delete_content(root: &Path, relative: &str) -> AppResult<()> {
    let normalized = relative.replace('\\', "/");
    if !normalized.starts_with("content/") {
        return Err(AppError::PathOutsideSite(relative.to_string()));
    }
    let path = resolve(root, relative)?;
    if path.is_dir() {
        let is_bundle = ["index.md", "_index.md"]
            .iter()
            .any(|name| path.join(name).is_file());
        if !is_bundle {
            return Err(AppError::Invalid(format!(
                "{relative} is a folder but not a page bundle"
            )));
        }
        fs::remove_dir_all(&path)?;
    } else {
        fs::remove_file(&path)?;
    }
    Ok(())
}

/// Deletes one file that overrides a theme file (under `layouts/`, `assets/`, `i18n/` or
/// `archetypes/`). Folders and anything else are refused.
pub fn delete_override(root: &Path, relative: &str) -> AppResult<()> {
    let normalized = relative.replace('\\', "/");
    let allowed = ["layouts/", "assets/", "i18n/", "archetypes/"]
        .iter()
        .any(|prefix| normalized.starts_with(prefix));
    if !allowed {
        return Err(AppError::PathOutsideSite(relative.to_string()));
    }
    let path = resolve(root, relative)?;
    if !path.is_file() {
        return Err(AppError::Invalid(format!("{relative} is not a file")));
    }
    fs::remove_file(path)?;
    Ok(())
}

/// Renames or moves a file or folder inside the site. Refuses to overwrite anything.
pub fn rename(root: &Path, from: &str, to: &str) -> AppResult<String> {
    let source = resolve(root, from)?;
    let target = resolve(root, to)?;
    if !source.exists() {
        return Err(AppError::Invalid(format!("{from} does not exist")));
    }
    if target.exists() {
        return Err(AppError::Invalid(format!("{to} already exists")));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&source, &target)?;
    Ok(to.replace('\\', "/"))
}

fn walk_filtered(dir: &Path, visit: &mut dyn FnMut(&Path)) -> AppResult<()> {
    for entry in fs::read_dir(dir)?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            walk_filtered(&path, visit)?;
        } else {
            visit(&path);
        }
    }
    Ok(())
}

/// Markdown files under the content folder, with a cheap title guess from the front matter.
pub fn list_content(site: &SiteInfo) -> AppResult<Vec<ContentFile>> {
    let base = site.root.join(&site.content_dir);
    let mut files = Vec::new();
    if base.is_dir() {
        walk(&base, &mut |path| {
            let is_content = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| CONTENT_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
            if !is_content {
                return;
            }
            let relative = path
                .strip_prefix(&site.root)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            let modified_ms = fs::metadata(path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            let title = fs::read_to_string(path)
                .ok()
                .and_then(|t| front_matter_title(&t));
            files.push(ContentFile {
                path: relative,
                title,
                modified_ms,
            });
        })?;
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn walk(dir: &Path, visit: &mut dyn FnMut(&Path)) -> AppResult<()> {
    for entry in fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        let hidden = entry.file_name().to_string_lossy().starts_with('.');
        if hidden {
            continue;
        }
        if path.is_dir() {
            walk(&path, visit)?;
        } else {
            visit(&path);
        }
    }
    Ok(())
}

/// Reads `title` from YAML (`title: x`) or TOML (`title = x`) front matter without a full parse.
pub fn front_matter_title(text: &str) -> Option<String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    let fence = lines.next()?.trim_end();
    if fence != "---" && fence != "+++" {
        return None;
    }
    for line in lines {
        if line.trim_end() == fence {
            break;
        }
        let Some(rest) = line
            .strip_prefix("title")
            .map(str::trim_start)
            .and_then(|r| r.strip_prefix(':').or_else(|| r.strip_prefix('=')))
        else {
            continue;
        };
        let value = rest.trim();
        let unquoted = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        return Some(unquoted.to_string());
    }
    None
}

fn version_of(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}-{}", hasher.finish(), bytes.len())
}

/// Writes to a temporary file in the same folder, then renames it over the target, so a crash
/// can never leave a half-written file.
fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::Invalid(format!("no parent folder for {}", path.display())))?;
    fs::create_dir_all(dir)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    let temp = dir.join(format!(".{name}.hugo-publisher-{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    Ok(result?)
}

/// `canonicalize` without Windows' `\\?\` prefix, so paths stay readable and comparable.
fn dunce_canonicalize(path: &Path) -> AppResult<PathBuf> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn site() -> (tempfile::TempDir, SiteInfo) {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("hugo.toml"), "title = \"x\"\n").unwrap();
        fs::create_dir_all(dir.path().join("content/posts")).unwrap();
        fs::write(
            dir.path().join("content/posts/a.md"),
            "---\ntitle: \"Merhaba: dünya\"\n---\nGövde\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("content/_index.md"),
            "+++\ntitle = 'Ana'\n+++\n",
        )
        .unwrap();
        fs::write(dir.path().join("content/posts/notes.txt"), "not content").unwrap();
        let info = open(dir.path()).unwrap();
        (dir, info)
    }

    #[test]
    fn opens_a_site() {
        let (_dir, info) = site();
        assert_eq!(info.config_files, vec!["hugo.toml"]);
        assert!(!info.is_git_repo);
    }

    #[test]
    fn refuses_folders_that_are_not_sites() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(open(dir.path()), Err(AppError::NotASite(_))));
    }

    #[test]
    fn lists_markdown_with_titles() {
        let (_dir, info) = site();
        let files = list_content(&info).unwrap();
        let summary: Vec<_> = files
            .iter()
            .map(|f| (f.path.as_str(), f.title.as_deref()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("content/_index.md", Some("Ana")),
                ("content/posts/a.md", Some("Merhaba: dünya")),
            ]
        );
    }

    #[test]
    fn blocks_paths_outside_the_site() {
        let (_dir, info) = site();
        for bad in [
            "../x.md",
            "/etc/passwd",
            "content/../../x",
            "",
            r"C:\Windows\x",
        ] {
            assert!(resolve(&info.root, bad).is_err(), "{bad} should be refused");
        }
        assert!(resolve(&info.root, "content/posts/new.md").is_ok());
    }

    #[test]
    fn writes_exact_bytes_and_detects_conflicts() {
        let (_dir, info) = site();
        let original = read_text(&info.root, "content/posts/a.md").unwrap();
        let edited = "\u{feff}---\r\ntitle: x\r\n---\r\n";
        let version = write_text(
            &info.root,
            "content/posts/a.md",
            edited,
            Some(&original.version),
        )
        .unwrap();
        assert_eq!(
            fs::read(info.root.join("content/posts/a.md")).unwrap(),
            edited.as_bytes()
        );

        // Writing again with the stale version must fail and leave the file alone.
        let stale = write_text(
            &info.root,
            "content/posts/a.md",
            "lost",
            Some(&original.version),
        );
        assert!(matches!(stale, Err(AppError::Conflict)));
        assert_eq!(
            read_text(&info.root, "content/posts/a.md").unwrap().version,
            version
        );
        // No temporary files are left behind.
        let leftovers = fs::read_dir(info.root.join("content/posts"))
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn reads_titles_from_front_matter() {
        assert_eq!(
            front_matter_title("---\ntitle: Bir\n---\n").as_deref(),
            Some("Bir")
        );
        assert_eq!(
            front_matter_title("+++\ntitle = \"İki\"\n+++\n").as_deref(),
            Some("İki")
        );
        assert_eq!(
            front_matter_title("\u{feff}---\r\ntitle: 'Üç'\r\n---\r\n").as_deref(),
            Some("Üç")
        );
        assert_eq!(front_matter_title("# no front matter"), None);
        assert_eq!(
            front_matter_title("---\ndraft: true\n---\ntitle: body\n"),
            None
        );
        assert_eq!(
            front_matter_title("---\ndate: 2026-01-01\ntitleColor: red\ntitle: Dört\n---\n")
                .as_deref(),
            Some("Dört")
        );
    }
}
