//! HTTP for site health: external link checks, pages from the local preview server and the
//! live site. Only ever started by the user.

use std::collections::HashSet;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::redirect::Policy;
use reqwest::{Client, Url};

use super::commands::{FetchedPage, LinkCheck};
use crate::error::{AppError, AppResult};

/// Links checked at the same time.
pub const LINK_CONCURRENCY: usize = 8;
pub const LINK_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_REDIRECTS: usize = 10;
/// Pages are cut at this size.
pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const PAGE_TIMEOUT: Duration = Duration::from_secs(30);

pub fn link_check_user_agent() -> String {
    format!("HugoPublisher/{} (link check)", env!("CARGO_PKG_VERSION"))
}

fn user_agent() -> String {
    format!("HugoPublisher/{}", env!("CARGO_PKG_VERSION"))
}

/// An absolute `http://` or `https://` URL with a host.
pub fn parse_web_url(url: &str) -> AppResult<Url> {
    let parsed = Url::parse(url.trim())
        .map_err(|e| AppError::Invalid(format!("not a valid URL: {url} ({e})")))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none_or(str::is_empty) {
        return Err(AppError::Invalid(format!("not an http(s) URL: {url}")));
    }
    Ok(parsed)
}

/// True for `localhost`, `127.0.0.1` and `[::1]`.
pub fn is_loopback(url: &Url) -> bool {
    matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
}

/// A URL on the local preview server: `http://localhost:*`, `http://127.0.0.1:*` or
/// `http://[::1]:*`, without user info.
pub fn parse_preview_url(url: &str) -> AppResult<Url> {
    let parsed = Url::parse(url.trim())
        .map_err(|e| AppError::Invalid(format!("not a valid URL: {url} ({e})")))?;
    if parsed.scheme() != "http"
        || !is_loopback(&parsed)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(AppError::Invalid(format!(
            "only http://localhost, http://127.0.0.1 and http://[::1] are allowed: {url}"
        )));
    }
    Ok(parsed)
}

/// Whether a link answered `HEAD` in a way that calls for a `GET`: no answer at all, or one of
/// the statuses servers use when they do not support `HEAD`.
pub fn needs_get(head_status: Option<u16>) -> bool {
    matches!(head_status, None | Some(403 | 405 | 501))
}

/// A link is fine when it ends (after redirects) with a 2xx status.
pub fn is_ok_status(status: u16) -> bool {
    (200..300).contains(&status)
}

/// Unique URLs in their first order.
pub fn dedupe(urls: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    urls.into_iter()
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty() && seen.insert(u.clone()))
        .collect()
}

/// A short, readable reason for a failed request, without the URL.
pub fn describe_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return "timed out".into();
    }
    if error.is_redirect() {
        return "too many redirects".into();
    }
    let mut parts = vec![if error.is_connect() {
        "could not connect".to_string()
    } else if error.is_body() || error.is_decode() {
        "could not read the response".to_string()
    } else {
        "request failed".to_string()
    }];
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        let text = cause.to_string();
        if !text.is_empty() && !parts.contains(&text) {
            parts.push(text);
        }
        source = cause.source();
    }
    parts.join(": ")
}

fn link_client() -> AppResult<Client> {
    Client::builder()
        .user_agent(link_check_user_agent())
        .redirect(Policy::limited(MAX_REDIRECTS))
        .timeout(LINK_TIMEOUT)
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Invalid(e.to_string()))
}

/// Checks each unique URL (HEAD, then GET when HEAD is refused), eight at a time. Results come in
/// the order of the unique URLs; URLs that are not http(s) get an error result.
pub async fn check_links(urls: Vec<String>) -> AppResult<Vec<LinkCheck>> {
    let client = link_client()?;
    let unique = dedupe(urls);
    Ok(futures_util::stream::iter(unique)
        .map(|url| check_one(&client, url))
        .buffered(LINK_CONCURRENCY)
        .collect()
        .await)
}

