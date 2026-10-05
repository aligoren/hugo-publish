//! Pure rules of the Hugo version manager: release file names, checksums, versions, the GitHub
//! release list and error mapping. No network.

use std::cmp::Ordering;

use hugo_publisher_lib::error::AppError;
use hugo_publisher_lib::hugo::manager::assets::{
    ArchiveKind, Platform, checksum_for, checksums_file_name, download_url, parse_checksums,
    resolve_asset, select_asset, sha256_hex, verify_checksum,
};
use hugo_publisher_lib::hugo::manager::github::{parse_releases, status_error};
use hugo_publisher_lib::hugo::manager::semver::{Semver, compare_versions};

const WIN_X64: Platform = Platform {
    os: "windows",
    arch: "x86_64",
};
const WIN_ARM: Platform = Platform {
    os: "windows",
    arch: "aarch64",
};
const LINUX_X64: Platform = Platform {
    os: "linux",
    arch: "x86_64",
};
const LINUX_ARM: Platform = Platform {
    os: "linux",
    arch: "aarch64",
};
const MAC_ARM: Platform = Platform {
    os: "macos",
    arch: "aarch64",
};
const MAC_X64: Platform = Platform {
    os: "macos",
    arch: "x86_64",
};

fn name(version: &str, extended: bool, platform: Platform) -> String {
    select_asset(version, extended, platform).unwrap().file_name
}

#[test]
fn asset_matrix_for_current_releases() {
    let cases = [
        (
            WIN_X64,
            true,
            "hugo_extended_0.167.0_windows-amd64.zip",
            ArchiveKind::Zip,
        ),
        (
            WIN_X64,
            false,
            "hugo_0.167.0_windows-amd64.zip",
            ArchiveKind::Zip,
        ),
        (
            WIN_ARM,
            false,
            "hugo_0.167.0_windows-arm64.zip",
            ArchiveKind::Zip,
        ),
        (
            LINUX_X64,
            true,
            "hugo_extended_0.167.0_linux-amd64.tar.gz",
            ArchiveKind::TarGz,
        ),
        (
            LINUX_X64,
            false,
            "hugo_0.167.0_linux-amd64.tar.gz",
            ArchiveKind::TarGz,
        ),
        (
            LINUX_ARM,
            true,
            "hugo_extended_0.167.0_linux-arm64.tar.gz",
            ArchiveKind::TarGz,
        ),
        (
            LINUX_ARM,
            false,
            "hugo_0.167.0_linux-arm64.tar.gz",
            ArchiveKind::TarGz,
        ),
        (
            MAC_ARM,
            true,
            "hugo_extended_0.167.0_darwin-universal.pkg",
            ArchiveKind::Pkg,
        ),
        (
            MAC_X64,
            false,
            "hugo_0.167.0_darwin-universal.pkg",
            ArchiveKind::Pkg,
        ),
    ];
    for (platform, extended, file, kind) in cases {
        let asset = select_asset("0.167.0", extended, platform).unwrap();
        assert_eq!(asset.file_name, file, "{platform:?} extended={extended}");
        assert_eq!(asset.kind, kind, "{file}");
        assert_eq!(asset.extended, extended, "{file}");
        assert_eq!(asset.note, None, "{file}");
    }
}

#[test]
fn windows_arm64_falls_back_to_the_standard_build_and_says_so() {
    let asset = select_asset("0.167.0", true, WIN_ARM).unwrap();
    assert_eq!(asset.file_name, "hugo_0.167.0_windows-arm64.zip");
    assert!(!asset.extended);
    assert!(asset.note.unwrap().contains("no extended build"));
    assert!(!WIN_ARM.has_extended_build());
    assert!(WIN_X64.has_extended_build() && LINUX_ARM.has_extended_build());
}

#[test]
fn macos_switches_to_pkg_at_0_153() {
    assert_eq!(
        name("0.152.2", true, MAC_ARM),
        "hugo_extended_0.152.2_darwin-universal.tar.gz"
    );
    assert_eq!(
        select_asset("0.152.2", false, MAC_X64).unwrap().kind,
        ArchiveKind::TarGz
    );
    assert_eq!(
        name("0.153.0", true, MAC_ARM),
        "hugo_extended_0.153.0_darwin-universal.pkg"
    );
    assert_eq!(
        select_asset("0.153.0", false, MAC_X64).unwrap().kind,
        ArchiveKind::Pkg
    );
}

