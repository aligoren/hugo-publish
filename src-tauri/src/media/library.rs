//! The site's images: listing, details, cleaning, importing, deleting and previews. The Tauri
//! commands in [`super::commands`] are thin wrappers around these functions.

use std::fs;
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::metadata::Orientation;
use image::{DynamicImage, ImageEncoder, ImageReader, Limits};
use img_parts::Bytes;
use img_parts::jpeg::Jpeg;
use img_parts::png::Png;
use img_parts::webp::WebP;

use super::commands::{GpsPosition, ImportOptions, MediaDetails, MediaFile};
use super::inspect::{self, Inspection};
use super::jpeg_header;
use super::names::file_name_for;
use super::sniff::{self, Format, IMAGE_EXTENSIONS};
use super::strip;
use crate::error::{AppError, AppResult};
use crate::site;

/// Folders the media library shows, and the only ones where images are cleaned or deleted.
pub const MEDIA_ROOTS: [&str; 3] = ["static", "assets", "content"];
/// Files larger than this are listed without reading them.
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
/// Previews are only made from files up to this size.
pub const MAX_PREVIEW_SOURCE_BYTES: u64 = 50 * 1024 * 1024;
/// SVG and AVIF previews are the file itself, so they are kept small.
const MAX_PASSTHROUGH_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;
/// Files up to this size are read whole for listing. Larger JPEGs are read only up to their
/// first scan (and the same for the previews their MPF index lists): every metadata segment comes
/// before the compressed image data.
const LIST_FULL_READ_BYTES: u64 = 512 * 1024;

/// Every image under `static/`, `assets/` and `content/`.
pub fn list(root: &Path) -> AppResult<Vec<MediaFile>> {
    let extensions: Vec<String> = IMAGE_EXTENSIONS.iter().map(|e| e.to_string()).collect();
    let mut files = Vec::new();
    for dir in MEDIA_ROOTS {
        for entry in site::list_files(root, dir, &extensions)? {
            let path = root.join(&entry.path);
            let file = listed_file(&entry.path, &path).unwrap_or_else(|_| MediaFile {
                path: entry.path.clone(),
                size: entry.size,
                width: None,
                height: None,
                format: None,
                has_gps: false,
                has_metadata: false,
                modified_ms: 0,
            });
            files.push(file);
        }
    }
    Ok(files)
}

fn listed_file(relative: &str, path: &Path) -> io::Result<MediaFile> {
    let meta = fs::metadata(path)?;
    if meta.len() > MAX_FILE_BYTES {
        return Ok(describe(relative, &meta, &Bytes::new(), true).0);
    }
    if meta.len() > LIST_FULL_READ_BYTES
        && let Some(headers) = jpeg_header::read_headers(path, meta.len())?
    {
        // An end marker after the scan header makes it a complete (empty) image to the parser.
        let finish = |mut header: Vec<u8>| {
            header.extend_from_slice(&[0xFF, 0xD9]);
            Bytes::from(header)
        };
        let main = finish(headers.main);
        if Jpeg::from_bytes(main.clone()).is_ok() {
            let (mut file, _) = describe(relative, &meta, &main, false);
            for embedded in headers.embedded {
                let found = inspect::inspect(&finish(embedded), Format::Jpeg, false);
                file.has_gps |= found.gps.is_some();
                file.has_metadata |= found.removable || found.gps.is_some();
            }
            return Ok(file);
        }
    }
    let bytes = fs::read(path)?;
    Ok(describe(relative, &meta, &Bytes::from(bytes), true).0)
}

/// The library entry for a file, and what its inspection found.
fn describe(
    relative: &str,
    meta: &fs::Metadata,
    bytes: &Bytes,
    complete: bool,
) -> (MediaFile, Inspection) {
    let format = sniff::sniff(bytes);
    let inspection = format
        .map(|f| inspect::inspect(bytes, f, complete))
        .unwrap_or_default();
    let size = format.and_then(|f| dimensions(bytes, f)).map(|(w, h)| {
        // Rotated photos are shown (and laid out by browsers) with width and height swapped.
        if (5..=8).contains(&inspection.orientation()) {
            (h, w)
        } else {
            (w, h)
        }
    });
    let file = MediaFile {
        path: relative.to_string(),
        size: meta.len(),
        width: size.map(|s| s.0),
        height: size.map(|s| s.1),
        format: Some(format.map_or("other", Format::name).to_string()),
        has_gps: inspection.gps.is_some(),
        has_metadata: inspection.removable,
        modified_ms: modified_ms(meta),
    };
    (file, inspection)
}

