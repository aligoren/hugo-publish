//! Runs the real `git` binary against temporary repositories (and a local bare "remote").
//! Skipped when git is not installed, unless `HUGO_PUBLISHER_REQUIRE_GIT=1` is set.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use hugo_publisher_lib::error::AppError;
use hugo_publisher_lib::git::errors::git_error_code;
use hugo_publisher_lib::git::ops;
use hugo_publisher_lib::git::runner::git_binary;
use hugo_publisher_lib::git::status::{GitFile, GitFileKind};

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

/// Runs git for test setup and returns stdout; panics on failure.
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

fn read(root: &Path, relative: &str) -> String {
    fs::read_to_string(root.join(relative)).unwrap()
}

/// A repository with a local identity and no line-ending conversion, so results do not depend on
/// the machine's global git config.
fn init_repo(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    configure(dir);
}

fn configure(dir: &Path) {
    git(dir, &["config", "user.name", "Yazar Adı"]);
    git(
        dir,
        &["config", "user.email", "yazar@users.noreply.github.com"],
    );
    git(dir, &["config", "core.autocrlf", "false"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

fn commit_all(dir: &Path, message: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", message]);
}

fn code(error: &AppError) -> &str {
    git_error_code(error).unwrap_or_else(|| panic!("not a git error: {error}"))
}

fn find<'a>(files: &'a [GitFile], path: &str) -> &'a GitFile {
    files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not in {files:#?}"))
}

#[tokio::test]
async fn a_folder_outside_any_repository_is_not_an_error() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let status = ops::status(dir.path()).await.unwrap();
    assert!(!status.is_repo);
    assert!(status.files.is_empty());
    let error = ops::diff(dir.path(), "a.md").await.unwrap_err();
    assert_eq!(code(&error), "git_not_repo");
}

#[tokio::test]
async fn status_reports_every_kind_with_turkish_names() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    init_repo(root);
    write(root, "içerik/ğüşıöç.md", "bir\n");
    write(root, "silinecek.md", "x\n");
    write(root, "eski ad.md", "taşınacak\n");
    write(root, "hugo.toml", "title = 'x'\n");
    commit_all(root, "ilk");

    write(root, "içerik/ğüşıöç.md", "bir\niki\n");
    fs::remove_file(root.join("silinecek.md")).unwrap();
    git(root, &["mv", "eski ad.md", "yeni ad.md"]);
    write(root, "içerik/yeni yazı.md", "yeni\n");
    write(root, "static/görsel.png", "png");
    write(root, "eklendi.md", "eklendi\n");
    git(root, &["add", "eklendi.md"]);

    let status = ops::status(root).await.unwrap();
    assert!(status.is_repo);
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.upstream, None);
    assert_eq!((status.ahead, status.behind), (0, 0));
    assert_eq!(status.user_name.as_deref(), Some("Yazar Adı"));
    assert_eq!(
        status.user_email.as_deref(),
        Some("yazar@users.noreply.github.com")
    );
    assert_eq!(status.remote_url, None);

    let files = &status.files;
    assert_eq!(files.len(), 6, "{files:#?}");
    assert_eq!(find(files, "içerik/ğüşıöç.md").kind, GitFileKind::Modified);
    assert_eq!(find(files, "silinecek.md").kind, GitFileKind::Deleted);
    let renamed = find(files, "yeni ad.md");
    assert_eq!(renamed.kind, GitFileKind::Renamed);
    assert_eq!(renamed.orig_path.as_deref(), Some("eski ad.md"));
    assert_eq!(
        find(files, "içerik/yeni yazı.md").kind,
        GitFileKind::Untracked
    );
    assert_eq!(
        find(files, "static/görsel.png").kind,
        GitFileKind::Untracked
    );
    assert_eq!(find(files, "eklendi.md").kind, GitFileKind::Added);
}

#[tokio::test]
async fn status_is_limited_to_the_site_folder() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    init_repo(dir.path());
    write(dir.path(), "README.md", "repo\n");
    write(dir.path(), "site/hugo.toml", "title = 'x'\n");
    commit_all(dir.path(), "ilk");
    write(dir.path(), "README.md", "changed\n");
    write(dir.path(), "site/content/a.md", "a\n");

    let site = dir.path().join("site");
    let status = ops::status(&site).await.unwrap();
    let paths: Vec<&str> = status.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec!["content/a.md"]);

    // Paths stay site-relative for diff and commit too, and nothing outside is committed.
    let diff = ops::diff(&site, "content/a.md").await.unwrap();
    assert!(diff.contains("+a"), "{diff}");
    ops::commit(&site, "Site", &[]).await.unwrap();
    assert!(ops::status(&site).await.unwrap().files.is_empty());
    assert_eq!(
        git(dir.path(), &["status", "--porcelain"]).trim(),
        "M README.md"
    );
}

