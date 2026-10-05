//! Theme components through `hugo config mounts` (vendored modules, local replacements, a custom
//! themesDir), the read-only module file access, content hashes, `hugo mod` helpers and git
//! submodule themes, against a real `hugo` and `git` in temporary folders. No network: modules
//! come from `_vendor/` or a `replacements` entry. Skipped when Hugo (or git) is not installed,
//! unless `HUGO_PUBLISHER_REQUIRE_HUGO=1`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use hugo_publisher_lib::error::AppError;
use hugo_publisher_lib::hugo::detect::{HugoInfo, detect};
use hugo_publisher_lib::hugo::filehash::hash_files;
use hugo_publisher_lib::hugo::modget::{
    GoModTexts, mod_get, mod_vendor, read_go_mod_texts, restore_go_mod_texts,
};
use hugo_publisher_lib::hugo::mounts::{
    allowed_dir, canonical, config_mounts, list_module_files, read_module_text,
};
use hugo_publisher_lib::hugo::submodule::{list_submodules, submodule_checkout, submodule_status};

fn required() -> bool {
    std::env::var("HUGO_PUBLISHER_REQUIRE_HUGO").as_deref() == Ok("1")
}

async fn hugo_or_skip() -> Option<HugoInfo> {
    match detect(None).await {
        Ok(info) => Some(info),
        Err(error) => {
            if required() {
                panic!("Hugo is required for this test run: {error}");
            }
            eprintln!("skipping: {error}");
            None
        }
    }
}

fn git_or_skip() -> bool {
    let found = Command::new("git")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success());
    if !found {
        if required() {
            panic!("git is required for this test run");
        }
        eprintln!("skipping: git not found");
    }
    found
}

fn write(root: &Path, relative: &str, text: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

/// A site with a vendored module, a module replaced by a local folder and a theme in a custom
/// themesDir. Returns (temp dir, site root, local module folder).
fn site_with_components() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let base = canonical(temp.path()).unwrap();
    let site = base.join("site");
    let local = base.join("local");
    write(
        &site,
        "hugo.toml",
        "baseURL = \"https://example.org/\"\ntitle = \"x\"\nthemesDir = \"mythemes\"\ntheme = [\"foo\"]\n\n[module]\nreplacements = \"example.org/local -> ../../local\"\n\n[[module.imports]]\npath = \"github.com/acme/vend\"\n\n[[module.imports]]\npath = \"example.org/local\"\n",
    );
    write(&site, "content/_index.md", "---\ntitle: Ana\n---\n");
    write(
        &site,
        "go.mod",
        "module example.org/site\n\ngo 1.20\n\nrequire github.com/acme/vend v1.2.0 // indirect\n",
    );
    write(
        &site,
        "_vendor/modules.txt",
        "# github.com/acme/vend v1.2.0\n",
    );
    write(
        &site,
        "_vendor/github.com/acme/vend/layouts/_shortcodes/note.html",
        "{{ .Get \"type\" }}\r\n",
    );
    write(
        &site,
        "_vendor/github.com/acme/vend/go.mod",
        "module github.com/acme/vend\n",
    );
    write(
        &site,
        "mythemes/foo/layouts/single.html",
        "<p>{{ .Title }}</p>\n",
    );
    write(&site, "mythemes/foo/theme.toml", "name = \"foo\"\n");
    write(&local, "go.mod", "module example.org/local\n");
    write(&local, "layouts/_partials/l.html", "local\n");
    write(&local, "i18n/en.yaml", "hello: Hello\n");
    fs::write(local.join("logo.png"), b"\x89PNG\r\n\x1a\n\0\0").unwrap();
    (temp, site, local)
}

