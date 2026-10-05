//! Backing up a site as a zip file, without generated output, caches and git internals.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::commands::AppState;
use crate::error::{AppError, AppResult};

/// Top-level folders that Hugo or tools regenerate, plus git's own folder.
const SKIPPED_DIRS: [&str; 5] = [".git", "public", "resources", "node_modules", ".deploy"];
const SKIPPED_FILES: [&str; 1] = [".hugo_build.lock"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub files: usize,
    pub bytes: u64,
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let top_level = dir == root;
        if path.is_dir() {
            if top_level && SKIPPED_DIRS.contains(&name.as_ref()) {
                continue;
            }
            if name == "node_modules" {
                continue;
            }
            collect(root, &path, out)?;
        } else if !(top_level && SKIPPED_FILES.contains(&name.as_ref())) {
            out.push(path);
        }
    }
    Ok(())
}

/// Writes `<site>` into the zip at `destination` (an absolute path chosen by the user).
/// Entries are stored under a folder named after the site.
pub fn backup(root: &Path, destination: &Path) -> AppResult<BackupResult> {
    if destination.starts_with(root) {
        return Err(AppError::Invalid(
            "save the backup outside the site folder".into(),
        ));
    }
    let mut files = Vec::new();
    collect(root, root, &mut files)?;
    let site_name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "site".into());

    let temp = destination.with_extension("zip.partial");
    let result = (|| -> AppResult<BackupResult> {
        let mut writer = zip::ZipWriter::new(File::create(&temp)?);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(true);
        let mut bytes = 0;
        for file in &files {
            let relative = file
                .strip_prefix(root)
                .map_err(|e| AppError::Invalid(e.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            writer
                .start_file(format!("{site_name}/{relative}"), options)
                .map_err(|e| AppError::Invalid(e.to_string()))?;
            let contents = fs::read(file)?;
            bytes += contents.len() as u64;
            writer.write_all(&contents)?;
        }
        writer
            .finish()
            .map_err(|e| AppError::Invalid(e.to_string()))?;
        Ok(BackupResult {
            path: destination.to_string_lossy().into_owned(),
            files: files.len(),
            bytes,
        })
    })();
    match result {
        Ok(done) => {
            fs::rename(&temp, destination)?;
            Ok(done)
        }
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn site_backup(
    state: State<'_, AppState>,
    destination: String,
) -> AppResult<BackupResult> {
    let site = state.site()?;
    let destination = PathBuf::from(destination);
    tauri::async_runtime::spawn_blocking(move || backup(&site.root, &destination))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn zips_sources_but_not_output_or_git() {
        let site = tempfile::tempdir().unwrap();
        let root = site.path();
        for (path, text) in [
            ("hugo.toml", "title = 'x'"),
            ("content/a.md", "# A"),
            ("themes/t/layouts/x.html", "<p>"),
            ("public/index.html", "built"),
            ("resources/_gen/x", "cache"),
            (".git/HEAD", "ref"),
            (".hugo_build.lock", ""),
            ("assets/node_modules/x.js", "dep"),
        ] {
            let file = root.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, text).unwrap();
        }
        let out = tempfile::tempdir().unwrap();
        let destination = out.path().join("backup.zip");
        let result = backup(root, &destination).unwrap();
        assert_eq!(result.files, 3);

        let mut archive = zip::ZipArchive::new(File::open(&destination).unwrap()).unwrap();
        let site_name = root.file_name().unwrap().to_string_lossy().into_owned();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                format!("{site_name}/content/a.md"),
                format!("{site_name}/hugo.toml"),
                format!("{site_name}/themes/t/layouts/x.html"),
            ]
        );
        let mut text = String::new();
        archive
            .by_name(&format!("{site_name}/content/a.md"))
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(text, "# A");
        assert!(!out.path().join("backup.zip.partial").exists());
    }

    #[test]
    fn refuses_a_destination_inside_the_site() {
        let site = tempfile::tempdir().unwrap();
        assert!(backup(site.path(), &site.path().join("b.zip")).is_err());
    }
}