#[test]
fn accepts_a_leading_v_and_refuses_bad_versions_and_platforms() {
    assert_eq!(
        name("v0.160.1", false, LINUX_X64),
        "hugo_0.160.1_linux-amd64.tar.gz"
    );
    for bad in [
        "",
        "latest",
        "0.167",
        "0.167.0.1",
        "0.167.0-rc1",
        "../0.1.0",
        "0.167.x",
    ] {
        assert!(
            matches!(select_asset(bad, false, WIN_X64), Err(AppError::Invalid(_))),
            "{bad:?} was accepted"
        );
    }
    let freebsd = Platform {
        os: "freebsd",
        arch: "x86_64",
    };
    assert!(select_asset("0.167.0", false, freebsd).is_err());
    let riscv = Platform {
        os: "linux",
        arch: "riscv64",
    };
    assert!(select_asset("0.167.0", false, riscv).is_err());
    // Before 0.103.0 the files had other names (Linux-64bit, macOS-ARM64…).
    let old = select_asset("0.102.3", false, LINUX_X64).unwrap_err();
    assert!(old.to_string().contains("0.103.0"));
}

#[test]
fn binary_names() {
    assert_eq!(WIN_X64.binary_name(), "hugo.exe");
    assert_eq!(LINUX_ARM.binary_name(), "hugo");
    assert_eq!(MAC_ARM.binary_name(), "hugo");
}

#[test]
fn urls_and_checksum_file_names() {
    assert_eq!(checksums_file_name("0.167.0"), "hugo_0.167.0_checksums.txt");
    assert_eq!(
        download_url("0.167.0", "hugo_0.167.0_checksums.txt"),
        "https://github.com/gohugoio/hugo/releases/download/v0.167.0/hugo_0.167.0_checksums.txt"
    );
}

const HASH_A: &str = "a3f1c6e0f5d24b8e9c7a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcd";
const HASH_B: &str = "0000000000000000000000000000000000000000000000000000000000000001";
/// Upper-case, as some tools write it.
const HASH_C: &str = "ABCDEF0000000000000000000000000000000000000000000000000000000000";

fn checksums() -> String {
    format!(
        "{HASH_A}  hugo_extended_0.167.0_windows-amd64.zip\n\
         {HASH_C}  *hugo_0.167.0_linux-amd64.tar.gz\r\n\
         \n\
         not a checksum line\n\
         abc  short.zip\n\
         {HASH_B}  hugo_0.167.0_windows-arm64.zip\n"
    )
}

#[test]
fn parses_checksum_files() {
    let parsed = parse_checksums(&checksums());
    assert_eq!(parsed.len(), 3);
    assert_eq!(
        parsed[0],
        (
            HASH_A.to_string(),
            "hugo_extended_0.167.0_windows-amd64.zip".to_string()
        )
    );
    // Binary-mode marker removed, hash lower-cased, CRLF tolerated.
    assert_eq!(parsed[1].1, "hugo_0.167.0_linux-amd64.tar.gz");
    assert_eq!(parsed[1].0, HASH_C.to_lowercase());
    assert_eq!(
        checksum_for(&checksums(), "hugo_0.167.0_windows-arm64.zip").as_deref(),
        Some(HASH_B)
    );
    assert_eq!(checksum_for(&checksums(), "missing.zip"), None);
}

#[test]
fn checksum_verification() {
    // SHA-256("abc"), a well-known test vector.
    let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    assert_eq!(sha256_hex(b"abc"), abc);
    assert!(verify_checksum(abc, &abc.to_uppercase(), "x.zip").is_ok());
    let error = verify_checksum(&sha256_hex(b"abd"), abc, "x.zip").unwrap_err();
    assert!(matches!(error, AppError::Invalid(_)));
    assert!(error.to_string().contains("checksum mismatch for x.zip"));
}

