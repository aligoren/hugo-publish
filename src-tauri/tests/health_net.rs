//! Link checks and page fetches against a tiny HTTP server on 127.0.0.1 (loopback only, random
//! port, closed when the test ends).

use std::net::SocketAddr;

use hugo_publisher_lib::health::commands::LinkCheck;
use hugo_publisher_lib::health::net::{MAX_BODY_BYTES, check_links, fetch_page, fetch_preview};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Answers a few fixed routes; HEAD gets the headers only.
async fn serve(mut stream: TcpStream) {
    let mut request = Vec::new();
    let mut buffer = [0u8; 1024];
    while !request.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(n) => request.extend_from_slice(&buffer[..n]),
        }
    }
    let text = String::from_utf8_lossy(&request).into_owned();
    let mut first = text.lines().next().unwrap_or("").split(' ');
    let method = first.next().unwrap_or("").to_string();
    let path = first.next().unwrap_or("").to_string();
    let user_agent = text
        .lines()
        .find_map(|l| {
            l.strip_prefix("user-agent: ")
                .or(l.strip_prefix("User-Agent: "))
        })
        .unwrap_or("")
        .to_string();
    let (status, headers, body): (&str, Vec<String>, Vec<u8>) =
        match (method.as_str(), path.as_str()) {
            (_, "/ok") => ("200 OK", vec![], b"fine".to_vec()),
            ("HEAD", "/nohead") => ("405 Method Not Allowed", vec![], vec![]),
            ("GET", "/nohead") => ("200 OK", vec![], b"get works".to_vec()),
            (_, "/redirect") => (
                "301 Moved Permanently",
                vec!["Location: /ok".into()],
                vec![],
            ),
            (_, "/loop") => ("302 Found", vec!["Location: /loop".into()], vec![]),
            (_, "/missing") => ("404 Not Found", vec![], b"nope".to_vec()),
            (_, "/away") => (
                "302 Found",
                vec!["Location: http://example.invalid/".into()],
                vec![],
            ),
            (_, "/html") => (
                "200 OK",
                vec!["Content-Type: text/html; charset=utf-8".into()],
                "<html><head><title>Önizleme</title></head></html>"
                    .as_bytes()
                    .to_vec(),
            ),
            (_, "/ua") => ("200 OK", vec![], user_agent.into_bytes()),
            (_, "/big") => ("200 OK", vec![], vec![b'a'; MAX_BODY_BYTES + 500_000]),
            _ => ("500 Internal Server Error", vec![], vec![]),
        };
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for header in headers {
        response.push_str(&header);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");
    let _ = stream.write_all(response.as_bytes()).await;
    if method != "HEAD" {
        let _ = stream.write_all(&body).await;
    }
    let _ = stream.shutdown().await;
}

async fn start_server() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(serve(stream));
        }
    });
    address
}

/// A loopback port nothing listens on.
async fn closed_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap().port()
}

fn find<'a>(results: &'a [LinkCheck], url: &str) -> &'a LinkCheck {
    results
        .iter()
        .find(|r| r.url == url)
        .unwrap_or_else(|| panic!("no result for {url}"))
}

#[tokio::test(flavor = "multi_thread")]
async fn checks_links() {
    let address = start_server().await;
    let base = format!("http://{address}");
    let dead = format!("http://127.0.0.1:{}/x", closed_port().await);
    let urls = vec![
        format!("{base}/ok"),
        format!("{base}/nohead"),
        format!("{base}/redirect"),
        format!("{base}/missing"),
        format!("{base}/loop"),
        format!("{base}/ok"),
        "ftp://example.org/file".to_string(),
        dead.clone(),
    ];
    let results = check_links(urls).await.unwrap();
    assert_eq!(results.len(), 7, "duplicates are checked once");
    assert_eq!(results[0].url, format!("{base}/ok"));

    let ok = find(&results, &format!("{base}/ok"));
    assert!(ok.ok);
    assert_eq!(ok.status, Some(200));

    let no_head = find(&results, &format!("{base}/nohead"));
    assert!(no_head.ok, "{no_head:?}");
    assert_eq!(no_head.status, Some(200));

    let redirect = find(&results, &format!("{base}/redirect"));
    assert!(redirect.ok);
    assert_eq!(
        redirect.final_url.as_deref(),
        Some(format!("{base}/ok").as_str())
    );

    let missing = find(&results, &format!("{base}/missing"));
    assert!(!missing.ok);
    assert_eq!(missing.status, Some(404));
    assert!(missing.error.is_none());

    let looping = find(&results, &format!("{base}/loop"));
    assert!(!looping.ok);
    assert!(looping.error.is_some());

    let ftp = find(&results, "ftp://example.org/file");
    assert!(!ftp.ok);
    assert!(ftp.error.is_some());

    let unreachable = find(&results, &dead);
    assert!(!unreachable.ok);
    assert_eq!(unreachable.status, None);
    assert!(unreachable.error.is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn pages_are_fetched_with_the_app_user_agent() {
    let address = start_server().await;
    let page = fetch_page(&format!("http://{address}/ua")).await.unwrap();
    assert!(page.body.starts_with("HugoPublisher/"), "{}", page.body);
}

#[tokio::test(flavor = "multi_thread")]
async fn fetches_preview_pages_on_loopback_only() {
    let address = start_server().await;
    let port = address.port();
    let html = fetch_preview(&format!("http://127.0.0.1:{port}/html"))
        .await
        .unwrap();
    assert!(html.contains("<title>Önizleme</title>"));
    // Redirects that leave the machine are not followed; errors are errors.
    assert!(
        fetch_preview(&format!("http://127.0.0.1:{port}/away"))
            .await
            .is_err()
    );
    assert!(
        fetch_preview(&format!("http://127.0.0.1:{port}/missing"))
            .await
            .is_err()
    );
    assert!(fetch_preview("http://example.org/").await.is_err());
    assert!(
        fetch_preview(&format!("https://127.0.0.1:{port}/html"))
            .await
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn fetches_pages_with_status_final_url_and_a_size_cap() {
    let address = start_server().await;
    let base = format!("http://{address}");

    let redirected = fetch_page(&format!("{base}/redirect")).await.unwrap();
    assert_eq!(redirected.status, 200);
    assert_eq!(redirected.final_url, format!("{base}/ok"));
    assert_eq!(redirected.body, "fine");

    let missing = fetch_page(&format!("{base}/missing")).await.unwrap();
    assert_eq!(missing.status, 404);

    let big = fetch_page(&format!("{base}/big")).await.unwrap();
    assert_eq!(big.body.len(), MAX_BODY_BYTES);

    assert!(fetch_page("file:///C:/Windows/win.ini").await.is_err());
    assert!(fetch_page("javascript:alert(1)").await.is_err());
}