#[tokio::test(flavor = "multi_thread")]
async fn lists_vendored_replaced_and_themes_dir_components() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let (_temp, site, local) = site_with_components();
    let modules = config_mounts(&hugo.path, &site, false).await.unwrap();
    // The project (the site itself) is left out; Hugo's order is kept.
    let summary: Vec<_> = modules
        .iter()
        .map(|m| {
            (
                m.path.as_str(),
                m.version.as_str(),
                m.site_dir.as_deref(),
                m.vendored,
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            (
                "github.com/acme/vend",
                "v1.2.0",
                Some("_vendor/github.com/acme/vend"),
                true
            ),
            ("../../local", "", None, false),
            ("foo", "", Some("mythemes/foo"), false),
        ]
    );
    assert_eq!(modules[1].module_path.as_deref(), Some("example.org/local"));
    assert_eq!(canonical(Path::new(&modules[1].dir)).unwrap(), local);
    assert!(modules.iter().all(|m| m.owner == "project"));
    assert!(
        modules[0]
            .mounts
            .iter()
            .any(|m| m.source == "layouts" && m.target == "layouts")
    );
    // `--noBuildLock`: nothing is left in the site.
    assert!(!site.join(".hugo_build.lock").exists());

    // Read-only access to module folders from the listing, and nothing else.
    let dir = allowed_dir(&modules, &modules[1].dir).unwrap();
    let files = list_module_files(&dir, ".", &[]).unwrap();
    let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            "go.mod",
            "i18n/en.yaml",
            "layouts/_partials/l.html",
            "logo.png"
        ]
    );
    let layouts = list_module_files(&dir, "layouts", &["html".to_string()]).unwrap();
    assert_eq!(layouts.len(), 1);
    assert_eq!(
        read_module_text(&dir, "i18n/en.yaml").unwrap().text,
        "hello: Hello\n"
    );
    assert!(matches!(
        read_module_text(&dir, "../site/hugo.toml"),
        Err(AppError::PathOutsideSite(_))
    ));
    assert!(allowed_dir(&modules, &site.to_string_lossy()).is_err());
    assert!(allowed_dir(&modules, &site.join("content").to_string_lossy()).is_err());

    // Content hashes: text normalised (the CRLF shortcode hashes like its LF form), binary exact.
    let hashes = hash_files(
        &dir,
        &[
            "layouts/_partials/l.html".into(),
            "logo.png".into(),
            "missing.html".into(),
        ],
    )
    .unwrap();
    assert_eq!(hashes.len(), 2);
    assert_eq!(hashes[1].size, 10);
    let vend = allowed_dir(&modules, &modules[0].dir).unwrap();
    write(&local, "note-lf.html", "{{ .Get \"type\" }}\n");
    let crlf = hash_files(&vend, &["layouts/_shortcodes/note.html".into()]).unwrap();
    let lf = hash_files(&dir, &["note-lf.html".into()]).unwrap();
    assert_eq!(crlf[0].sha256, lf[0].sha256);
    assert!(hash_files(&site, &["../local/go.mod".into()]).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn mod_helpers_keep_go_mod_safe() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let (_temp, site, _local) = site_with_components();
    let before = read_go_mod_texts(&site).unwrap();
    assert!(before.go_mod.is_some());
    assert_eq!(before.go_sum, None);

    // Bad arguments never reach Hugo.
    assert!(mod_get(&hugo.path, &site, "--help", "v1").await.is_err());
    assert!(
        mod_get(&hugo.path, &site, "github.com/acme/vend", "-x")
            .await
            .is_err()
    );
    // Without Go, `hugo mod get` fails without touching the network, and go.mod stays as it was.
    let go_missing = Command::new("go").arg("version").output().is_err();
    if go_missing {
        assert!(
            mod_get(&hugo.path, &site, "github.com/acme/vend", "v1.3.0")
                .await
                .is_err()
        );
        assert_eq!(read_go_mod_texts(&site).unwrap(), before);
        assert!(!site.join(".hugo_build.lock").exists());
    }

    // Undo: go.mod and go.sum are written back exactly (a missing go.sum is removed again).
    write(
        &site,
        "go.mod",
        "module example.org/site\n\ngo 1.20\n\nrequire github.com/acme/vend v1.3.0 // indirect\n",
    );
    write(&site, "go.sum", "github.com/acme/vend v1.3.0 h1:x\n");
    restore_go_mod_texts(&site, &before).unwrap();
    assert_eq!(read_go_mod_texts(&site).unwrap(), before);
    assert!(
        restore_go_mod_texts(
            &site,
            &GoModTexts {
                go_mod: Some("not a go.mod".into()),
                go_sum: None
            }
        )
        .is_err()
    );

    // A site without go.mod does not use Hugo Modules.
    let plain = tempfile::tempdir().unwrap();
    write(plain.path(), "hugo.toml", "title = \"x\"\n");
    assert!(matches!(
        mod_get(&hugo.path, plain.path(), "github.com/acme/vend", "v1.0.0").await,
        Err(AppError::Invalid(_))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn vendors_without_leaving_a_build_lock() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let temp = tempfile::tempdir().unwrap();
    let base = canonical(temp.path()).unwrap();
    let site = base.join("site");
    write(
        &site,
        "hugo.toml",
        "title = \"x\"\n[module]\nreplacements = \"example.org/local -> ../../local\"\n[[module.imports]]\npath = \"example.org/local\"\n",
    );
    write(&site, "go.mod", "module example.org/site\n\ngo 1.20\n");
    write(&base, "local/go.mod", "module example.org/local\n");
    write(&base, "local/layouts/x.html", "x\n");
    mod_vendor(&hugo.path, &site).await.unwrap();
    assert!(!site.join(".hugo_build.lock").exists());
}

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.org",
            "-c",
            "protocol.file.allow=always",
            "-c",
            "init.defaultBranch=main",
            "-c",
            "core.autocrlf=false",
        ])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn updates_a_submodule_theme_with_fetch_and_checkout() {
    if !git_or_skip() {
        return;
    }
    let temp = tempfile::tempdir().unwrap();
    let base = canonical(temp.path()).unwrap();

    // The theme's "upstream": a bare repository with two tagged versions.
    let work = base.join("theme-work");
    fs::create_dir_all(&work).unwrap();
    git(&work, &["init"]);
    write(&work, "layouts/baseof.html", "<html>v1</html>\n");
    git(&work, &["add", "."]);
    git(&work, &["commit", "-m", "v1"]);
    git(&work, &["tag", "v1.0"]);
    let v1 = git(&work, &["rev-parse", "HEAD"]);
    let bare = base.join("theme.git");
    git(
        &base,
        &[
            "clone",
            "--bare",
            &work.to_string_lossy(),
            &bare.to_string_lossy(),
        ],
    );

    // The site uses the theme as a submodule at v1.0.
    let site = base.join("site");
    fs::create_dir_all(&site).unwrap();
    git(&site, &["init"]);
    write(&site, "hugo.toml", "title = \"x\"\ntheme = \"t\"\n");
    git(&site, &["add", "."]);
    git(&site, &["commit", "-m", "site"]);
    git(
        &site,
        &["submodule", "add", &bare.to_string_lossy(), "themes/t"],
    );
    git(&site, &["commit", "-m", "theme"]);

    // Upstream moves on to v2.0 after the site added the submodule.
    write(&work, "layouts/baseof.html", "<html>v2</html>\n");
    git(&work, &["commit", "-am", "v2"]);
    git(&work, &["tag", "v2.0"]);
    let v2 = git(&work, &["rev-parse", "HEAD"]);
    git(&work, &["push", &bare.to_string_lossy(), "main", "--tags"]);

    let submodules = list_submodules(&site).await.unwrap();
    assert_eq!(submodules.len(), 1);
    assert_eq!(submodules[0].path, "themes/t");
    let status = submodule_status(&site, "themes/t").await.unwrap();
    assert!(status.initialized);
    assert_eq!(status.head.as_deref(), Some(v1.as_str()));
    assert_eq!(status.describe.as_deref(), Some("v1.0"));
    assert!(status.changes.is_empty());

    // Not a submodule, or not a safe reference: refused.
    assert!(submodule_status(&site, "themes/other").await.is_err());
    assert!(
        submodule_checkout(&site, "themes/t", "--force")
            .await
            .is_err()
    );

    // Local changes block the update and stay untouched.
    write(&site, "themes/t/layouts/baseof.html", "<html>mine</html>\n");
    let refused = submodule_checkout(&site, "themes/t", "v2.0").await;
    assert!(matches!(refused, Err(AppError::Invalid(_))));
    assert_eq!(
        fs::read_to_string(site.join("themes/t/layouts/baseof.html")).unwrap(),
        "<html>mine</html>\n"
    );
    git(&site.join("themes/t"), &["checkout", "--", "."]);

    // Fetch + checkout of the new tag.
    let after = submodule_checkout(&site, "themes/t", "v2.0").await.unwrap();
    assert_eq!(after.head.as_deref(), Some(v2.as_str()));
    assert_eq!(after.describe.as_deref(), Some("v2.0"));
    // (The user's git may check files out with CRLF.)
    assert_eq!(
        fs::read_to_string(site.join("themes/t/layouts/baseof.html"))
            .unwrap()
            .replace("\r\n", "\n"),
        "<html>v2</html>\n"
    );
    // The parent repository now has a submodule pointer change to commit.
    let parent = git(&site, &["status", "--porcelain"]);
    assert!(parent.contains("themes/t"), "{parent}");
}