/// Stored width and height (before EXIF orientation).
pub fn dimensions(bytes: &[u8], format: Format) -> Option<(u32, u32)> {
    match format {
        Format::Svg => {
            sniff::svg_dimensions(&String::from_utf8_lossy(&bytes[..bytes.len().min(1 << 20)]))
        }
        Format::Avif => sniff::avif_dimensions(bytes),
        other => ImageReader::with_format(Cursor::new(bytes), other.image_format()?)
            .into_dimensions()
            .ok(),
    }
}

/// Everything known about one image, metadata entries included.
pub fn details(root: &Path, relative: &str) -> AppResult<MediaDetails> {
    let (path, meta) = image_file(root, relative, false)?;
    let bytes = Bytes::from(read_limited(&path, &meta)?);
    let (file, inspection) = describe(relative, &meta, &bytes, true);
    Ok(MediaDetails {
        file,
        camera: inspection.camera,
        taken_at: inspection.taken_at,
        gps: inspection.gps.map(|(lat, lon)| GpsPosition { lat, lon }),
        entries: inspection.entries,
    })
}

/// Removes metadata in place (atomically), keeping the pixels, ICC profile and orientation.
pub fn strip_file(root: &Path, relative: &str) -> AppResult<MediaFile> {
    let (path, meta) = image_file(root, relative, true)?;
    let bytes = Bytes::from(read_limited(&path, &meta)?);
    let format = sniff::sniff(&bytes).ok_or_else(|| not_an_image(relative))?;
    let inspection = inspect::inspect(&bytes, format, true);
    if inspection.unreadable {
        return Err(AppError::Invalid(format!(
            "{relative} could not be read as {}, so its metadata was not removed",
            format.name()
        )));
    }
    if inspection.removable {
        let stripped = strip::strip(bytes.clone(), format)?;
        verify_same_image(&bytes, &stripped, format)?;
        atomic_write(&path, &stripped)?;
    }
    let meta = fs::metadata(&path)?;
    let bytes = Bytes::from(fs::read(&path)?);
    Ok(describe(relative, &meta, &bytes, true).0)
}

/// Copies images (absolute paths chosen by the user) into the site. Every source is checked
/// before anything is written. Returns the new site-relative paths.
pub fn import_files(
    root: &Path,
    sources: &[String],
    options: &ImportOptions,
) -> AppResult<Vec<String>> {
    if sources.is_empty() {
        return Ok(Vec::new());
    }
    let target = ImportTarget::prepare(root, &options.target_dir)?;
    let mut checked = Vec::with_capacity(sources.len());
    for source in sources {
        let path = PathBuf::from(source);
        if !path.is_absolute() {
            return Err(AppError::Invalid(format!(
                "{source} is not an absolute path"
            )));
        }
        let meta = fs::metadata(&path)?;
        if meta.is_dir() {
            return Err(AppError::Invalid(format!(
                "{source} is a folder, not an image"
            )));
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(AppError::Invalid(format!("{source} is too large")));
        }
        let mut head = Vec::new();
        fs::File::open(&path)?.take(4096).read_to_end(&mut head)?;
        if sniff::sniff(&head).is_none() {
            return Err(not_an_image(source));
        }
        checked.push(path);
    }
    checked
        .iter()
        .map(|path| {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            import_one(&target, &name, fs::read(path)?, options)
        })
        .collect()
}

/// Imports image bytes (e.g. pasted), given as base64 or a `data:` URL.
pub fn import_bytes(
    root: &Path,
    file_name: &str,
    data_base64: &str,
    options: &ImportOptions,
) -> AppResult<String> {
    let encoded = if data_base64.trim_start().starts_with("data:") {
        data_base64
            .split_once(',')
            .map_or(data_base64, |(_, data)| data)
    } else {
        data_base64
    };
    let encoded: String = encoded.chars().filter(|c| !c.is_whitespace()).collect();
    if encoded.len() as u64 > MAX_FILE_BYTES / 3 * 4 + 4 {
        return Err(AppError::Invalid("the image is too large".into()));
    }
    let bytes = STANDARD
        .decode(encoded.as_bytes())
        .map_err(|e| AppError::Invalid(format!("the image data is not valid base64: {e}")))?;
    let target = ImportTarget::prepare(root, &options.target_dir)?;
    import_one(&target, file_name, bytes, options)
}

