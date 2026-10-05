//! Installing, listing and removing app-managed Hugo versions in `<app data>/hugo/`:
//! one folder per version and edition (`0.167.0`, `0.167.0-extended`), each holding only the
//! `hugo` binary. Work happens in a `.staging-*` folder that is renamed into place at the end,
//! so a failed or interrupted install never leaves a half-filled version folder behind.

use std::collections::HashSet;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::assets::{
    Asset, Platform, checksum_for, checksums_file_name, download_url, resolve_asset, select_asset,
    sha256_file, verify_checksum,
};
use super::semver::Semver;
use super::{InstallProgress, ManagedHugo, archive, github};
use crate::error::{AppError, AppResult};
use crate::hugo::detect::probe;

const STAGING_PREFIX: &str = ".staging-";
const EXTENDED_SUFFIX: &str = "-extended";

/// Versions being installed right now, so one version is never installed twice at once.
static IN_PROGRESS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn folder_name(version: Semver, extended: bool) -> String {
    if extended {
        format!("{version}{EXTENDED_SUFFIX}")
    } else {
        version.to_string()
    }
}

/// `0.167.0` → (0.167.0, standard), `0.167.0-extended` → (0.167.0, extended).
pub fn parse_folder_name(name: &str) -> Option<(Semver, bool)> {
    match name.strip_suffix(EXTENDED_SUFFIX) {
        Some(version) => Some((Semver::parse(version)?, true)),
        None => Some((Semver::parse(name)?, false)),
    }
}

fn parse_version(version: &str) -> AppResult<Semver> {
    Semver::parse(version.trim()).ok_or_else(|| {
        AppError::Invalid(format!(
            "not a Hugo version: {version:?} (expected something like 0.167.0)"
        ))
    })
}

/// The folder of an installed version (it may not exist).
pub fn version_dir(base: &Path, version: &str, extended: bool) -> AppResult<PathBuf> {
    Ok(base.join(folder_name(parse_version(version)?, extended)))
}

/// App-managed versions in `base`, newest first (extended before standard).
pub fn scan_installed(base: &Path, platform: Platform) -> Vec<ManagedHugo> {
    let Ok(entries) = fs::read_dir(base) else {
        return Vec::new();
    };
    let mut found: Vec<(Semver, bool, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let (version, extended) = parse_folder_name(&name)?;
            let binary = entry.path().join(platform.binary_name());
            binary.is_file().then_some((version, extended, binary))
        })
        .collect();
    found.sort_by_key(|f| std::cmp::Reverse((f.0, f.1)));
    found
        .into_iter()
        .map(|(version, extended, path)| ManagedHugo {
            version: version.to_string(),
            extended,
            path: path.to_string_lossy().into_owned(),
        })
        .collect()
}

/// Removes staging folders left behind by a crash. Only call when no install is running.
pub fn remove_stale_staging(base: &Path) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(STAGING_PREFIX)
        {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// A temporary folder inside `base` (same file system, so the final rename is atomic),
/// removed with everything in it when dropped.
pub struct Staging {
    path: PathBuf,
}

impl Staging {
    pub fn new(base: &Path) -> AppResult<Self> {
        fs::create_dir_all(base)?;
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let path = base.join(format!("{STAGING_PREFIX}{}-{nanos}", std::process::id()));
        fs::create_dir(&path)?;
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct InProgress(String);

impl InProgress {
    fn claim(key: String) -> AppResult<Self> {
        let mut guard = IN_PROGRESS.lock().unwrap_or_else(|e| e.into_inner());
        let set = guard.get_or_insert_with(HashSet::new);
        if !set.insert(key.clone()) {
            return Err(AppError::Invalid(format!(
                "Hugo {key} is already being installed"
            )));
        }
        Ok(Self(key))
    }
}

impl Drop for InProgress {
    fn drop(&mut self) {
        let mut guard = IN_PROGRESS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(set) = guard.as_mut() {
            set.remove(&self.0);
        }
    }
}

/// Renames, retrying for a moment: right after a file is written, Windows virus scanners can
/// hold it open and make the rename fail.
async fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut attempt = 0;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(_) if attempt < 8 => {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(150 * attempt)).await;
            }
            Err(error) => return Err(error),
        }
    }
}

pub async fn remove_dir_with_retry(dir: &Path) -> std::io::Result<()> {
    let mut attempt = 0;
    loop {
        match fs::remove_dir_all(dir) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) if attempt < 5 => {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(150 * attempt)).await;
            }
            Err(error) => return Err(error),
        }
    }
}

/// Runs the installed binary and checks that it is the expected version and edition.
pub async fn verify_with_probe(binary: PathBuf, version: Semver, extended: bool) -> AppResult<()> {
    let info = probe(&binary).await?;
    let reported = info.version.display();
    if reported != version.to_string() {
        return Err(AppError::Hugo(format!(
            "the downloaded binary reports Hugo {reported}, expected {version}"
        )));
    }
    if extended && !info.version.extended {
        return Err(AppError::Hugo(
            "the downloaded binary is not the extended edition".into(),
        ));
    }
    Ok(())
}

fn progress_event(
    version: Semver,
    stage: &str,
    received: u64,
    total: Option<u64>,
) -> InstallProgress {
    InstallProgress {
        version: version.to_string(),
        received,
        total,
        stage: stage.into(),
    }
}