#[tokio::test]
async fn diffs_modified_untracked_renamed_and_deleted_files() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    init_repo(root);
    write(root, "içerik/ğüşıöç.md", "bir\niki\nüç\n");
    write(root, "eski.md", "aynı kalacak satır\nbir satır daha\n");
    write(root, "gidecek.md", "elveda\n");
    commit_all(root, "ilk");

    write(root, "içerik/ğüşıöç.md", "bir\nİKİ\nüç\n");
    write(root, "içerik/yeni yazı.md", "satır 1\r\nsatır 2\r\n");
    git(root, &["mv", "eski.md", "yeni.md"]);
    fs::remove_file(root.join("gidecek.md")).unwrap();

    let modified = ops::diff(root, "içerik/ğüşıöç.md").await.unwrap();
    assert!(
        modified.contains("--- a/içerik/ğüşıöç.md\n+++ b/içerik/ğüşıöç.md\n"),
        "{modified}"
    );
    assert!(modified.contains("\n-iki\n+İKİ\n"), "{modified}");

    let untracked = ops::diff(root, "içerik/yeni yazı.md").await.unwrap();
    assert!(untracked.contains("new file mode"), "{untracked}");
    assert!(untracked.contains("--- /dev/null"), "{untracked}");
    assert!(
        untracked.contains("+++ b/içerik/yeni yazı.md"),
        "{untracked}"
    );
    assert!(
        untracked.contains("@@ -0,0 +1,2 @@\n+satır 1\r\n+satır 2\r\n"),
        "{untracked}"
    );

    let renamed = ops::diff(root, "yeni.md").await.unwrap();
    assert!(renamed.contains("rename from eski.md"), "{renamed}");
    assert!(renamed.contains("rename to yeni.md"), "{renamed}");

    let deleted = ops::diff(root, "gidecek.md").await.unwrap();
    assert!(deleted.contains("deleted file mode"), "{deleted}");
    assert!(deleted.contains("-elveda"), "{deleted}");

    // Backslashes are accepted; paths leaving the site are not.
    let same = ops::diff(root, r"içerik\ğüşıöç.md").await.unwrap();
    assert_eq!(same, modified);
    assert!(matches!(
        ops::diff(root, "../x.md").await,
        Err(AppError::PathOutsideSite(_))
    ));
    // A file without changes has an empty diff.
    git(root, &["checkout", "--", "içerik/ğüşıöç.md"]);
    assert_eq!(ops::diff(root, "içerik/ğüşıöç.md").await.unwrap(), "");
}

#[tokio::test]
async fn diffs_in_a_repository_without_commits() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    init_repo(root);
    write(root, "staged.md", "hazır\n");
    write(root, "untracked.md", "yeni\n");
    git(root, &["add", "staged.md"]);

    let staged = ops::diff(root, "staged.md").await.unwrap();
    assert!(staged.contains("new file mode"), "{staged}");
    assert!(staged.contains("+hazır"), "{staged}");
    let untracked = ops::diff(root, "untracked.md").await.unwrap();
    assert!(untracked.contains("+yeni"), "{untracked}");

    let status = ops::status(root).await.unwrap();
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.files.len(), 2);
}

#[tokio::test]
async fn commits_only_the_chosen_paths_with_a_multi_line_message() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    init_repo(root);
    write(root, "content/a.md", "a\n");
    write(root, "content/eski.md", "e\n");
    write(root, "content/silinecek.md", "s\n");
    write(root, "hugo.toml", "title = 'x'\n");
    commit_all(root, "ilk");

    write(root, "content/a.md", "a2\n");
    write(root, "content/ğüşıöç [taslak].md", "yeni\n");
    git(root, &["mv", "content/eski.md", "content/yeni.md"]);
    fs::remove_file(root.join("content/silinecek.md")).unwrap();
    write(root, "hugo.toml", "title = 'y'\n");
    // Staged earlier by someone else; must stay out of this commit.
    write(root, "layouts/x.html", "x");
    git(root, &["add", "layouts/x.html"]);

    let message = "Yazı eklendi: \"Merhaba\" & 'dünya'\n\n- $HOME %PATH% `ls` \\n\n- ikinci satır";
    let paths: Vec<String> = [
        "content/a.md",
        "content/ğüşıöç [taslak].md",
        "content/yeni.md",
        "content/eski.md",
        "content/silinecek.md",
    ]
    .map(String::from)
    .to_vec();
    let hash = ops::commit(root, message, &paths).await.unwrap();

    assert_eq!(hash, git(root, &["rev-parse", "--short", "HEAD"]).trim());
    assert_eq!(git(root, &["log", "-1", "--format=%B"]).trim_end(), message);
    let committed = git(root, &["show", "--name-status", "--format=", "-M", "HEAD"]);
    let mut lines: Vec<&str> = committed.lines().filter(|l| !l.is_empty()).collect();
    lines.sort();
    assert_eq!(
        lines,
        vec![
            "A\tcontent/ğüşıöç [taslak].md",
            "D\tcontent/silinecek.md",
            "M\tcontent/a.md",
            "R100\tcontent/eski.md\tcontent/yeni.md",
        ]
    );

    // What was not chosen is still waiting.
    let status = ops::status(root).await.unwrap();
    let mut left: Vec<(&str, &str)> = status
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.index.as_str()))
        .collect();
    left.sort();
    assert_eq!(left, vec![("hugo.toml", "."), ("layouts/x.html", "A")]);

    // Committing everything picks up the rest.
    ops::commit(root, "Kalanlar", &[]).await.unwrap();
    assert!(ops::status(root).await.unwrap().files.is_empty());
}

