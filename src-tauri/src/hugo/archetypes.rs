//! Archetypes and `hugo new content` for the new-post wizard.

use std::fs;
use std::path::{Component, Path};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use super::output::strip_control;
use super::short_command;
use crate::commands::AppState;
use crate::config::toml_doc::TomlEditor;
use crate::error::{AppError, AppResult};

const NEW_CONTENT_TIMEOUT: Duration = Duration::from_secs(60);
const CONTENT_EXTENSIONS: [&str; 3] = ["md", "markdown", "mdown"];
/// Root config files in Hugo's lookup order, then the `config/_default` equivalents.
const CONFIG_FILES: [&str; 16] = [
    "hugo.toml",
    "hugo.yaml",
    "hugo.yml",
    "hugo.json",
    "config.toml",
    "config.yaml",
    "config.yml",
    "config.json",
    "config/_default/hugo.toml",
    "config/_default/hugo.yaml",
    "config/_default/hugo.yml",
    "config/_default/hugo.json",
    "config/_default/config.toml",
    "config/_default/config.yaml",
    "config/_default/config.yml",
    "config/_default/config.json",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Archetype {
    /// The `--kind` name, e.g. `post` for archetypes/post.md.
    pub name: String,
    /// Site-relative path of the archetype file or directory.
    pub path: String,
    /// site | theme
    pub source: String,
}

/// The theme settings that decide where theme archetypes live.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThemeConfig {
    pub themes_dir: String,
    /// In precedence order (Hugo's `theme` may be a list).
    pub themes: Vec<String>,
}

#[tauri::command]
pub async fn hugo_list_archetypes(state: State<'_, AppState>) -> AppResult<Vec<Archetype>> {
    list_archetypes(&state.site()?.root)
}

/// Runs `hugo new content <path> [--kind kind]` and returns the created site-relative path.
#[tauri::command]
pub async fn hugo_new_content(
    state: State<'_, AppState>,
    path: String,
    kind: Option<String>,
) -> AppResult<String> {
    let site = state.site()?;
    let hugo = state.hugo().await?;
    new_content(
        &hugo.path,
        &site.root,
        &site.content_dir,
        &path,
        kind.as_deref(),
    )
    .await
}

/// The site's archetypes (`archetypes/*.md` and bundle folders with an `index.md` or `_index.md`),
/// then the theme's. A theme archetype with the same name as a site one is left out, because
/// Hugo uses the site's.
pub fn list_archetypes(root: &Path) -> AppResult<Vec<Archetype>> {
    let mut list = Vec::new();
    collect(root, "archetypes", "site", &mut list)?;
    let config = theme_config(root);
    for theme in &config.themes {
        for base in [
            format!("{}/{theme}", config.themes_dir),
            format!("_vendor/{theme}"),
        ] {
            collect(root, &format!("{base}/archetypes"), "theme", &mut list)?;
        }
    }
    let mut seen = std::collections::HashSet::new();
    list.retain(|a| seen.insert(a.name.clone()));
    Ok(list)
}

fn collect(root: &Path, dir: &str, source: &str, out: &mut Vec<Archetype>) -> AppResult<()> {
    if !is_plain_relative(dir) {
        return Ok(());
    }
    let Ok(entries) = fs::read_dir(root.join(dir)) else {
        return Ok(());
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let kind = if path.is_dir() {
            let bundle = path.join("index.md").is_file() || path.join("_index.md").is_file();
            bundle.then(|| name.clone())
        } else {
            name.strip_suffix(".md").map(str::to_string)
        };
        if let Some(kind) = kind.filter(|k| !k.is_empty()) {
            found.push(Archetype {
                name: kind,
                path: format!("{dir}/{name}"),
                source: source.to_string(),
            });
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    out.extend(found);
    Ok(())
}

/// Reads `theme` and `themesDir` from the site config without running Hugo. TOML and JSON are
/// parsed fully; YAML only for these two top-level keys.
pub fn theme_config(root: &Path) -> ThemeConfig {
    let mut themes_dir = None;
    let mut themes = None;
    for name in CONFIG_FILES {
        let Ok(text) = fs::read_to_string(root.join(name)) else {
            continue;
        };
        let Some(values) = parse_config(name, &text) else {
            continue;
        };
        if themes.is_none() {
            themes = key(&values, "theme").map(theme_list);
        }
        if themes_dir.is_none() {
            themes_dir = key(&values, "themesDir")
                .and_then(Value::as_str)
                .map(|d| d.trim_end_matches(['/', '\\']).replace('\\', "/"));
        }
    }
    ThemeConfig {
        themes_dir: themes_dir
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| "themes".into()),
        themes: themes
            .unwrap_or_default()
            .into_iter()
            .filter(|t| is_plain_relative(t))
            .collect(),
    }
}

fn parse_config(name: &str, text: &str) -> Option<Value> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if name.ends_with(".toml") {
        TomlEditor::parse(&text.replace("\r\n", "\n"))
            .ok()
            .map(|e| e.to_json())
    } else if name.ends_with(".json") {
        serde_json::from_str(text).ok()
    } else {
        Some(yaml_theme_keys(text))
    }
}

