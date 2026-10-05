//! The gh-pages method, commit files and share-link branches against temporary repositories and
//! a local bare "remote". Skipped without git or Hugo, unless `HUGO_PUBLISHER_REQUIRE_GIT=1` /
//! `HUGO_PUBLISHER_REQUIRE_HUGO=1` is set. Nothing talks to the network.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use hugo_publisher_lib::error::AppError;
use hugo_publisher_lib::git::deploy::gh_pages::{self, Stage};
use hugo_publisher_lib::git::deploy::{commit_files, delete_preview, list_previews, push_preview};
use hugo_publisher_lib::git::errors::git_error_code;
use hugo_publisher_lib::git::runner::git_binary;
use hugo_publisher_lib::hugo::detect::detect;

fn require(var: &str, what: &str) -> bool {
    if std::env::var(var).as_deref() == Ok("1") {
        panic!("{what} is required for this test run");
    }
    eprintln!("skipping: {what} not found");
    false
}

fn git_or_skip() -> bool {
    git_binary().is_some() || require("HUGO_PUBLISHER_REQUIRE_GIT", "git")
}

async fn tools_or_skip() -> Option<PathBuf> {
    if !git_or_skip() {
        return None;
    }
    match detect(None).await {
        Ok(info) => Some(info.path),
        Err(_) => {
            require("HUGO_PUBLISHER_REQUIRE_HUGO", "Hugo");
            None
        }
    }
}

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new(git_binary().unwrap())
        .arg("-C")
        .arg(dir)
        .args(["-c", "core.quotepath=off"])
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

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn configure(dir: &Path) {
    git(dir, &["config", "user.name", "Yazar"]);
    git(
        dir,
        &["config", "user.email", "yazar@users.noreply.github.com"],
    );
    git(dir, &["config", "commit.gpgsign", "false"]);
}

struct Setup {
    _dir: tempfile::TempDir,
    site: PathBuf,
    bare: PathBuf,
    base: PathBuf,
}

/// A small Hugo site in a repository whose `origin` is a local bare repository.
fn site_with_remote() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().to_path_buf();
    let bare = base.join("remote.git");
    let site = base.join("site");
    git(&base, &["init", "-q", "--bare", "-b", "main", "remote.git"]);
    fs::create_dir_all(&site).unwrap();
    git(&site, &["init", "-q", "-b", "main"]);
    configure(&site);
    // A machine-wide autocrlf must not change the published bytes.
    git(&site, &["config", "core.autocrlf", "true"]);
    git(&site, &["remote", "add", "origin", bare.to_str().unwrap()]);
    write(
        &site,
        "hugo.toml",
        "baseURL = 'https://example.org/'\ntitle = 'Deneme'\ndisableKinds = ['taxonomy', 'term', 'RSS', 'sitemap']\n",
    );
    write(
        &site,
        "layouts/home.html",
        "<html><head><title>{{ site.Title }}</title></head><body>{{ range site.RegularPages }}<a href=\"{{ .RelPermalink }}\">{{ .Title }}</a>{{ end }}</body></html>\n",
    );
    write(
        &site,
        "layouts/page.html",
        "<html><head><title>{{ .Title }}</title></head><body>{{ .Content }}</body></html>\n",
    );
    write(
        &site,
        "layouts/section.html",
        "<html><body>{{ .Title }}</body></html>\n",
    );
    write(
        &site,
        "content/posts/ilk.md",
        "---\ntitle: İlk yazı\n---\nMerhaba.\n",
    );
    write(
        &site,
        "content/posts/taslak.md",
        "---\ntitle: Taslak\ndraft: true\n---\nGizli.\n",
    );
    write(&site, ".gitignore", "public/\nresources/\n");
    git(&site, &["add", "-A"]);
    git(&site, &["commit", "-q", "-m", "ilk"]);
    git(&site, &["push", "-q", "-u", "origin", "main"]);
    let site = hugo_publisher_lib::site::open(&site).unwrap().root;
    Setup {
        _dir: dir,
        site,
        bare,
        base,
    }
}

fn worktrees(site: &Path) -> usize {
    git(site, &["worktree", "list", "--porcelain"])
        .lines()
        .filter(|l| l.starts_with("worktree "))
        .count()
}