/// Verifies `archive` against `checksums`, extracts the binary and moves it into
/// `base/<version>[-extended]/`, then runs `verify` on the final binary. On any failure nothing
/// is left in `base` (an existing folder for the same version is replaced only on success of
/// the extraction).
#[allow(clippy::too_many_arguments)]
pub async fn install_archive<V, Fut>(
    base: &Path,
    version: &str,
    asset: &Asset,
    archive_path: &Path,
    checksums: &str,
    platform: Platform,
    progress: &(dyn Fn(InstallProgress) + Send + Sync),
    verify: V,
) -> AppResult<ManagedHugo>
where
    V: FnOnce(PathBuf) -> Fut,
    Fut: Future<Output = AppResult<()>>,
{
    let version = parse_version(version)?;
    let expected = checksum_for(checksums, &asset.file_name).ok_or_else(|| {
        AppError::Invalid(format!(
            "{} is not listed in the release's checksums",
            asset.file_name
        ))
    })?;
    let size = fs::metadata(archive_path)?.len();
    progress(progress_event(version, "verify", size, Some(size)));
    let file = archive_path.to_path_buf();
    let actual = tokio::task::spawn_blocking(move || sha256_file(&file))
        .await
        .map_err(|e| AppError::Invalid(format!("checksum calculation stopped: {e}")))??;
    verify_checksum(&actual, &expected, &asset.file_name)?;

    progress(progress_event(version, "extract", size, Some(size)));
    let staging = Staging::new(base)?;
    let out = staging.path().join("out");
    fs::create_dir(&out)?;
    let binary_name = platform.binary_name();
    archive::extract_binary(
        archive_path,
        asset.kind,
        binary_name,
        &out,
        &staging.path().join("pkg"),
    )
    .await?;

    let target = base.join(folder_name(version, asset.extended));
    if target.exists() {
        remove_dir_with_retry(&target).await?;
    }
    rename_with_retry(&out, &target).await?;
    let binary = target.join(binary_name);
    if let Err(error) = verify(binary.clone()).await {
        let _ = remove_dir_with_retry(&target).await;
        return Err(error);
    }
    Ok(ManagedHugo {
        version: version.to_string(),
        extended: asset.extended,
        path: binary.to_string_lossy().into_owned(),
    })
}

/// An already installed, working copy of this version and edition.
async fn existing_install(
    base: &Path,
    version: Semver,
    extended: bool,
    platform: Platform,
) -> Option<ManagedHugo> {
    let binary = base
        .join(folder_name(version, extended))
        .join(platform.binary_name());
    if !binary.is_file() {
        return None;
    }
    verify_with_probe(binary.clone(), version, extended)
        .await
        .ok()?;
    Some(ManagedHugo {
        version: version.to_string(),
        extended,
        path: binary.to_string_lossy().into_owned(),
    })
}

/// Downloads `version` from GitHub, verifies it against the release's checksums and installs it
/// into `base`. Returns the existing copy when this version is already installed and works.
/// When extended is asked for but not available here, the standard build is installed (the
/// result's `extended` is then false).
pub async fn install(
    base: &Path,
    version: &str,
    extended: bool,
    platform: Platform,
    progress: &(dyn Fn(InstallProgress) + Send + Sync),
) -> AppResult<ManagedHugo> {
    let semver = parse_version(version)?;
    let version = semver.to_string();
    let planned = select_asset(&version, extended, platform)?;
    let _claim = InProgress::claim(folder_name(semver, planned.extended))?;
    if let Some(existing) = existing_install(base, semver, planned.extended, platform).await {
        progress(progress_event(semver, "done", 0, None));
        return Ok(existing);
    }

    progress(progress_event(semver, "download", 0, None));
    let checksums =
        github::fetch_text(&download_url(&version, &checksums_file_name(&version))).await?;
    let asset = resolve_asset(&version, extended, platform, &checksums)?;
    if let Some(note) = &asset.note {
        log::warn!("{note}");
    }
    if asset.extended != planned.extended
        && let Some(existing) = existing_install(base, semver, asset.extended, platform).await
    {
        progress(progress_event(semver, "done", 0, None));
        return Ok(existing);
    }

    let downloads = Staging::new(base)?;
    let archive_path = downloads.path().join(&asset.file_name);
    github::download(
        &download_url(&version, &asset.file_name),
        &archive_path,
        |received, total| progress(progress_event(semver, "download", received, total)),
    )
    .await?;

    let installed = install_archive(
        base,
        &version,
        &asset,
        &archive_path,
        &checksums,
        platform,
        progress,
        |binary| verify_with_probe(binary, semver, asset.extended),
    )
    .await?;
    drop(downloads);
    progress(progress_event(semver, "done", 0, None));
    Ok(installed)
}

/// Whether `path` is inside `dir` (compared as given and, when possible, canonicalized).
pub fn is_inside(path: &Path, dir: &Path) -> bool {
    if path.starts_with(dir) {
        return true;
    }
    match (fs::canonicalize(path), fs::canonicalize(dir)) {
        (Ok(path), Ok(dir)) => path.starts_with(dir),
        _ => false,
    }
}
