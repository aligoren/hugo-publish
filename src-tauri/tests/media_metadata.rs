//! Metadata detection, details and stripping on real (tiny) JPEG, PNG, WebP, GIF and SVG files.

mod media_support;

use std::fs;

use hugo_publisher_lib::error::AppError;
use hugo_publisher_lib::media::exif::Exif;
use hugo_publisher_lib::media::inspect::{self, exif_block};
use hugo_publisher_lib::media::library;
use hugo_publisher_lib::media::sniff::Format;
use img_parts::Bytes;
use media_support::*;

fn read(root: &std::path::Path, relative: &str) -> Vec<u8> {
    fs::read(root.join(relative)).unwrap()
}

fn assert_close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
}

#[test]
fn detects_gps_camera_and_orientation_in_jpeg() {
    let dir = site();
    let original = with_jpeg_exif(&jpeg(40, 20), camera_exif(6));
    write(dir.path(), "static/images/photo.jpg", &original);

    let listed = library::list(dir.path()).unwrap();
    assert_eq!(listed.len(), 1);
    let file = &listed[0];
    assert_eq!(file.path, "static/images/photo.jpg");
    assert_eq!(file.format.as_deref(), Some("jpeg"));
    assert!(file.has_gps && file.has_metadata);
    // Orientation 6 shows the 40×20 pixels as a 20×40 picture.
    assert_eq!((file.width, file.height), (Some(20), Some(40)));
    assert_eq!(file.size, original.len() as u64);

    let details = library::details(dir.path(), "static/images/photo.jpg").unwrap();
    let gps = details.gps.expect("coordinates");
    assert_close(gps.lat, LAT);
    assert_close(gps.lon, LON);
    assert_eq!(details.camera.as_deref(), Some("Canon EOS R6"));
    assert_eq!(
        details.taken_at.as_deref(),
        Some("2026-10-03 12:34:56+03:00")
    );
    let entry = |group: &str, key: &str| {
        details
            .entries
            .iter()
            .find(|e| e.group == group && e.key == key)
            .map(|e| e.value.clone())
    };
    assert_eq!(entry("EXIF", "Artist").as_deref(), Some("Gizli Yazar"));
    assert_eq!(
        entry("EXIF", "Camera serial number").as_deref(),
        Some("012345678901")
    );
    assert_eq!(
        entry("EXIF", "Orientation").as_deref(),
        Some("Rotated 90° clockwise")
    );
    assert_eq!(entry("GPS", "Latitude").as_deref(), Some("41.010000°"));
    assert_eq!(entry("GPS", "Latitude reference").as_deref(), Some("N"));
}

#[test]
fn strips_jpeg_without_touching_pixels_and_keeps_orientation_and_icc() {
    let dir = site();
    let base = with_jpeg_icc(&jpeg(32, 24), icc_profile("Test RGB"));
    let mut original = with_jpeg_exif(&base, camera_exif(6));
    original = with_jpeg_segment(
        &original,
        APP1,
        jpeg_xmp(&xmp_packet(
            r#"exif:GPSLatitude="41,0.6N" exif:GPSLongitude="28,58.5E""#,
        )),
    );
    original = with_jpeg_segment(
        &original,
        APP13,
        jpeg_iptc(&[(80, "Jane"), (90, "İstanbul")]),
    );
    original = with_jpeg_segment(&original, COM, b"shot on my phone".to_vec());
    write(dir.path(), "content/posts/x/cover.jpg", &original);

    let before = library::details(dir.path(), "content/posts/x/cover.jpg").unwrap();
    let groups: Vec<&str> = before.entries.iter().map(|e| e.group.as_str()).collect();
    for group in ["EXIF", "GPS", "XMP", "IPTC", "ICC", "Comment"] {
        assert!(groups.contains(&group), "{group} missing from {groups:?}");
    }

    let cleaned = library::strip_file(dir.path(), "content/posts/x/cover.jpg").unwrap();
    assert!(!cleaned.has_gps);
    assert!(!cleaned.has_metadata);
    assert_eq!((cleaned.width, cleaned.height), (Some(24), Some(32)));

    let stripped = read(dir.path(), "content/posts/x/cover.jpg");
    assert!(stripped.len() < original.len());
    // Same compressed data, same decoded pixels.
    assert_eq!(jpeg_scan(&stripped), jpeg_scan(&original));
    assert_eq!(pixels(&stripped), pixels(&original));
    // Only the orientation is left in EXIF.
    let block = exif_block(&Bytes::from(stripped.clone()), Format::Jpeg).expect("minimal EXIF");
    let exif = Exif::parse(&block).unwrap();
    assert_eq!(exif.orientation(), Some(6));
    assert_eq!(exif.fields.len(), 1);
    // The colour profile stays.
    let after = library::details(dir.path(), "content/posts/x/cover.jpg").unwrap();
    assert!(after.gps.is_none() && after.camera.is_none() && after.taken_at.is_none());
    let left: Vec<(&str, &str)> = after
        .entries
        .iter()
        .map(|e| (e.group.as_str(), e.value.as_str()))
        .collect();
    assert_eq!(
        left,
        vec![("EXIF", "Rotated 90° clockwise"), ("ICC", "Test RGB")]
    );
    // Cleaning again changes nothing.
    library::strip_file(dir.path(), "content/posts/x/cover.jpg").unwrap();
    assert_eq!(read(dir.path(), "content/posts/x/cover.jpg"), stripped);
}

