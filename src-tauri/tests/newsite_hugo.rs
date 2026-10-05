//! Creating a site with a real `hugo` (no theme download: offline). Skipped without Hugo unless
//! `HUGO_PUBLISHER_REQUIRE_HUGO=1`.

use std::fs;

use hugo_publisher_lib::config::commands::effective;
use hugo_publisher_lib::hugo::detect::{HugoInfo, detect};
use hugo_publisher_lib::newsite::{NewSiteOptions, create_site};

async fn hugo_or_skip() -> Option<HugoInfo> {
    match detect(None).await {
        Ok(info) => Some(info),
        Err(error) => {
            if std::env::var("HUGO_PUBLISHER_REQUIRE_HUGO").as_deref() == Ok("1") {
                panic!("Hugo is required for this test run: {error}");
            }
            eprintln!("skipping: {error}");
            None
        }
    }
}

fn options(parent: &std::path::Path, name: &str, git_init: bool) -> NewSiteOptions {
    serde_json::from_value(serde_json::json!({
        "parentDir": parent.to_string_lossy(),
        "name": name,
        "title": "Yeni \"Site\"",
        "language": "tr",
        "gitInit": git_init,
    }))
    .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn creates_a_site_hugo_can_load() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let parent = tempfile::tempdir().unwrap();
    let root = create_site(&hugo.path, &options(parent.path(), "blog", false))
        .await
        .unwrap();
    assert!(root.join("content").is_dir());
    assert!(root.join("archetypes").is_dir());
    let config = fs::read_to_string(root.join("hugo.toml")).unwrap();
    assert!(config.contains("title = \"Yeni \\\"Site\\\"\""));
    assert!(
        fs::read_to_string(root.join(".gitignore"))
            .unwrap()
            .contains("/public/")
    );

    let loaded = serde_json::to_value(effective(&hugo.path, &root, None).await.unwrap()).unwrap();
    assert_eq!(loaded["values"]["title"], "Yeni \"Site\"");
    assert_eq!(loaded["values"]["defaultcontentlanguage"], "tr");

    // The same name again must fail instead of overwriting.
    assert!(
        create_site(&hugo.path, &options(parent.path(), "blog", false))
            .await
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn initialises_git_when_asked() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    if which::which("git").is_err() {
        eprintln!("skipping: git not installed");
        return;
    }
    let parent = tempfile::tempdir().unwrap();
    let root = create_site(&hugo.path, &options(parent.path(), "with-git", true))
        .await
        .unwrap();
    assert!(root.join(".git").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_bad_folder_names() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let parent = tempfile::tempdir().unwrap();
    for name in ["../escape", "a/b", ".hidden", ""] {
        assert!(
            create_site(&hugo.path, &options(parent.path(), name, false))
                .await
                .is_err(),
            "{name}"
        );
    }
}
