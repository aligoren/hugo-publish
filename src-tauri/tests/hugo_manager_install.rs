//! Extracting and installing Hugo from archives built in memory with a fake binary. No network,
//! no real Hugo needed (the final "does it run" check is replaced, except in a Unix-only test
//! that uses a shell script as the fake binary).

use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use hugo_publisher_lib::error::AppError;
use hugo_publisher_lib::hugo::manager::InstallProgress;
use hugo_publisher_lib::hugo::manager::archive::{
    extract_binary, extract_from_tar_gz, extract_from_zip, find_in_expanded_pkg,
};
use hugo_publisher_lib::hugo::manager::assets::{
    ArchiveKind, Asset, Platform, select_asset, sha256_hex,
};
use hugo_publisher_lib::hugo::manager::install::{
    Staging, folder_name, install_archive, is_inside, parse_folder_name, remove_stale_staging,
    scan_installed, version_dir,
};
use hugo_publisher_lib::hugo::manager::semver::Semver;

const FAKE_BINARY: &[u8] = b"\x7fELF fake hugo binary for tests";

const WIN_X64: Platform = Platform {
    os: "windows",
    arch: "x86_64",
};
const LINUX_X64: Platform = Platform {
    os: "linux",
    arch: "x86_64",
};

fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);
    for (name, data) in entries {
        if name.ends_with('/') {
            writer.add_directory(*name, options).unwrap();
        } else {
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
    }
    writer.finish().unwrap().into_inner()
}

fn tar_gz_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    let mut builder = tar::Builder::new(encoder);
    for (name, data) in entries {
        let mut header = tar::Header::new_gnu();
        if name.ends_with('/') {
            header.set_entry_type(tar::EntryType::Directory);
            header.set_size(0);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append_data(&mut header, name, &[][..]).unwrap();
        } else {
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, name, *data).unwrap();
        }
    }
    builder.into_inner().unwrap().finish().unwrap()
}

fn release_zip() -> Vec<u8> {
    zip_bytes(&[
        ("LICENSE", b"Apache License"),
        ("README.md", b"# Hugo"),
        ("hugo.exe", FAKE_BINARY),
    ])
}

fn release_tar_gz() -> Vec<u8> {
    tar_gz_bytes(&[
        ("LICENSE", b"Apache License"),
        ("README.md", b"# Hugo"),
        ("hugo", FAKE_BINARY),
    ])
}

#[test]
fn extracts_the_binary_from_a_zip() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("hugo.exe");
    extract_from_zip(Cursor::new(release_zip()), "hugo.exe", &dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), FAKE_BINARY);
    // Only the binary is written.
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn zip_entries_in_folders_are_found_but_never_used_as_paths() {
    let dir = tempfile::tempdir().unwrap();
    let archive = zip_bytes(&[
        ("hugo_0.167.0/", b""),
        ("hugo_0.167.0/hugo.exe", FAKE_BINARY),
    ]);
    let dest = dir.path().join("out.exe");
    extract_from_zip(Cursor::new(archive), "hugo.exe", &dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), FAKE_BINARY);

    // A path-traversal entry only ever lands at `dest`.
    let evil = zip_bytes(&[("../../evil/hugo.exe", FAKE_BINARY)]);
    let dest = dir.path().join("safe.exe");
    extract_from_zip(Cursor::new(evil), "hugo.exe", &dest).unwrap();
    assert!(dest.is_file());
    assert!(!dir.path().parent().unwrap().join("evil").exists());
}

#[test]
fn missing_binary_and_broken_archives_are_errors() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("hugo");
    let no_binary = zip_bytes(&[("README.md", b"# Hugo"), ("hugo.exe.sig", b"x")]);
    let error = extract_from_zip(Cursor::new(no_binary), "hugo.exe", &dest).unwrap_err();
    assert!(error.to_string().contains("hugo.exe was not found"));
    assert!(extract_from_zip(Cursor::new(b"not a zip".to_vec()), "hugo", &dest).is_err());

    let no_binary = tar_gz_bytes(&[("hugo/", b""), ("README.md", b"x")]);
    let error = extract_from_tar_gz(Cursor::new(no_binary), "hugo", &dest).unwrap_err();
    assert!(error.to_string().contains("hugo was not found"), "{error}");
    assert!(extract_from_tar_gz(Cursor::new(b"nope".to_vec()), "hugo", &dest).is_err());
    assert!(!dest.exists());
}

