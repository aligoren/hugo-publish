//! Taking only the `hugo` executable out of a release download (`.zip`, `.tar.gz` or macOS
//! `.pkg`). Archive paths are never used to build output paths, so a crafted archive cannot
//! write outside the destination.

use std::fs;
use std::io::{self, Read, Seek};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use super::assets::ArchiveKind;
use crate::error::{AppError, AppResult};

/// Hugo binaries are well below this; anything bigger is not a real release.
pub const MAX_BINARY_SIZE: u64 = 1 << 30;

fn not_found(binary_name: &str) -> AppError {
    AppError::Invalid(format!("{binary_name} was not found in the download"))
}

/// Last component of an archive entry name, whichever separator it uses.
fn entry_file_name(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
}

/// Copies `reader` to a new file at `dest` (at most [`MAX_BINARY_SIZE`] bytes) and makes it
/// executable on Unix.
fn write_binary(reader: &mut impl Read, dest: &Path) -> AppResult<()> {
    let mut file = fs::File::create(dest)?;
    let written = io::copy(&mut reader.take(MAX_BINARY_SIZE + 1), &mut file)?;
    if written > MAX_BINARY_SIZE {
        drop(file);
        let _ = fs::remove_file(dest);
        return Err(AppError::Invalid(
            "the Hugo binary in the download is unexpectedly large".into(),
        ));
    }
    file.sync_all()?;
    drop(file);
    make_executable(dest)
}

#[cfg(unix)]
pub fn make_executable(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
    Ok(())
}

#[cfg(not(unix))]
pub fn make_executable(_path: &Path) -> AppResult<()> {
    Ok(())
}

/// Writes the zip entry called `binary_name` (in any folder) to `dest`.
pub fn extract_from_zip<R: Read + Seek>(
    reader: R,
    binary_name: &str,
    dest: &Path,
) -> AppResult<()> {
    let bad_zip = |e: zip::result::ZipError| AppError::Invalid(format!("broken zip file: {e}"));
    let mut archive = zip::ZipArchive::new(reader).map_err(bad_zip)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(bad_zip)?;
        if entry.is_file() && entry_file_name(entry.name()) == binary_name {
            return write_binary(&mut entry, dest);
        }
    }
    Err(not_found(binary_name))
}

/// Writes the regular file called `binary_name` (in any folder) from a `.tar.gz` to `dest`.
pub fn extract_from_tar_gz<R: Read>(reader: R, binary_name: &str, dest: &Path) -> AppResult<()> {
    let bad_tar = |e: io::Error| AppError::Invalid(format!("broken .tar.gz file: {e}"));
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(reader));
    for entry in archive.entries().map_err(bad_tar)? {
        let mut entry = entry.map_err(bad_tar)?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry.path().map_err(bad_tar)?;
        if path.file_name().and_then(|n| n.to_str()) == Some(binary_name) {
            return write_binary(&mut entry, dest);
        }
    }
    Err(not_found(binary_name))
}

/// Finds `binary_name` in a folder made by `pkgutil --expand-full`, preferring files inside a
/// `Payload` folder (the files the installer would put on disk). Symlinks are not followed.
pub fn find_in_expanded_pkg(expanded: &Path, binary_name: &str) -> AppResult<PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![expanded.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(&dir)?.flatten() {
            let file_type = entry.file_type()?;
            let path = entry.path();
            if file_type.is_dir() {
                pending.push(path);
            } else if file_type.is_file() && entry.file_name().to_str() == Some(binary_name) {
                found.push(path);
            }
        }
    }
    let in_payload = |p: &PathBuf| p.components().any(|c| c.as_os_str() == "Payload");
    found.sort_by_key(|p| (!in_payload(p), p.components().count()));
    found
        .into_iter()
        .next()
        .ok_or_else(|| not_found(binary_name))
}

/// Unpacks a macOS `.pkg` with the built-in `pkgutil` (nothing is installed) into `scratch`,
/// which must not exist yet, and copies the Hugo binary to `dest`.
async fn extract_from_pkg(
    pkg: &Path,
    binary_name: &str,
    dest: &Path,
    scratch: &Path,
) -> AppResult<()> {
    let mut command = tokio::process::Command::new("pkgutil");
    command
        .arg("--expand-full")
        .arg(pkg)
        .arg(scratch)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(crate::hugo::CREATE_NO_WINDOW);
    let output = tokio::time::timeout(Duration::from_secs(300), command.output())
        .await
        .map_err(|_| AppError::Invalid("unpacking the .pkg file timed out".into()))?
        .map_err(|e| AppError::Invalid(format!("could not run pkgutil: {e}")))?;
    if !output.status.success() {
        return Err(AppError::Invalid(format!(
            "pkgutil could not unpack the download: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let binary = find_in_expanded_pkg(scratch, binary_name)?;
    let dest = dest.to_path_buf();
    run_blocking(move || write_binary(&mut fs::File::open(binary)?, &dest)).await
}

async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|e| AppError::Invalid(format!("extraction stopped unexpectedly: {e}")))?
}

/// Extracts the Hugo binary from `archive` to `out_dir/<binary_name>` and returns that path.
/// `scratch` is a not-yet-existing folder for unpacking a `.pkg`.
pub async fn extract_binary(
    archive: &Path,
    kind: ArchiveKind,
    binary_name: &str,
    out_dir: &Path,
    scratch: &Path,
) -> AppResult<PathBuf> {
    let dest = out_dir.join(binary_name);
    match kind {
        ArchiveKind::Zip | ArchiveKind::TarGz => {
            let (archive, name, target) =
                (archive.to_path_buf(), binary_name.to_string(), dest.clone());
            run_blocking(move || {
                let file = io::BufReader::new(fs::File::open(&archive)?);
                if kind == ArchiveKind::Zip {
                    extract_from_zip(file, &name, &target)
                } else {
                    extract_from_tar_gz(file, &name, &target)
                }
            })
            .await?;
        }
        ArchiveKind::Pkg => extract_from_pkg(archive, binary_name, &dest, scratch).await?,
    }
    Ok(dest)
}
