//! Talking to GitHub: the release list (cached) and streamed downloads.

use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use reqwest::header::{ACCEPT, HeaderMap};
use serde::Deserialize;

use super::HugoRelease;
use super::semver::Semver;
use crate::error::{AppError, AppResult};

pub const RELEASES_URL: &str = "https://api.github.com/repos/gohugoio/hugo/releases?per_page=40";
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
/// Progress is reported at most once per this many bytes (plus at the end).
const PROGRESS_STEP: u64 = 256 * 1024;

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static RELEASES_CACHE: Mutex<Option<(Instant, Vec<HugoRelease>)>> = Mutex::new(None);

fn network_error(what: &str, error: &reqwest::Error) -> AppError {
    AppError::Network(format!("Network error while {what}: {error}"))
}

fn client() -> AppResult<reqwest::Client> {
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!(
            "hugo-publisher/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/aligoren/hugo-publish)"
        ))
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| network_error("preparing the HTTP client", &e))?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

#[derive(Deserialize)]
struct ApiRelease {
    tag_name: String,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
}

/// Releases from the GitHub API response, newest version first. Drafts and tags that are not
/// plain versions are skipped.
pub fn parse_releases(json: &str) -> AppResult<Vec<HugoRelease>> {
    let list: Vec<ApiRelease> = serde_json::from_str(json)
        .map_err(|e| AppError::Invalid(format!("unexpected answer from GitHub: {e}")))?;
    let mut releases: Vec<(Semver, HugoRelease)> = list
        .into_iter()
        .filter(|r| !r.draft)
        .filter_map(|r| {
            let version = Semver::parse(&r.tag_name)?;
            Some((
                version,
                HugoRelease {
                    version: version.to_string(),
                    published_at: r.published_at.unwrap_or_default(),
                    prerelease: r.prerelease,
                },
            ))
        })
        .collect();
    releases.sort_by_key(|r| std::cmp::Reverse(r.0));
    releases.dedup_by(|a, b| a.0 == b.0);
    Ok(releases.into_iter().map(|(_, r)| r).collect())
}

/// Maps a failed HTTP status to an error the user can act on. 403 and 429 from GitHub mean the
/// (unauthenticated: 60 requests per hour) rate limit; `reset_at` is `x-ratelimit-reset`.
pub fn status_error(status: u16, reset_at: Option<u64>, now: u64, what: &str) -> AppError {
    match status {
        403 | 429 => {
            let wait = reset_at
                .filter(|reset| *reset > now)
                .map(|reset| (reset - now).div_ceil(60).max(1));
            let hint = match wait {
                Some(minutes) => format!("try again in about {minutes} minute(s)"),
                None => "try again later".into(),
            };
            AppError::Network(format!(
                "GitHub rate limit reached (HTTP {status}) while {what}; {hint}"
            ))
        }
        404 => AppError::Network(format!("Not found on GitHub (HTTP 404) while {what}")),
        _ => AppError::Network(format!("GitHub answered HTTP {status} while {what}")),
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

fn check_status(response: reqwest::Response, what: &str) -> AppResult<reqwest::Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let reset_at = reset_header(response.headers());
    Err(status_error(status.as_u16(), reset_at, now_secs(), what))
}

fn reset_header(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("x-ratelimit-reset")?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// The newest Hugo releases. Cached for ten minutes; when GitHub cannot be reached, an older
/// cached list is returned instead of an error.
pub async fn releases() -> AppResult<Vec<HugoRelease>> {
    if let Some((fetched, list)) = RELEASES_CACHE.lock().unwrap().as_ref()
        && fetched.elapsed() < CACHE_TTL
    {
        return Ok(list.clone());
    }
    match fetch_releases().await {
        Ok(list) => {
            *RELEASES_CACHE.lock().unwrap() = Some((Instant::now(), list.clone()));
            Ok(list)
        }
        Err(error) => match RELEASES_CACHE.lock().unwrap().as_ref() {
            Some((_, stale)) => {
                log::warn!("using the cached Hugo release list: {error}");
                Ok(stale.clone())
            }
            None => Err(error),
        },
    }
}

async fn fetch_releases() -> AppResult<Vec<HugoRelease>> {
    let what = "listing Hugo releases";
    let response = client()?
        .get(RELEASES_URL)
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| network_error(what, &e))?;
    let text = check_status(response, what)?
        .text()
        .await
        .map_err(|e| network_error(what, &e))?;
    parse_releases(&text)
}

/// A small text file, such as a release's checksums.
pub async fn fetch_text(url: &str) -> AppResult<String> {
    let what = format!("downloading {url}");
    let response = client()?
        .get(url)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| network_error(&what, &e))?;
    check_status(response, &what)?
        .text()
        .await
        .map_err(|e| network_error(&what, &e))
}

/// Streams `url` into a new file at `dest`, calling `progress(received, total)` along the way.
pub async fn download(
    url: &str,
    dest: &Path,
    mut progress: impl FnMut(u64, Option<u64>),
) -> AppResult<u64> {
    let what = format!("downloading {url}");
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| network_error(&what, &e))?;
    let response = check_status(response, &what)?;
    let total = response.content_length();
    let mut file = std::io::BufWriter::with_capacity(256 * 1024, std::fs::File::create(dest)?);
    let mut stream = response.bytes_stream();
    let mut received = 0u64;
    let mut reported = 0u64;
    progress(0, total);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| network_error(&what, &e))?;
        file.write_all(&chunk)?;
        received += chunk.len() as u64;
        if received - reported >= PROGRESS_STEP {
            reported = received;
            progress(received, total);
        }
    }
    let file = file
        .into_inner()
        .map_err(|e| AppError::Io(e.into_error()))?;
    file.sync_all()?;
    if let Some(total) = total
        && received != total
    {
        return Err(AppError::Invalid(format!(
            "the download of {url} ended early ({received} of {total} bytes)"
        )));
    }
    progress(received, total);
    Ok(received)
}
