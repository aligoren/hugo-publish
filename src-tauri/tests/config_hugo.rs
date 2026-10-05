//! `hugo config` based validation and effective values, against a real `hugo`. Skipped when Hugo
//! is not installed, unless `HUGO_PUBLISHER_REQUIRE_HUGO=1`.

use std::fs;
use std::path::Path;

use hugo_publisher_lib::config::commands::{ConfigFileText, effective, validate, validate_files};
use hugo_publisher_lib::hugo::detect::{HugoInfo, detect};

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

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn site() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "hugo.toml",
        "baseURL = \"https://example.org/\"\ntitle = \"Deneme\"\n# keep me\n",
    );
    write(
        dir.path(),
        "config/_default/params.toml",
        "ShowToc = true\n",
    );
    write(dir.path(), "content/_index.md", "---\ntitle: Ana\n---\n");
    dir
}

fn json(value: &impl serde::Serialize) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_the_effective_config() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let site = site();
    let result = json(&effective(&hugo.path, site.path(), None).await.unwrap());
    assert_eq!(result["values"]["title"], "Deneme");
    // Hugo lower-cases keys, params included, and merges config/_default.
    assert_eq!(result["values"]["params"]["showtoc"], true);
    assert!(result["messages"].is_array());
}

#[tokio::test(flavor = "multi_thread")]
async fn validates_root_config_without_touching_the_site() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let site = site();
    let original = fs::read_to_string(site.path().join("hugo.toml")).unwrap();

    let ok = json(
        &validate(
            &hugo.path,
            site.path(),
            "hugo.toml",
            "baseURL = \"https://example.org/\"\ntitle = \"Yeni\"\n",
        )
        .await
        .unwrap(),
    );
    assert_eq!(ok["ok"], true, "{ok}");

    let broken = json(
        &validate(&hugo.path, site.path(), "hugo.toml", "title = \n")
            .await
            .unwrap(),
    );
    assert_eq!(broken["ok"], false);
    assert!(!broken["messages"].as_array().unwrap().is_empty());

    assert_eq!(
        fs::read_to_string(site.path().join("hugo.toml")).unwrap(),
        original
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn validates_files_in_the_config_directory() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let site = site();
    let broken = json(
        &validate(
            &hugo.path,
            site.path(),
            "config/_default/params.toml",
            "ShowToc = \n",
        )
        .await
        .unwrap(),
    );
    assert_eq!(broken["ok"], false, "{broken}");
    let fine = json(
        &validate(
            &hugo.path,
            site.path(),
            "config/_default/params.toml",
            "ShowToc = false\n",
        )
        .await
        .unwrap(),
    );
    assert_eq!(fine["ok"], true, "{fine}");
    assert_eq!(
        fs::read_to_string(site.path().join("config/_default/params.toml")).unwrap(),
        "ShowToc = true\n"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn validates_a_split_config_without_touching_the_site() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let site = site();
    let file = |path: &str, text: Option<&str>| ConfigFileText {
        path: path.into(),
        text: text.map(str::to_owned),
    };
    // Root file moved into config/_default/: valid.
    let split = [
        file("hugo.toml", None),
        file(
            "config/_default/hugo.toml",
            Some(
                "baseURL = \"https://example.org/\"
title = \"Deneme\"
",
            ),
        ),
    ];
    let result = json(
        &validate_files(&hugo.path, site.path(), &split)
            .await
            .unwrap(),
    );
    assert_eq!(result["ok"], true, "{result}");
    // A broken piece is reported.
    let broken = [file(
        "config/_default/menus.toml",
        Some(
            "[[main]
name = 1
",
        ),
    )];
    let result = json(
        &validate_files(&hugo.path, site.path(), &broken)
            .await
            .unwrap(),
    );
    assert_eq!(result["ok"], false);
    // Only config files are accepted, and the site is unchanged.
    let other = [file("content/_index.md", Some("x"))];
    assert!(
        validate_files(&hugo.path, site.path(), &other)
            .await
            .is_err()
    );
    assert!(site.path().join("hugo.toml").is_file());
    assert!(!site.path().join("config/_default/hugo.toml").exists());
}
