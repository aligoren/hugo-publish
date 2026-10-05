//! Importing, deleting, listing and previewing images.

mod media_support;

use std::fs;
use std::path::Path;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use hugo_publisher_lib::error::AppError;
use hugo_publisher_lib::media::commands::ImportOptions;
use hugo_publisher_lib::media::exif::Exif;
use hugo_publisher_lib::media::inspect::exif_block;
use hugo_publisher_lib::media::library;
use hugo_publisher_lib::media::sniff::Format;
use img_parts::Bytes;
use media_support::*;

fn options(target_dir: &str, strip_metadata: bool) -> ImportOptions {
    ImportOptions {
        target_dir: target_dir.into(),
        strip_metadata,
        max_width: None,
        file_name: None,
        overwrite: false,
    }
}

/// A folder outside the site with files to import.
fn sources(files: &[(&str, &[u8])]) -> (tempfile::TempDir, Vec<String>) {
    let dir = tempfile::tempdir().unwrap();
    let paths = files
        .iter()
        .map(|(name, bytes)| {
            let path = dir.path().join(name);
            fs::write(&path, bytes).unwrap();
            path.to_string_lossy().into_owned()
        })
        .collect();
    (dir, paths)
}

fn decoded_size(bytes: &[u8]) -> (u32, u32) {
    let image = image::load_from_memory(bytes).unwrap();
    (image.width(), image.height())
}

fn files_in(root: &Path, dir: &str) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(root.join(dir))
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[test]
fn imports_with_clean_names_and_without_location() {
    let site = site();
    let photo = with_jpeg_exif(&jpeg(20, 10), camera_exif(6));
    let (_src, paths) = sources(&[
        ("IMG_20261003_123456.JPG", &photo),
        ("Kapak Fotoğrafı.jpeg", &photo),
    ]);
    let imported =
        library::import_files(site.path(), &paths, &options("static/images", true)).unwrap();
    assert_eq!(
        imported,
        vec![
            "static/images/image.jpg",
            "static/images/kapak-fotografi.jpeg"
        ]
    );
    for path in &imported {
        let details = library::details(site.path(), path).unwrap();
        assert!(
            details.gps.is_none() && !details.file.has_metadata,
            "{path}"
        );
        // Orientation survives, so the picture is not shown sideways.
        let block = exif_block(
            &Bytes::from(fs::read(site.path().join(path)).unwrap()),
            Format::Jpeg,
        )
        .unwrap();
        assert_eq!(Exif::parse(&block).unwrap().orientation(), Some(6));
    }
    // The source files are untouched.
    assert_eq!(fs::read(&paths[0]).unwrap(), photo);

    // Same names again: numbered, never overwritten.
    let again =
        library::import_files(site.path(), &paths, &options("static/images/", true)).unwrap();
    assert_eq!(
        again,
        vec![
            "static/images/image-2.jpg",
            "static/images/kapak-fotografi-2.jpeg"
        ]
    );
    let third =
        library::import_files(site.path(), &paths[..1], &options("static\\images", true)).unwrap();
    assert_eq!(third, vec!["static/images/image-3.jpg"]);
}

#[test]
fn keeps_metadata_and_names_when_asked() {
    let site = site();
    let photo = with_jpeg_exif(&jpeg(20, 10), camera_exif(1));
    let (_src, paths) = sources(&[("IMG_20261003_123456.jpg", &photo)]);
    let imported =
        library::import_files(site.path(), &paths, &options("content/posts/trip", false)).unwrap();
    assert_eq!(imported, vec!["content/posts/trip/img-20261003-123456.jpg"]);
    assert_eq!(fs::read(site.path().join(&imported[0])).unwrap(), photo);
    assert!(
        library::details(site.path(), &imported[0])
            .unwrap()
            .gps
            .is_some()
    );
}

#[test]
fn overwrites_and_renames_on_request() {
    let site = site();
    let (_src, paths) = sources(&[("a.png", &png(4, 4)), ("b.png", &png(6, 6))]);
    let mut opts = options("static", true);
    opts.file_name = Some("Logo Büyük".into());
    assert_eq!(
        library::import_files(site.path(), &paths[..1], &opts).unwrap(),
        vec!["static/logo-buyuk.png"]
    );
    opts.overwrite = true;
    assert_eq!(
        library::import_files(site.path(), &paths[1..], &opts).unwrap(),
        vec!["static/logo-buyuk.png"]
    );
    assert_eq!(
        decoded_size(&fs::read(site.path().join("static/logo-buyuk.png")).unwrap()),
        (6, 6)
    );
    assert_eq!(files_in(site.path(), "static"), vec!["logo-buyuk.png"]);
}

