//! Which forge hosts `origin`, so its deploy status can be read: GitHub, GitLab (gitlab.com or
//! self-hosted) or Gitea/Forgejo (Codeberg or self-hosted).
//!
//! Well-known hosts are recognised from the remote URL. For a self-hosted forge, the site sets
//! `forge = "github" | "gitlab" | "gitea"` in the `[deploy]` table of `.hugo-publisher/site.toml`.
//! Only public APIs are called, without tokens; private repositories report `needs_auth`.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};

/// The per-site settings file (also written by the deploy settings panel).
pub const SETTINGS_FILE: &str = ".hugo-publisher/site.toml";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ForgeKind {
    Github,
    Gitlab,
    /// Gitea and its fork Forgejo (Codeberg), which share the API.
    Gitea,
}

impl ForgeKind {
    pub fn name(self) -> &'static str {
        match self {
            ForgeKind::Github => "github",
            ForgeKind::Gitlab => "gitlab",
            ForgeKind::Gitea => "gitea",
        }
    }

    /// The `forge` setting: `github`, `gitlab`, `gitea` (`forgejo` and `codeberg` too).
    pub fn from_setting(value: &str) -> Option<ForgeKind> {
        match value.trim().to_ascii_lowercase().as_str() {
            "github" => Some(ForgeKind::Github),
            "gitlab" => Some(ForgeKind::Gitlab),
            "gitea" | "forgejo" | "codeberg" => Some(ForgeKind::Gitea),
            _ => None,
        }
    }
}

/// The parts of a remote URL that locate the repository on its web host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteUrl {
    /// `https`, or `http` for an http remote (ssh remotes are reached over https).
    pub scheme: String,
    /// Lower case, without user name or password.
    pub host: String,
    /// Kept for http(s) remotes only (an ssh port says nothing about the web server).
    pub port: Option<u16>,
    /// Path segments, without a trailing `.git`.
    pub path: Vec<String>,
}

fn valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Reads `https://host[:port]/a/b.git`, `ssh://git@host[:port]/a/b.git`, `git://…` and the
/// scp-like `git@host:a/b.git`. Credentials in the URL are dropped.
pub fn parse_remote_url(url: &str) -> Option<RemoteUrl> {
    let url = url.trim();
    let (scheme, keep_port, authority, path) = if let Some((scheme, rest)) = url.split_once("://") {
        let scheme = scheme.to_ascii_lowercase();
        let (web, keep_port) = match scheme.as_str() {
            "https" | "http" => (scheme.clone(), true),
            "ssh" | "git" | "git+ssh" | "ssh+git" => ("https".to_string(), false),
            _ => return None,
        };
        let (authority, path) = rest.split_once('/')?;
        let host_port = authority.rsplit('@').next()?;
        (web, keep_port, host_port.to_string(), path.to_string())
    } else {
        // scp-like: [user@]host:path
        let (host, path) = url.split_once(':')?;
        let host = host.rsplit('@').next()?;
        // `C:/x` is a Windows path, `/x` a local one.
        if host.len() < 2 || path.starts_with('/') || host.contains('/') || host.contains('\\') {
            return None;
        }
        (
            "https".to_string(),
            false,
            host.to_string(),
            path.to_string(),
        )
    };
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host.to_string(), port.parse::<u16>().ok()),
        None => (authority.clone(), None),
    };
    let host = host.to_ascii_lowercase();
    let host_ok = !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.'));
    if !host_ok {
        return None;
    }
    let mut path: Vec<String> = path
        .split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if let Some(last) = path.last_mut()
        && let Some(stripped) = last.strip_suffix(".git")
    {
        *last = stripped.to_string();
    }
    if path.len() < 2 || !path.iter().all(|s| valid_segment(s)) {
        return None;
    }
    Some(RemoteUrl {
        port: port.filter(|_| keep_port),
        scheme,
        host,
        path,
    })
}

const GITLAB_HOSTS: [&str; 7] = [
    "gitlab.com",
    "framagit.org",
    "salsa.debian.org",
    "gitlab.gnome.org",
    "invent.kde.org",
    "gitlab.freedesktop.org",
    "gitlab.archlinux.org",
];
const GITEA_HOSTS: [&str; 5] = [
    "codeberg.org",
    "gitea.com",
    "code.forgejo.org",
    "next.forgejo.org",
    "git.disroot.org",
];

/// The forge of a well-known host (or a host named `gitlab.*`, `gitea.*`, `forgejo.*`).
pub fn known_kind(host: &str) -> Option<ForgeKind> {
    let host = host.to_ascii_lowercase();
    if matches!(
        host.as_str(),
        "github.com" | "www.github.com" | "ssh.github.com"
    ) {
        return Some(ForgeKind::Github);
    }
    if GITLAB_HOSTS.contains(&host.as_str()) || host.starts_with("gitlab.") {
        return Some(ForgeKind::Gitlab);
    }
    if GITEA_HOSTS.contains(&host.as_str())
        || host.starts_with("gitea.")
        || host.starts_with("forgejo.")
    {
        return Some(ForgeKind::Gitea);
    }
    None
}