#[tokio::test]
async fn the_first_commit_works_too() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    init_repo(root);
    write(root, "hugo.toml", "title = 'x'\n");
    write(root, "content/a.md", "a\n");
    ops::commit(root, "İlk yayın", &["hugo.toml".into()])
        .await
        .unwrap();
    assert_eq!(
        git(root, &["ls-files"]).lines().collect::<Vec<_>>(),
        vec!["hugo.toml"]
    );
}

#[tokio::test]
async fn refuses_empty_messages_and_empty_commits() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    init_repo(root);
    write(root, "a.md", "a\n");
    commit_all(root, "ilk");

    let error = ops::commit(root, "  \n", &[]).await.unwrap_err();
    assert_eq!(code(&error), "git_empty_message");
    let error = ops::commit(root, "Boş", &[]).await.unwrap_err();
    assert_eq!(code(&error), "git_nothing_to_commit");
    let error = ops::commit(root, "Boş", &["a.md".into()])
        .await
        .unwrap_err();
    assert_eq!(code(&error), "git_nothing_to_commit");
    assert!(matches!(
        ops::commit(root, "x", &["../dışarı.md".into()]).await,
        Err(AppError::PathOutsideSite(_))
    ));
}

#[tokio::test]
async fn commit_without_identity_is_explained() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "-q", "-b", "main"]);
    git(root, &["config", "commit.gpgsign", "false"]);
    // Empty values override any global identity for this repository.
    git(root, &["config", "user.name", ""]);
    git(root, &["config", "user.email", ""]);
    git(root, &["config", "user.useConfigOnly", "true"]);
    write(root, "a.md", "a\n");
    let error = ops::commit(root, "x", &[]).await.unwrap_err();
    assert_eq!(code(&error), "git_no_identity", "{error}");
}

/// A bare "remote", a working copy `a` with `origin` set, and a clone `b` of it.
struct Remote {
    _dir: tempfile::TempDir,
    a: PathBuf,
    b: PathBuf,
}

async fn remote_with_two_clones() -> Remote {
    let dir = tempfile::tempdir().unwrap();
    let bare = dir.path().join("remote.git");
    let a = dir.path().join("a");
    let b = dir.path().join("b");
    git(
        dir.path(),
        &["init", "-q", "--bare", "-b", "main", "remote.git"],
    );
    init_repo(&a);
    git(&a, &["remote", "add", "origin", bare.to_str().unwrap()]);
    write(&a, "content/yazı.md", "bir\niki\nüç\n");
    commit_all(&a, "ilk");

    // No upstream yet: push sets it.
    let status = ops::status(&a).await.unwrap();
    assert_eq!(status.upstream, None);
    assert_eq!(status.remote_url.as_deref(), bare.to_str());
    ops::push(&a).await.unwrap();
    let status = ops::status(&a).await.unwrap();
    assert_eq!(status.upstream.as_deref(), Some("origin/main"));
    assert_eq!((status.ahead, status.behind), (0, 0));

    git(
        dir.path(),
        &[
            "clone",
            "-q",
            "-c",
            "core.autocrlf=false",
            bare.to_str().unwrap(),
            b.to_str().unwrap(),
        ],
    );
    configure(&b);
    Remote { _dir: dir, a, b }
}