#[test]
fn trusts_content_not_extensions() {
    let site = site();
    let (_src, paths) = sources(&[("photo.jpg", &png(3, 3))]);
    let imported = library::import_files(site.path(), &paths, &options("static", true)).unwrap();
    assert_eq!(imported, vec!["static/photo.png"]);

    let (_src, text) = sources(&[("notes.jpg", b"not an image at all")]);
    let error = library::import_files(site.path(), &text, &options("static", true)).unwrap_err();
    assert!(matches!(error, AppError::Invalid(_)), "{error:?}");

    // One bad source means nothing is imported.
    let (_src, mixed) = sources(&[("good.png", &png(2, 2)), ("bad.gif", b"GIF-ish")]);
    assert!(library::import_files(site.path(), &mixed, &options("static/new", true)).is_err());
    assert!(files_in(site.path(), "static/new").is_empty());
}

#[test]
fn refuses_folders_relative_sources_and_unsafe_targets() {
    let site = site();
    let (src, paths) = sources(&[("a.png", &png(2, 2))]);
    let folder = vec![src.path().to_string_lossy().into_owned()];
    assert!(library::import_files(site.path(), &folder, &options("static", true)).is_err());
    assert!(
        library::import_files(
            site.path(),
            &["a.png".to_string()],
            &options("static", true)
        )
        .is_err()
    );

    for target in [
        "../outside",
        "static/../../x",
        "/tmp/x",
        r"C:\Windows",
        "",
        ".git/images",
        "static/.hidden",
    ] {
        let result = library::import_files(site.path(), &paths, &options(target, true));
        assert!(result.is_err(), "{target} should be refused");
    }
    assert!(matches!(
        library::import_files(site.path(), &paths, &options("../outside", true)),
        Err(AppError::PathOutsideSite(_))
    ));
    assert!(!site.path().join(".git").exists());
    assert!(!site.path().parent().unwrap().join("outside").exists());
}

#[test]
fn downscales_wide_images_after_rotating_them() {
    let site = site();
    // Stored 400×200, shown 200×400 because of the orientation tag.
    let rotated = with_jpeg_exif(&jpeg(400, 200), camera_exif(6));
    let (_src, paths) = sources(&[
        ("rotated.jpg", &rotated),
        (
            "wide.png",
            &encode(&rgba(300, 100), image::ImageFormat::Png),
        ),
        ("wide.webp", &webp(300, 150)),
        ("small.jpg", &jpeg(50, 50)),
    ]);
    let mut opts = options("static/img", false);
    opts.max_width = Some(100);
    let imported = library::import_files(site.path(), &paths, &opts).unwrap();
    let read = |i: usize| fs::read(site.path().join(&imported[i])).unwrap();

    let rotated_out = read(0);
    assert_eq!(decoded_size(&rotated_out), (100, 200));
    assert!(exif_block(&Bytes::from(rotated_out.clone()), Format::Jpeg).is_none());
    assert!(
        !library::details(site.path(), &imported[0])
            .unwrap()
            .file
            .has_gps
    );

    let png_out = read(1);
    assert!(png_out.starts_with(b"\x89PNG"));
    assert_eq!(decoded_size(&png_out), (100, 33));
    assert!(
        image::load_from_memory(&png_out)
            .unwrap()
            .color()
            .has_alpha()
    );

    let webp_out = read(2);
    assert!(webp_out.starts_with(b"RIFF") && &webp_out[12..16] == b"VP8L");
    assert_eq!(decoded_size(&webp_out), (100, 50));

    // Narrow enough already: copied as is.
    assert_eq!(read(3), jpeg(50, 50));
}

