//! Content hashes of theme files for `.hugo-publisher/theme.lock.json`.
//!
//! Text files are hashed with line endings normalised (a leading BOM dropped, CRLF and lone CR
//! read as LF), so a CRLF checkout does not count as an edit; this matches the app's earlier
//! TypeScript hashes of text files. A file with a NUL byte in its first 8000 bytes is binary
//! (git's rule) and is hashed byte for byte. Files are read in chunks, never whole.

use std::fs;
use std::io::Read;
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::AppResult;
use crate::site;

/// Bytes inspected for a NUL byte to tell binary files from text.
const SNIFF_BYTES: usize = 8000;
const CHUNK: usize = 64 * 1024;
/// Upper bound on paths per call, so one request cannot keep the app busy forever.
pub const MAX_HASHED_FILES: usize = 50_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHash {
    /// The path as given (forward slashes).
    pub path: String,
    /// Lower-case hex SHA-256 (of the normalised text for text files).
    pub sha256: String,
    /// Size on disk in bytes.
    pub size: u64,
}

/// Feeds bytes to the hasher, turning CRLF and lone CR into LF across chunk boundaries.
struct Normalizer {
    pending_cr: bool,
}

impl Normalizer {
    fn feed(&mut self, hasher: &mut Sha256, bytes: &[u8]) {
        let mut out = Vec::with_capacity(bytes.len());
        for &b in bytes {
            if self.pending_cr {
                self.pending_cr = false;
                if b == b'\n' {
                    continue;
                }
            }
            if b == b'\r' {
                out.push(b'\n');
                self.pending_cr = true;
            } else {
                out.push(b);
            }
        }
        hasher.update(&out);
    }
}

/// Hash and size of one file (see the module docs for text normalisation).
pub fn hash_file(path: &Path) -> AppResult<(String, u64)> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK];
    let mut size = 0u64;
    // Fill the first chunk far enough to decide text or binary.
    let mut first = 0;
    while first < SNIFF_BYTES.min(CHUNK) {
        let read = file.read(&mut buffer[first..])?;
        if read == 0 {
            break;
        }
        first += read;
    }
    size += first as u64;
    let head = &buffer[..first];
    let binary = head[..head.len().min(SNIFF_BYTES)].contains(&0);
    let mut normalizer = (!binary).then_some(Normalizer { pending_cr: false });
    let head = if !binary {
        head.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(head)
    } else {
        head
    };
    match normalizer.as_mut() {
        Some(n) => n.feed(&mut hasher, head),
        None => hasher.update(head),
    }
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size += read as u64;
        match normalizer.as_mut() {
            Some(n) => n.feed(&mut hasher, &buffer[..read]),
            None => hasher.update(&buffer[..read]),
        }
    }
    let hex = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok((hex, size))
}

/// Hashes files given relative to `root` (each path checked like [`site::resolve`]). Paths that
/// do not exist or are folders are left out of the result; a path leaving `root` is an error.
pub fn hash_files(root: &Path, paths: &[String]) -> AppResult<Vec<FileHash>> {
    if paths.len() > MAX_HASHED_FILES {
        return Err(crate::error::AppError::Invalid(format!(
            "too many files to hash at once ({})",
            paths.len()
        )));
    }
    let mut out = Vec::with_capacity(paths.len());
    for relative in paths {
        let path = site::resolve(root, relative)?;
        if !path.is_file() {
            continue;
        }
        let (sha256, size) = hash_file(&path)?;
        out.push(FileHash {
            path: relative.replace('\\', "/"),
            sha256,
            size,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn normalises_text_and_keeps_binary_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let root = &crate::hugo::mounts::canonical(dir.path()).unwrap();
        fs::write(root.join("lf.html"), "a\nb\n").unwrap();
        fs::write(root.join("crlf.html"), "\u{feff}a\r\nb\r\n").unwrap();
        fs::write(root.join("cr.html"), "a\rb\r").unwrap();
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
        fs::write(root.join("x.png"), png).unwrap();
        let paths: Vec<String> = ["lf.html", "crlf.html", "cr.html", "x.png", "missing.txt"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let hashes = hash_files(root, &paths).unwrap();
        assert_eq!(hashes.len(), 4);
        let text = sha(b"a\nb\n");
        assert_eq!(hashes[0].sha256, text);
        assert_eq!(hashes[1].sha256, text);
        assert_eq!(hashes[2].sha256, text);
        assert_eq!(hashes[1].size, 9);
        assert_eq!(hashes[3].sha256, sha(png));
        assert_eq!(hashes[3].size, png.len() as u64);
    }

    #[test]
    fn handles_crlf_split_across_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let mut text = "x".repeat(CHUNK - 1);
        text.push_str("\r\nend\r\n");
        fs::write(dir.path().join("big.css"), &text).unwrap();
        let (hash, size) = hash_file(&dir.path().join("big.css")).unwrap();
        assert_eq!(size, text.len() as u64);
        assert_eq!(hash, sha(text.replace("\r\n", "\n").as_bytes()));
    }

    #[test]
    fn refuses_paths_outside_the_root() {
        let dir = tempfile::tempdir().unwrap();
        assert!(hash_files(dir.path(), &["../x".to_string()]).is_err());
    }
}