#[tokio::test(flavor = "multi_thread")]
async fn publishes_the_built_site_to_a_new_orphan_branch_and_updates_it() {
    let Some(hugo) = tools_or_skip().await else {
        return;
    };
    let setup = site_with_remote();
    let stages = Arc::new(Mutex::new(Vec::new()));
    let sink = stages.clone();
    let result = gh_pages::publish(
        &hugo,
        &setup.site,
        "gh-pages",
        "Yayın: 2026-10-04 12:00",
        move |p| sink.lock().unwrap().push(p.stage),
    )
    .await
    .unwrap();
    assert!(result.pushed && !result.up_to_date, "{result:?}");
    assert!(result.commit.is_some());
    assert!(result.files >= 2);
    let stages = stages.lock().unwrap().clone();
    assert_eq!(stages.first(), Some(&Stage::Build));
    assert_eq!(stages.last(), Some(&Stage::Done));

    // The remote branch holds only the built site: no sources, no drafts, no shared history.
    let tree = git(&setup.bare, &["ls-tree", "-r", "--name-only", "gh-pages"]);
    assert!(tree.lines().any(|l| l == "index.html"), "{tree}");
    assert!(tree.lines().any(|l| l.starts_with("posts/ilk/")), "{tree}");
    assert!(!tree.contains("taslak"), "{tree}");
    assert!(!tree.contains("hugo.toml"), "{tree}");
    assert_eq!(
        git(&setup.bare, &["rev-list", "--count", "gh-pages"]).trim(),
        "1"
    );
    assert_eq!(
        git(&setup.bare, &["log", "-1", "--format=%s", "gh-pages"]).trim(),
        "Yayın: 2026-10-04 12:00"
    );
    // Byte-exact output despite core.autocrlf=true.
    let built = git(&setup.bare, &["show", "gh-pages:index.html"]);
    assert!(!built.contains('\r'));
    // The site's own branch and files are untouched; the worktree is gone.
    assert_eq!(
        git(&setup.site, &["branch", "--show-current"]).trim(),
        "main"
    );
    assert!(
        git(&setup.site, &["status", "--porcelain"])
            .trim()
            .is_empty()
    );
    assert_eq!(worktrees(&setup.site), 1);

    // Same site again: nothing to publish.
    let again = gh_pages::publish(&hugo, &setup.site, "gh-pages", "Yayın 2", |_| {})
        .await
        .unwrap();
    assert!(
        again.up_to_date && !again.pushed && again.commit.is_none(),
        "{again:?}"
    );

    // A new post: one more commit on top, fast-forward.
    write(
        &setup.site,
        "content/posts/ikinci.md",
        "---\ntitle: İkinci\n---\nYeni.\n",
    );
    let third = gh_pages::publish(&hugo, &setup.site, "gh-pages", "Yayın 3", |_| {})
        .await
        .unwrap();
    assert!(third.pushed);
    assert_eq!(
        git(&setup.bare, &["rev-list", "--count", "gh-pages"]).trim(),
        "2"
    );
    assert_eq!(worktrees(&setup.site), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_fresh_clone_continues_the_remote_branch() {
    let Some(hugo) = tools_or_skip().await else {
        return;
    };
    let setup = site_with_remote();
    gh_pages::publish(&hugo, &setup.site, "gh-pages", "ilk yayın", |_| {})
        .await
        .unwrap();

    // Another computer: no local gh-pages branch, only the remote one.
    let clone = setup.base.join("clone");
    git(
        &setup.base,
        &[
            "clone",
            "-q",
            setup.bare.to_str().unwrap(),
            clone.to_str().unwrap(),
        ],
    );
    configure(&clone);
    write(
        &clone,
        "content/posts/üçüncü.md",
        "---\ntitle: Üçüncü\n---\nBaşka bilgisayar.\n",
    );
    let result = gh_pages::publish(&hugo, &clone, "gh-pages", "ikinci yayın", |_| {})
        .await
        .unwrap();
    assert!(result.pushed);
    assert_eq!(
        git(&setup.bare, &["rev-list", "--count", "gh-pages"]).trim(),
        "2"
    );

    // Back on the first computer: its local branch is behind and fast-forwards.
    write(
        &setup.site,
        "content/posts/dördüncü.md",
        "---\ntitle: Dört\n---\nx\n",
    );
    let result = gh_pages::publish(&hugo, &setup.site, "gh-pages", "üçüncü yayın", |_| {})
        .await
        .unwrap();
    assert!(result.pushed, "{result:?}");
    assert_eq!(
        git(&setup.bare, &["rev-list", "--count", "gh-pages"]).trim(),
        "3"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn failures_clean_up_and_are_explained() {
    let Some(hugo) = tools_or_skip().await else {
        return;
    };
    let setup = site_with_remote();
    // Pushing to a remote that disappeared fails after the worktree was made.
    fs::rename(&setup.bare, setup.base.join("moved.git")).unwrap();
    let error = gh_pages::publish(&hugo, &setup.site, "gh-pages", "x", |_| {})
        .await
        .unwrap_err();
    assert!(git_error_code(&error).is_some(), "{error:?}");
    assert_eq!(worktrees(&setup.site), 1);

    git(&setup.site, &["remote", "remove", "origin"]);
    let error = gh_pages::publish(&hugo, &setup.site, "gh-pages", "x", |_| {})
        .await
        .unwrap_err();
    assert_eq!(git_error_code(&error), Some("git_no_remote"));

    for bad in ["", "-x", "a..b", "main"] {
        let result = gh_pages::publish(&hugo, &setup.site, bad, "x", |_| {}).await;
        assert!(result.is_err(), "{bad}");
    }
    let empty = gh_pages::publish(&hugo, &setup.site, "gh-pages", "  ", |_| {}).await;
    assert_eq!(
        git_error_code(&empty.unwrap_err()),
        Some("git_empty_message")
    );

    // A site Hugo cannot build.
    git(
        &setup.site,
        &[
            "remote",
            "add",
            "origin",
            setup.base.join("moved.git").to_str().unwrap(),
        ],
    );
    write(&setup.site, "layouts/page.html", "{{ .Broken");
    let error = gh_pages::publish(&hugo, &setup.site, "gh-pages", "x", |_| {})
        .await
        .unwrap_err();
    assert!(matches!(error, AppError::Hugo(_)), "{error:?}");
    assert_eq!(worktrees(&setup.site), 1);
}

#[tokio::test]
async fn lists_the_files_a_commit_changed() {
    if !git_or_skip() {
        return;
    }
    let setup = site_with_remote();
    let first = commit_files(&setup.site, None).await.unwrap();
    assert_eq!(first.sha.len(), 40);
    assert!(first.files.contains(&"content/posts/ilk.md".to_string()));
    write(
        &setup.site,
        "content/posts/ilk.md",
        "---\ntitle: İlk yazı\n---\nDeğişti.\n",
    );
    write(
        &setup.site,
        "content/posts/yeni yazı.md",
        "---\ntitle: Yeni\n---\n",
    );
    git(&setup.site, &["add", "-A"]);
    git(&setup.site, &["commit", "-q", "-m", "iki"]);
    let second = commit_files(&setup.site, Some("HEAD")).await.unwrap();
    assert_eq!(
        second.files,
        vec![
            "content/posts/ilk.md".to_string(),
            "content/posts/yeni yazı.md".to_string()
        ]
    );
    assert_eq!(
        commit_files(&setup.site, Some("HEAD~1")).await.unwrap().sha,
        first.sha
    );
    assert!(commit_files(&setup.site, Some("--all")).await.is_err());
}

#[tokio::test]
async fn share_links_push_and_delete_preview_branches() {
    if !git_or_skip() {
        return;
    }
    let setup = site_with_remote();
    assert!(list_previews(&setup.site).await.unwrap().is_empty());
    push_preview(&setup.site, "preview/ilk-yazi").await.unwrap();
    assert_eq!(
        list_previews(&setup.site).await.unwrap(),
        vec!["preview/ilk-yazi".to_string()]
    );
    assert_eq!(
        git(&setup.bare, &["rev-parse", "preview/ilk-yazi"]),
        git(&setup.site, &["rev-parse", "HEAD"])
    );
    // Pushing again after a new commit fast-forwards it.
    write(
        &setup.site,
        "content/posts/ilk.md",
        "---\ntitle: İlk\n---\nx\n",
    );
    git(&setup.site, &["commit", "-q", "-am", "iki"]);
    push_preview(&setup.site, "preview/ilk-yazi").await.unwrap();
    // A branch that moved elsewhere is not overwritten.
    git(&setup.site, &["reset", "-q", "--hard", "HEAD~1"]);
    write(
        &setup.site,
        "content/posts/ilk.md",
        "---\ntitle: Başka\n---\ny\n",
    );
    git(&setup.site, &["commit", "-q", "-am", "başka"]);
    let error = push_preview(&setup.site, "preview/ilk-yazi")
        .await
        .unwrap_err();
    assert_eq!(git_error_code(&error), Some("git_rejected"), "{error:?}");

    delete_preview(&setup.site, "preview/ilk-yazi")
        .await
        .unwrap();
    assert!(list_previews(&setup.site).await.unwrap().is_empty());
    for bad in ["main", "preview/", "preview/a..b", "gh-pages"] {
        assert!(push_preview(&setup.site, bad).await.is_err(), "{bad}");
        assert!(delete_preview(&setup.site, bad).await.is_err(), "{bad}");
    }
}