/// Hugo config keys are case-insensitive.
fn key<'a>(values: &'a Value, name: &str) -> Option<&'a Value> {
    values
        .as_object()?
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v)
}

fn theme_list(value: &Value) -> Vec<String> {
    match value {
        Value::String(s) => vec![s.trim().to_string()],
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(|s| s.trim().to_string())
            .collect(),
        _ => Vec::new(),
    }
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect()
}

/// `theme` and `themesDir` from YAML: `theme: x`, `theme: [a, b]` or a block list.
fn yaml_theme_keys(text: &str) -> Value {
    let mut out = serde_json::Map::new();
    let lines: Vec<&str> = text.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        if line.starts_with([' ', '\t', '#', '-']) {
            continue;
        }
        let Some((name, rest)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        if !name.eq_ignore_ascii_case("theme") && !name.eq_ignore_ascii_case("themesDir") {
            continue;
        }
        let rest = strip_yaml_comment(rest).trim();
        let value = if let Some(inner) = rest.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
            Value::Array(
                inner
                    .split(',')
                    .map(|s| Value::String(unquote(s.trim()).to_string()))
                    .collect(),
            )
        } else if rest.is_empty() {
            Value::Array(
                lines[i + 1..]
                    .iter()
                    .take_while(|l| l.starts_with([' ', '\t']) || l.trim().is_empty())
                    .filter_map(|l| l.trim().strip_prefix('-'))
                    .map(|item| Value::String(unquote(strip_yaml_comment(item).trim()).to_string()))
                    .collect(),
            )
        } else {
            Value::String(unquote(rest).to_string())
        };
        out.insert(name.to_string(), value);
    }
    Value::Object(out)
}

fn strip_yaml_comment(text: &str) -> &str {
    text.find(" #").map_or(text, |i| &text[..i])
}

fn unquote(text: &str) -> &str {
    text.strip_prefix('"')
        .and_then(|t| t.strip_suffix('"'))
        .or_else(|| text.strip_prefix('\'').and_then(|t| t.strip_suffix('\'')))
        .unwrap_or(text)
}

/// A relative path made only of normal components (no `..`, no root, no drive).
fn is_plain_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with(['/', '\\'])
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

