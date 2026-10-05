//! Deploy status from GitLab (gitlab.com or self-hosted): the commit's statuses (CI jobs, and what
//! hosts such as Netlify or Cloudflare report) and its pipelines, through the public REST API.
//!
//! `GET /api/v4/projects/:path/repository/commits/:sha/statuses` and
//! `GET /api/v4/projects/:path/pipelines?sha=:sha`, without a token: a private project answers
//! 404 "Project Not Found", which is reported as `needs_auth`.

use serde_json::Value;

use super::forge::{self, ForgeRepo, text};
use super::github::{DeployCheck, DeployStatus};
use crate::error::{AppError, AppResult};

/// A GitLab job or pipeline status in the shared shape: `(status, conclusion)`.
fn map_state(state: &str, allow_failure: bool) -> (&'static str, Option<&'static str>) {
    match state {
        "success" => ("completed", Some("success")),
        "failed" if allow_failure => ("completed", Some("neutral")),
        "failed" => ("completed", Some("failure")),
        "canceled" | "canceling" => ("completed", Some("cancelled")),
        "skipped" => ("completed", Some("skipped")),
        // A manual job waits for someone; when it may be left alone it does not block the result.
        "manual" if allow_failure => ("completed", Some("skipped")),
        "manual" => ("completed", Some("action_required")),
        "running" => ("in_progress", None),
        // created, pending, preparing, waiting_for_resource, scheduled, …
        _ => ("queued", None),
    }
}