fn import_one(
    target: &ImportTarget,
    source_name: &str,
    bytes: Vec<u8>,
    options: &ImportOptions,
) -> AppResult<String> {
    let format = sniff::sniff(&bytes).ok_or_else(|| not_an_image(source_name))?;
    let bytes = Bytes::from(bytes);
    let resized = match options.max_width.filter(|&w| w > 0) {
        Some(max_width) => resize_if_wider(&bytes, format, max_width)?,
        None => None,
    };
    let data = match resized {
        // Re-encoding already dropped the metadata (the ICC profile is carried over).
        Some(data) => data,
        None if options.strip_metadata => {
            let inspection = inspect::inspect(&bytes, format, true);
            if inspection.removable || inspection.unreadable {
                let stripped = strip::strip(bytes.clone(), format)?;
                verify_same_image(&bytes, &stripped, format)?;
                stripped
            } else {
                bytes.to_vec()
            }
        }
        None => bytes.to_vec(),
    };
    let name = file_name_for(
        source_name,
        options.file_name.as_deref(),
        format,
        options.strip_metadata,
    );
    let path = target.free_path(&name, options.overwrite)?;
    atomic_write(&path, &data)?;
    let written = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(name);
    Ok(format!("{}/{written}", target.relative))
}

struct ImportTarget {
    dir: PathBuf,
    /// Site-relative, forward slashes.
    relative: String,
}

impl ImportTarget {
    fn prepare(root: &Path, dir: &str) -> AppResult<ImportTarget> {
        let dir = dir.trim();
        // `/x` or `C:\x` is an absolute path, not a folder of the site.
        if dir.starts_with(['/', '\\']) || dir.contains(':') || Path::new(dir).is_absolute() {
            return Err(AppError::PathOutsideSite(dir.to_string()));
        }
        let relative = dir
            .replace('\\', "/")
            .split('/')
            .filter(|part| !part.is_empty() && *part != ".")
            .collect::<Vec<_>>()
            .join("/");
        if relative.is_empty() {
            return Err(AppError::Invalid(
                "choose a folder inside the site for the images".into(),
            ));
        }
        site::resolve(root, &relative)?;
        if relative.split('/').any(|part| part.starts_with('.')) {
            return Err(AppError::Invalid(format!(
                "{relative} is a hidden folder; choose another one"
            )));
        }
        fs::create_dir_all(root.join(&relative))?;
        // Resolve again now that the folders exist, in case a link points outside the site.
        let dir = site::resolve(root, &relative)?;
        if !dir.is_dir() {
            return Err(AppError::Invalid(format!("{relative} is not a folder")));
        }
        Ok(ImportTarget { dir, relative })
    }

    /// `name`, or `name-2`, `name-3`… when taken (unless overwriting is allowed).
    fn free_path(&self, name: &str, overwrite: bool) -> AppResult<PathBuf> {
        let first = self.dir.join(name);
        if first.is_dir() {
            return Err(AppError::Invalid(format!("{name} is a folder")));
        }
        if overwrite || !first.exists() {
            return Ok(first);
        }
        let (stem, extension) = name.rsplit_once('.').unwrap_or((name, ""));
        for n in 2..10_000 {
            let candidate = self.dir.join(format!("{stem}-{n}.{extension}"));
            if !candidate.exists() {
                return Ok(candidate);
            }
        }
        Err(AppError::Invalid(format!(
            "too many files named like {name}"
        )))
    }
}

/// Deletes an image under `static/`, `assets/` or `content/`.
pub fn delete(root: &Path, relative: &str) -> AppResult<()> {
    let (path, _) = image_file(root, relative, true)?;
    fs::remove_file(path)?;
    Ok(())
}