/// Creates a content file (or a bundle folder, for a folder archetype) with Hugo.
///
/// `path` is site-relative and must be inside `content_dir` and not exist yet. Returns the
/// site-relative path of the created Markdown file, with forward slashes.
pub async fn new_content(
    hugo: &Path,
    root: &Path,
    content_dir: &str,
    path: &str,
    kind: Option<&str>,
) -> AppResult<String> {
    let path = path.replace('\\', "/");
    let path = path.trim_start_matches("./");
    let relative = path
        .strip_prefix(content_dir)
        .and_then(|r| r.strip_prefix('/'))
        .filter(|r| is_plain_relative(r))
        .ok_or_else(|| AppError::PathOutsideSite(format!("{path} (not inside {content_dir}/)")))?;
    let extension = Path::new(relative)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if !extension.is_some_and(|e| CONTENT_EXTENSIONS.contains(&e.as_str())) {
        return Err(AppError::Invalid(format!(
            "{path} is not a Markdown file (.md)"
        )));
    }
    let target = crate::site::resolve(root, path)?;
    if target.exists() {
        return Err(AppError::Invalid(format!("{path} already exists")));
    }
    let kind = kind.map(str::trim).filter(|k| !k.is_empty());
    if let Some(kind) = kind
        && (!is_plain_relative(kind) || kind.contains(['/', '\\']) || kind.starts_with('-'))
    {
        return Err(AppError::Invalid(format!("invalid archetype name: {kind}")));
    }

    // A folder archetype makes a bundle: Hugo wants the folder path, not `…/index.md`.
    let folder_archetype = match kind {
        Some(kind) => list_archetypes(root)?
            .into_iter()
            .any(|a| a.name == kind && root.join(&a.path).is_dir()),
        None => false,
    };
    let (argument, expected) = if folder_archetype {
        let folder = relative
            .strip_suffix("/index.md")
            .or_else(|| relative.strip_suffix("/_index.md"))
            .unwrap_or_else(|| relative.rsplit_once('.').map_or(relative, |(stem, _)| stem));
        if root.join(content_dir).join(folder).exists() {
            return Err(AppError::Invalid(format!(
                "{content_dir}/{folder} already exists"
            )));
        }
        (
            folder.to_string(),
            vec![
                format!("{content_dir}/{folder}/index.md"),
                format!("{content_dir}/{folder}/_index.md"),
            ],
        )
    } else {
        (relative.to_string(), vec![path.to_string()])
    };

    let mut command = short_command(hugo);
    command
        .args(["new", "content", "--noBuildLock", "--source"])
        .arg(root);
    if let Some(kind) = kind {
        command.args(["--kind", kind]);
    }
    command.arg("--").arg(&argument);
    let output = tokio::time::timeout(NEW_CONTENT_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::Hugo("`hugo new content` timed out".into()))??;
    let printed = [&output.stderr[..], &output.stdout[..]]
        .iter()
        .flat_map(|bytes| {
            String::from_utf8_lossy(bytes)
                .lines()
                .map(strip_control)
                .filter(|l| !l.trim().is_empty())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>()
        .join("\n");
    if !output.status.success() {
        return Err(AppError::Hugo(printed));
    }
    expected
        .into_iter()
        .find(|p| root.join(p).is_file())
        .ok_or_else(|| AppError::Hugo(format!("Hugo did not create {path}. {printed}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, text: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn reads_the_theme_from_toml_yaml_and_json() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "hugo.toml", "title = 'x'\r\ntheme = \"PaperMod\"\r\n");
        assert_eq!(
            theme_config(root),
            ThemeConfig {
                themes_dir: "themes".into(),
                themes: vec!["PaperMod".into()]
            }
        );

        fs::remove_file(root.join("hugo.toml")).unwrap();
        write(
            root,
            "config.yaml",
            "title: x\nthemesDir: vendor/themes/ # local\ntheme:\n  - \"a\"\n  - b # second\nparams:\n  theme: dark\n",
        );
        assert_eq!(
            theme_config(root),
            ThemeConfig {
                themes_dir: "vendor/themes".into(),
                themes: vec!["a".into(), "b".into()]
            }
        );

        fs::remove_file(root.join("config.yaml")).unwrap();
        write(root, "hugo.yaml", "Theme: ['x', \"y\"]\n");
        assert_eq!(theme_config(root).themes, vec!["x", "y"]);

        fs::remove_file(root.join("hugo.yaml")).unwrap();
        write(root, "config/_default/hugo.json", "{\"theme\": \"j\"}");
        assert_eq!(theme_config(root).themes, vec!["j"]);

        // Nothing usable: no themes, and names that would leave the site are ignored.
        write(
            root,
            "config/_default/hugo.json",
            "{\"theme\": \"../../etc\"}",
        );
        assert!(theme_config(root).themes.is_empty());
    }

    #[test]
    fn lists_site_and_theme_archetypes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "hugo.toml", "theme = 'tt'\n");
        write(root, "archetypes/default.md", "---\n---\n");
        write(root, "archetypes/yazı.md", "---\n---\n");
        write(root, "archetypes/galeri/index.md", "---\n---\n");
        write(root, "archetypes/galeri/foto.jpg", "");
        write(root, "archetypes/bolum/_index.md", "---\n---\n");
        write(root, "archetypes/bos-klasor/readme.txt", "");
        write(root, "archetypes/notes.txt", "");
        write(root, "archetypes/.hidden.md", "");
        write(root, "themes/tt/archetypes/note.md", "+++\n+++\n");
        write(root, "themes/tt/archetypes/default.md", "+++\n+++\n");

        let list = list_archetypes(root).unwrap();
        let summary: Vec<(&str, &str, &str)> = list
            .iter()
            .map(|a| (a.name.as_str(), a.path.as_str(), a.source.as_str()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("bolum", "archetypes/bolum", "site"),
                ("default", "archetypes/default.md", "site"),
                ("galeri", "archetypes/galeri", "site"),
                ("yazı", "archetypes/yazı.md", "site"),
                ("note", "themes/tt/archetypes/note.md", "theme"),
            ]
        );
    }

    #[test]
    fn a_site_without_archetypes_has_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_archetypes(dir.path()).unwrap().is_empty());
    }
}
