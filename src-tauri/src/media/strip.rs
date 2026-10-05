//! Removing metadata without touching the pixels: the compressed image data is copied byte for
//! byte, only metadata containers are dropped. ICC profiles stay (they describe colours, not
//! people), and a non-default EXIF orientation is kept in a minimal EXIF block so the picture is
//! not shown rotated. AVIF metadata is blanked in place (see [`super::isobmff`]); AVIF keeps its
//! orientation in `irot`/`imir` properties, which stay.

use img_parts::Bytes;
use img_parts::jpeg::{Jpeg, JpegSegment, markers};
use img_parts::png::{Png, PngChunk};
use img_parts::riff::{RiffChunk, RiffContent};
use img_parts::webp::WebP;

use super::exif::{self, Exif};
use super::inspect::{
    GifBlock, JpegKind, SVG_EDITOR_ATTRIBUTE, SVG_METADATA, WEBP_KEEP, classify_jpeg, gif_blocks,
    is_app_or_comment, jfif_thumbnail, keep_png_chunk, scan_entropy,
};
use super::isobmff;
use super::sniff::Format;
use crate::error::{AppError, AppResult};

/// VP8X flag bits.
const WEBP_FLAG_EXIF: u8 = 0x08;
const WEBP_FLAG_XMP: u8 = 0x04;

/// Returns the image without its metadata. Files whose structure cannot be followed exactly are
/// refused.
pub fn strip(bytes: Bytes, format: Format) -> AppResult<Vec<u8>> {
    match format {
        Format::Jpeg => strip_jpeg(bytes),
        Format::Png => strip_png(bytes),
        Format::Webp => strip_webp(bytes),
        Format::Gif => strip_gif(&bytes),
        Format::Svg => strip_svg(&bytes),
        Format::Avif => isobmff::strip(&bytes).map_err(|e| unreadable("AVIF", e)),
    }
}

fn unreadable(format: &str, error: impl std::fmt::Display) -> AppError {
    AppError::Invalid(format!("the {format} file could not be read: {error}"))
}

/// The orientation to keep, when it is not the default.
fn kept_orientation(exif_data: Option<&[u8]>) -> Option<u16> {
    exif_data
        .and_then(Exif::parse)
        .and_then(|exif| exif.orientation())
        .filter(|&o| o != 1)
}

fn strip_jpeg(bytes: Bytes) -> AppResult<Vec<u8>> {
    let mut jpeg = Jpeg::from_bytes(bytes.clone()).map_err(|e| unreadable("JPEG", e))?;
    let orientation = kept_orientation(
        jpeg.segments()
            .iter()
            .find(|s| classify_jpeg(s.marker(), s.contents()) == JpegKind::Exif)
            .map(|s| s.contents().as_ref()),
    );
    let mut kept = Vec::with_capacity(jpeg.segments().len() + 1);
    for segment in jpeg.segments() {
        let contents = segment.contents();
        match classify_jpeg(segment.marker(), contents) {
            JpegKind::Structural | JpegKind::Icc | JpegKind::Adobe => {
                if segment.has_entropy() {
                    // The entropy-coded data runs to the end of the input.
                    let start = bytes
                        .len()
                        .saturating_sub(segment.len_with_entropy() - segment.len());
                    let entropy = clean_entropy(&bytes[start..]);
                    kept.push(JpegSegment::new_with_entropy(
                        segment.marker(),
                        contents.clone(),
                        Bytes::from(entropy),
                    ));
                } else {
                    kept.push(segment.clone());
                }
            }
            JpegKind::Jfif if jfif_thumbnail(contents) && contents.len() >= 14 => {
                let mut header = contents[..12].to_vec();
                header.extend_from_slice(&[0, 0]);
                kept.push(JpegSegment::new_with_contents(
                    markers::APP0,
                    Bytes::from(header),
                ));
            }
            JpegKind::Jfif => kept.push(segment.clone()),
            _ => {}
        }
    }
    if let Some(orientation) = orientation {
        let at = kept
            .iter()
            .take_while(|s| s.marker() == markers::APP0)
            .count();
        let mut contents = b"Exif\0\0".to_vec();
        contents.extend(exif::orientation_only(orientation));
        kept.insert(
            at,
            JpegSegment::new_with_contents(markers::APP1, Bytes::from(contents)),
        );
    }
    *jpeg.segments_mut() = kept;
    Ok(jpeg.encoder().bytes().to_vec())
}

/// Copies the scan data, leaving out metadata segments placed between scans and anything after
/// the end-of-image marker (embedded previews, motion-photo videos).
fn clean_entropy(data: &[u8]) -> Vec<u8> {
    let scan = scan_entropy(data);
    let mut out = Vec::with_capacity(scan.end);
    let mut copied = 0;
    for segment in &scan.segments {
        if !is_app_or_comment(segment.marker) {
            continue;
        }
        let kind = classify_jpeg(segment.marker, &data[segment.contents.clone()]);
        if matches!(kind, JpegKind::Icc | JpegKind::Adobe) {
            continue;
        }
        out.extend_from_slice(&data[copied..segment.whole.start]);
        copied = segment.whole.end;
    }
    out.extend_from_slice(&data[copied..scan.end]);
    out
}