/// A preview no larger than `max_size` × `max_size`, as a `data:` URL: JPEG, or PNG when the
/// image has transparency. SVG and AVIF files are returned as they are.
pub fn thumbnail(root: &Path, relative: &str, max_size: u32) -> AppResult<String> {
    let (path, meta) = image_file(root, relative, false)?;
    if meta.len() > MAX_PREVIEW_SOURCE_BYTES {
        return Err(AppError::Invalid(format!(
            "{relative} is too large for a preview"
        )));
    }
    let bytes = Bytes::from(fs::read(&path)?);
    let format = sniff::sniff(&bytes).ok_or_else(|| not_an_image(relative))?;
    if !format.is_raster_decodable() {
        if meta.len() > MAX_PASSTHROUGH_PREVIEW_BYTES {
            return Err(AppError::Invalid(format!(
                "{relative} is too large for a preview"
            )));
        }
        return Ok(data_url(format.mime(), &bytes));
    }
    let mut image = decode(&bytes, format)?;
    image.apply_orientation(orientation_of(inspect::orientation(&bytes, format)));
    let size = max_size.clamp(16, 2048);
    if image.width() > size || image.height() > size {
        image = image.thumbnail(size, size);
    }
    let mut out = Vec::new();
    let mime = if image.color().has_alpha() {
        DynamicImage::ImageRgba8(image.to_rgba8())
            .write_with_encoder(PngEncoder::new(&mut out))
            .map_err(encode_error)?;
        "image/png"
    } else {
        DynamicImage::ImageRgb8(image.to_rgb8())
            .write_with_encoder(JpegEncoder::new_with_quality(&mut out, 80))
            .map_err(encode_error)?;
        "image/jpeg"
    };
    Ok(data_url(mime, &out))
}

/// Downscales to `max_width` (after applying the EXIF orientation) and re-encodes in the same
/// format, when the image is wider. Animated images, GIF, SVG and AVIF are left alone.
pub fn resize_if_wider(
    bytes: &Bytes,
    format: Format,
    max_width: u32,
) -> AppResult<Option<Vec<u8>>> {
    if !matches!(format, Format::Jpeg | Format::Png | Format::Webp) || is_animated(bytes, format) {
        return Ok(None);
    }
    let orientation = inspect::orientation(bytes, format);
    let (width, height) = dimensions(bytes, format)
        .ok_or_else(|| AppError::Invalid("the image size could not be read".into()))?;
    let shown_width = if (5..=8).contains(&orientation) {
        height
    } else {
        width
    };
    if shown_width <= max_width {
        return Ok(None);
    }
    let mut image = decode(bytes, format)?;
    image.apply_orientation(orientation_of(orientation));
    let new_height = (f64::from(image.height()) * f64::from(max_width) / f64::from(image.width()))
        .round()
        .max(1.0) as u32;
    let resized = image.resize_exact(max_width, new_height, FilterType::Lanczos3);
    encode_as(&resized, format, inspect::icc_profile(bytes, format)).map(Some)
}

fn is_animated(bytes: &Bytes, format: Format) -> bool {
    match format {
        Format::Png => {
            Png::from_bytes(bytes.clone()).is_ok_and(|png| png.chunk_by_type(*b"acTL").is_some())
        }
        Format::Webp => WebP::from_bytes(bytes.clone()).is_ok_and(|webp| webp.has_chunk(*b"ANIM")),
        Format::Gif => true,
        _ => false,
    }
}

