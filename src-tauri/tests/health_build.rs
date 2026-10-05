//! Site health builds against a real `hugo` (and `git` for revision builds). Skipped when Hugo
//! is not installed, unless `HUGO_PUBLISHER_REQUIRE_HUGO=1`; the revision tests also need git.

use std::fs;
use std::path::Path;
use std::process::Command;

use hugo_publisher_lib::git::runner::git_binary;
use hugo_publisher_lib::health::build::{
    WORK_DIR_PREFIX, build, discard, is_registered, read_file,
};
use hugo_publisher_lib::health::commands::{BuildOptions, BuildResult};
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

fn git_or_skip() -> bool {
    if git_binary().is_some() {
        return true;
    }
    if std::env::var("HUGO_PUBLISHER_REQUIRE_GIT").as_deref() == Ok("1") {
        panic!("git is required for this test run");
    }
    eprintln!("skipping: git not found");
    false
}

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new(git_binary().unwrap())
        .arg("-C")
        .arg(dir)
        .args(["-c", "core.quotepath=off", "-c", "core.autocrlf=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn init_repo(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.name", "Test"]);
    git(dir, &["config", "user.email", "test@example.org"]);
    git(dir, &["config", "core.autocrlf", "false"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

/// A tiny 2×2 PNG, so the home page processes an image like real themes do.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00, 0x00, 0xfd, 0xd4, 0x9a,
    0x73, 0x00, 0x00, 0x00, 0x10, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x44, 0x0c, 0x10, 0x0a, 0x00, 0x1f, 0xee, 0x03, 0xfd, 0x63, 0x5e, 0xbb, 0x5b, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

/// A site with its own layouts: a home page that resizes an image, sections and single pages.
fn make_site(root: &Path) {
    write(
        root,
        "hugo.toml",
        "baseURL = \"https://example.org/\"\ntitle = \"Deneme\"\ndisableKinds = [\"taxonomy\", \"term\", \"RSS\", \"sitemap\"]\n",
    );
    write(
        root,
        "layouts/home.html",
        "<!doctype html><title>{{ site.Title }}</title>{{ with resources.Get \"dot.png\" }}{{ with .Resize \"1x\" }}<img src=\"{{ .RelPermalink }}\">{{ end }}{{ end }}\n{{ range site.RegularPages }}<a href=\"{{ .RelPermalink }}\">{{ .Title }}</a>\n{{ end }}",
    );
    write(
        root,
        "layouts/single.html",
        "<!doctype html><title>{{ .Title }}</title><main id=\"main\">{{ .Content }}</main>\n",
    );
    write(
        root,
        "layouts/list.html",
        "<!doctype html><title>{{ .Title }}</title>\n",
    );
    fs::create_dir_all(root.join("assets")).unwrap();
    fs::write(root.join("assets/dot.png"), PNG).unwrap();
    write(root, "content/_index.md", "---\ntitle: Ana\n---\n");
    write(
        root,
        "content/posts/a.md",
        "---\ntitle: A\n---\nEski metin.\n",
    );
    write(
        root,
        "content/posts/taslak.md",
        "---\ntitle: Taslak\ndraft: true\n---\nHenüz değil.\n",
    );
}

fn paths(result: &BuildResult) -> Vec<&str> {
    result.files.iter().map(|f| f.path.as_str()).collect()
}

fn hash_of<'a>(result: &'a BuildResult, path: &str) -> &'a str {
    &result
        .files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} missing in {:?}", paths(result)))
        .hash
}

