//! `hugo new content` with a real `hugo` binary in a temporary site. Skipped when Hugo is not
//! installed, unless `HUGO_PUBLISHER_REQUIRE_HUGO=1` is set.

use std::fs;
use std::path::{Path, PathBuf};

use hugo_publisher_lib::error::AppError;
use hugo_publisher_lib::hugo::archetypes::{list_archetypes, new_content};
use hugo_publisher_lib::hugo::detect::detect;
use hugo_publisher_lib::site;

async fn hugo_or_skip() -> Option<PathBuf> {
    match detect(None).await {
        Ok(info) => Some(info.path),
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

fn read(root: &Path, relative: &str) -> String {
    fs::read_to_string(root.join(relative)).unwrap()
}

/// A site with a section archetype, a bundle archetype and a theme archetype.
fn sample_site() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "hugo.toml",
        "baseURL = 'https://example.org/'\ntitle = 'Deneme'\ntheme = 'tema'\n",
    );
    write(
        root,
        "archetypes/posts.md",
        "---\ntitle: \"{{ replace .File.ContentBaseName \"-\" \" \" | title }}\"\ndraft: true\ndescription: \"\"\n---\n\nBuraya giriş yazılacak.\n",
    );
    write(
        root,
        "archetypes/galeri/index.md",
        "---\ntitle: \"{{ .File.ContentBaseName }}\"\n---\nGaleri açıklaması buraya.\n",
    );
    write(root, "archetypes/galeri/kapak.txt", "kapak");
    write(
        root,
        "themes/tema/archetypes/not.md",
        "+++\ntitle = 'not'\n+++\nTemadan gelen not.\n",
    );
    write(root, "themes/tema/layouts/home.html", "home");
    write(root, "content/posts/var-olan.md", "---\ntitle: Var\n---\n");
    let root = site::open(root).unwrap().root;
    (dir, root)
}

#[test]
fn lists_the_sample_archetypes() {
    let (_dir, root) = sample_site();
    let names: Vec<(String, String)> = list_archetypes(&root)
        .unwrap()
        .into_iter()
        .map(|a| (a.name, a.source))
        .collect();
    assert_eq!(
        names,
        vec![
            ("galeri".to_string(), "site".to_string()),
            ("posts".to_string(), "site".to_string()),
            ("not".to_string(), "theme".to_string()),
        ]
    );
}

#[tokio::test]
async fn creates_posts_from_the_section_archetype() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let (_dir, root) = sample_site();
    let created = new_content(&hugo, &root, "content", "content/posts/ilk-yazı.md", None)
        .await
        .unwrap();
    assert_eq!(created, "content/posts/ilk-yazı.md");
    let text = read(&root, &created);
    assert!(text.contains("Buraya giriş yazılacak."), "{text}");
    assert!(text.contains("draft: true"), "{text}");

    // Backslashes are fine; the same path again is refused before Hugo runs.
    let again = new_content(&hugo, &root, "content", r"content\posts\ilk-yazı.md", None).await;
    assert!(
        matches!(&again, Err(AppError::Invalid(m)) if m.contains("already exists")),
        "{again:?}"
    );
}

#[tokio::test]
async fn creates_a_bundle_from_a_folder_archetype() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let (_dir, root) = sample_site();
    let created = new_content(
        &hugo,
        &root,
        "content",
        "content/posts/gezi-notları/index.md",
        Some("galeri"),
    )
    .await
    .unwrap();
    assert_eq!(created, "content/posts/gezi-notları/index.md");
    assert!(read(&root, &created).contains("Galeri açıklaması buraya."));
    assert_eq!(read(&root, "content/posts/gezi-notları/kapak.txt"), "kapak");
}

#[tokio::test]
async fn creates_from_a_theme_archetype_and_into_a_new_section() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let (_dir, root) = sample_site();
    let created = new_content(
        &hugo,
        &root,
        "content",
        "content/notlar/bir.md",
        Some("not"),
    )
    .await
    .unwrap();
    assert_eq!(created, "content/notlar/bir.md");
    assert!(read(&root, &created).contains("Temadan gelen not."));

    // A bundle without a folder archetype: just the index.md, from the default archetype.
    let created = new_content(&hugo, &root, "content", "content/sayfa/index.md", None)
        .await
        .unwrap();
    assert_eq!(created, "content/sayfa/index.md");
}

#[tokio::test]
async fn refuses_paths_outside_the_content_folder() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let (_dir, root) = sample_site();
    for bad in [
        "static/x.md",
        "content/../x.md",
        "../x.md",
        "content/",
        "content",
        "contentx/a.md",
    ] {
        let result = new_content(&hugo, &root, "content", bad, None).await;
        assert!(
            matches!(result, Err(AppError::PathOutsideSite(_))),
            "{bad}: {result:?}"
        );
    }
    let result = new_content(&hugo, &root, "content", "content/x.txt", None).await;
    assert!(matches!(result, Err(AppError::Invalid(_))), "{result:?}");
    let result = new_content(&hugo, &root, "content", "content/x.md", Some("--force")).await;
    assert!(matches!(result, Err(AppError::Invalid(_))), "{result:?}");
    assert!(!root.join("content/x.md").exists());
    assert!(!root.join("x.md").exists());
}
