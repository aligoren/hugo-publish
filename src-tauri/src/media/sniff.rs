//! Image formats: recognising files by their first bytes, extensions, and sizes of the formats
//! the `image` crate does not read (SVG, AVIF).

use std::sync::LazyLock;

use regex::Regex;

/// File extensions the media library lists, without dots.
pub const IMAGE_EXTENSIONS: [&str; 7] = ["jpg", "jpeg", "png", "webp", "gif", "svg", "avif"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Jpeg,
    Png,
    Webp,
    Gif,
    Svg,
    Avif,
}

impl Format {
    pub fn name(self) -> &'static str {
        match self {
            Format::Jpeg => "jpeg",
            Format::Png => "png",
            Format::Webp => "webp",
            Format::Gif => "gif",
            Format::Svg => "svg",
            Format::Avif => "avif",
        }
    }

    /// The extension used for new files.
    pub fn extension(self) -> &'static str {
        match self {
            Format::Jpeg => "jpg",
            other => other.name(),
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Format::Jpeg => "image/jpeg",
            Format::Png => "image/png",
            Format::Webp => "image/webp",
            Format::Gif => "image/gif",
            Format::Svg => "image/svg+xml",
            Format::Avif => "image/avif",
        }
    }

    pub fn from_extension(extension: &str) -> Option<Format> {
        Some(match extension.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" => Format::Jpeg,
            "png" => Format::Png,
            "webp" => Format::Webp,
            "gif" => Format::Gif,
            "svg" => Format::Svg,
            "avif" => Format::Avif,
            _ => return None,
        })
    }

    /// Formats the `image` crate decodes here.
    pub fn is_raster_decodable(self) -> bool {
        matches!(
            self,
            Format::Jpeg | Format::Png | Format::Webp | Format::Gif
        )
    }

    pub fn image_format(self) -> Option<image::ImageFormat> {
        Some(match self {
            Format::Jpeg => image::ImageFormat::Jpeg,
            Format::Png => image::ImageFormat::Png,
            Format::Webp => image::ImageFormat::WebP,
            Format::Gif => image::ImageFormat::Gif,
            Format::Svg | Format::Avif => return None,
        })
    }
}

/// Recognises an image by its content, never by its name.
pub fn sniff(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(Format::Jpeg);
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(Format::Png);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(Format::Gif);
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(Format::Webp);
    }
    if is_avif(bytes) {
        return Some(Format::Avif);
    }
    if is_svg(bytes) {
        return Some(Format::Svg);
    }
    None
}

fn is_avif(bytes: &[u8]) -> bool {
    if bytes.get(4..8) != Some(b"ftyp") {
        return false;
    }
    let size = bytes
        .get(0..4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .unwrap_or(0);
    let end = size.clamp(8, 256).min(bytes.len());
    // Major brand at 8..12, minor version at 12..16, then compatible brands.
    let brand = |b: &[u8]| b == b"avif" || b == b"avis";
    bytes.get(8..12).is_some_and(brand)
        || bytes
            .get(16..end)
            .is_some_and(|brands| brands.chunks_exact(4).any(brand))
}

fn is_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(4096)];
    let text = String::from_utf8_lossy(head);
    let text = text.trim_start_matches('\u{feff}').trim_start();
    if !text.starts_with('<') {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    lower.contains("<svg") && !lower.contains("<html")
}

static SVG_ROOT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<svg\b[^>]*>").unwrap());
static SVG_ATTR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)\s(width|height|viewBox)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap()
});