fn json(value: &impl serde::Serialize) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn builds_into_a_temporary_folder_without_touching_the_site() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let site = dir.path();
    make_site(site);

    let result = build(&hugo.path, site, &BuildOptions::default())
        .await
        .unwrap();
    assert!(result.ok, "{:?}", json(&result.messages));
    let out = Path::new(&result.output_dir);
    assert!(out.starts_with(std::env::temp_dir()));
    assert!(
        out.parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(WORK_DIR_PREFIX)
    );
    let list = paths(&result);
    assert!(list.contains(&"index.html"), "{list:?}");
    assert!(list.contains(&"posts/a/index.html"), "{list:?}");
    assert!(!list.iter().any(|p| p.contains("taslak")), "{list:?}");
    assert!(list.iter().any(|p| p.ends_with(".png")), "{list:?}");
    assert!(result.files.iter().all(|f| f.hash.len() == 64));
    let file = result
        .files
        .iter()
        .find(|f| f.path == "posts/a/index.html")
        .unwrap();
    assert_eq!(
        file.size,
        fs::metadata(out.join("posts/a/index.html")).unwrap().len()
    );

    // The site folder is left alone: no public/, resources/ or build lock.
    for name in ["public", "resources", ".hugo_build.lock", "hugo_stats.json"] {
        assert!(
            !site.join(name).exists(),
            "{name} was written into the site"
        );
    }

    // Reading files from the build.
    let page = read_file(&result.output_dir, "posts/a/index.html").unwrap();
    assert!(page.contains("Eski metin."));
    assert!(
        read_file(&result.output_dir, "/posts/a/index.html")
            .unwrap()
            .contains("<title>A</title>")
    );
    for bad in [
        "../hugo.toml",
        "posts/../../x",
        "C:/Windows/win.ini",
        "/etc/passwd/../../x",
        "",
        "posts",
    ] {
        assert!(read_file(&result.output_dir, bad).is_err(), "{bad}");
    }
    // A folder that is not ours (the site itself) is refused.
    assert!(read_file(&site.to_string_lossy(), "hugo.toml").is_err());
    assert!(discard(&site.to_string_lossy()).is_err());
    assert!(site.join("hugo.toml").exists());

    discard(&result.output_dir).unwrap();
    assert!(!out.parent().unwrap().exists());
    assert!(!is_registered(&result.output_dir));
    assert!(read_file(&result.output_dir, "index.html").is_err());
    assert!(discard(&result.output_dir).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn drafts_future_and_environment_options() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let site = dir.path();
    make_site(site);
    write(
        site,
        "content/posts/sonra.md",
        "---\ntitle: Sonra\ndate: 2999-01-01\n---\nGelecek.\n",
    );
    write(site, "config/staging/hugo.toml", "title = \"Sahne\"\n");

    let options = BuildOptions {
        drafts: true,
        future: true,
        environment: Some("staging".into()),
        revision: None,
    };
    let result = build(&hugo.path, site, &options).await.unwrap();
    assert!(result.ok, "{:?}", json(&result.messages));
    let list = paths(&result);
    assert!(list.contains(&"posts/taslak/index.html"), "{list:?}");
    assert!(list.contains(&"posts/sonra/index.html"), "{list:?}");
    assert!(
        read_file(&result.output_dir, "index.html")
            .unwrap()
            .contains("<title>Sahne</title>")
    );
    discard(&result.output_dir).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_build_reports_hugo_messages() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let site = dir.path();
    make_site(site);
    write(site, "layouts/single.html", "{{ .Title \n");

    let result = build(&hugo.path, site, &BuildOptions::default())
        .await
        .unwrap();
    assert!(!result.ok);
    let messages = json(&result.messages);
    assert!(
        messages
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["level"] == "error"),
        "{messages}"
    );
    assert!(is_registered(&result.output_dir));
    discard(&result.output_dir).unwrap();
}

fn worktrees(repo: &Path) -> usize {
    git(repo, &["worktree", "list", "--porcelain"])
        .lines()
        .filter(|l| l.starts_with("worktree "))
        .count()
}

