//! Talks to the real GitHub API and downloads a real Hugo release. Opt-in only:
//! `HUGO_PUBLISHER_NETWORK_TESTS=1 cargo test --test hugo_manager_network`.

use std::path::Path;
use std::sync::Mutex;

use hugo_publisher_lib::hugo::detect::probe;
use hugo_publisher_lib::hugo::manager::assets::Platform;
use hugo_publisher_lib::hugo::manager::semver::Semver;
use hugo_publisher_lib::hugo::manager::{InstallProgress, github, install};

fn enabled() -> bool {
    let on = std::env::var("HUGO_PUBLISHER_NETWORK_TESTS").as_deref() == Ok("1");
    if !on {
        eprintln!("skipping: set HUGO_PUBLISHER_NETWORK_TESTS=1 to run network tests");
    }
    on
}

#[tokio::test]
async fn lists_releases_and_installs_the_newest_stable_one() {
    if !enabled() {
        return;
    }
    let releases = github::releases().await.unwrap();
    assert!(releases.len() > 10, "{releases:?}");
    let versions: Vec<Semver> = releases
        .iter()
        .map(|r| Semver::parse(&r.version).unwrap())
        .collect();
    assert!(versions.windows(2).all(|w| w[0] > w[1]), "not newest first");
    assert!(versions[0] >= Semver::new(0, 167, 0));
    // Served from the cache the second time.
    assert_eq!(github::releases().await.unwrap(), releases);

    let latest = releases.iter().find(|r| !r.prerelease).unwrap();
    let app_data = tempfile::tempdir().unwrap();
    let base = app_data.path().join("hugo");
    let platform = Platform::current();
    let events = Mutex::new(Vec::<InstallProgress>::new());
    let progress = |p: InstallProgress| events.lock().unwrap().push(p);

    let installed = install::install(&base, &latest.version, true, platform, &progress)
        .await
        .unwrap();
    assert_eq!(installed.version, latest.version);
    assert_eq!(installed.extended, platform.has_extended_build());
    let info = probe(Path::new(&installed.path)).await.unwrap();
    assert_eq!(info.version.display(), latest.version);
    assert_eq!(info.version.extended, installed.extended);

    let stages: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .map(|p| p.stage.clone())
        .collect();
    for stage in ["download", "verify", "extract", "done"] {
        assert!(
            stages.iter().any(|s| s == stage),
            "no {stage} in {stages:?}"
        );
    }
    let last_download = events
        .lock()
        .unwrap()
        .iter()
        .rev()
        .find(|p| p.stage == "download")
        .cloned()
        .unwrap();
    assert!(last_download.received > 1_000_000);
    assert_eq!(Some(last_download.received), last_download.total);

    // Only the version folder is left; installing again reuses it.
    let names: Vec<String> = std::fs::read_dir(&base)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names.len(), 1, "{names:?}");
    let again = install::install(&base, &latest.version, true, platform, &|_| {})
        .await
        .unwrap();
    assert_eq!(again, installed);
    assert_eq!(install::scan_installed(&base, platform), vec![installed]);
}
