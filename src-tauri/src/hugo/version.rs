use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

/// Parsed `hugo version` output, e.g.
/// `hugo v0.167.0-3fff6fb5…+extended windows/amd64 BuildDate=2026-09-28T14:50:38Z VendorInfo=gohugoio`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HugoVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub extended: bool,
    pub with_deploy: bool,
    pub os: String,
    pub arch: String,
}

impl HugoVersion {
    pub fn display(&self) -> String {
        format!("{}.{}.{}", self.major, self.minor, self.patch)
    }

    pub fn at_least(&self, major: u32, minor: u32, patch: u32) -> bool {
        (self.major, self.minor, self.patch) >= (major, minor, patch)
    }
}

static VERSION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"hugo v(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z]+)?((?:\+\w+)*) (\w+)/(\w+)").unwrap()
});

pub fn parse_version(output: &str) -> Option<HugoVersion> {
    let caps = VERSION_RE.captures(output)?;
    let flags = caps.get(4).map_or("", |m| m.as_str());
    Some(HugoVersion {
        major: caps[1].parse().ok()?,
        minor: caps[2].parse().ok()?,
        patch: caps[3].parse().ok()?,
        extended: flags.split('+').any(|f| f == "extended"),
        with_deploy: flags.split('+').any(|f| f == "withdeploy"),
        os: caps[5].to_string(),
        arch: caps[6].to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_extended_release() {
        let v = parse_version(
            "hugo v0.167.0-3fff6fb5c267dacb26280c78dbe8c344054249c8+extended windows/amd64 BuildDate=2026-09-28T14:50:38Z VendorInfo=gohugoio",
        )
        .unwrap();
        assert_eq!(v.display(), "0.167.0");
        assert!(v.extended);
        assert!(!v.with_deploy);
        assert_eq!((v.os.as_str(), v.arch.as_str()), ("windows", "amd64"));
        assert!(v.at_least(0, 158, 0));
        assert!(!v.at_least(0, 168, 0));
    }

    #[test]
    fn parses_standard_and_deploy_editions() {
        let v = parse_version("hugo v0.160.1+extended+withdeploy linux/arm64 BuildDate=unknown")
            .unwrap();
        assert!(v.extended && v.with_deploy);
        let v = parse_version("hugo v0.153.0 darwin/arm64 BuildDate=2025-12-19").unwrap();
        assert!(!v.extended);
        assert_eq!(v.arch, "arm64");
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_version("command not found").is_none());
    }
}
