//! `git status --porcelain=v2 --branch -z` parsing and the status types sent to the UI.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GitFileKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
    Typechange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    /// Path relative to the site folder, with forward slashes, exactly as stored (no quoting).
    pub path: String,
    /// For renames and copies: the old path.
    pub orig_path: Option<String>,
    /// Porcelain v2 status letter of the index (`M`, `A`, `D`, `R`, `.` for unchanged…).
    pub index: String,
    /// Porcelain v2 status letter of the working tree.
    pub worktree: String,
    pub kind: GitFileKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    /// `None` when HEAD is detached.
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    /// The fetch URL of the upstream's remote (or `origin`), without any password in it.
    pub remote_url: Option<String>,
}

impl GitStatus {
    pub fn not_a_repo() -> Self {
        Self {
            is_repo: false,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            files: Vec::new(),
            user_name: None,
            user_email: None,
            remote_url: None,
        }
    }
}

/// What `status --porcelain=v2 --branch -z` reports.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Porcelain {
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// False in a repository without commits (`# branch.oid (initial)`).
    pub has_commits: bool,
    pub files: Vec<GitFile>,
}

/// Parses NUL-separated porcelain v2 output. Unknown or malformed records are skipped.
pub fn parse_porcelain_v2(bytes: &[u8]) -> Porcelain {
    let mut status = Porcelain {
        has_commits: true,
        ..Porcelain::default()
    };
    let mut records = bytes
        .split(|b| *b == 0)
        .map(|r| String::from_utf8_lossy(r).into_owned());
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        if let Some(header) = record.strip_prefix("# ") {
            parse_header(header, &mut status);
            continue;
        }
        let file = match record.as_bytes()[0] {
            b'1' => parse_ordinary(&record),
            b'2' => {
                let orig = records.next();
                parse_renamed(&record, orig)
            }
            b'u' => parse_unmerged(&record),
            b'?' => record
                .strip_prefix("? ")
                .filter(|p| !p.is_empty())
                .map(|path| GitFile {
                    path: path.to_string(),
                    orig_path: None,
                    index: "?".into(),
                    worktree: "?".into(),
                    kind: GitFileKind::Untracked,
                }),
            _ => None,
        };
        status.files.extend(file);
    }
    status
}

fn parse_header(header: &str, status: &mut Porcelain) {
    let (key, value) = header.split_once(' ').unwrap_or((header, ""));
    match key {
        "branch.oid" => status.has_commits = value != "(initial)",
        "branch.head" => status.branch = (value != "(detached)").then(|| value.to_string()),
        "branch.upstream" => status.upstream = Some(value.to_string()),
        "branch.ab" => {
            for part in value.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    status.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    status.behind = n.parse().unwrap_or(0);
                }
            }
        }
        _ => {}
    }
}

/// Splits `XY` into the index and worktree letters.
fn letters(xy: &str) -> Option<(String, String)> {
    let mut chars = xy.chars();
    let (x, y) = (chars.next()?, chars.next()?);
    Some((x.to_string(), y.to_string()))
}

/// `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`
fn parse_ordinary(record: &str) -> Option<GitFile> {
    let fields: Vec<&str> = record.splitn(9, ' ').collect();
    let [_, xy, _, _, _, _, _, _, path] = fields.as_slice() else {
        return None;
    };
    let (index, worktree) = letters(xy)?;
    let kind = if index == "A" && worktree != "D" {
        GitFileKind::Added
    } else if index == "D" || worktree == "D" {
        GitFileKind::Deleted
    } else if index == "T" || worktree == "T" {
        GitFileKind::Typechange
    } else {
        GitFileKind::Modified
    };
    Some(GitFile {
        path: path.to_string(),
        orig_path: None,
        index,
        worktree,
        kind,
    })
}

/// `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>`, then `<origPath>` as the next record.
fn parse_renamed(record: &str, orig: Option<String>) -> Option<GitFile> {
    let fields: Vec<&str> = record.splitn(10, ' ').collect();
    let [_, xy, _, _, _, _, _, _, score, path] = fields.as_slice() else {
        return None;
    };
    let (index, worktree) = letters(xy)?;
    let kind = if score.starts_with('C') {
        GitFileKind::Added
    } else {
        GitFileKind::Renamed
    };
    Some(GitFile {
        path: path.to_string(),
        orig_path: orig.filter(|o| !o.is_empty()),
        index,
        worktree,
        kind,
    })
}

/// `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`
fn parse_unmerged(record: &str) -> Option<GitFile> {
    let fields: Vec<&str> = record.splitn(11, ' ').collect();
    let [_, xy, _, _, _, _, _, _, _, _, path] = fields.as_slice() else {
        return None;
    };
    let (index, worktree) = letters(xy)?;
    Some(GitFile {
        path: path.to_string(),
        orig_path: None,
        index,
        worktree,
        kind: GitFileKind::Conflicted,
    })
}