#[test]
fn keeps_icc_profiles_when_resizing() {
    let site = site();
    let source = with_jpeg_icc(&jpeg(64, 32), icc_profile("Display P3"));
    let (_src, paths) = sources(&[("p3.jpg", &source)]);
    let mut opts = options("static", true);
    opts.max_width = Some(32);
    let imported = library::import_files(site.path(), &paths, &opts).unwrap();
    let details = library::details(site.path(), &imported[0]).unwrap();
    assert_eq!(
        (details.file.width, details.file.height),
        (Some(32), Some(16))
    );
    assert!(
        details
            .entries
            .iter()
            .any(|e| e.group == "ICC" && e.value == "Display P3")
    );
}

#[test]
fn imports_pasted_bytes() {
    let site = site();
    let photo = with_jpeg_exif(&jpeg(8, 8), camera_exif(1));
    let encoded = STANDARD.encode(&photo);
    let path = library::import_bytes(
        site.path(),
        "clipboard.png",
        &encoded,
        &options("static/images", true),
    )
    .unwrap();
    // The name follows the content (JPEG), and the location is gone.
    assert_eq!(path, "static/images/clipboard.jpg");
    assert!(!library::details(site.path(), &path).unwrap().file.has_gps);

    let data_url = format!("data:image/png;base64,{}", STANDARD.encode(png(2, 2)));
    let path =
        library::import_bytes(site.path(), "", &data_url, &options("static/images", true)).unwrap();
    assert_eq!(path, "static/images/image.png");

    assert!(library::import_bytes(site.path(), "x.png", "%%%", &options("static", true)).is_err());
    let text = STANDARD.encode(b"hello");
    assert!(library::import_bytes(site.path(), "x.png", &text, &options("static", true)).is_err());
}

#[test]
fn deletes_only_images_in_media_folders() {
    let site = site();
    write(site.path(), "static/a.png", &png(2, 2));
    write(
        site.path(),
        "content/post/index.md",
        b"---\ntitle: x\n---\n",
    );
    write(site.path(), "layouts/logo.png", &png(2, 2));
    write(site.path(), "content/post/folder.png/x.txt", b"");

    library::delete(site.path(), "static/a.png").unwrap();
    assert!(!site.path().join("static/a.png").exists());
    assert!(library::delete(site.path(), "static/a.png").is_err());
    assert!(library::delete(site.path(), "content/post/index.md").is_err());
    assert!(library::delete(site.path(), "layouts/logo.png").is_err());
    assert!(library::delete(site.path(), "content/post/folder.png").is_err());
    assert!(matches!(
        library::delete(site.path(), "static/../layouts/logo.png"),
        Err(AppError::PathOutsideSite(_))
    ));
    assert!(site.path().join("layouts/logo.png").exists());
}

#[test]
fn lists_images_from_static_assets_and_bundles() {
    let site = site();
    write(site.path(), "static/images/a.png", &png(30, 20));
    write(site.path(), "assets/images/b.webp", &webp(8, 4));
    write(site.path(), "content/posts/x/index.md", b"![](c.jpg)");
    write(site.path(), "content/posts/x/c.jpg", &jpeg(5, 7));
    write(site.path(), "content/posts/x/d.gif", &gif(3, 2));
    write(
        site.path(),
        "static/icon.svg",
        br#"<svg viewBox="0 0 16 8"></svg>"#,
    );
    write(site.path(), "static/images/.hidden.png", &png(1, 1));
    write(site.path(), "themes/t/static/theme.png", &png(1, 1));
    write(site.path(), "static/readme.txt", b"x");

    let listed = library::list(site.path()).unwrap();
    type Row<'a> = (&'a str, Option<&'a str>, Option<u32>, Option<u32>);
    let summary: Vec<Row> = listed
        .iter()
        .map(|f| (f.path.as_str(), f.format.as_deref(), f.width, f.height))
        .collect();
    assert_eq!(
        summary,
        vec![
            ("static/icon.svg", Some("svg"), Some(16), Some(8)),
            ("static/images/a.png", Some("png"), Some(30), Some(20)),
            ("assets/images/b.webp", Some("webp"), Some(8), Some(4)),
            ("content/posts/x/c.jpg", Some("jpeg"), Some(5), Some(7)),
            ("content/posts/x/d.gif", Some("gif"), Some(3), Some(2)),
        ]
    );
    assert!(
        listed
            .iter()
            .all(|f| !f.has_gps && !f.has_metadata && f.modified_ms > 0)
    );
}