#[test]
fn extracts_the_binary_from_a_tar_gz() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("hugo");
    extract_from_tar_gz(Cursor::new(release_tar_gz()), "hugo", &dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), FAKE_BINARY);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&dest).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
    }
}

#[test]
fn a_directory_named_like_the_binary_is_skipped() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("hugo");
    let archive = tar_gz_bytes(&[("hugo/", b""), ("hugo/hugo", FAKE_BINARY)]);
    extract_from_tar_gz(Cursor::new(archive), "hugo", &dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), FAKE_BINARY);
}

#[test]
fn finds_the_binary_in_an_expanded_pkg() {
    // The layout `pkgutil --expand-full` produces.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("hugo.pkg/Scripts")).unwrap();
    fs::create_dir_all(root.join("hugo.pkg/Payload/usr/local/bin")).unwrap();
    fs::write(root.join("Distribution"), "<xml/>").unwrap();
    fs::write(root.join("hugo.pkg/Scripts/hugo"), "#!/bin/sh").unwrap();
    fs::write(
        root.join("hugo.pkg/Payload/usr/local/bin/hugo"),
        FAKE_BINARY,
    )
    .unwrap();
    let found = find_in_expanded_pkg(root, "hugo").unwrap();
    assert!(found.ends_with("Payload/usr/local/bin/hugo"), "{found:?}");
    assert!(find_in_expanded_pkg(root, "hugo.exe").is_err());
}

#[test]
fn version_folder_names() {
    let v = Semver::new(0, 167, 0);
    assert_eq!(folder_name(v, true), "0.167.0-extended");
    assert_eq!(folder_name(v, false), "0.167.0");
    assert_eq!(parse_folder_name("0.167.0-extended"), Some((v, true)));
    assert_eq!(parse_folder_name("0.167.0"), Some((v, false)));
    assert_eq!(parse_folder_name(".staging-1-2"), None);
    assert_eq!(parse_folder_name("0.167.0-deploy"), None);
    let base = Path::new("base");
    assert_eq!(
        version_dir(base, "v0.160.1", true).unwrap(),
        base.join("0.160.1-extended")
    );
    assert!(matches!(
        version_dir(base, "../..", false),
        Err(AppError::Invalid(_))
    ));
}

#[test]
fn scans_installed_versions_newest_first() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path();
    for folder in ["0.147.7", "0.167.0", "0.167.0-extended", "0.99.0-extended"] {
        fs::create_dir_all(base.join(folder)).unwrap();
        fs::write(base.join(folder).join("hugo"), FAKE_BINARY).unwrap();
    }
    // Ignored: no binary, staging folders, other names, files.
    fs::create_dir_all(base.join("0.150.0")).unwrap();
    fs::create_dir_all(base.join(".staging-1-2/out")).unwrap();
    fs::write(base.join(".staging-1-2/out/hugo"), FAKE_BINARY).unwrap();
    fs::create_dir_all(base.join("notes")).unwrap();
    fs::write(base.join("0.1.0"), "file").unwrap();

    let installed = scan_installed(base, LINUX_X64);
    let listed: Vec<(String, bool)> = installed
        .iter()
        .map(|m| (m.version.clone(), m.extended))
        .collect();
    assert_eq!(
        listed,
        [
            ("0.167.0".to_string(), true),
            ("0.167.0".to_string(), false),
            ("0.147.7".to_string(), false),
            ("0.99.0".to_string(), true),
        ]
    );
    assert_eq!(
        PathBuf::from(&installed[0].path),
        base.join("0.167.0-extended").join("hugo")
    );
    // Windows looks for hugo.exe.
    assert!(scan_installed(base, WIN_X64).is_empty());
    assert!(scan_installed(&base.join("missing"), LINUX_X64).is_empty());

    remove_stale_staging(base);
    assert!(!base.join(".staging-1-2").exists());
    assert!(base.join("0.167.0").exists());
}