/// Removes a password or token from a remote URL (`https://user:token@host/x` → `https://host/x`).
pub fn redact_remote_url(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_string();
    };
    let authority_end = rest.find('/').unwrap_or(rest.len());
    match rest[..authority_end].rfind('@') {
        Some(at) if scheme.starts_with("http") => format!("{scheme}://{}", &rest[at + 1..]),
        Some(at) => {
            // ssh://user:pass@host keeps the user name, which ssh needs, but never a password.
            let user = rest[..at].split(':').next().unwrap_or_default();
            format!("{scheme}://{user}@{}", &rest[at + 1..])
        }
        None => url.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: &str = "0123456789abcdef0123456789abcdef01234567";

    fn z(records: &[&str]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for record in records {
            bytes.extend_from_slice(record.as_bytes());
            bytes.push(0);
        }
        bytes
    }

    fn file(path: &str, kind: GitFileKind, index: &str, worktree: &str) -> GitFile {
        GitFile {
            path: path.into(),
            orig_path: None,
            index: index.into(),
            worktree: worktree.into(),
            kind,
        }
    }

    #[test]
    fn parses_branch_headers() {
        let status = parse_porcelain_v2(&z(&[
            &format!("# branch.oid {H}"),
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -13",
        ]));
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind), (2, 13));
        assert!(status.has_commits);
        assert!(status.files.is_empty());
    }

    #[test]
    fn parses_a_fresh_or_detached_repository() {
        let status = parse_porcelain_v2(&z(&["# branch.oid (initial)", "# branch.head main"]));
        assert!(!status.has_commits);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.upstream, None);

        let detached = parse_porcelain_v2(&z(&[
            &format!("# branch.oid {H}"),
            "# branch.head (detached)",
        ]));
        assert_eq!(detached.branch, None);
    }

    #[test]
    fn parses_every_record_kind_with_turkish_names_and_spaces() {
        let bytes = z(&[
            &format!("# branch.oid {H}"),
            "# branch.head yayın",
            &format!("1 .M N... 100644 100644 100644 {H} {H} içerik/ğüşıöç.md"),
            &format!("1 M. N... 100644 100644 100644 {H} {H} hugo.toml"),
            &format!("1 A. N... 000000 100644 100644 {H} {H} content/yeni yazı.md"),
            &format!("1 AM N... 000000 100644 100644 {H} {H} content/eklendi sonra değişti.md"),
            &format!("1 .D N... 100644 100644 000000 {H} {H} static/eski.png"),
            &format!("1 D. N... 100644 000000 000000 {H} {H} content/silindi.md"),
            &format!("1 .T N... 100644 100644 120000 {H} {H} layouts/link.html"),
            &format!("2 R. N... 100644 100644 100644 {H} {H} R100 content/yeni ad.md"),
            "content/eski ad.md",
            &format!("2 RM N... 100644 100644 100644 {H} {H} R87 içerik/taşındı.md"),
            "içerik/burada.md",
            &format!("u UU N... 100644 100644 100644 100644 {H} {H} {H} content/çakışma.md"),
            &format!("u AA N... 000000 100644 100644 100644 {H} {H} {H} iki taraf.md"),
            "? içerik/ğ ü ş.md",
            "! public/index.html",
        ]);
        let status = parse_porcelain_v2(&bytes);
        assert_eq!(status.branch.as_deref(), Some("yayın"));
        let mut renamed = file("content/yeni ad.md", GitFileKind::Renamed, "R", ".");
        renamed.orig_path = Some("content/eski ad.md".into());
        let mut moved = file("içerik/taşındı.md", GitFileKind::Renamed, "R", "M");
        moved.orig_path = Some("içerik/burada.md".into());
        assert_eq!(
            status.files,
            vec![
                file("içerik/ğüşıöç.md", GitFileKind::Modified, ".", "M"),
                file("hugo.toml", GitFileKind::Modified, "M", "."),
                file("content/yeni yazı.md", GitFileKind::Added, "A", "."),
                file(
                    "content/eklendi sonra değişti.md",
                    GitFileKind::Added,
                    "A",
                    "M"
                ),
                file("static/eski.png", GitFileKind::Deleted, ".", "D"),
                file("content/silindi.md", GitFileKind::Deleted, "D", "."),
                file("layouts/link.html", GitFileKind::Typechange, ".", "T"),
                renamed,
                moved,
                file("content/çakışma.md", GitFileKind::Conflicted, "U", "U"),
                file("iki taraf.md", GitFileKind::Conflicted, "A", "A"),
                file("içerik/ğ ü ş.md", GitFileKind::Untracked, "?", "?"),
            ]
        );
    }

    #[test]
    fn copies_are_reported_as_added_with_their_source() {
        let status = parse_porcelain_v2(&z(&[
            &format!("2 C. N... 100644 100644 100644 {H} {H} C75 b.md"),
            "a.md",
        ]));
        assert_eq!(status.files[0].kind, GitFileKind::Added);
        assert_eq!(status.files[0].orig_path.as_deref(), Some("a.md"));
    }

    #[test]
    fn ignores_garbage() {
        let status = parse_porcelain_v2(b"\0\0weird\x001 broken\0? \0u UU\0");
        assert!(status.files.is_empty());
        assert!(parse_porcelain_v2(b"").files.is_empty());
    }

    #[test]
    fn serializes_like_the_typescript_contract() {
        let mut renamed = file("b.md", GitFileKind::Renamed, "R", ".");
        renamed.orig_path = Some("a.md".into());
        let json = serde_json::to_value(&renamed).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"path": "b.md", "origPath": "a.md", "index": "R", "worktree": ".", "kind": "renamed"})
        );
        let status = serde_json::to_value(GitStatus::not_a_repo()).unwrap();
        assert_eq!(status["isRepo"], false);
        assert!(status["remoteUrl"].is_null());
    }

    #[test]
    fn redacts_credentials_in_remote_urls() {
        for (url, expected) in [
            (
                "https://user:ghp_secret@github.com/a/b.git",
                "https://github.com/a/b.git",
            ),
            ("https://github.com/a/b.git", "https://github.com/a/b.git"),
            ("git@github.com:a/b.git", "git@github.com:a/b.git"),
            (
                "ssh://git:pw@example.org/a/b.git",
                "ssh://git@example.org/a/b.git",
            ),
            ("D:/repos/site.git", "D:/repos/site.git"),
        ] {
            assert_eq!(redact_remote_url(url), expected);
        }
    }
}