/// Width and height from the root element: `width`/`height` in px (or unitless), otherwise the
/// `viewBox` size.
pub fn svg_dimensions(text: &str) -> Option<(u32, u32)> {
    let root = SVG_ROOT.find(text)?.as_str();
    let mut width = None;
    let mut height = None;
    let mut view_box = None;
    for capture in SVG_ATTR.captures_iter(root) {
        let value = capture
            .get(2)
            .or_else(|| capture.get(3))
            .map_or("", |m| m.as_str())
            .trim();
        match &capture[1] {
            "width" => width = svg_length(value),
            "height" => height = svg_length(value),
            _ => {
                let parts: Vec<f64> = value
                    .split(|c: char| c == ',' || c.is_whitespace())
                    .filter(|p| !p.is_empty())
                    .filter_map(|p| p.parse().ok())
                    .collect();
                if let [_, _, w, h] = parts[..]
                    && w > 0.0
                    && h > 0.0
                {
                    view_box = Some((w, h));
                }
            }
        }
    }
    let (w, h) = match (width, height, view_box) {
        (Some(w), Some(h), _) => (w, h),
        (Some(w), None, Some((vw, vh))) => (w, w * vh / vw),
        (None, Some(h), Some((vw, vh))) => (h * vw / vh, h),
        (_, _, Some(size)) => size,
        _ => return None,
    };
    let round = |v: f64| (0.5..1e6).contains(&v).then(|| v.round() as u32);
    Some((round(w)?, round(h)?))
}

fn svg_length(value: &str) -> Option<f64> {
    let number = value.strip_suffix("px").unwrap_or(value).trim();
    number.parse::<f64>().ok().filter(|v| *v > 0.0)
}

/// The largest `ispe` (image spatial extents) box, which is the primary image in practice.
pub fn avif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let limit = bytes.len().min(1 << 20);
    let mut best: Option<(u32, u32)> = None;
    let mut start = 0;
    while let Some(found) = find(&bytes[start..limit], b"ispe") {
        let at = start + found;
        // Box layout: size(4) type(4) version/flags(4) width(4) height(4).
        if let Some(raw) = bytes.get(at + 8..at + 16) {
            let w = u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]);
            let h = u32::from_be_bytes([raw[4], raw[5], raw[6], raw[7]]);
            if w > 0
                && h > 0
                && best.is_none_or(|(bw, bh)| {
                    u64::from(w) * u64::from(h) > u64::from(bw) * u64::from(bh)
                })
            {
                best = Some((w, h));
            }
        }
        start = at + 4;
    }
    best
}

pub fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_formats_by_content() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(Format::Jpeg));
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n...."), Some(Format::Png));
        assert_eq!(sniff(b"GIF89a......"), Some(Format::Gif));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some(Format::Webp));
        assert_eq!(
            sniff(b"\0\0\0\x1cftypavif\0\0\0\0avifmif1miaf"),
            Some(Format::Avif)
        );
        assert_eq!(
            sniff(b"\0\0\0\x1cftypmif1\0\0\0\0mif1avifmiaf"),
            Some(Format::Avif)
        );
        assert_eq!(sniff(b"\0\0\0\x18ftypheic\0\0\0\0mif1heic"), None);
        assert_eq!(
            sniff(
                b"\xEF\xBB\xBF<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
            ),
            Some(Format::Svg)
        );
        assert_eq!(sniff(b"<!doctype html><html><svg></svg></html>"), None);
        assert_eq!(sniff(b"hello"), None);
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn reads_svg_sizes() {
        assert_eq!(
            svg_dimensions(r#"<svg width="120px" height='80' xmlns="x">"#),
            Some((120, 80))
        );
        assert_eq!(
            svg_dimensions(r#"<svg viewBox="0 0 300 150">"#),
            Some((300, 150))
        );
        assert_eq!(
            svg_dimensions(r#"<svg width="100%" viewBox="0,0,24,12" height="100%">"#),
            Some((24, 12))
        );
        assert_eq!(
            svg_dimensions(r#"<svg width="48" viewBox="0 0 24 12">"#),
            Some((48, 24))
        );
        assert_eq!(svg_dimensions("<svg>"), None);
    }

    #[test]
    fn reads_avif_sizes() {
        let mut data = b"\0\0\0\x14ispe\0\0\0\0".to_vec();
        data.extend_from_slice(&640u32.to_be_bytes());
        data.extend_from_slice(&480u32.to_be_bytes());
        data.extend_from_slice(b"\0\0\0\x14ispe\0\0\0\0\0\0\0\x10\0\0\0\x10");
        assert_eq!(avif_dimensions(&data), Some((640, 480)));
        assert_eq!(avif_dimensions(b"ispe"), None);
    }
}
