//! `hugo list all` gives every page with its status and permalink as CSV.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::short_command;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageEntry {
    /// Content path relative to the site root, with forward slashes.
    pub path: String,
    pub slug: String,
    pub title: String,
    pub date: String,
    pub expiry_date: String,
    pub publish_date: String,
    pub draft: bool,
    pub permalink: String,
    pub kind: String,
    pub section: String,
}

pub async fn list_all(hugo: &Path, site: &Path) -> AppResult<Vec<PageEntry>> {
    let output = tokio::time::timeout(
        Duration::from_secs(120),
        short_command(hugo)
            .args(["list", "all", "--noBuildLock", "--source"])
            .arg(site)
            .output(),
    )
    .await
    .map_err(|_| AppError::Hugo("`hugo list all` timed out".into()))??;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Hugo(stderr.trim().to_string()));
    }
    parse_list_csv(&String::from_utf8_lossy(&output.stdout))
}

pub fn parse_list_csv(csv: &str) -> AppResult<Vec<PageEntry>> {
    let mut rows = parse_csv(csv).into_iter();
    let header = rows.next().unwrap_or_default();
    let column = |name: &str| {
        header
            .iter()
            .position(|h| h == name)
            .ok_or_else(|| AppError::Hugo(format!("`hugo list` output has no `{name}` column")))
    };
    let path = column("path")?;
    let slug = column("slug")?;
    let title = column("title")?;
    let date = column("date")?;
    let expiry = column("expiryDate")?;
    let publish = column("publishDate")?;
    let draft = column("draft")?;
    let permalink = column("permalink")?;
    let kind = column("kind")?;
    let section = column("section")?;

    Ok(rows
        .filter(|row| row.len() == header.len())
        .map(|row| PageEntry {
            path: row[path].replace('\\', "/"),
            slug: row[slug].clone(),
            title: row[title].clone(),
            date: row[date].clone(),
            expiry_date: row[expiry].clone(),
            publish_date: row[publish].clone(),
            draft: row[draft] == "true",
            permalink: row[permalink].clone(),
            kind: row[kind].clone(),
            section: row[section].clone(),
        })
        .collect())
}

/// Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF records.
fn parse_csv(input: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    field.push('"');
                    chars.next();
                }
                '"' => in_quotes = false,
                _ => field.push(c),
            }
            continue;
        }
        match c {
            '"' => in_quotes = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            _ => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "path,slug,title,date,expiryDate,publishDate,draft,permalink,kind,section\r\n\
content\\posts\\a.md,,\"Merhaba, dünya\",2026-10-03T00:11:40+03:00,0001-01-01T00:00:00Z,2026-10-03T00:11:40+03:00,false,https://example.org/posts/a/,page,posts\r\n\
content/posts/_index.md,,\"Say \"\"hi\"\"\",0001-01-01T00:00:00Z,0001-01-01T00:00:00Z,0001-01-01T00:00:00Z,true,https://example.org/posts/,section,posts\r\n";

    #[test]
    fn parses_hugo_list_output() {
        let pages = parse_list_csv(SAMPLE).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].path, "content/posts/a.md");
        assert_eq!(pages[0].title, "Merhaba, dünya");
        assert!(!pages[0].draft);
        assert_eq!(pages[0].permalink, "https://example.org/posts/a/");
        assert_eq!(pages[1].title, "Say \"hi\"");
        assert!(pages[1].draft);
        assert_eq!(pages[1].kind, "section");
    }

    #[test]
    fn reports_unexpected_format() {
        assert!(parse_list_csv("foo,bar\n1,2\n").is_err());
    }
}