async fn check_one(client: &Client, url: String) -> LinkCheck {
    let parsed = match parse_web_url(&url) {
        Ok(parsed) => parsed,
        Err(error) => {
            return LinkCheck {
                url,
                ok: false,
                status: None,
                final_url: None,
                error: Some(error.to_string()),
            };
        }
    };
    let head = client.head(parsed.clone()).send().await;
    let head_status = head.as_ref().ok().map(|r| r.status().as_u16());
    let response = if needs_get(head_status) {
        client.get(parsed).send().await
    } else {
        head
    };
    match response {
        Ok(response) => {
            let status = response.status().as_u16();
            LinkCheck {
                url,
                ok: is_ok_status(status),
                status: Some(status),
                final_url: Some(response.url().to_string()),
                error: None,
            }
        }
        Err(error) => LinkCheck {
            url,
            ok: false,
            status: error.status().map(|s| s.as_u16()),
            final_url: error.url().map(Url::to_string),
            error: Some(describe_error(&error)),
        },
    }
}

/// GET of a page on the local preview server. Redirects are followed only while they stay on
/// the local machine.
pub async fn fetch_preview(url: &str) -> AppResult<String> {
    let parsed = parse_preview_url(url)?;
    let client = Client::builder()
        .user_agent(user_agent())
        .no_proxy()
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many redirects")
            } else if attempt.url().scheme() == "http" && is_loopback(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .timeout(LINK_TIMEOUT)
        .build()
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| AppError::Invalid(describe_error(&e)))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::Invalid(format!(
            "the preview server answered {status}"
        )));
    }
    read_capped(response, MAX_BODY_BYTES).await
}

/// GET of a public page: status, final URL after redirects and the body (cut at 2 MB).
pub async fn fetch_page(url: &str) -> AppResult<FetchedPage> {
    let parsed = parse_web_url(url)?;
    let client = Client::builder()
        .user_agent(user_agent())
        .redirect(Policy::limited(MAX_REDIRECTS))
        .timeout(PAGE_TIMEOUT)
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| AppError::Invalid(describe_error(&e)))?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let body = read_capped(response, MAX_BODY_BYTES).await?;
    Ok(FetchedPage {
        status,
        final_url,
        body,
    })
}

/// The body as text (invalid UTF-8 replaced), stopping after `limit` bytes.
async fn read_capped(mut response: reqwest::Response, limit: usize) -> AppResult<String> {
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Invalid(describe_error(&e)))?
    {
        let room = limit - bytes.len();
        if chunk.len() >= room {
            bytes.extend_from_slice(&chunk[..room]);
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_urls_are_http_or_https_with_a_host() {
        for ok in [
            "https://example.org/",
            "http://example.org/a?b=c#d",
            " https://örnek.com.tr/yazı ",
        ] {
            assert!(parse_web_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "ftp://example.org/",
            "mailto:a@b.c",
            "javascript:alert(1)",
            "/relative",
            "file:///C:/x",
            "http://",
            "",
        ] {
            assert!(parse_web_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn preview_urls_must_stay_on_this_machine() {
        for ok in [
            "http://localhost:1313/",
            "http://127.0.0.1:50123/posts/a/",
            "http://[::1]:1313/x",
            "http://localhost/",
        ] {
            assert!(parse_preview_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "https://localhost:1313/",
            "http://localhost.example.com/",
            "http://127.0.0.2:1313/",
            "http://example.com/",
            "http://localhost@example.com/",
            "http://user:pw@localhost:1313/",
            "http://0.0.0.0:1313/",
            "file:///etc/passwd",
        ] {
            assert!(parse_preview_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn head_refusals_fall_back_to_get() {
        assert!(needs_get(None));
        assert!(needs_get(Some(403)));
        assert!(needs_get(Some(405)));
        assert!(needs_get(Some(501)));
        assert!(!needs_get(Some(200)));
        assert!(!needs_get(Some(404)));
        assert!(!needs_get(Some(500)));
    }

    #[test]
    fn only_2xx_is_ok() {
        assert!(is_ok_status(200));
        assert!(is_ok_status(204));
        assert!(!is_ok_status(301));
        assert!(!is_ok_status(404));
        assert!(!is_ok_status(500));
        assert!(!is_ok_status(199));
    }

    #[test]
    fn dedupes_in_first_order() {
        let urls = vec![
            "https://b.org/".to_string(),
            "https://a.org/".to_string(),
            " https://b.org/ ".to_string(),
            String::new(),
        ];
        assert_eq!(dedupe(urls), ["https://b.org/", "https://a.org/"]);
    }

    #[test]
    fn user_agent_names_the_app() {
        assert!(link_check_user_agent().starts_with("HugoPublisher/"));
        assert!(link_check_user_agent().ends_with("(link check)"));
    }
}
