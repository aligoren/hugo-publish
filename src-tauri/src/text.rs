//! Line-ending and BOM handling, so edits never change bytes the user did not touch.

use crate::error::{AppError, AppResult};

const BOM: char = '\u{feff}';

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
    Mixed,
    /// No line break at all (single-line file).
    None,
}

pub fn detect_eol(text: &str) -> Eol {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count();
    match (crlf, lf) {
        (0, 0) => Eol::None,
        (0, _) => Eol::Lf,
        (c, l) if c == l => Eol::Crlf,
        _ => Eol::Mixed,
    }
}

/// How a text file looked on disk, so it can be written back the same way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextShape {
    pub bom: bool,
    pub eol: Eol,
}

/// Strips the BOM and converts CRLF to LF. Mixed line endings are rejected,
/// because writing such a file back would silently change lines the user did not edit.
pub fn normalize(text: &str) -> AppResult<(String, TextShape)> {
    let (bom, body) = match text.strip_prefix(BOM) {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let eol = detect_eol(body);
    let normalized = match eol {
        Eol::Mixed => return Err(AppError::MixedLineEndings),
        Eol::Crlf => body.replace("\r\n", "\n"),
        Eol::Lf | Eol::None => body.to_string(),
    };
    Ok((normalized, TextShape { bom, eol }))
}

/// Inverse of [`normalize`]. A file that had no line break keeps LF for new lines.
pub fn restore(normalized: &str, shape: TextShape) -> String {
    let body = if shape.eol == Eol::Crlf {
        normalized.replace('\n', "\r\n")
    } else {
        normalized.to_string()
    };
    if shape.bom {
        format!("{BOM}{body}")
    } else {
        body
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_line_endings() {
        assert_eq!(detect_eol("a\nb\n"), Eol::Lf);
        assert_eq!(detect_eol("a\r\nb\r\n"), Eol::Crlf);
        assert_eq!(detect_eol("a\r\nb\n"), Eol::Mixed);
        assert_eq!(detect_eol("abc"), Eol::None);
    }

    #[test]
    fn round_trips_bom_and_crlf() {
        for original in ["\u{feff}a = 1\r\nb = 2\r\n", "a = 1\nb = 2", "x", ""] {
            let (normalized, shape) = normalize(original).unwrap();
            assert!(!normalized.contains('\r'));
            assert_eq!(restore(&normalized, shape), original);
        }
    }

    #[test]
    fn rejects_mixed_line_endings() {
        assert!(matches!(
            normalize("a\r\nb\n"),
            Err(AppError::MixedLineEndings)
        ));
    }
}