#[test]
fn removes_exif_entirely_when_orientation_is_normal() {
    let dir = site();
    let original = with_jpeg_exif(&jpeg(16, 16), camera_exif(1));
    write(dir.path(), "static/a.jpg", &original);
    library::strip_file(dir.path(), "static/a.jpg").unwrap();
    let stripped = read(dir.path(), "static/a.jpg");
    assert!(exif_block(&Bytes::from(stripped.clone()), Format::Jpeg).is_none());
    assert_eq!(pixels(&stripped), pixels(&original));
}

#[test]
fn finds_location_in_xmp_only() {
    let dir = site();
    let original = with_jpeg_segment(
        &jpeg(8, 8),
        APP1,
        jpeg_xmp(&xmp_packet(
            r#"exif:GPSLatitude="41,0.6N" exif:GPSLongitude="28,58.5W""#,
        )),
    );
    write(dir.path(), "assets/images/xmp.jpg", &original);
    let details = library::details(dir.path(), "assets/images/xmp.jpg").unwrap();
    let gps = details.gps.unwrap();
    assert_close(gps.lat, 41.01);
    assert_close(gps.lon, -28.975);
    assert!(details.file.has_gps);
    assert!(details.entries.iter().any(|e| e.key == "xmp:CreatorTool"));
}

#[test]
fn finds_and_drops_embedded_preview_images() {
    let dir = site();
    // Phones append previews (MPF) after the main image; they carry their own EXIF.
    let mut original = jpeg(16, 16);
    original.extend(with_jpeg_exif(&jpeg(8, 8), camera_exif(1)));
    write(dir.path(), "static/mpf.jpg", &original);

    let details = library::details(dir.path(), "static/mpf.jpg").unwrap();
    assert!(details.gps.is_some(), "location in the embedded image");
    assert!(
        details
            .entries
            .iter()
            .any(|e| e.key == "Data after the image")
    );

    let cleaned = library::strip_file(dir.path(), "static/mpf.jpg").unwrap();
    assert!(!cleaned.has_gps && !cleaned.has_metadata);
    let stripped = read(dir.path(), "static/mpf.jpg");
    assert_eq!(stripped, jpeg(16, 16));
}

