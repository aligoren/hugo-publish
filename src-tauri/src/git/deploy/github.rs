//! Deploy status from GitHub: the check runs and commit statuses that hosts such as Cloudflare
//! Pages, Netlify, GitHub Pages and GitHub Actions report on a pushed commit.
//!
//! The `gh` CLI is used when it is installed and signed in (it also sees private repositories);
//! otherwise the public REST API is called without credentials. GitHub Enterprise Server works
//! the same way through its own API root (`forge = "github"` in the site settings).

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::process::Command;

use super::forge::{self, ForgeRepo};
use crate::error::{AppError, AppResult};

const GH_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitHubRepo {
    pub owner: String,
    pub repo: String,
}

/// `owner/repo` of a github.com remote URL (https, ssh and scp-like forms); `None` otherwise.
pub fn parse_github_remote(url: &str) -> Option<GitHubRepo> {
    let url = url.trim();
    let rest = if let Some((scheme, rest)) = url.split_once("://") {
        if !matches!(scheme, "https" | "http" | "ssh" | "git") {
            return None;
        }
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit('@').next()?.split(':').next()?;
        if !matches!(
            host.to_ascii_lowercase().as_str(),
            "github.com" | "www.github.com" | "ssh.github.com"
        ) {
            return None;
        }
        path
    } else {
        // scp-like: git@github.com:owner/repo.git
        let (host, path) = url.split_once(':')?;
        let host = host.rsplit('@').next()?;
        if !host.eq_ignore_ascii_case("github.com") || path.starts_with('/') {
            return None;
        }
        path
    };
    let mut parts = rest.trim_end_matches('/').split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.trim_end_matches(".git").to_string();
    let valid = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    (parts.next().is_none() && valid(&owner) && valid(&repo)).then_some(GitHubRepo { owner, repo })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployCheck {
    pub name: String,
    /// queued | in_progress | completed
    pub status: String,
    /// success | failure | neutral | cancelled | skipped | timed_out | action_required | stale;
    /// `None` until completed.
    pub conclusion: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployStatus {
    pub owner: String,
    pub repo: String,
    pub sha: String,
    pub checks: Vec<DeployCheck>,
    /// gh | api
    pub source: String,
    /// The repository is not visible without signing in (private): sign in with `gh` (GitHub);
    /// other forges are only read anonymously.
    pub needs_auth: bool,
    /// github | gitlab | gitea
    pub forge: String,
}

impl DeployStatus {
    /// An empty status for `sha` of `repo`, read from the public API.
    pub fn new(repo: &ForgeRepo, sha: &str) -> Self {
        DeployStatus {
            owner: repo.owner.clone(),
            repo: repo.repo.clone(),
            sha: sha.to_string(),
            checks: Vec::new(),
            source: "api".into(),
            needs_auth: false,
            forge: repo.kind.name().into(),
        }
    }
}

/// A full or abbreviated commit id.
pub fn is_commit_id(sha: &str) -> bool {
    (7..=64).contains(&sha.len()) && sha.chars().all(|c| c.is_ascii_hexdigit())
}

/// Check runs (`GET …/commits/{sha}/check-runs`) in the shared shape.
pub fn parse_check_runs(json: &Value) -> Vec<DeployCheck> {
    json.get("check_runs")
        .and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .map(|run| DeployCheck {
                    name: text(run, &["name"]).unwrap_or_else(|| "check".into()),
                    status: text(run, &["status"]).unwrap_or_else(|| "queued".into()),
                    conclusion: text(run, &["conclusion"]),
                    url: text(run, &["details_url"]).or_else(|| text(run, &["html_url"])),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Commit statuses (`GET …/commits/{sha}/status`, the combined view) in the shared shape.
pub fn parse_statuses(json: &Value) -> Vec<DeployCheck> {
    json.get("statuses")
        .and_then(Value::as_array)
        .map(|statuses| {
            statuses
                .iter()
                .map(|s| {
                    let state = text(s, &["state"]).unwrap_or_else(|| "pending".into());
                    let (status, conclusion) = match state.as_str() {
                        "success" => ("completed", Some("success")),
                        "failure" | "error" => ("completed", Some("failure")),
                        _ => ("in_progress", None),
                    };
                    DeployCheck {
                        name: text(s, &["context"]).unwrap_or_else(|| "status".into()),
                        status: status.into(),
                        conclusion: conclusion.map(str::to_string),
                        url: text(s, &["target_url"]),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn text(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(key)?;
    }
    current
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Checks and statuses of `sha`, through `gh` when signed in, else the public API.
pub async fn deploy_status(repo: &ForgeRepo, sha: &str) -> AppResult<DeployStatus> {
    if !is_commit_id(sha) {
        return Err(AppError::Invalid(format!("not a commit id: {sha}")));
    }
    let base = format!("repos/{}/{}/commits/{sha}", repo.owner, repo.repo);
    let mut result = DeployStatus::new(repo, sha);
    if gh_signed_in(&repo.host).await {
        let runs = gh_api(&repo.host, &format!("{base}/check-runs?per_page=100")).await?;
        let statuses = gh_api(&repo.host, &format!("{base}/status")).await?;
        result.source = "gh".into();
        result.checks = parse_check_runs(&runs);
        result.checks.extend(parse_statuses(&statuses));
        return Ok(result);
    }
    let client = forge::client()?;
    let api = &repo.api;
    let mut checks = Vec::new();
    for (suffix, parse) in [
        (
            "check-runs?per_page=100",
            parse_check_runs as fn(&Value) -> Vec<DeployCheck>,
        ),
        ("status", parse_statuses),
    ] {
        let response = client
            .get(format!("{api}/{base}/{suffix}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|e| AppError::Network(format!("GitHub could not be reached: {e}")))?;
        match response.status().as_u16() {
            200 => {
                let json: Value = response
                    .json()
                    .await
                    .map_err(|e| AppError::Network(format!("unexpected GitHub answer: {e}")))?;
                checks.extend(parse(&json));
            }
            // Private repositories look like missing ones without credentials.
            404 | 401 => {
                result.needs_auth = true;
                return Ok(result);
            }
            403 | 429 => {
                return Err(AppError::Network(
                    "GitHub's limit for requests without signing in was reached; try again later or sign in with gh".into(),
                ));
            }
            // A commit GitHub has not seen yet (push still in flight): no checks so far.
            422 => {}
            code => {
                return Err(AppError::Network(format!(
                    "GitHub answered with HTTP {code}"
                )));
            }
        }
    }
    result.checks = checks;
    Ok(result)
}

fn gh_command(args: &[&str]) -> Option<Command> {
    let gh = which::which("gh").ok()?;
    let mut command = Command::new(gh);
    command
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(crate::hugo::CREATE_NO_WINDOW);
    Some(command)
}

/// `gh` is installed and signed in to `host` (github.com or an Enterprise server).
pub async fn gh_signed_in(host: &str) -> bool {
    let Some(mut command) = gh_command(&["auth", "status", "--hostname", host]) else {
        return false;
    };
    matches!(
        tokio::time::timeout(GH_TIMEOUT, command.output()).await,
        Ok(Ok(output)) if output.status.success()
    )
}

async fn gh_api(host: &str, path: &str) -> AppResult<Value> {
    let mut command = gh_command(&["api", "--hostname", host, path])
        .ok_or_else(|| AppError::Invalid("the gh CLI is not installed".into()))?;
    let output = tokio::time::timeout(GH_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::Network("`gh api` timed out".into()))??;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Not pushed yet / unknown commit: no checks so far.
        if stderr.contains("No commit found") || stderr.contains("HTTP 422") {
            return Ok(Value::Null);
        }
        return Err(AppError::Network(format!(
            "gh api failed: {}",
            stderr.trim()
        )));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::Network(format!("unexpected gh output: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn repo(owner: &str, name: &str) -> Option<GitHubRepo> {
        Some(GitHubRepo {
            owner: owner.into(),
            repo: name.into(),
        })
    }

    #[test]
    fn parses_github_remotes() {
        for url in [
            "https://github.com/ali/blog.git",
            "https://github.com/ali/blog",
            "https://github.com/ali/blog/",
            "http://www.github.com/ali/blog.git",
            "https://token@github.com/ali/blog.git",
            "git@github.com:ali/blog.git",
            "git@github.com:ali/blog",
            "ssh://git@github.com/ali/blog.git",
            "ssh://git@ssh.github.com:443/ali/blog.git",
            "  https://GitHub.com/ali/blog.git\n",
        ] {
            assert_eq!(parse_github_remote(url), repo("ali", "blog"), "{url}");
        }
        assert_eq!(
            parse_github_remote("git@github.com:my-org/my.site_2.git"),
            repo("my-org", "my.site_2")
        );
        for url in [
            "https://gitlab.com/ali/blog.git",
            "git@codeberg.org:ali/blog.git",
            "https://github.com/ali",
            "https://github.com/ali/blog/tree/main",
            "D:/repos/blog.git",
            "file:///x/blog.git",
            "https://github.com.evil.example/ali/blog",
        ] {
            assert_eq!(parse_github_remote(url), None, "{url}");
        }
    }

    #[test]
    fn parses_check_runs_and_statuses() {
        let runs = json!({"total_count": 2, "check_runs": [
            {"name": "Cloudflare Pages", "status": "completed", "conclusion": "success",
             "details_url": "https://dash.cloudflare.com/x", "html_url": "https://github.com/a"},
            {"name": "build", "status": "in_progress", "conclusion": null, "html_url": "https://github.com/b"}
        ]});
        assert_eq!(
            parse_check_runs(&runs),
            vec![
                DeployCheck {
                    name: "Cloudflare Pages".into(),
                    status: "completed".into(),
                    conclusion: Some("success".into()),
                    url: Some("https://dash.cloudflare.com/x".into()),
                },
                DeployCheck {
                    name: "build".into(),
                    status: "in_progress".into(),
                    conclusion: None,
                    url: Some("https://github.com/b".into()),
                },
            ]
        );
        let statuses = json!({"state": "pending", "statuses": [
            {"context": "netlify/site/deploy-preview", "state": "pending", "target_url": "https://app.netlify.com/x"},
            {"context": "ci", "state": "error", "target_url": ""},
            {"context": "pages", "state": "success"}
        ]});
        let parsed = parse_statuses(&statuses);
        assert_eq!(parsed[0].status, "in_progress");
        assert_eq!(parsed[0].conclusion, None);
        assert_eq!(parsed[1].conclusion.as_deref(), Some("failure"));
        assert_eq!(parsed[1].url, None);
        assert_eq!(parsed[2].conclusion.as_deref(), Some("success"));
        assert!(parse_check_runs(&Value::Null).is_empty());
        assert!(parse_statuses(&json!({})).is_empty());
    }
}