#[test]
fn staging_folders_clean_up_after_themselves() {
    let dir = tempfile::tempdir().unwrap();
    let path = {
        let staging = Staging::new(dir.path()).unwrap();
        fs::write(staging.path().join("partial.zip"), b"half").unwrap();
        staging.path().to_path_buf()
    };
    assert!(!path.exists());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn is_inside_compares_paths() {
    let dir = tempfile::tempdir().unwrap();
    let version = dir.path().join("0.167.0");
    fs::create_dir_all(&version).unwrap();
    assert!(is_inside(&version.join("hugo"), &version));
    assert!(!is_inside(
        &dir.path().join("0.167.0-extended/hugo"),
        &version
    ));
}

struct Recorder(Mutex<Vec<InstallProgress>>);

impl Recorder {
    fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }
    fn stages(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(|p| p.stage.clone())
            .collect()
    }
}

fn write_archive(dir: &Path, asset: &Asset, bytes: &[u8]) -> (PathBuf, String) {
    let path = dir.join(&asset.file_name);
    fs::write(&path, bytes).unwrap();
    let checksums = format!(
        "{}  {}\n{}  hugo_0.167.0_darwin-universal.pkg\n",
        sha256_hex(bytes),
        asset.file_name,
        "1".repeat(64)
    );
    (path, checksums)
}