#[test]
fn strips_png_text_time_and_exif_chunks() {
    let dir = site();
    let mut original = png(12, 10);
    original = png_chunk(&original, b"eXIf", &camera_exif(3), true);
    original = png_chunk(&original, b"tEXt", b"Author\0Gizli Yazar", true);
    original = png_chunk(
        &original,
        b"iTXt",
        format!("XML:com.adobe.xmp\0\0\0\0\0{}", xmp_packet("")).as_bytes(),
        true,
    );
    original = png_chunk(&original, b"tIME", &[0x07, 0xEA, 10, 3, 12, 34, 56], false);
    original = png_chunk(
        &original,
        b"pHYs",
        &[0, 0, 0x0B, 0x13, 0, 0, 0x0B, 0x13, 1],
        true,
    );
    write(dir.path(), "static/shot.png", &original);

    let details = library::details(dir.path(), "static/shot.png").unwrap();
    assert!(details.gps.is_some());
    let find = |key: &str| {
        details
            .entries
            .iter()
            .find(|e| e.key == key)
            .map(|e| e.value.clone())
    };
    assert_eq!(find("Author").as_deref(), Some("Gizli Yazar"));
    assert_eq!(
        find("Last modified").as_deref(),
        Some("2026-10-03 12:34:56 UTC")
    );
    assert_eq!(find("xmp:CreatorTool").as_deref(), Some("Lightroom"));

    let cleaned = library::strip_file(dir.path(), "static/shot.png").unwrap();
    assert!(!cleaned.has_gps && !cleaned.has_metadata);
    let stripped = read(dir.path(), "static/shot.png");
    assert_eq!(
        png_chunk_kinds(&stripped),
        vec!["IHDR", "pHYs", "eXIf", "IDAT", "IEND"]
    );
    assert_eq!(
        png_chunk_data(&stripped, b"IDAT"),
        png_chunk_data(&original, b"IDAT")
    );
    assert_eq!(pixels(&stripped), pixels(&original));
    let exif = Exif::parse(&png_chunk_data(&stripped, b"eXIf")[0]).unwrap();
    assert_eq!(exif.orientation(), Some(3));
    assert!(exif.is_orientation_only());
}

#[test]
fn reads_imagemagick_exif_profiles_in_png_text() {
    let dir = site();
    let tiff = camera_exif(1);
    let mut text = format!("\nexif\n{:>8}\n", tiff.len() + 6);
    for byte in b"Exif\0\0".iter().chain(&tiff) {
        text.push_str(&format!("{byte:02x}"));
    }
    let mut chunk = b"Raw profile type exif\0".to_vec();
    chunk.extend_from_slice(text.as_bytes());
    write(
        dir.path(),
        "static/magick.png",
        &png_chunk(&png(4, 4), b"tEXt", &chunk, true),
    );
    let details = library::details(dir.path(), "static/magick.png").unwrap();
    assert!(details.gps.is_some());
    library::strip_file(dir.path(), "static/magick.png").unwrap();
    assert!(
        !library::details(dir.path(), "static/magick.png")
            .unwrap()
            .file
            .has_gps
    );
}

#[test]
fn strips_webp_exif_and_xmp() {
    let dir = site();
    let mut original = with_webp_exif(&webp(10, 6), camera_exif(8));
    {
        use img_parts::riff::{RiffChunk, RiffContent};
        use img_parts::webp::WebP;
        let mut image = WebP::from_bytes(Bytes::from(original.clone())).unwrap();
        image.chunks_mut().push(RiffChunk::new(
            *b"XMP ",
            RiffContent::Data(Bytes::from(xmp_packet(""))),
        ));
        original = image.encoder().bytes().to_vec();
    }
    write(dir.path(), "static/w.webp", &original);
    let details = library::details(dir.path(), "static/w.webp").unwrap();
    assert!(details.gps.is_some());
    assert_eq!(
        (details.file.width, details.file.height),
        (Some(6), Some(10))
    );

    let cleaned = library::strip_file(dir.path(), "static/w.webp").unwrap();
    assert!(!cleaned.has_gps && !cleaned.has_metadata);
    let stripped = read(dir.path(), "static/w.webp");
    assert_eq!(webp_chunk_ids(&stripped), vec!["VP8X", "VP8L", "EXIF"]);
    assert_eq!(pixels(&stripped), pixels(&original));
    let block = exif_block(&Bytes::from(stripped.clone()), Format::Webp).unwrap();
    assert_eq!(Exif::parse(&block).unwrap().orientation(), Some(8));
}

#[test]
fn strips_gif_comments() {
    let dir = site();
    let mut original = gif(6, 4);
    // A comment extension right before the trailer.
    let trailer = original.pop().unwrap();
    original.extend_from_slice(&[0x21, 0xFE, 5]);
    original.extend_from_slice(b"hello");
    original.extend_from_slice(&[0, trailer]);
    write(dir.path(), "static/a.gif", &original);
    let details = library::details(dir.path(), "static/a.gif").unwrap();
    assert!(
        details
            .entries
            .iter()
            .any(|e| e.group == "Comment" && e.value == "hello")
    );
    let cleaned = library::strip_file(dir.path(), "static/a.gif").unwrap();
    assert!(!cleaned.has_metadata);
    assert_eq!(read(dir.path(), "static/a.gif"), gif(6, 4));
}