/// Commit statuses (`…/repository/commits/:sha/statuses`) in the shared shape.
pub fn parse_statuses(json: &Value) -> Vec<DeployCheck> {
    json.as_array()
        .map(|statuses| {
            statuses
                .iter()
                .map(|s| {
                    let state = text(s, "status").unwrap_or_else(|| "pending".into());
                    let allow_failure = s
                        .get("allow_failure")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let (status, conclusion) = map_state(&state, allow_failure);
                    DeployCheck {
                        name: text(s, "name").unwrap_or_else(|| "status".into()),
                        status: status.into(),
                        conclusion: conclusion.map(str::to_string),
                        url: text(s, "target_url"),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Pipelines of the commit (`…/pipelines?sha=`) in the shared shape, one check each.
pub fn parse_pipelines(json: &Value) -> Vec<DeployCheck> {
    json.as_array()
        .map(|pipelines| {
            pipelines
                .iter()
                .map(|p| {
                    let state = text(p, "status").unwrap_or_else(|| "pending".into());
                    let (status, conclusion) = map_state(&state, false);
                    let id = p.get("id").and_then(Value::as_u64).unwrap_or(0);
                    let name = match text(p, "ref") {
                        Some(r) => format!("pipeline #{id} ({r})"),
                        None => format!("pipeline #{id}"),
                    };
                    DeployCheck {
                        name,
                        status: status.into(),
                        conclusion: conclusion.map(str::to_string),
                        url: text(p, "web_url"),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// What an answer from the API means.
#[derive(Debug, Clone, PartialEq)]
pub enum Answer {
    Data(Value),
    /// The project is visible but has nothing for this commit (not pushed yet, or no CI).
    Nothing,
    /// The project is private (or its CI/CD is visible to members only).
    NeedsAuth,
    RateLimited,
    Failed(u16),
}

/// Interprets a status code and body. Without a token, a private project and a missing one both
/// answer 404 "Project Not Found"; an unknown commit in a visible project answers
/// "Commit Not Found" (or an empty list).
pub fn interpret(code: u16, body: Value) -> Answer {
    match code {
        200 => Answer::Data(body),
        404 => {
            let message = text(&body, "message")
                .unwrap_or_default()
                .to_ascii_lowercase();
            if message.contains("project not found") || message.is_empty() {
                Answer::NeedsAuth
            } else {
                Answer::Nothing
            }
        }
        401 | 403 => Answer::NeedsAuth,
        429 => Answer::RateLimited,
        other => Answer::Failed(other),
    }
}

/// Statuses and pipelines of `sha`.
pub async fn deploy_status(repo: &ForgeRepo, sha: &str) -> AppResult<DeployStatus> {
    let project = format!(
        "{}/projects/{}",
        repo.api,
        forge::encode_segment(&repo.full_path())
    );
    let mut result = DeployStatus::new(repo, sha);
    let client = forge::client()?;
    let statuses = fetch(
        &client,
        &format!("{project}/repository/commits/{sha}/statuses?per_page=100"),
    )
    .await?;
    let pipelines = match statuses {
        Some(_) => {
            fetch(
                &client,
                &format!("{project}/pipelines?sha={sha}&per_page=20"),
            )
            .await?
        }
        None => None,
    };
    match (statuses, pipelines) {
        (Some(statuses), Some(pipelines)) => {
            // Pipelines first: they sum up the jobs listed after them.
            result.checks = parse_pipelines(&pipelines);
            result.checks.extend(parse_statuses(&statuses));
        }
        _ => result.needs_auth = true,
    }
    Ok(result)
}

/// The JSON of one request: `Some(Null)` when the project has nothing for the commit yet, `None`
/// when it is not visible without signing in.
async fn fetch(client: &reqwest::Client, url: &str) -> AppResult<Option<Value>> {
    let (code, body) = forge::get_json(client, url, "GitLab").await?;
    match interpret(code, body) {
        Answer::Data(json) => Ok(Some(json)),
        Answer::Nothing => Ok(Some(Value::Null)),
        Answer::NeedsAuth => Ok(None),
        Answer::RateLimited => Err(AppError::Network(
            "GitLab's limit for requests without signing in was reached; try again later".into(),
        )),
        Answer::Failed(code) => Err(AppError::Network(format!(
            "GitLab answered with HTTP {code}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recorded(name: &str) -> Value {
        let text = match name {
            "statuses" => include_str!("testdata/gitlab_statuses.json"),
            "pipelines" => include_str!("testdata/gitlab_pipelines.json"),
            _ => unreachable!(),
        };
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn reads_recorded_statuses() {
        let checks = parse_statuses(&recorded("statuses"));
        let summary: Vec<(&str, &str, Option<&str>)> = checks
            .iter()
            .map(|c| (c.name.as_str(), c.status.as_str(), c.conclusion.as_deref()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("pages", "completed", Some("success")),
                ("lint", "completed", Some("neutral")),
                ("deploy:production", "completed", Some("action_required")),
                ("netlify/blog/deploy-preview", "in_progress", None),
                ("pages:deploy", "queued", None),
            ]
        );
        assert_eq!(
            checks[0].url.as_deref(),
            Some("https://gitlab.com/group/blog/-/jobs/7001")
        );
        assert_eq!(checks[4].url, None);
        assert!(parse_statuses(&Value::Null).is_empty());
    }

    #[test]
    fn reads_recorded_pipelines() {
        let checks = parse_pipelines(&recorded("pipelines"));
        assert_eq!(checks.len(), 2);
        assert_eq!(checks[0].name, "pipeline #1200 (main)");
        assert_eq!(checks[0].status, "completed");
        assert_eq!(checks[0].conclusion.as_deref(), Some("failure"));
        assert_eq!(
            checks[0].url.as_deref(),
            Some("https://gitlab.com/group/blog/-/pipelines/1200")
        );
        assert_eq!(checks[1].status, "in_progress");
        assert_eq!(checks[1].conclusion, None);
    }

    #[test]
    fn tells_private_projects_from_unknown_commits() {
        let body = |message: &str| serde_json::json!({ "message": message });
        assert_eq!(
            interpret(404, body("404 Project Not Found")),
            Answer::NeedsAuth
        );
        assert_eq!(interpret(404, Value::Null), Answer::NeedsAuth);
        assert_eq!(
            interpret(404, body("404 Commit Not Found")),
            Answer::Nothing
        );
        assert_eq!(interpret(403, body("403 Forbidden")), Answer::NeedsAuth);
        assert_eq!(interpret(401, Value::Null), Answer::NeedsAuth);
        assert_eq!(interpret(429, Value::Null), Answer::RateLimited);
        assert_eq!(interpret(500, Value::Null), Answer::Failed(500));
        assert_eq!(
            interpret(200, Value::Array(vec![])),
            Answer::Data(Value::Array(vec![]))
        );
    }
}