fn only_versions(base: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(base)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[tokio::test]
async fn installs_from_a_verified_archive() {
    let downloads = tempfile::tempdir().unwrap();
    let app_data = tempfile::tempdir().unwrap();
    let base = app_data.path().join("hugo");
    for (platform, bytes) in [(WIN_X64, release_zip()), (LINUX_X64, release_tar_gz())] {
        let asset = select_asset("0.167.0", true, platform).unwrap();
        let (archive, checksums) = write_archive(downloads.path(), &asset, &bytes);
        let recorder = Recorder::new();
        let progress = |p: InstallProgress| recorder.0.lock().unwrap().push(p);
        let verified = Mutex::new(None);
        let installed = install_archive(
            &base,
            "0.167.0",
            &asset,
            &archive,
            &checksums,
            platform,
            &progress,
            |binary| {
                *verified.lock().unwrap() = Some(binary);
                async { Ok(()) }
            },
        )
        .await
        .unwrap();
        let binary = base.join("0.167.0-extended").join(platform.binary_name());
        assert_eq!(PathBuf::from(&installed.path), binary);
        assert!(installed.extended);
        assert_eq!(installed.version, "0.167.0");
        assert_eq!(fs::read(&binary).unwrap(), FAKE_BINARY);
        assert_eq!(verified.lock().unwrap().as_ref(), Some(&binary));
        assert_eq!(recorder.stages(), ["verify", "extract"]);
        // The version folder holds only the binary, and no staging folder is left.
        assert_eq!(
            fs::read_dir(base.join("0.167.0-extended")).unwrap().count(),
            1
        );
        assert_eq!(only_versions(&base), ["0.167.0-extended"]);
        fs::remove_dir_all(base.join("0.167.0-extended")).unwrap();
    }
}

#[tokio::test]
async fn reinstalling_replaces_the_existing_folder() {
    let downloads = tempfile::tempdir().unwrap();
    let base = tempfile::tempdir().unwrap();
    let old = base.path().join("0.167.0");
    fs::create_dir_all(&old).unwrap();
    fs::write(old.join("hugo"), b"broken").unwrap();
    fs::write(old.join("leftover"), b"x").unwrap();
    let asset = select_asset("0.167.0", false, LINUX_X64).unwrap();
    let (archive, checksums) = write_archive(downloads.path(), &asset, &release_tar_gz());
    install_archive(
        base.path(),
        "0.167.0",
        &asset,
        &archive,
        &checksums,
        LINUX_X64,
        &|_| {},
        |_| async { Ok(()) },
    )
    .await
    .unwrap();
    assert_eq!(fs::read(old.join("hugo")).unwrap(), FAKE_BINARY);
    assert!(!old.join("leftover").exists());
}

#[tokio::test]
async fn a_checksum_mismatch_leaves_nothing_behind() {
    let downloads = tempfile::tempdir().unwrap();
    let base = tempfile::tempdir().unwrap();
    let asset = select_asset("0.167.0", true, WIN_X64).unwrap();
    let (archive, _) = write_archive(downloads.path(), &asset, &release_zip());
    let wrong = format!("{}  {}\n", sha256_hex(b"something else"), asset.file_name);
    let error = install_archive(
        base.path(),
        "0.167.0",
        &asset,
        &archive,
        &wrong,
        WIN_X64,
        &|_| {},
        |_| async { panic!("must not run a binary that failed verification") },
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("checksum mismatch"), "{error}");
    assert!(only_versions(base.path()).is_empty());

    // Not listed at all.
    let error = install_archive(
        base.path(),
        "0.167.0",
        &asset,
        &archive,
        "",
        WIN_X64,
        &|_| {},
        |_| async { Ok(()) },
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("not listed"), "{error}");
    assert!(only_versions(base.path()).is_empty());
}

#[tokio::test]
async fn a_binary_that_does_not_run_is_removed_again() {
    let downloads = tempfile::tempdir().unwrap();
    let base = tempfile::tempdir().unwrap();
    let asset = select_asset("0.167.0", true, LINUX_X64).unwrap();
    let (archive, checksums) = write_archive(downloads.path(), &asset, &release_tar_gz());
    let error = install_archive(
        base.path(),
        "0.167.0",
        &asset,
        &archive,
        &checksums,
        LINUX_X64,
        &|_| {},
        |_| async { Err(AppError::Hugo("exec format error".into())) },
    )
    .await
    .unwrap_err();
    assert!(matches!(error, AppError::Hugo(_)));
    assert!(only_versions(base.path()).is_empty());
}

#[tokio::test]
async fn an_archive_without_hugo_leaves_nothing_behind() {
    let downloads = tempfile::tempdir().unwrap();
    let base = tempfile::tempdir().unwrap();
    let asset = select_asset("0.167.0", false, WIN_X64).unwrap();
    let (archive, checksums) =
        write_archive(downloads.path(), &asset, &zip_bytes(&[("README.md", b"x")]));
    let error = install_archive(
        base.path(),
        "0.167.0",
        &asset,
        &archive,
        &checksums,
        WIN_X64,
        &|_| {},
        |_| async { Ok(()) },
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("not found"), "{error}");
    assert!(only_versions(base.path()).is_empty());
}

#[tokio::test]
async fn extract_binary_reads_archive_files() {
    let dir = tempfile::tempdir().unwrap();
    let archive = dir.path().join("a.tar.gz");
    fs::write(&archive, release_tar_gz()).unwrap();
    let out = dir.path().join("out");
    fs::create_dir(&out).unwrap();
    let binary = extract_binary(
        &archive,
        ArchiveKind::TarGz,
        "hugo",
        &out,
        &dir.path().join("pkg"),
    )
    .await
    .unwrap();
    assert_eq!(binary, out.join("hugo"));
    assert_eq!(fs::read(binary).unwrap(), FAKE_BINARY);
}

/// The whole pipeline including the real `hugo version` check, with a shell script standing in
/// for Hugo.
#[cfg(unix)]
#[tokio::test]
async fn verifies_the_installed_binary_with_probe() {
    use hugo_publisher_lib::hugo::manager::install::verify_with_probe;

    let script = |version: &str| {
        format!(
            "#!/bin/sh\necho 'hugo v{version}-abc123+extended linux/amd64 BuildDate=2026-09-28T14:50:38Z VendorInfo=gohugoio'\n"
        )
    };
    let downloads = tempfile::tempdir().unwrap();
    let base = tempfile::tempdir().unwrap();
    let asset = select_asset("0.167.0", true, LINUX_X64).unwrap();
    let good = script("0.167.0");
    let bytes = tar_gz_bytes(&[("hugo", good.as_bytes())]);
    let (archive, checksums) = write_archive(downloads.path(), &asset, &bytes);
    let v = Semver::new(0, 167, 0);
    let installed = install_archive(
        base.path(),
        "0.167.0",
        &asset,
        &archive,
        &checksums,
        LINUX_X64,
        &|_| {},
        |binary| verify_with_probe(binary, v, true),
    )
    .await
    .unwrap();
    assert!(Path::new(&installed.path).is_file());

    // A binary reporting another version is refused and removed.
    let fs_base = tempfile::tempdir().unwrap();
    let bytes = tar_gz_bytes(&[("hugo", script("0.160.0").as_bytes())]);
    let (archive, checksums) = write_archive(downloads.path(), &asset, &bytes);
    let error = install_archive(
        fs_base.path(),
        "0.167.0",
        &asset,
        &archive,
        &checksums,
        LINUX_X64,
        &|_| {},
        |binary| verify_with_probe(binary, v, true),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("0.160.0"), "{error}");
    assert!(only_versions(fs_base.path()).is_empty());
}
