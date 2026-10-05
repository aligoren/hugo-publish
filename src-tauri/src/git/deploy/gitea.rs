//! Deploy status from Gitea and Forgejo (Codeberg or self-hosted): the combined commit status,
//! which Forgejo/Gitea Actions, Woodpecker and deploy hosts report, through the public REST API.
//!
//! `GET /api/v1/repos/{owner}/{repo}/commits/{sha}/status`, without a token. A 404 is ambiguous
//! (private repository, or a commit the server has not seen yet), so the repository itself is
//! asked for: visible means "no checks yet", hidden means `needs_auth`.

use serde_json::Value;

use super::forge::{self, ForgeRepo, text};
use super::github::{DeployCheck, DeployStatus};
use crate::error::{AppError, AppResult};

/// The combined status in the shared shape.
pub fn parse_status(json: &Value) -> Vec<DeployCheck> {
    json.get("statuses")
        .and_then(Value::as_array)
        .map(|statuses| {
            statuses
                .iter()
                .map(|s| {
                    // `status` in the API; some versions also call it `state`.
                    let state = text(s, "status")
                        .or_else(|| text(s, "state"))
                        .unwrap_or_else(|| "pending".into());
                    let (status, conclusion) = match state.as_str() {
                        "success" => ("completed", Some("success")),
                        "failure" | "error" => ("completed", Some("failure")),
                        "warning" => ("completed", Some("neutral")),
                        "skipped" => ("completed", Some("skipped")),
                        _ => ("in_progress", None),
                    };
                    DeployCheck {
                        name: text(s, "context").unwrap_or_else(|| "status".into()),
                        status: status.into(),
                        conclusion: conclusion.map(str::to_string),
                        url: text(s, "target_url"),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// What an answer to the status request means.
#[derive(Debug, Clone, PartialEq)]
pub enum Answer {
    Data(Value),
    /// 404: ask whether the repository is visible.
    Unknown,
    NeedsAuth,
    RateLimited,
    Failed(u16),
}

pub fn interpret(code: u16, body: Value) -> Answer {
    match code {
        200 => Answer::Data(body),
        404 => Answer::Unknown,
        401 | 403 => Answer::NeedsAuth,
        429 => Answer::RateLimited,
        other => Answer::Failed(other),
    }
}

/// After a 404 for the status: the repository answer decides between "no checks yet" (the
/// repository is visible) and "private".
pub fn repository_visible(code: u16) -> bool {
    code == 200
}

/// The combined status of `sha`.
pub async fn deploy_status(repo: &ForgeRepo, sha: &str) -> AppResult<DeployStatus> {
    let base = format!(
        "{}/repos/{}/{}",
        repo.api,
        forge::encode_segment(&repo.owner),
        forge::encode_segment(&repo.repo)
    );
    let mut result = DeployStatus::new(repo, sha);
    let client = forge::client()?;
    let (code, body) =
        forge::get_json(&client, &format!("{base}/commits/{sha}/status"), "Gitea").await?;
    match interpret(code, body) {
        Answer::Data(json) => result.checks = parse_status(&json),
        Answer::Unknown => {
            let (code, _) = forge::get_json(&client, &base, "Gitea").await?;
            result.needs_auth = !repository_visible(code);
        }
        Answer::NeedsAuth => result.needs_auth = true,
        Answer::RateLimited => {
            return Err(AppError::Network(
                "the server's limit for requests without signing in was reached; try again later"
                    .into(),
            ));
        }
        Answer::Failed(code) => {
            return Err(AppError::Network(format!(
                "the Gitea/Forgejo server answered with HTTP {code}"
            )));
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_recorded_combined_status() {
        let json: Value = serde_json::from_str(include_str!("testdata/gitea_status.json")).unwrap();
        let checks = parse_status(&json);
        let summary: Vec<(&str, &str, Option<&str>)> = checks
            .iter()
            .map(|c| (c.name.as_str(), c.status.as_str(), c.conclusion.as_deref()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("build / hugo (push)", "completed", Some("success")),
                ("ci/woodpecker/push/pages", "in_progress", None),
                ("links", "completed", Some("neutral")),
                ("deploy", "completed", Some("failure")),
            ]
        );
        assert_eq!(
            checks[0].url.as_deref(),
            Some("https://codeberg.org/ali/blog/actions/runs/88/jobs/0")
        );
        assert_eq!(checks[2].url, None);
        // Older servers send `null` for a commit without statuses.
        assert!(parse_status(&serde_json::json!({ "state": "", "statuses": null })).is_empty());
        let legacy = serde_json::json!({ "statuses": [{ "state": "success", "context": "ci" }] });
        assert_eq!(
            parse_status(&legacy)[0].conclusion.as_deref(),
            Some("success")
        );
    }

    #[test]
    fn interprets_answers() {
        assert_eq!(interpret(404, Value::Null), Answer::Unknown);
        assert_eq!(interpret(403, Value::Null), Answer::NeedsAuth);
        assert_eq!(interpret(429, Value::Null), Answer::RateLimited);
        assert_eq!(interpret(502, Value::Null), Answer::Failed(502));
        assert!(repository_visible(200));
        assert!(!repository_visible(404));
    }
}