#[test]
fn strips_svg_editor_metadata() {
    let dir = site();
    let svg = r#"<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12" sodipodi:docname="C:\Users\jane\Desktop\logo.svg">
  <metadata><rdf:RDF><cc:Work><dc:creator><cc:Agent><dc:title>Jane Doe</dc:title></cc:Agent></dc:creator></cc:Work></rdf:RDF></metadata>
  <rect width="24" height="12"/>
</svg>"#;
    write(dir.path(), "assets/logo.svg", svg.as_bytes());
    let details = library::details(dir.path(), "assets/logo.svg").unwrap();
    assert_eq!(details.file.format.as_deref(), Some("svg"));
    assert_eq!(
        (details.file.width, details.file.height),
        (Some(24), Some(12))
    );
    assert!(details.file.has_metadata);
    assert!(details.entries.iter().any(|e| e.value.contains("Jane Doe")));
    assert!(
        details
            .entries
            .iter()
            .any(|e| e.value.contains(r"C:\Users\jane"))
    );

    library::strip_file(dir.path(), "assets/logo.svg").unwrap();
    let cleaned = String::from_utf8(read(dir.path(), "assets/logo.svg")).unwrap();
    assert!(!cleaned.contains("metadata") && !cleaned.contains("docname"));
    assert!(cleaned.contains(r#"<rect width="24" height="12"/>"#));
}

#[test]
fn survives_broken_files() {
    let dir = site();
    let mut truncated = with_jpeg_exif(&jpeg(16, 16), camera_exif(1));
    truncated.truncate(40);
    write(dir.path(), "static/broken.jpg", &truncated);
    write(dir.path(), "static/fake.png", b"this is text");
    write(dir.path(), "static/empty.webp", b"");

    let listed = library::list(dir.path()).unwrap();
    assert_eq!(listed.len(), 3);
    let fake = listed.iter().find(|f| f.path == "static/fake.png").unwrap();
    assert_eq!(fake.format.as_deref(), Some("other"));
    assert_eq!(fake.width, None);

    library::details(dir.path(), "static/broken.jpg").unwrap();
    assert!(library::strip_file(dir.path(), "static/broken.jpg").is_err());
    assert_eq!(
        read(dir.path(), "static/broken.jpg"),
        truncated,
        "left unchanged"
    );
    assert!(library::strip_file(dir.path(), "static/fake.png").is_err());

    // Corrupting any byte of a metadata-rich JPEG never panics.
    let rich = with_jpeg_segment(
        &with_jpeg_exif(&jpeg(8, 8), camera_exif(6)),
        APP13,
        jpeg_iptc(&[(80, "Jane")]),
    );
    let mut gif_with_comment = gif(4, 4);
    let trailer = gif_with_comment.pop().unwrap();
    gif_with_comment.extend_from_slice(&[0x21, 0xFE, 2, b'h', b'i', 0, trailer]);
    let samples = [
        (rich, Format::Jpeg),
        (with_webp_exif(&webp(6, 6), camera_exif(6)), Format::Webp),
        (gif_with_comment, Format::Gif),
    ];
    for (sample, format) in samples {
        for i in 0..sample.len().min(1500) {
            for flip in [0xFF, 0x80, 0x01] {
                let mut corrupt = sample.clone();
                corrupt[i] ^= flip;
                let bytes = Bytes::from(corrupt);
                let _ = inspect::inspect(&bytes, format, true);
                let _ = inspect::inspect(&bytes, format, false);
                let _ = hugo_publisher_lib::media::strip::strip(bytes, format);
            }
        }
    }
}

#[test]
fn refuses_paths_outside_the_media_folders() {
    let dir = site();
    write(dir.path(), "layouts/partials/logo.png", &png(2, 2));
    write(dir.path(), "content/post.md", b"---\ntitle: x\n---\n");
    assert!(matches!(
        library::details(dir.path(), "../outside.png"),
        Err(AppError::PathOutsideSite(_))
    ));
    assert!(library::strip_file(dir.path(), "layouts/partials/logo.png").is_err());
    assert!(library::strip_file(dir.path(), "content/post.md").is_err());
    assert!(library::list(dir.path()).unwrap().is_empty());
}