#[tokio::test]
async fn pushes_and_pulls_through_a_bare_remote() {
    if !git_or_skip() {
        return;
    }
    let remote = remote_with_two_clones().await;
    let (a, b) = (&remote.a, &remote.b);

    // b publishes a post; a is behind after fetching and catches up by pulling.
    write(b, "content/ğüş.md", "b'den\n");
    commit_all(b, "b yazısı");
    git(b, &["push", "-q"]);
    ops::fetch(a).await.unwrap();
    let status = ops::status(a).await.unwrap();
    assert_eq!((status.ahead, status.behind), (0, 1));

    // An uncommitted local change survives the pull (autostash).
    write(a, "content/yazı.md", "bir\niki\nüç\ndört\n");
    let pulled = ops::pull(a).await.unwrap();
    assert!(!pulled.output.is_empty());
    assert_eq!(read(a, "content/ğüş.md"), "b'den\n");
    assert_eq!(read(a, "content/yazı.md"), "bir\niki\nüç\ndört\n");
    let status = ops::status(a).await.unwrap();
    assert_eq!((status.ahead, status.behind), (0, 0));

    // a commits and pushes; b sees it.
    ops::commit(a, "Yazı güncellendi: yazı", &[]).await.unwrap();
    assert_eq!(ops::status(a).await.unwrap().ahead, 1);
    let pushed = ops::push(a).await.unwrap();
    assert!(pushed.output.contains("main -> main"), "{}", pushed.output);
    assert_eq!(ops::status(a).await.unwrap().ahead, 0);
    git(b, &["pull", "-q", "--rebase"]);
    assert_eq!(read(b, "content/yazı.md"), "bir\niki\nüç\ndört\n");
}

#[tokio::test]
async fn a_push_behind_the_remote_is_rejected_and_never_forced() {
    if !git_or_skip() {
        return;
    }
    let remote = remote_with_two_clones().await;
    let (a, b) = (&remote.a, &remote.b);
    write(b, "content/b.md", "b\n");
    commit_all(b, "b");
    git(b, &["push", "-q"]);
    write(a, "content/a.md", "a\n");
    commit_all(a, "a");

    let error = ops::push(a).await.unwrap_err();
    assert_eq!(code(&error), "git_rejected", "{error}");
    // The remote still has b's commit.
    assert_eq!(
        git(b, &["ls-remote", "origin", "main"])
            .split_whitespace()
            .next(),
        Some(git(b, &["rev-parse", "HEAD"]).trim())
    );
}

#[tokio::test]
async fn a_conflicting_pull_is_reported_and_left_for_the_user() {
    if !git_or_skip() {
        return;
    }
    let remote = remote_with_two_clones().await;
    let (a, b) = (&remote.a, &remote.b);
    write(b, "content/yazı.md", "bir\nB'nin satırı\nüç\n");
    commit_all(b, "b");
    git(b, &["push", "-q"]);
    write(a, "content/yazı.md", "bir\nA'nın satırı\nüç\n");
    commit_all(a, "a");

    let error = ops::pull(a).await.unwrap_err();
    assert_eq!(code(&error), "git_conflict", "{error}");
    let status = ops::status(a).await.unwrap();
    assert_eq!(
        find(&status.files, "content/yazı.md").kind,
        GitFileKind::Conflicted
    );
    // Further writes are refused until the conflict is dealt with.
    let error = ops::commit(a, "x", &[]).await.unwrap_err();
    assert_eq!(code(&error), "git_conflict");
    let error = ops::pull(a).await.unwrap_err();
    assert_eq!(code(&error), "git_conflict");
    git(a, &["rebase", "--abort"]);
    assert_eq!(read(a, "content/yazı.md"), "bir\nA'nın satırı\nüç\n");
}

#[tokio::test]
async fn uncommitted_changes_that_clash_with_a_pull_are_reported() {
    if !git_or_skip() {
        return;
    }
    let remote = remote_with_two_clones().await;
    let (a, b) = (&remote.a, &remote.b);
    write(
        b,
        "content/yazı.md",
        "bir
B'nin satırı
üç
",
    );
    commit_all(b, "b");
    git(b, &["push", "-q"]);
    // Not committed: the pull itself works, putting this change back does not.
    write(
        a,
        "content/yazı.md",
        "bir
A'nın satırı
üç
",
    );

    let error = ops::pull(a).await.unwrap_err();
    assert_eq!(code(&error), "git_conflict", "{error}");
    assert!(error.to_string().contains("stash"), "{error}");
    let status = ops::status(a).await.unwrap();
    assert_eq!(status.behind, 0);
    assert_eq!(
        find(&status.files, "content/yazı.md").kind,
        GitFileKind::Conflicted
    );
}

#[tokio::test]
async fn pull_and_push_explain_missing_upstream_and_remote() {
    if !git_or_skip() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    init_repo(root);
    write(root, "a.md", "a\n");
    commit_all(root, "ilk");
    let error = ops::pull(root).await.unwrap_err();
    assert_eq!(code(&error), "git_no_upstream");
    let error = ops::push(root).await.unwrap_err();
    assert_eq!(code(&error), "git_no_remote");
}
