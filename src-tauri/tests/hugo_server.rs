//! Runs a real `hugo` binary. Skipped when Hugo is not installed, unless
//! `HUGO_PUBLISHER_REQUIRE_HUGO=1` is set (CI sets it so a missing Hugo fails loudly).

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hugo_publisher_lib::error::AppError;
use hugo_publisher_lib::hugo::detect::{HugoInfo, detect};
use hugo_publisher_lib::hugo::list::list_all;
use hugo_publisher_lib::hugo::server::{self, ServerEvent, ServerOptions};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

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

fn sample_site() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "hugo.toml",
        "baseURL = \"https://example.org/\"\ntitle = \"Deneme Sitesi\"\n",
    );
    write(root, "content/_index.md", "---\ntitle: Ana Sayfa\n---\n");
    write(
        root,
        "content/posts/merhaba.md",
        "---\ntitle: Merhaba\ndraft: true\n---\nGövde\n",
    );
    write(root, "layouts/home.html", "<h1>{{ site.Title }}</h1>");
    write(
        root,
        "layouts/page.html",
        "<h1>{{ .Title }}</h1>{{ .Content }}",
    );
    write(root, "layouts/section.html", "<h1>{{ .Title }}</h1>");
    dir
}

async fn http_get(port: u16, path: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    String::from_utf8_lossy(&response).into_owned()
}

#[tokio::test(flavor = "multi_thread")]
async fn serves_a_site_and_cleans_up_after_itself() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let site = sample_site();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let options = ServerOptions {
        drafts: true,
        ..Default::default()
    };

    let running = server::start(&hugo.path, site.path(), &options, move |event| {
        sink.lock().unwrap().push(event);
    })
    .await
    .expect("hugo server should start");

    assert!(
        running.url.contains(&running.port.to_string()),
        "url: {}",
        running.url
    );
    let home = http_get(running.port, "/").await;
    assert!(home.starts_with("HTTP/1.1 200"), "{home}");
    assert!(home.contains("<h1>Deneme Sitesi</h1>"), "{home}");
    let draft = http_get(running.port, "/posts/merhaba/").await;
    assert!(
        draft.contains("<h1>Merhaba</h1>"),
        "drafts were requested: {draft}"
    );
    assert!(
        events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, ServerEvent::Ready { .. }))
    );

    let port = running.port;
    running.stop().await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        TcpStream::connect(("127.0.0.1", port)).await.is_err(),
        "port {port} still open"
    );
    // --renderToMemory: the preview must not write the site's public/ folder.
    assert!(!site.path().join("public").exists());
    // The output reader notices the exit.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, ServerEvent::Exited))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_a_broken_config_instead_of_hanging() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let site = sample_site();
    write(site.path(), "hugo.toml", "title = \n");
    let result = server::start(&hugo.path, site.path(), &ServerOptions::default(), |_| {}).await;
    match result {
        Err(AppError::Hugo(message)) => assert!(!message.is_empty()),
        Err(other) => panic!("unexpected error: {other}"),
        Ok(_) => panic!("a broken config must not start"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn lists_pages_with_their_status() {
    let Some(hugo) = hugo_or_skip().await else {
        return;
    };
    let site = sample_site();
    let pages = list_all(&hugo.path, site.path()).await.unwrap();
    let post = pages
        .iter()
        .find(|p| p.path == "content/posts/merhaba.md")
        .expect("the draft post is listed");
    assert!(post.draft);
    assert_eq!(post.title, "Merhaba");
    assert!(
        !site.path().join(".hugo_build.lock").exists(),
        "--noBuildLock was ignored"
    );
}
