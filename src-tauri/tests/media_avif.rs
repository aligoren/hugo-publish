//! AVIF metadata: finding EXIF and XMP items through `iinf`/`iloc`, and blanking them in place
//! without moving or changing a single byte of the image. The files are built box by box.

mod media_support;

use std::fs;

use hugo_publisher_lib::media::inspect;
use hugo_publisher_lib::media::isobmff;
use hugo_publisher_lib::media::library;
use hugo_publisher_lib::media::sniff::Format;
use hugo_publisher_lib::media::strip;
use img_parts::Bytes;
use media_support::*;

fn find(haystack: &[u8], needle: &[u8]) -> usize {
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
        .expect("present")
}

fn assert_close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
}

const GPS_XMP: &str = r#"exif:GPSLatitude="41,0.6N" exif:GPSLongitude="28,58.5E""#;

fn rich_items(in_idat: bool) -> Vec<AvifItem> {
    vec![
        AvifItem::new(1, b"av01", av1_data(300)),
        AvifItem {
            in_idat,
            ..AvifItem::exif(2, camera_exif(1))
        },
        AvifItem {
            in_idat,
            ..AvifItem::xmp(3, &xmp_packet(GPS_XMP))
        },
    ]
}

/// Byte positions where two equally long files differ.
fn differences(a: &[u8], b: &[u8]) -> Vec<usize> {
    assert_eq!(a.len(), b.len(), "same length");
    (0..a.len()).filter(|&i| a[i] != b[i]).collect()
}

fn metadata_groups(path: &std::path::Path, relative: &str) -> Vec<String> {
    library::details(path, relative)
        .unwrap()
        .entries
        .into_iter()
        .map(|e| e.group)
        .filter(|g| g != "ICC")
        .collect()
}

#[test]
fn finds_and_blanks_exif_and_xmp_items() {
    let dir = site();
    let items = rich_items(false);
    let original = avif(64, 48, &items, &[]);
    write(dir.path(), "static/photo.avif", &original);

    let listed = library::list(dir.path()).unwrap();
    assert_eq!(listed[0].format.as_deref(), Some("avif"));
    assert!(listed[0].has_gps && listed[0].has_metadata);
    assert_eq!((listed[0].width, listed[0].height), (Some(64), Some(48)));

    let details = library::details(dir.path(), "static/photo.avif").unwrap();
    let gps = details.gps.expect("coordinates from the EXIF item");
    assert_close(gps.lat, LAT);
    assert_close(gps.lon, LON);
    assert_eq!(details.camera.as_deref(), Some("Canon EOS R6"));
    assert!(
        details
            .entries
            .iter()
            .any(|e| e.group == "EXIF" && e.key == "Artist")
    );
    assert!(details.entries.iter().any(|e| e.key == "xmp:CreatorTool"));

    let cleaned = library::strip_file(dir.path(), "static/photo.avif").unwrap();
    assert!(!cleaned.has_gps && !cleaned.has_metadata);
    assert_eq!((cleaned.width, cleaned.height), (Some(64), Some(48)));
    let stripped = fs::read(dir.path().join("static/photo.avif")).unwrap();

    // Only the two payloads and the two item types changed; the image bytes stay in place.
    let image_at = find(&original, &items[0].data);
    assert_eq!(
        &stripped[image_at..image_at + items[0].data.len()],
        items[0].data.as_slice()
    );
    let exif_at = find(&original, &items[1].data);
    let xmp_at = find(&original, &items[2].data);
    let exif_type = find(&original, b"Exif\0");
    let xmp_type = find(&original, b"mime\0");
    let allowed = |i: usize| {
        (exif_at..exif_at + items[1].data.len()).contains(&i)
            || (xmp_at..xmp_at + items[2].data.len()).contains(&i)
            || (exif_type..exif_type + 4).contains(&i)
            || (xmp_type..xmp_type + 4).contains(&i)
    };
    let changed = differences(&original, &stripped);
    assert!(!changed.is_empty());
    assert!(changed.iter().all(|&i| allowed(i)), "unexpected change");
    assert!(
        stripped[exif_at..exif_at + items[1].data.len()]
            .iter()
            .all(|&b| b == 0)
    );
    assert!(
        stripped[xmp_at..xmp_at + items[2].data.len()]
            .iter()
            .all(|&b| b == 0)
    );
    assert_eq!(
        &stripped[exif_type..exif_type + 4],
        isobmff::CLEARED_ITEM_TYPE
    );
    assert_eq!(
        &stripped[xmp_type..xmp_type + 4],
        isobmff::CLEARED_ITEM_TYPE
    );

    // Nothing is reported any more, and cleaning again changes nothing.
    assert!(metadata_groups(dir.path(), "static/photo.avif").is_empty());
    let found = inspect::inspect(&Bytes::from(stripped.clone()), Format::Avif, true);
    assert!(!found.removable && found.gps.is_none() && !found.unreadable);
    assert_eq!(
        strip::strip(Bytes::from(stripped.clone()), Format::Avif).unwrap(),
        stripped
    );
}