#[tokio::test(flavor = "multi_thread")]
async fn builds_a_revision_from_a_temporary_worktree() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    // The site lives in a subfolder of the repository, as some do.
    let repo = dir.path().join("repo");
    init_repo(&repo);
    let site = repo.join("site");
    make_site(&site);
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-q", "-m", "ilk"]);

    // Working tree changes: an edited post and a new one.
    write(
        &site,
        "content/posts/a.md",
        "---\ntitle: A\n---\nYeni metin.\n",
    );
    write(&site, "content/posts/b.md", "---\ntitle: B\n---\nİkinci.\n");

    let head = build(
        &hugo.path,
        &site,
        &BuildOptions {
            revision: Some("HEAD".into()),
            ..BuildOptions::default()
        },
    )
    .await
    .unwrap();
    assert!(head.ok, "{:?}", json(&head.messages));
    let now = build(&hugo.path, &site, &BuildOptions::default())
        .await
        .unwrap();
    assert!(now.ok, "{:?}", json(&now.messages));

    assert!(
        read_file(&head.output_dir, "posts/a/index.html")
            .unwrap()
            .contains("Eski metin.")
    );
    assert!(
        read_file(&now.output_dir, "posts/a/index.html")
            .unwrap()
            .contains("Yeni metin.")
    );
    assert_ne!(
        hash_of(&head, "posts/a/index.html"),
        hash_of(&now, "posts/a/index.html")
    );
    assert!(!paths(&head).contains(&"posts/b/index.html"));
    assert!(paths(&now).contains(&"posts/b/index.html"));
    // Same image, same output.
    let png = paths(&now)
        .into_iter()
        .find(|p| p.ends_with(".png"))
        .unwrap()
        .to_string();
    assert_eq!(hash_of(&head, &png), hash_of(&now, &png));

    // The temporary worktree is gone, and the working tree is untouched.
    assert_eq!(worktrees(&repo), 1);
    assert!(
        fs::read_to_string(site.join("content/posts/a.md"))
            .unwrap()
            .contains("Yeni metin.")
    );
    let status = git(&repo, &["status", "--porcelain"]);
    assert!(
        status
            .lines()
            .all(|l| l.contains("content/posts/a.md") || l.contains("content/posts/b.md")),
        "{status}"
    );

    // Unknown or option-like revisions fail cleanly and leave nothing behind.
    for bad in ["does-not-exist", "--output=x"] {
        let error = build(
            &hugo.path,
            &site,
            &BuildOptions {
                revision: Some(bad.into()),
                ..BuildOptions::default()
            },
        )
        .await;
        assert!(error.is_err(), "{bad}");
    }
    assert_eq!(worktrees(&repo), 1);

    discard(&head.output_dir).unwrap();
    discard(&now.output_dir).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn revision_builds_bring_submodule_themes() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let theme = dir.path().join("theme");
    init_repo(&theme);
    write(
        &theme,
        "layouts/home.html",
        "<!doctype html><title>{{ site.Title }}</title><p>tema-isareti</p>\n",
    );
    write(&theme, "layouts/single.html", "{{ .Content }}\n");
    write(&theme, "layouts/list.html", "list\n");
    git(&theme, &["add", "-A"]);
    git(&theme, &["commit", "-q", "-m", "tema"]);

    let site = dir.path().join("site");
    init_repo(&site);
    write(
        &site,
        "hugo.toml",
        "baseURL = \"https://example.org/\"\ntitle = \"Alt modül\"\ntheme = \"t\"\ndisableKinds = [\"taxonomy\", \"term\", \"RSS\", \"sitemap\"]\n",
    );
    write(&site, "content/_index.md", "---\ntitle: Ana\n---\n");
    git(
        &site,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            &theme.to_string_lossy(),
            "themes/t",
        ],
    );
    git(&site, &["add", "-A"]);
    git(&site, &["commit", "-q", "-m", "site"]);

    let head = build(
        &hugo.path,
        &site,
        &BuildOptions {
            revision: Some("HEAD".into()),
            ..BuildOptions::default()
        },
    )
    .await
    .unwrap();
    assert!(head.ok, "{:?}", json(&head.messages));
    // Either git checked the submodule out, or (file:// clones are refused by default since
    // git 2.38) it was copied from the working tree with a note saying so.
    eprintln!("messages: {}", json(&head.messages));
    assert!(
        read_file(&head.output_dir, "index.html")
            .unwrap()
            .contains("tema-isareti")
    );
    assert_eq!(worktrees(&site), 1);
    discard(&head.output_dir).unwrap();
}

/// Builds a real site twice (HEAD and the working tree) and checks that its folder is left as it
/// was. Run by hand: `HUGO_PUBLISHER_HEALTH_SITE=<a clone of a site> cargo test --test
/// health_build -- --ignored --nocapture`. Point it at a clone, never at a site you work on.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn builds_a_real_site_from_the_environment() {
    let Ok(site) = std::env::var("HUGO_PUBLISHER_HEALTH_SITE") else {
        eprintln!("skipping: HUGO_PUBLISHER_HEALTH_SITE is not set");
        return;
    };
    let site = Path::new(&site);
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let status_before = git(site, &["status", "--porcelain", "--ignored"]);
    let head = build(
        &hugo.path,
        site,
        &BuildOptions {
            revision: Some("HEAD".into()),
            ..BuildOptions::default()
        },
    )
    .await
    .unwrap();
    let now = build(&hugo.path, site, &BuildOptions::default())
        .await
        .unwrap();
    eprintln!(
        "HEAD: ok={} files={} {} ms; working tree: ok={} files={} {} ms",
        head.ok,
        head.files.len(),
        head.duration_ms,
        now.ok,
        now.files.len(),
        now.duration_ms
    );
    let changed: Vec<&str> = now
        .files
        .iter()
        .filter(|f| {
            head.files
                .iter()
                .find(|h| h.path == f.path)
                .is_none_or(|h| h.hash != f.hash)
        })
        .map(|f| f.path.as_str())
        .collect();
    eprintln!("changed or added: {changed:?}");
    eprintln!("messages: {}", json(&now.messages));
    assert!(head.ok && now.ok);
    assert_eq!(worktrees(site), 1);
    assert_eq!(
        git(site, &["status", "--porcelain", "--ignored"]),
        status_before
    );
    discard(&head.output_dir).unwrap();
    discard(&now.output_dir).unwrap();
}
