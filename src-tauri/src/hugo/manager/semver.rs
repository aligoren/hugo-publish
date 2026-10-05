//! Plain `major.minor.patch` versions, as Hugo uses them in release tags (`v0.167.0`).

use std::cmp::Ordering;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Semver {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl Semver {
    pub const fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }

    /// Accepts `0.167.0` and `v0.167.0`. Anything else (pre-release suffixes, spaces, leading
    /// zeros, missing parts) is refused, so a parsed version is always safe in a path or URL.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.strip_prefix('v').unwrap_or(text);
        let mut parts = text.split('.');
        let major = number(parts.next()?)?;
        let minor = number(parts.next()?)?;
        let patch = number(parts.next()?)?;
        if parts.next().is_some() {
            return None;
        }
        Some(Self::new(major, minor, patch))
    }
}

impl fmt::Display for Semver {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

fn number(text: &str) -> Option<u32> {
    let digits_only = !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    let leading_zero = text.len() > 1 && text.starts_with('0');
    if !digits_only || leading_zero {
        return None;
    }
    text.parse().ok()
}

/// Compares two version strings; `None` when either one is not a plain version.
pub fn compare_versions(a: &str, b: &str) -> Option<Ordering> {
    Some(Semver::parse(a)?.cmp(&Semver::parse(b)?))
}