/// A repository on a forge, and where its API is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgeRepo {
    pub kind: ForgeKind,
    /// Web host, e.g. `gitlab.com`.
    pub host: String,
    /// API root without a trailing slash: `https://api.github.com`, `https://gitlab.com/api/v4`,
    /// `https://codeberg.org/api/v1`.
    pub api: String,
    /// User or group; for GitLab the whole namespace (`group/subgroup`).
    pub owner: String,
    pub repo: String,
}

impl ForgeRepo {
    /// `owner/repo` (GitLab: the full project path).
    pub fn full_path(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }
}

/// The forge repository behind a remote URL. `setting` (from `site.toml`) decides the kind for
/// hosts that are not recognised, and overrides the guess for those that are.
pub fn detect(url: &str, setting: Option<ForgeKind>) -> Option<ForgeRepo> {
    let remote = parse_remote_url(url)?;
    let kind = setting.or_else(|| known_kind(&remote.host))?;
    let host = if remote.host == "www.github.com" || remote.host == "ssh.github.com" {
        "github.com".to_string()
    } else {
        remote.host.clone()
    };
    let origin = match remote.port {
        Some(port) => format!("{}://{host}:{port}", remote.scheme),
        None => format!("{}://{host}", remote.scheme),
    };
    let n = remote.path.len();
    let (prefix, owner, repo) = match kind {
        // GitHub and Gitea: `owner/repo`; a self-hosted Gitea may live under a sub-path.
        ForgeKind::Github if n != 2 => return None,
        ForgeKind::Github | ForgeKind::Gitea => (
            remote.path[..n - 2].join("/"),
            remote.path[n - 2].clone(),
            remote.path[n - 1].clone(),
        ),
        // GitLab: groups nest, so everything before the project is the namespace.
        ForgeKind::Gitlab => (
            String::new(),
            remote.path[..n - 1].join("/"),
            remote.path[n - 1].clone(),
        ),
    };
    let base = if prefix.is_empty() {
        origin
    } else {
        format!("{origin}/{prefix}")
    };
    let api = match kind {
        ForgeKind::Github if host == "github.com" => "https://api.github.com".to_string(),
        // GitHub Enterprise Server.
        ForgeKind::Github => format!("{base}/api/v3"),
        ForgeKind::Gitlab => format!("{base}/api/v4"),
        ForgeKind::Gitea => format!("{base}/api/v1"),
    };
    Some(ForgeRepo {
        kind,
        host,
        api,
        owner,
        repo,
    })
}

/// `forge` of the `[deploy]` table in `site.toml` text (keys in any case).
pub fn setting_from_text(text: &str) -> Option<ForgeKind> {
    let doc = text.parse::<toml_edit::DocumentMut>().ok()?;
    let deploy = doc
        .as_table()
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("deploy"))?
        .1
        .as_table_like()?;
    let (_, value) = deploy
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("forge"))?;
    ForgeKind::from_setting(value.as_str()?)
}

/// The site's `forge` setting; `None` when the file or the key is missing.
pub fn read_setting(root: &Path) -> Option<ForgeKind> {
    let text = std::fs::read_to_string(root.join(SETTINGS_FILE)).ok()?;
    setting_from_text(&text)
}

/// An HTTP client for public forge APIs (no credentials are ever sent).
pub fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("HugoPublisher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))
}