fn strip_png(bytes: Bytes) -> AppResult<Vec<u8>> {
    let mut png = Png::from_bytes(bytes).map_err(|e| unreadable("PNG", e))?;
    let orientation = kept_orientation(
        png.chunk_by_type(*b"eXIf")
            .map(|chunk| chunk.contents().as_ref()),
    );
    png.chunks_mut()
        .retain(|chunk| keep_png_chunk(chunk.kind()));
    if let Some(orientation) = orientation {
        let chunks = png.chunks_mut();
        let at = chunks
            .iter()
            .position(|c| &c.kind() == b"IDAT")
            .unwrap_or(chunks.len().saturating_sub(1));
        chunks.insert(
            at,
            PngChunk::new(*b"eXIf", Bytes::from(exif::orientation_only(orientation))),
        );
    }
    Ok(png.encoder().bytes().to_vec())
}

fn strip_webp(bytes: Bytes) -> AppResult<Vec<u8>> {
    let mut webp = WebP::from_bytes(bytes).map_err(|e| unreadable("WebP", e))?;
    let orientation = kept_orientation(
        webp.chunk_by_id(*b"EXIF")
            .and_then(|chunk| chunk.content().data())
            .map(|data| data.as_ref()),
    );
    let extended = webp.has_chunk(*b"VP8X");
    webp.chunks_mut()
        .retain(|chunk| WEBP_KEEP.contains(&&chunk.id()));
    // EXIF needs the extended format; a simple WebP cannot have had any.
    if let Some(orientation) = orientation.filter(|_| extended) {
        webp.chunks_mut().push(RiffChunk::new(
            *b"EXIF",
            RiffContent::Data(Bytes::from(exif::orientation_only(orientation))),
        ));
    }
    let has_exif = webp.has_chunk(*b"EXIF");
    if let Some(vp8x) = webp
        .chunks_mut()
        .iter_mut()
        .find(|chunk| &chunk.id() == b"VP8X")
        && let RiffContent::Data(data) = vp8x.content_mut()
        && !data.is_empty()
    {
        let mut flags = data.to_vec();
        flags[0] &= !(WEBP_FLAG_EXIF | WEBP_FLAG_XMP);
        if has_exif {
            flags[0] |= WEBP_FLAG_EXIF;
        }
        *data = Bytes::from(flags);
    }
    Ok(webp.encoder().bytes().to_vec())
}

fn strip_gif(bytes: &[u8]) -> AppResult<Vec<u8>> {
    let layout =
        gif_blocks(bytes).ok_or_else(|| unreadable("GIF", "the block structure is broken"))?;
    let mut out = Vec::with_capacity(bytes.len());
    for block in &layout.blocks {
        let keep = match &block.kind {
            GifBlock::Header | GifBlock::Image | GifBlock::Trailer => true,
            // Graphic control and plain text extensions are part of the image.
            GifBlock::Extension(0xF9 | 0x01, _) => true,
            GifBlock::Extension(0xFF, Some(app)) => matches!(
                app.as_slice(),
                b"NETSCAPE2.0" | b"ANIMEXTS1.0" | b"ICCRGBG1012"
            ),
            GifBlock::Extension(..) => false,
        };
        if keep {
            out.extend_from_slice(&bytes[block.range.clone()]);
        }
    }
    Ok(out)
}

fn strip_svg(bytes: &[u8]) -> AppResult<Vec<u8>> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| AppError::Invalid("the SVG file is not UTF-8 text".into()))?;
    let without_metadata = SVG_METADATA.replace_all(text, "");
    let cleaned = SVG_EDITOR_ATTRIBUTE.replace_all(&without_metadata, "");
    Ok(cleaned.into_owned().into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_scan_data_and_drops_inline_metadata() {
        // Scan data, a COM segment between scans, a DHT segment, EOI and a trailing preview.
        let data = [
            0x11, 0xFF, 0x00, 0xFF, 0xFE, 0x00, 0x04, b'h', b'i', 0x22, 0xFF, 0xC4, 0x00, 0x03,
            0x07, 0x33, 0xFF, 0xD9, 0xFF, 0xD8, 0xFF,
        ];
        assert_eq!(
            clean_entropy(&data),
            vec![
                0x11, 0xFF, 0x00, 0x22, 0xFF, 0xC4, 0x00, 0x03, 0x07, 0x33, 0xFF, 0xD9
            ]
        );
    }

    #[test]
    fn strips_svg_editor_data() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" sodipodi:docname="C:\Users\jane\secret.svg" width="10"><metadata><rdf:RDF><cc:Work><dc:creator>Jane</dc:creator></cc:Work></rdf:RDF></metadata><rect/></svg>"#;
        let out = String::from_utf8(strip_svg(svg).unwrap()).unwrap();
        assert_eq!(
            out,
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect/></svg>"#
        );
    }

    #[test]
    fn refuses_broken_files() {
        assert!(strip(Bytes::from_static(b"\xFF\xD8\xFF"), Format::Jpeg).is_err());
        assert!(strip(Bytes::from_static(b"\x89PNG\r\n\x1a\n\0\0"), Format::Png).is_err());
        assert!(strip(Bytes::from_static(b"RIFF\xff\0\0\0WEBP"), Format::Webp).is_err());
        assert!(strip(Bytes::from_static(b"GIF89a"), Format::Gif).is_err());
        assert!(strip(Bytes::from_static(b"\0\0\0\x0cftypavif"), Format::Avif).is_err());
    }
}