#[test]
fn lists_large_jpegs_from_their_header() {
    let site = site();
    // Larger than the listing prefix: only the header is read, metadata is still found.
    let mut big = with_jpeg_exif(&jpeg(16, 16), camera_exif(1));
    let eoi = big.split_off(big.len() - 2);
    big.extend(std::iter::repeat_n(0x55, 600 * 1024));
    big.extend(eoi);
    write(site.path(), "static/big.jpg", &big);
    let listed = library::list(site.path()).unwrap();
    assert!(listed[0].has_gps);
    assert_eq!((listed[0].width, listed[0].height), (Some(16), Some(16)));
}

#[test]
fn lists_large_jpegs_with_huge_headers_and_mpf_previews() {
    let site = site();
    // Over 512 KB of APP segments before the EXIF block: the header is read to the first scan,
    // whatever its size.
    let mut padded = with_jpeg_exif(&jpeg(16, 16), camera_exif(1));
    for _ in 0..10 {
        padded = with_jpeg_segment(&padded, 0xEF, vec![0x20; 60_000]);
    }
    write(site.path(), "static/padded.jpg", &padded);

    // The main image has no location; the preview the MPF index points to has.
    let mut main = jpeg(16, 16);
    let eoi = main.split_off(main.len() - 2);
    main.extend(std::iter::repeat_n(0x55, 600 * 1024));
    main.extend(eoi);
    let preview = with_jpeg_exif(&jpeg(8, 8), camera_exif(1));
    write(
        site.path(),
        "static/phone.jpg",
        &with_mpf_image(&main, &preview),
    );
    // Without the MPF index pointing at it, the same preview is not looked for in a large file.
    let mut plain = main.clone();
    plain.extend(&preview);
    write(site.path(), "static/plain.jpg", &plain);

    let listed = library::list(site.path()).unwrap();
    let file = |name: &str| {
        listed
            .iter()
            .find(|f| f.path == format!("static/{name}"))
            .unwrap()
    };
    assert!(file("padded.jpg").has_gps);
    assert_eq!(
        (file("padded.jpg").width, file("padded.jpg").height),
        (Some(16), Some(16))
    );
    assert!(file("phone.jpg").has_gps && file("phone.jpg").has_metadata);
    assert_eq!(
        (file("phone.jpg").width, file("phone.jpg").height),
        (Some(16), Some(16))
    );
    assert!(!file("plain.jpg").has_gps);
    // Details read the whole file and find it either way.
    assert!(
        library::details(site.path(), "static/plain.jpg")
            .unwrap()
            .gps
            .is_some()
    );
}

#[test]
fn makes_previews() {
    let site = site();
    write(
        site.path(),
        "static/rotated.jpg",
        &with_jpeg_exif(&jpeg(80, 40), camera_exif(6)),
    );
    write(
        site.path(),
        "static/alpha.png",
        &encode(&rgba(30, 30), image::ImageFormat::Png),
    );
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>"#;
    write(site.path(), "static/icon.svg", svg);

    let preview = library::thumbnail(site.path(), "static/rotated.jpg", 20).unwrap();
    let data = preview
        .strip_prefix("data:image/jpeg;base64,")
        .expect("JPEG data URL");
    let bytes = STANDARD.decode(data).unwrap();
    // Rotated upright, then fitted into 20×20.
    assert_eq!(decoded_size(&bytes), (10, 20));

    let preview = library::thumbnail(site.path(), "static/alpha.png", 256).unwrap();
    let data = preview
        .strip_prefix("data:image/png;base64,")
        .expect("PNG for transparency");
    assert_eq!(decoded_size(&STANDARD.decode(data).unwrap()), (30, 30));

    let preview = library::thumbnail(site.path(), "static/icon.svg", 64).unwrap();
    assert_eq!(
        preview,
        format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg))
    );

    // Huge sources are refused instead of decoded.
    let huge = fs::File::create(site.path().join("static/huge.png")).unwrap();
    huge.set_len(library::MAX_PREVIEW_SOURCE_BYTES + 1).unwrap();
    assert!(library::thumbnail(site.path(), "static/huge.png", 64).is_err());
    assert!(library::thumbnail(site.path(), "../x.png", 64).is_err());
}