fn encode_as(image: &DynamicImage, format: Format, icc: Option<Vec<u8>>) -> AppResult<Vec<u8>> {
    use image::ColorType::{L8, L16, La8, La16};
    let gray = matches!(image.color(), L8 | L16 | La8 | La16);
    let expected_space: &[u8] = if gray { b"GRAY" } else { b"RGB " };
    // A CMYK profile on RGB pixels (CMYK JPEGs decode to RGB) would distort the colours.
    let icc = icc.filter(|p| inspect::icc_color_space(p) == Some(expected_space));
    let mut out = Vec::new();
    match format {
        Format::Jpeg => {
            let mut encoder = JpegEncoder::new_with_quality(&mut out, 85);
            if let Some(profile) = icc {
                let _ = encoder.set_icc_profile(profile);
            }
            let pixels = if gray {
                DynamicImage::ImageLuma8(image.to_luma8())
            } else {
                DynamicImage::ImageRgb8(image.to_rgb8())
            };
            pixels.write_with_encoder(encoder).map_err(encode_error)?;
        }
        Format::Png => {
            let mut encoder = PngEncoder::new(&mut out);
            if let Some(profile) = icc {
                let _ = encoder.set_icc_profile(profile);
            }
            image.write_with_encoder(encoder).map_err(encode_error)?;
        }
        Format::Webp => {
            let mut encoder = WebPEncoder::new_lossless(&mut out);
            if let Some(profile) = icc.filter(|_| !gray) {
                let _ = encoder.set_icc_profile(profile);
            }
            let pixels = if image.color().has_alpha() {
                DynamicImage::ImageRgba8(image.to_rgba8())
            } else {
                DynamicImage::ImageRgb8(image.to_rgb8())
            };
            pixels.write_with_encoder(encoder).map_err(encode_error)?;
        }
        other => {
            return Err(AppError::Invalid(format!(
                "{} images cannot be re-encoded",
                other.name()
            )));
        }
    }
    Ok(out)
}

fn decode(bytes: &[u8], format: Format) -> AppResult<DynamicImage> {
    let image_format = format
        .image_format()
        .ok_or_else(|| AppError::Invalid(format!("{} images cannot be decoded", format.name())))?;
    let mut reader = ImageReader::with_format(Cursor::new(bytes), image_format);
    reader.limits(Limits::default());
    reader
        .decode()
        .map_err(|e| AppError::Invalid(format!("the image could not be decoded: {e}")))
}

fn orientation_of(exif: u16) -> Orientation {
    u8::try_from(exif)
        .ok()
        .and_then(Orientation::from_exif)
        .unwrap_or(Orientation::NoTransforms)
}

/// A safety net before overwriting: the cleaned file must still be the same kind of image with
/// the same size.
fn verify_same_image(original: &[u8], cleaned: &[u8], format: Format) -> AppResult<()> {
    let fail = || {
        AppError::Invalid(format!(
            "removing metadata would have damaged this {} image; it was left unchanged",
            format.name()
        ))
    };
    if sniff::sniff(cleaned) != Some(format) {
        return Err(fail());
    }
    if let Some(size) = dimensions(original, format)
        && dimensions(cleaned, format) != Some(size)
    {
        return Err(fail());
    }
    Ok(())
}

/// Resolves an image path inside the site. With `media_only`, it must be under one of
/// [`MEDIA_ROOTS`].
fn image_file(root: &Path, relative: &str, media_only: bool) -> AppResult<(PathBuf, fs::Metadata)> {
    let normalized = relative.replace('\\', "/");
    let first = normalized.split('/').next().unwrap_or_default();
    if media_only && !MEDIA_ROOTS.contains(&first) {
        return Err(AppError::Invalid(format!(
            "{relative} is not in static/, assets/ or content/"
        )));
    }
    let is_image = Path::new(&normalized)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
    if !is_image {
        return Err(AppError::Invalid(format!(
            "{relative} is not an image file"
        )));
    }
    let path = site::resolve(root, &normalized)?;
    let meta = fs::metadata(&path)?;
    if !meta.is_file() {
        return Err(AppError::Invalid(format!("{relative} is not a file")));
    }
    Ok((path, meta))
}

fn read_limited(path: &Path, meta: &fs::Metadata) -> AppResult<Vec<u8>> {
    if meta.len() > MAX_FILE_BYTES {
        return Err(AppError::Invalid(format!(
            "{} is too large",
            path.display()
        )));
    }
    Ok(fs::read(path)?)
}

fn not_an_image(name: &str) -> AppError {
    AppError::Invalid(format!(
        "{name} is not a supported image (JPEG, PNG, WebP, GIF, SVG or AVIF)"
    ))
}

fn encode_error(error: image::ImageError) -> AppError {
    AppError::Invalid(format!("the image could not be encoded: {error}"))
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

/// Writes next to the target, then renames over it, so a crash never leaves half a file.
fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = path
        .parent()
        .ok_or_else(|| AppError::Invalid(format!("no parent folder for {}", path.display())))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    let temp = dir.join(format!(
        ".{name}.hugo-publisher-{}-{}.tmp",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    Ok(result?)
}