/// GETs `url` and returns the status code and the JSON body (`Null` when it is not JSON).
pub async fn get_json(client: &reqwest::Client, url: &str, forge: &str) -> AppResult<(u16, Value)> {
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Network(format!("{forge} could not be reached: {e}")))?;
    let code = response.status().as_u16();
    let body = response.bytes().await.unwrap_or_default();
    Ok((code, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

/// Percent-encodes a path for use as one URL segment (GitLab project ids: `group%2Fproject`).
pub fn encode_segment(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// A string field, `None` when missing or empty.
pub fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(kind: ForgeKind, host: &str, api: &str, owner: &str, name: &str) -> Option<ForgeRepo> {
        Some(ForgeRepo {
            kind,
            host: host.into(),
            api: api.into(),
            owner: owner.into(),
            repo: name.into(),
        })
    }

    #[test]
    fn detects_known_hosts() {
        assert_eq!(
            detect("git@github.com:ali/blog.git", None),
            repo(
                ForgeKind::Github,
                "github.com",
                "https://api.github.com",
                "ali",
                "blog"
            )
        );
        assert_eq!(
            detect("ssh://git@ssh.github.com:443/ali/blog.git", None),
            repo(
                ForgeKind::Github,
                "github.com",
                "https://api.github.com",
                "ali",
                "blog"
            )
        );
        for url in [
            "https://gitlab.com/group/sub/blog.git",
            "git@gitlab.com:group/sub/blog.git",
            "ssh://git@gitlab.com:2222/group/sub/blog",
            "https://user:secret@GitLab.com/group/sub/blog/",
        ] {
            assert_eq!(
                detect(url, None),
                repo(
                    ForgeKind::Gitlab,
                    "gitlab.com",
                    "https://gitlab.com/api/v4",
                    "group/sub",
                    "blog"
                ),
                "{url}"
            );
        }
        for url in [
            "https://codeberg.org/ali/blog.git",
            "git@codeberg.org:ali/blog.git",
        ] {
            assert_eq!(
                detect(url, None),
                repo(
                    ForgeKind::Gitea,
                    "codeberg.org",
                    "https://codeberg.org/api/v1",
                    "ali",
                    "blog"
                ),
                "{url}"
            );
        }
        assert_eq!(
            detect("https://gitlab.example.org/ali/blog.git", None).map(|r| r.kind),
            Some(ForgeKind::Gitlab)
        );
        assert_eq!(
            detect("git@forgejo.example.net:ali/blog.git", None).map(|r| r.kind),
            Some(ForgeKind::Gitea)
        );
    }

    #[test]
    fn uses_the_setting_for_self_hosted_forges() {
        let url = "https://git.example.org:8443/team/blog.git";
        assert_eq!(detect(url, None), None);
        assert_eq!(
            detect(url, Some(ForgeKind::Gitlab)),
            repo(
                ForgeKind::Gitlab,
                "git.example.org",
                "https://git.example.org:8443/api/v4",
                "team",
                "blog"
            )
        );
        // Gitea under a sub-path; an ssh port is not the web port.
        assert_eq!(
            detect("http://example.org/code/team/blog", Some(ForgeKind::Gitea)),
            repo(
                ForgeKind::Gitea,
                "example.org",
                "http://example.org/code/api/v1",
                "team",
                "blog"
            )
        );
        assert_eq!(
            detect(
                "ssh://git@example.org:2222/team/blog.git",
                Some(ForgeKind::Gitea)
            )
            .map(|r| r.api),
            Some("https://example.org/api/v1".to_string())
        );
        // GitHub Enterprise Server.
        assert_eq!(
            detect("git@ghe.example.com:team/blog.git", Some(ForgeKind::Github)).map(|r| r.api),
            Some("https://ghe.example.com/api/v3".to_string())
        );
        // The setting wins over the guess.
        assert_eq!(
            detect("https://gitlab.example.org/a/b", Some(ForgeKind::Gitea)).map(|r| r.kind),
            Some(ForgeKind::Gitea)
        );
    }

    #[test]
    fn rejects_what_is_not_a_repository_url() {
        for url in [
            "",
            "D:/repos/blog.git",
            "C:\\repos\\blog",
            "/srv/git/blog.git",
            "file:///srv/git/blog.git",
            "https://gitlab.com/blog",
            "https://gitlab.com/../x",
            "https://gitlab.com/a b/c",
            "ftp://gitlab.com/a/b",
        ] {
            assert_eq!(detect(url, Some(ForgeKind::Gitlab)), None, "{url}");
        }
        assert_eq!(detect("https://github.com/a/b/c", None), None);
        assert_eq!(detect("https://example.org/a/b", None), None);
    }

    #[test]
    fn reads_the_forge_setting() {
        assert_eq!(
            setting_from_text("[deploy]\nmethod = \"push\"\nforge = \"gitlab\"\n"),
            Some(ForgeKind::Gitlab)
        );
        assert_eq!(
            setting_from_text("[Deploy]\nForge = \"Forgejo\"\n"),
            Some(ForgeKind::Gitea)
        );
        assert_eq!(
            setting_from_text("deploy = { forge = \"github\" }"),
            Some(ForgeKind::Github)
        );
        assert_eq!(setting_from_text("[deploy]\nforge = \"svn\"\n"), None);
        assert_eq!(setting_from_text("[deploy]\nforge = 3\n"), None);
        assert_eq!(setting_from_text("forge = \"gitlab\"\n"), None);
        assert_eq!(setting_from_text("not toml ["), None);
    }

    #[test]
    fn encodes_project_paths() {
        assert_eq!(
            encode_segment("group/sub/my.blog_1"),
            "group%2Fsub%2Fmy.blog_1"
        );
        assert_eq!(encode_segment("a b"), "a%20b");
    }
}
