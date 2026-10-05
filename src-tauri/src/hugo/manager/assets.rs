//! Which file of a Hugo release fits this computer, and how to check it against the release's
//! `hugo_<version>_checksums.txt`.

use sha2::{Digest, Sha256};

use super::semver::Semver;
use crate::error::{AppError, AppResult};

/// Where release files are downloaded from: `<base>/v<version>/<file>`.
pub const DOWNLOAD_BASE: &str = "https://github.com/gohugoio/hugo/releases/download";

/// First release whose macOS downloads are signed `.pkg` installers (no `.tar.gz` any more).
pub const MACOS_PKG_SINCE: Semver = Semver::new(0, 153, 0);

/// First release with the `<os>-<arch>` file names used here (older ones say `Linux-64bit`).
pub const ASSET_NAMES_SINCE: Semver = Semver::new(0, 103, 0);

/// Operating system and CPU, as `std::env::consts` names them (`windows`/`macos`/`linux`,
/// `x86_64`/`aarch64`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Platform {
    pub os: &'static str,
    pub arch: &'static str,
}

impl Platform {
    pub fn current() -> Self {
        Self {
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
        }
    }

    /// File name of the Hugo executable on this platform.
    pub fn binary_name(&self) -> &'static str {
        if self.os == "windows" {
            "hugo.exe"
        } else {
            "hugo"
        }
    }

    /// Whether Hugo publishes an extended build for this platform at all.
    pub fn has_extended_build(&self) -> bool {
        !(self.os == "windows" && self.arch == "aarch64")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    Zip,
    TarGz,
    /// macOS installer package, unpacked with `pkgutil --expand-full` (never installed).
    Pkg,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asset {
    /// Release file name, e.g. `hugo_extended_0.167.0_windows-amd64.zip`.
    pub file_name: String,
    pub kind: ArchiveKind,
    /// The edition this file contains. False although extended was asked for when there is no
    /// extended build (see `note`).
    pub extended: bool,
    /// Why the standard build replaces the extended one, when it does.
    pub note: Option<String>,
}

fn invalid_version(version: &str) -> AppError {
    AppError::Invalid(format!(
        "not a Hugo version: {version:?} (expected something like 0.167.0)"
    ))
}

/// The release file for `version` on `platform`. Pure: the release itself is not consulted.
pub fn select_asset(version: &str, extended: bool, platform: Platform) -> AppResult<Asset> {
    let v = Semver::parse(version).ok_or_else(|| invalid_version(version))?;
    if v < ASSET_NAMES_SINCE {
        return Err(AppError::Invalid(format!(
            "Hugo {v} is too old to be installed by the app; versions from {ASSET_NAMES_SINCE} on are supported"
        )));
    }
    let (suffix, kind) = match (platform.os, platform.arch) {
        ("windows", "x86_64") => ("windows-amd64.zip", ArchiveKind::Zip),
        ("windows", "aarch64") => ("windows-arm64.zip", ArchiveKind::Zip),
        ("linux", "x86_64") => ("linux-amd64.tar.gz", ArchiveKind::TarGz),
        ("linux", "aarch64") => ("linux-arm64.tar.gz", ArchiveKind::TarGz),
        // One universal binary for Intel and Apple silicon.
        ("macos", "x86_64" | "aarch64") if v >= MACOS_PKG_SINCE => {
            ("darwin-universal.pkg", ArchiveKind::Pkg)
        }
        ("macos", "x86_64" | "aarch64") => ("darwin-universal.tar.gz", ArchiveKind::TarGz),
        (os, arch) => {
            return Err(AppError::Invalid(format!(
                "Hugo publishes no download for {os}/{arch}; install Hugo yourself and choose its binary"
            )));
        }
    };
    let use_extended = extended && platform.has_extended_build();
    let note = (extended && !use_extended).then(|| {
        format!(
            "Hugo has no extended build for {}/{}; the standard build is installed instead",
            platform.os, platform.arch
        )
    });
    let edition = if use_extended {
        "hugo_extended"
    } else {
        "hugo"
    };
    Ok(Asset {
        file_name: format!("{edition}_{v}_{suffix}"),
        kind,
        extended: use_extended,
        note,
    })
}

/// Like [`select_asset`], but checked against the release's checksums file: when the extended
/// file is not part of the release, the standard one is used (with a note); when no fitting
/// file is listed at all, an error says so.
pub fn resolve_asset(
    version: &str,
    extended: bool,
    platform: Platform,
    checksums: &str,
) -> AppResult<Asset> {
    let asset = select_asset(version, extended, platform)?;
    if checksum_for(checksums, &asset.file_name).is_some() {
        return Ok(asset);
    }
    if asset.extended {
        let mut standard = select_asset(version, false, platform)?;
        if checksum_for(checksums, &standard.file_name).is_some() {
            standard.note = Some(format!(
                "Hugo {version} has no extended build for {}/{}; the standard build is installed instead",
                platform.os, platform.arch
            ));
            return Ok(standard);
        }
    }
    Err(AppError::Invalid(format!(
        "Hugo {version} has no download named {} for this computer",
        asset.file_name
    )))
}

pub fn checksums_file_name(version: &str) -> String {
    format!("hugo_{version}_checksums.txt")
}

pub fn download_url(version: &str, file_name: &str) -> String {
    format!("{DOWNLOAD_BASE}/v{version}/{file_name}")
}

/// `(sha256, file name)` pairs from a `sha256sum`-style file (`<hash>  <file>` lines; a `*`
/// before the name marks binary mode). Hashes are lower-cased; other lines are skipped.
pub fn parse_checksums(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let hash = parts.next()?;
            let name = parts.next()?.trim_start_matches('*');
            if parts.next().is_some()
                || hash.len() != 64
                || !hash.bytes().all(|b| b.is_ascii_hexdigit())
                || name.is_empty()
            {
                return None;
            }
            Some((hash.to_ascii_lowercase(), name.to_string()))
        })
        .collect()
}

/// The expected SHA-256 (lower-case hex) of `file_name`, if the checksums file lists it.
pub fn checksum_for(checksums: &str, file_name: &str) -> Option<String> {
    parse_checksums(checksums)
        .into_iter()
        .find(|(_, name)| name == file_name)
        .map(|(hash, _)| hash)
}

pub fn verify_checksum(actual: &str, expected: &str, file_name: &str) -> AppResult<()> {
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!(
            "checksum mismatch for {file_name}: expected {expected}, got {actual}. The download was discarded"
        )))
    }
}

pub fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(64), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    to_hex(&Sha256::digest(bytes))
}

/// SHA-256 of a file, read in chunks.
pub fn sha256_file(path: &std::path::Path) -> AppResult<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(to_hex(&hasher.finalize()))
}