#[test]
fn resolve_asset_checks_the_release_contents() {
    let text = checksums();
    // Listed: used as is.
    let asset = resolve_asset("0.167.0", true, WIN_X64, &text).unwrap();
    assert_eq!(asset.file_name, "hugo_extended_0.167.0_windows-amd64.zip");
    // Extended not listed for linux-amd64 in this fixture: standard build with a note.
    let asset = resolve_asset("0.167.0", true, LINUX_X64, &text).unwrap();
    assert_eq!(asset.file_name, "hugo_0.167.0_linux-amd64.tar.gz");
    assert!(!asset.extended);
    assert!(asset.note.is_some());
    // Nothing fitting listed.
    let error = resolve_asset("0.167.0", false, MAC_ARM, &text).unwrap_err();
    assert!(error.to_string().contains("darwin-universal.pkg"));
}

#[test]
fn semver_parsing_and_ordering() {
    assert_eq!(Semver::parse("0.167.0"), Some(Semver::new(0, 167, 0)));
    assert_eq!(Semver::parse("v1.2.3"), Some(Semver::new(1, 2, 3)));
    assert_eq!(Semver::parse("0.167"), None);
    assert_eq!(Semver::parse("0.0167.0"), None);
    assert_eq!(Semver::parse("vv0.1.0"), None);
    assert_eq!(Semver::new(0, 147, 7).to_string(), "0.147.7");
    // Numeric, not lexicographic.
    assert!(Semver::parse("0.99.0") < Semver::parse("0.100.0"));
    assert_eq!(
        compare_versions("0.158.0", "0.147.7"),
        Some(Ordering::Greater)
    );
    assert_eq!(
        compare_versions("v0.153.0", "0.153.0"),
        Some(Ordering::Equal)
    );
    assert_eq!(compare_versions("0.9.10", "0.10.0"), Some(Ordering::Less));
    assert_eq!(compare_versions("latest", "0.1.0"), None);
}

const RELEASES_JSON: &str = r#"[
  {"tag_name": "v0.160.1", "published_at": "2026-05-02T10:00:00Z", "prerelease": false, "draft": false, "assets": []},
  {"tag_name": "v0.167.0", "published_at": "2026-09-28T14:50:38Z", "prerelease": false, "draft": false},
  {"tag_name": "v0.168.0-rc1", "published_at": "2026-10-01T09:00:00Z", "prerelease": true, "draft": false},
  {"tag_name": "v0.99.1", "published_at": "2022-05-01T00:00:00Z", "prerelease": false, "draft": false},
  {"tag_name": "v0.168.0", "published_at": null, "prerelease": true, "draft": true},
  {"tag_name": "v0.166.2", "published_at": "2026-09-30T08:00:00Z", "prerelease": false},
  {"tag_name": "v0.168.0", "published_at": "2026-10-02T09:00:00Z", "prerelease": true, "draft": false}
]"#;

#[test]
fn parses_and_sorts_the_github_release_list() {
    let releases = parse_releases(RELEASES_JSON).unwrap();
    let versions: Vec<&str> = releases.iter().map(|r| r.version.as_str()).collect();
    // Drafts and non-version tags skipped, `v` removed, newest version first (a later patch of
    // an older line does not jump ahead).
    assert_eq!(
        versions,
        ["0.168.0", "0.167.0", "0.166.2", "0.160.1", "0.99.1"]
    );
    assert!(releases[0].prerelease);
    assert_eq!(releases[0].published_at, "2026-10-02T09:00:00Z");
    assert!(!releases[1].prerelease);
    assert!(parse_releases("{\"message\": \"Not Found\"}").is_err());
}

#[test]
fn maps_rate_limits_to_a_clear_error() {
    let error = status_error(403, Some(1_000 + 125), 1_000, "listing Hugo releases");
    let text = error.to_string();
    assert!(text.contains("GitHub rate limit reached"), "{text}");
    assert!(text.contains("3 minute"), "{text}");
    let error = status_error(429, None, 1_000, "downloading");
    assert!(error.to_string().contains("rate limit"));
    assert!(error.to_string().contains("try again later"));
    // A reset time in the past is not shown.
    assert!(
        status_error(403, Some(10), 1_000, "x")
            .to_string()
            .contains("later")
    );
    assert!(status_error(404, None, 0, "x").to_string().contains("404"));
    assert!(status_error(502, None, 0, "x").to_string().contains("502"));
}
