//! Parsing of `hugo` console output.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
    Info,
}

/// A `file:line:col` reference found in an error message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceLocation {
    pub file: String,
    pub line: u32,
    pub column: Option<u32>,
}

static OSC_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)").unwrap());
static CSI_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").unwrap());
static READY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Web Server is available at (https?://\S+)").unwrap());
static LOCATION_RE: LazyLock<Regex> = LazyLock::new(|| {
    // Windows (C:\x\y.md) or Unix (/x/y.md) paths followed by :line[:col].
    Regex::new(r#"((?:[A-Za-z]:[\\/]|/)[^"\s:]+(?:\s[^"\s:]+)*):(\d+)(?::(\d+))?"#).unwrap()
});

/// Removes terminal escape sequences, including the OSC 9;4 progress codes Hugo prints since 0.151.
pub fn strip_control(line: &str) -> String {
    let without_osc = OSC_RE.replace_all(line, "");
    let without_csi = CSI_RE.replace_all(&without_osc, "");
    without_csi
        .chars()
        .filter(|c| !c.is_control() || *c == '\t')
        .collect()
}

pub fn classify(line: &str) -> Level {
    let trimmed = line.trim_start();
    if trimmed.starts_with("ERROR") || trimmed.starts_with("Error:") {
        Level::Error
    } else if trimmed.starts_with("WARN") {
        Level::Warn
    } else {
        Level::Info
    }
}

/// The preview URL from the line Hugo prints once the server is listening.
pub fn ready_url(line: &str) -> Option<String> {
    READY_RE.captures(line).map(|c| c[1].to_string())
}

/// True when the server could not bind its port (Hugo exits instead of choosing another port).
pub fn is_port_failure(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("server startup failed")
        || (lower.contains("listen tcp") && lower.contains("bind"))
}

pub fn source_location(line: &str) -> Option<SourceLocation> {
    let caps = LOCATION_RE.captures(line)?;
    Some(SourceLocation {
        file: caps[1].to_string(),
        line: caps[2].parse().ok()?,
        column: caps.get(3).and_then(|m| m.as_str().parse().ok()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_progress_and_colour_codes() {
        let line = "\x1b]9;4;3;0\x07Built in 35 ms\x1b[0m\x1b]9;4;0;0\x1b\\";
        assert_eq!(strip_control(line), "Built in 35 ms");
    }

    #[test]
    fn finds_ready_url() {
        let line = "Web Server is available at http://localhost:63424/ (bind address 127.0.0.1)";
        assert_eq!(ready_url(line).as_deref(), Some("http://localhost:63424/"));
        assert_eq!(ready_url("Environment: \"development\""), None);
    }

    #[test]
    fn classifies_levels() {
        assert_eq!(classify("ERROR render failed"), Level::Error);
        assert_eq!(classify("WARN  deprecated: x"), Level::Warn);
        assert_eq!(classify("Built in 12 ms"), Level::Info);
    }

    #[test]
    fn detects_port_failures() {
        assert!(is_port_failure(
            "ERROR command error: server startup failed: listen tcp 127.0.0.1:1313: bind: address already in use"
        ));
        assert!(!is_port_failure("Watching for changes in /site/content"));
    }

    #[test]
    fn extracts_source_locations() {
        let win = source_location(
            r#"ERROR "D:\Sites\blog\content\posts\a.md:12:3": failed to render shortcode"#,
        )
        .unwrap();
        assert_eq!(win.file, r"D:\Sites\blog\content\posts\a.md");
        assert_eq!((win.line, win.column), (12, Some(3)));

        let unix = source_location("ERROR /home/u/site/layouts/single.html:7: unexpected").unwrap();
        assert_eq!(unix.file, "/home/u/site/layouts/single.html");
        assert_eq!((unix.line, unix.column), (7, None));
    }
}