#[test]
fn blanks_items_stored_in_idat() {
    let dir = site();
    let items = rich_items(true);
    let original = avif(32, 32, &items, &[]);
    write(dir.path(), "content/post/cover.avif", &original);
    assert!(library::list(dir.path()).unwrap()[0].has_gps);

    library::strip_file(dir.path(), "content/post/cover.avif").unwrap();
    let stripped = fs::read(dir.path().join("content/post/cover.avif")).unwrap();
    let image_at = find(&original, &items[0].data);
    let exif_at = find(&original, &items[1].data);
    assert_eq!(
        &stripped[image_at..image_at + 300],
        items[0].data.as_slice()
    );
    assert!(
        stripped[exif_at..exif_at + items[1].data.len()]
            .iter()
            .all(|&b| b == 0)
    );
    assert!(
        differences(&original, &stripped).len() <= items[1].data.len() + items[2].data.len() + 8
    );
    assert!(metadata_groups(dir.path(), "content/post/cover.avif").is_empty());
}

#[test]
fn leaves_clean_files_byte_for_byte() {
    let dir = site();
    let clean = avif(16, 16, &[AvifItem::new(1, b"av01", av1_data(64))], &[]);
    assert_eq!(
        strip::strip(Bytes::from(clean.clone()), Format::Avif).unwrap(),
        clean
    );
    let found = inspect::inspect(&Bytes::from(clean.clone()), Format::Avif, true);
    assert!(!found.removable && !found.unreadable);

    write(dir.path(), "static/clean.avif", &clean);
    let listed = library::list(dir.path()).unwrap();
    assert!(!listed[0].has_metadata);
    library::strip_file(dir.path(), "static/clean.avif").unwrap();
    assert_eq!(
        fs::read(dir.path().join("static/clean.avif")).unwrap(),
        clean
    );

    // Other kinds of items (here a text/plain mime item) are not metadata and are kept.
    let other = avif(
        16,
        16,
        &[
            AvifItem::new(1, b"av01", av1_data(64)),
            AvifItem {
                content_type: Some("text/plain"),
                ..AvifItem::new(2, b"mime", b"hello".to_vec())
            },
        ],
        &[],
    );
    assert_eq!(
        strip::strip(Bytes::from(other.clone()), Format::Avif).unwrap(),
        other
    );
}

#[test]
fn turns_a_top_level_xmp_box_into_free_space() {
    let mut uuid = vec![
        0xBE, 0x7A, 0xCF, 0xCB, 0x97, 0xA9, 0x42, 0xE8, 0x9C, 0x71, 0x99, 0x94, 0x91, 0xE3, 0xAF,
        0xAC,
    ];
    uuid.extend_from_slice(xmp_packet(GPS_XMP).as_bytes());
    let xmp_box = bmff_box(b"uuid", &uuid);
    let items = [AvifItem::new(1, b"av01", av1_data(80))];
    let original = avif(20, 10, &items, std::slice::from_ref(&xmp_box));
    let found = inspect::inspect(&Bytes::from(original.clone()), Format::Avif, true);
    assert!(found.gps.is_some() && found.removable);

    let stripped = strip::strip(Bytes::from(original.clone()), Format::Avif).unwrap();
    let at = find(&original, &xmp_box);
    assert_eq!(&stripped[at..at + 4], &original[at..at + 4], "size kept");
    assert_eq!(&stripped[at + 4..at + 8], b"free");
    assert!(stripped[at + 8..at + xmp_box.len()].iter().all(|&b| b == 0));
    assert_eq!(&stripped[..at], &original[..at]);
    assert_eq!(
        &stripped[at + xmp_box.len()..],
        &original[at + xmp_box.len()..]
    );
    let again = inspect::inspect(&Bytes::from(stripped), Format::Avif, true);
    assert!(!again.removable && again.gps.is_none());
}

#[test]
fn refuses_files_it_cannot_follow() {
    let dir = site();
    let items = rich_items(false);
    let good = avif(16, 16, &items, &[]);
    let image_at = find(&good, &items[0].data) as u32;

    // Cut inside the meta box.
    let truncated = good[..60].to_vec();
    // The EXIF item points past the end of the file.
    let mut outside = items.clone();
    outside[1].offset = Some(good.len() as u32);
    // The EXIF item shares its bytes with the image.
    let mut shared = items.clone();
    shared[1].offset = Some(image_at);
    shared[1].data.truncate(40);
    // No meta box at all.
    let mut no_meta = bmff_box(b"ftyp", b"avif\0\0\0\0avifmif1miaf");
    no_meta.extend(bmff_box(b"mdat", &av1_data(20)));

    for (name, bytes) in [
        ("truncated", truncated),
        ("outside", avif(16, 16, &outside, &[])),
        ("shared", avif(16, 16, &shared, &[])),
        ("no-meta", no_meta),
    ] {
        assert!(
            strip::strip(Bytes::from(bytes.clone()), Format::Avif).is_err(),
            "{name}"
        );
        let relative = format!("static/{name}.avif");
        write(dir.path(), &relative, &bytes);
        assert!(
            library::strip_file(dir.path(), &relative).is_err(),
            "{name}"
        );
        assert_eq!(
            fs::read(dir.path().join(&relative)).unwrap(),
            bytes,
            "{name} unchanged"
        );
    }
}

#[test]
fn survives_corrupt_files() {
    let sample = avif(16, 16, &rich_items(false), &[]);
    for i in 0..sample.len().min(1200) {
        for flip in [0xFF, 0x80, 0x01] {
            let mut corrupt = sample.clone();
            corrupt[i] ^= flip;
            let bytes = Bytes::from(corrupt.clone());
            let _ = inspect::inspect(&bytes, Format::Avif, true);
            if let Ok(out) = strip::strip(bytes, Format::Avif) {
                assert_eq!(out.len(), corrupt.len());
            }
        }
    }
}
