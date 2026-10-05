//! Finding metadata in image files: EXIF (with GPS), XMP, IPTC, ICC, comments, PNG text chunks,
//! and the odd places phones and editors hide more (embedded previews, data after the image).
//!
//! Everything here works on untrusted bytes: parsers bound-check and give up quietly.

use std::collections::HashSet;
use std::io::Read;
use std::ops::Range;
use std::sync::LazyLock;

use img_parts::Bytes;
use img_parts::jpeg::{Jpeg, markers};
use img_parts::png::Png;
use img_parts::webp::WebP;
use regex::Regex;

use super::commands::MetadataEntry;
use super::exif::{self, Exif, Ifd};
use super::isobmff::{self, MetadataKind};
use super::sniff::{self, Format};

/// Group names of [`MetadataEntry`]; the UI translates them.
pub mod groups {
    pub const EXIF: &str = "EXIF";
    pub const GPS: &str = "GPS";
    pub const XMP: &str = "XMP";
    pub const IPTC: &str = "IPTC";
    pub const ICC: &str = "ICC";
    pub const PNG_TEXT: &str = "PNG";
    pub const COMMENT: &str = "Comment";
    pub const SVG: &str = "SVG";
    pub const OTHER: &str = "Other";
}

use groups::*;

const MAX_ENTRIES: usize = 400;
const MAX_VALUE_CHARS: usize = 300;
/// Compressed text chunks and ICC profiles are inflated up to this size.
const MAX_INFLATED: u64 = 16 * 1024 * 1024;

pub(crate) const XMP_PREFIX: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const XMP_EXTENSION_PREFIX: &[u8] = b"http://ns.adobe.com/xmp/extension/\0";
const ICC_PREFIX: &[u8] = b"ICC_PROFILE\0";
const PHOTOSHOP_PREFIX: &[u8] = b"Photoshop 3.0\0";

#[derive(Debug, Clone, Default)]
pub struct Inspection {
    pub entries: Vec<MetadataEntry>,
    /// Something that stripping would remove (everything except ICC profiles and orientation).
    pub removable: bool,
    /// Decimal latitude and longitude from EXIF or XMP.
    pub gps: Option<(f64, f64)>,
    /// EXIF orientation of the main image (1–8).
    pub orientation: Option<u16>,
    pub camera: Option<String>,
    pub taken_at: Option<String>,
    pub has_icc: bool,
    /// The file structure could not be read, so metadata could not be checked.
    pub unreadable: bool,
    extended_xmp: usize,
}

impl Inspection {
    /// Orientation 1–8, 1 when unknown.
    pub fn orientation(&self) -> u16 {
        self.orientation.unwrap_or(1)
    }

    fn add(&mut self, group: &str, key: impl Into<String>, value: impl AsRef<str>) {
        let value = value.as_ref().trim();
        if self.entries.len() >= MAX_ENTRIES || value.is_empty() {
            return;
        }
        self.entries.push(MetadataEntry {
            group: group.to_string(),
            key: key.into(),
            value: exif::truncate(value, MAX_VALUE_CHARS),
        });
    }

    fn removable_entry(&mut self, group: &str, key: impl Into<String>, value: impl AsRef<str>) {
        self.removable = true;
        self.add(group, key, value);
    }

    fn absorb_exif(&mut self, data: &[u8]) {
        let Some(exif) = Exif::parse(data) else {
            self.removable_entry(EXIF, "Data", format!("{} bytes (unreadable)", data.len()));
            return;
        };
        if !exif.is_orientation_only() {
            self.removable = true;
        }
        self.orientation = self.orientation.or(exif.orientation());
        self.gps = self.gps.or(exif.gps());
        if self.camera.is_none() {
            self.camera = exif.camera();
        }
        if self.taken_at.is_none() {
            self.taken_at = exif.taken_at();
        }
        for field in &exif.fields {
            let group = match field.ifd {
                Ifd::Primary | Ifd::Exif => EXIF,
                Ifd::Gps => GPS,
                // Interoperability and thumbnail tags only describe the file layout.
                Ifd::Interop | Ifd::Thumbnail => continue,
            };
            let key = exif::tag_name(field.ifd, field.tag)
                .map_or_else(|| format!("Tag 0x{:04X}", field.tag), str::to_string);
            self.add(group, key, exif::describe(field));
        }
        if let Some(len) = exif.thumbnail_len {
            self.add(EXIF, "Embedded thumbnail", format!("{len} bytes"));
        }
    }

    fn absorb_xmp(&mut self, text: &str, group: &str) {
        self.removable = true;
        let before = self.entries.len();
        let mut seen = HashSet::new();
        let mut values: Vec<(String, String)> = Vec::new();
        for capture in XMP_ATTRIBUTE.captures_iter(text) {
            let value = capture
                .get(3)
                .or_else(|| capture.get(4))
                .map_or("", |m| m.as_str());
            values.push((
                format!("{}:{}", &capture[1], &capture[2]),
                xml_unescape(value),
            ));
        }
        for capture in XMP_ELEMENT.captures_iter(text) {
            if capture[1] == capture[3] && &capture[1] != "rdf:li" {
                values.push((capture[1].to_string(), xml_unescape(&capture[2])));
            }
        }
        for capture in XMP_CONTAINER.captures_iter(text) {
            let items: Vec<String> = XMP_LIST_ITEM
                .captures_iter(&capture[2])
                .map(|c| xml_unescape(&c[1]))
                .filter(|v| !v.trim().is_empty())
                .collect();
            if !items.is_empty() {
                values.push((capture[1].to_string(), items.join(", ")));
            }
        }
        let mut lat = None;
        let mut lon = None;
        let mut make = None;
        let mut model = None;
        let mut date = None;
        for (key, value) in values {
            let prefix = key.split(':').next().unwrap_or_default();
            if matches!(prefix, "xmlns" | "rdf" | "x" | "xml") || value.trim().is_empty() {
                continue;
            }
            if !seen.insert(key.clone()) {
                continue;
            }
            match key.as_str() {
                "exif:GPSLatitude" => lat = xmp_coordinate(&value),
                "exif:GPSLongitude" => lon = xmp_coordinate(&value),
                "tiff:Make" => make = Some(value.clone()),
                "tiff:Model" => model = Some(value.clone()),
                "exif:DateTimeOriginal" | "photoshop:DateCreated" | "xmp:CreateDate" => {
                    date = date.or(Some(value.clone()));
                }
                _ => {}
            }
            let shown = if key.ends_with(":image") || key.ends_with("Thumbnails") {
                format!("embedded preview image ({} characters)", value.len())
            } else {
                value
            };
            let entry_group = if key.starts_with("exif:GPS") {
                GPS
            } else {
                group
            };
            self.add(entry_group, key, shown);
        }
        if let (Some(lat), Some(lon)) = (lat, lon)
            && lat.abs() <= 90.0
            && lon.abs() <= 180.0
        {
            self.gps = self.gps.or(Some((lat, lon)));
        }
        if self.camera.is_none() {
            self.camera = exif::join_camera(make.as_deref(), model.as_deref());
        }
        if self.taken_at.is_none() {
            self.taken_at = date.map(|d| d.replace('T', " "));
        }
        if self.entries.len() == before {
            self.add(group, "Data", format!("{} characters", text.len()));
        }
    }

    /// Photoshop image resources (APP13): IPTC records, thumbnails and other blocks.
    fn absorb_photoshop(&mut self, data: &[u8]) {
        self.removable = true;
        let mut pos = 0;
        let mut other_blocks = 0;
        let mut found_iptc = false;
        while let Some(signature) = data.get(pos..pos + 4) {
            if !matches!(signature, b"8BIM" | b"PHUT" | b"AgHg" | b"DCSR" | b"MeSa") {
                break;
            }
            let Some(id) = be16(data, pos + 4) else { break };
            let Some(&name_len) = data.get(pos + 6) else {
                break;
            };
            let mut p = pos + 7 + usize::from(name_len);
            if (1 + usize::from(name_len)) % 2 == 1 {
                p += 1;
            }
            let Some(size) = be32(data, p) else { break };
            let start = p + 4;
            let Some(block) = start.checked_add(size).and_then(|end| data.get(start..end)) else {
                break;
            };
            match id {
                0x0404 => {
                    found_iptc = true;
                    self.absorb_iptc(block);
                }
                0x0409 | 0x040C => self.add(IPTC, "Embedded thumbnail", format!("{size} bytes")),
                // IPTC digest: a checksum, not information.
                0x0425 => {}
                _ => other_blocks += 1,
            }
            pos = start + size + size % 2;
        }
        if other_blocks > 0 {
            self.add(IPTC, "Photoshop data", format!("{other_blocks} blocks"));
        } else if !found_iptc {
            self.add(IPTC, "Photoshop data", format!("{} bytes", data.len()));
        }
    }

    fn absorb_iptc(&mut self, block: &[u8]) {
        self.removable = true;
        let mut pos = 0;
        let mut keywords = Vec::new();
        let mut date = None;
        let mut time = None;
        while pos + 5 <= block.len() && block[pos] == 0x1C {
            let record = block[pos + 1];
            let dataset = block[pos + 2];
            let Some(mut size) = be16(block, pos + 3).map(usize::from) else {
                break;
            };
            let mut start = pos + 5;
            if size & 0x8000 != 0 {
                // Extended dataset: the low bits give the length of the length field.
                let width = size & 0x7FFF;
                let Some(raw) = (width <= 4)
                    .then(|| block.get(start..start + width))
                    .flatten()
                else {
                    break;
                };
                size = raw
                    .iter()
                    .fold(0usize, |acc, &b| (acc << 8) | usize::from(b));
                start += width;
            }
            let Some(raw) = start
                .checked_add(size)
                .and_then(|end| block.get(start..end))
            else {
                break;
            };
            let value = String::from_utf8_lossy(raw).trim().to_string();
            pos = start + size;
            if record != 2 || dataset == 0 {
                continue;
            }
            match dataset {
                55 => date = Some(value.clone()),
                60 => time = Some(value.clone()),
                _ => {}
            }
            if dataset == 25 {
                keywords.push(value);
            } else {
                let key = iptc_name(dataset)
                    .map_or_else(|| format!("Dataset 2:{dataset}"), str::to_string);
                self.add(IPTC, key, &value);
            }
        }
        if !keywords.is_empty() {
            self.add(IPTC, "Keywords", keywords.join(", "));
        }
        if self.taken_at.is_none()
            && let Some(date) =
                date.filter(|d| d.len() == 8 && d.bytes().all(|b| b.is_ascii_digit()))
        {
            let mut text = format!("{}-{}-{}", &date[..4], &date[4..6], &date[6..8]);
            if let Some(time) = time.filter(|t| t.len() >= 6 && t.is_ascii()) {
                text.push_str(&format!(" {}:{}:{}", &time[..2], &time[2..4], &time[4..6]));
            }
            self.taken_at = Some(text);
        }
    }

    fn add_icc(&mut self, profile: &[u8]) {
        self.has_icc = true;
        let description =
            icc_description(profile).unwrap_or_else(|| format!("{} bytes", profile.len()));
        self.add(ICC, "Colour profile", description);
    }

    fn inspect_jpeg(&mut self, bytes: &Bytes, complete: bool, depth: u8) {
        let Ok(jpeg) = Jpeg::from_bytes(bytes.clone()) else {
            self.unreadable = true;
            return;
        };
        let mut icc_parts = Vec::new();
        for segment in jpeg.segments() {
            self.jpeg_segment(segment.marker(), segment.contents(), &mut icc_parts);
        }
        if complete
            && let Some(last) = jpeg.segments().last()
            && last.has_entropy()
        {
            let start = bytes
                .len()
                .saturating_sub(last.len_with_entropy() - last.len());
            let entropy = bytes.slice(start..);
            let scan = scan_entropy(&entropy);
            for segment in &scan.segments {
                if is_app_or_comment(segment.marker) {
                    let contents = entropy.slice(segment.contents.clone());
                    self.jpeg_segment(segment.marker, &contents, &mut icc_parts);
                }
            }
            let trailing = &entropy[scan.end..];
            if trailing.iter().any(|&b| b != 0) {
                self.removable_entry(
                    OTHER,
                    "Data after the image",
                    format!("{} bytes", trailing.len()),
                );
                if depth < 3 && trailing.starts_with(&[0xFF, 0xD8, 0xFF]) {
                    let mut nested = Inspection::default();
                    nested.inspect_jpeg(&entropy.slice(scan.end..), true, depth + 1);
                    if let Some(position) = nested.gps {
                        self.gps = self.gps.or(Some(position));
                        self.add(
                            GPS,
                            "Location in embedded image",
                            format!("{:.6}, {:.6}", position.0, position.1),
                        );
                    }
                    if self.camera.is_none() {
                        self.camera = nested.camera;
                    }
                }
            }
        }
        if self.extended_xmp > 0 {
            self.add(XMP, "Extended XMP", format!("{} bytes", self.extended_xmp));
        }
        if !icc_parts.is_empty() {
            icc_parts.sort_by_key(|(seq, _)| *seq);
            let profile: Vec<u8> = icc_parts
                .iter()
                .flat_map(|(_, part)| part.iter().copied())
                .collect();
            self.add_icc(&profile);
        }
    }

    fn jpeg_segment(&mut self, marker: u8, contents: &Bytes, icc_parts: &mut Vec<(u8, Bytes)>) {
        let len = contents.len();
        match classify_jpeg(marker, contents) {
            JpegKind::Exif => self.absorb_exif(contents),
            JpegKind::Xmp => {
                let text = String::from_utf8_lossy(&contents[XMP_PREFIX.len()..]);
                self.absorb_xmp(&text, XMP);
            }
            JpegKind::XmpExtension => {
                self.removable = true;
                self.extended_xmp += len;
            }
            JpegKind::Photoshop => self.absorb_photoshop(&contents[PHOTOSHOP_PREFIX.len()..]),
            JpegKind::Icc => {
                if len > ICC_PREFIX.len() + 2 {
                    icc_parts.push((
                        contents[ICC_PREFIX.len()],
                        contents.slice(ICC_PREFIX.len() + 2..),
                    ));
                }
            }
            JpegKind::Comment => {
                self.removable_entry(COMMENT, "Comment", String::from_utf8_lossy(contents));
            }
            JpegKind::Jfif => {
                if jfif_thumbnail(contents) {
                    self.removable_entry(OTHER, "JFIF thumbnail", format!("{} bytes", len - 14));
                }
            }
            JpegKind::JfifExtension => {
                self.removable_entry(OTHER, "JFIF thumbnail", format!("{len} bytes"))
            }
            JpegKind::Mpf => {
                self.removable_entry(OTHER, "Multi-picture data (MPF)", format!("{len} bytes"))
            }
            JpegKind::OtherApp => {
                let label: String = contents
                    .iter()
                    .take_while(|b| b.is_ascii_graphic() || **b == b' ')
                    .take(24)
                    .map(|&b| char::from(b))
                    .collect();
                let value = if label.trim().is_empty() {
                    format!("{len} bytes")
                } else {
                    format!("{} ({len} bytes)", label.trim())
                };
                self.removable_entry(
                    OTHER,
                    format!("APP{} segment", marker - markers::APP0),
                    value,
                );
            }
            JpegKind::Adobe | JpegKind::Structural => {}
        }
    }

    fn inspect_png(&mut self, bytes: &Bytes) {
        let Ok(png) = Png::from_bytes(bytes.clone()) else {
            self.unreadable = true;
            return;
        };
        for chunk in png.chunks() {
            let kind = chunk.kind();
            let data = chunk.contents();
            match &kind {
                b"eXIf" => self.absorb_exif(data),
                b"tEXt" => {
                    let (keyword, text) = split_nul(data);
                    let text: String = text.iter().map(|&b| char::from(b)).collect();
                    self.text_chunk(&latin1(keyword), &text);
                }
                b"zTXt" => {
                    let (keyword, rest) = split_nul(data);
                    let text = rest.get(1..).and_then(inflate).unwrap_or_default();
                    let text: String = text.iter().map(|&b| char::from(b)).collect();
                    self.text_chunk(&latin1(keyword), &text);
                }
                b"iTXt" => {
                    let (keyword, rest) = split_nul(data);
                    let compressed = rest.first() == Some(&1);
                    let rest = rest.get(2..).unwrap_or_default();
                    let (_language, rest) = split_nul(rest);
                    let (_translated, text) = split_nul(rest);
                    let text = if compressed {
                        inflate(text).unwrap_or_default()
                    } else {
                        text.to_vec()
                    };
                    self.text_chunk(
                        &String::from_utf8_lossy(keyword),
                        &String::from_utf8_lossy(&text),
                    );
                }
                b"tIME" => {
                    if let Some(t) = data.get(0..7) {
                        let year = u16::from_be_bytes([t[0], t[1]]);
                        self.removable_entry(
                            PNG_TEXT,
                            "Last modified",
                            format!(
                                "{year:04}-{:02}-{:02} {:02}:{:02}:{:02} UTC",
                                t[2], t[3], t[4], t[5], t[6]
                            ),
                        );
                    } else {
                        self.removable = true;
                    }
                }
                b"iCCP" => {
                    let (name, rest) = split_nul(data);
                    self.has_icc = true;
                    let description = rest
                        .get(1..)
                        .and_then(inflate)
                        .and_then(|profile| icc_description(&profile))
                        .unwrap_or_else(|| latin1(name));
                    self.add(ICC, "Colour profile", description);
                }
                other if keep_png_chunk(*other) => {}
                other => self.removable_entry(
                    OTHER,
                    format!("Chunk {}", String::from_utf8_lossy(other)),
                    format!("{} bytes", data.len()),
                ),
            }
        }
        let trailing = bytes.get(png.len()..).unwrap_or_default();
        if trailing.iter().any(|&b| b != 0) {
            self.removable_entry(
                OTHER,
                "Data after the image",
                format!("{} bytes", trailing.len()),
            );
        }
    }

    fn text_chunk(&mut self, keyword: &str, text: &str) {
        self.removable = true;
        if keyword == "XML:com.adobe.xmp" {
            self.absorb_xmp(text, XMP);
            return;
        }
        if let Some(kind) = keyword.strip_prefix("Raw profile type ") {
            // ImageMagick keeps whole metadata blocks as hex text.
            match (kind.to_ascii_lowercase().as_str(), decode_raw_profile(text)) {
                ("exif" | "app1", Some(bytes)) => self.absorb_exif(&bytes),
                ("xmp", Some(bytes)) => self.absorb_xmp(&String::from_utf8_lossy(&bytes), XMP),
                ("iptc" | "8bim", Some(bytes)) => match sniff::find(&bytes, b"8BIM") {
                    Some(at) => self.absorb_photoshop(&bytes[at..]),
                    None => self.absorb_iptc(&bytes),
                },
                (_, _) => self.add(PNG_TEXT, keyword, format!("{} characters", text.len())),
            }
            return;
        }
        self.add(PNG_TEXT, keyword, text);
    }

    fn inspect_webp(&mut self, bytes: &Bytes) {
        let Ok(webp) = WebP::from_bytes(bytes.clone()) else {
            self.unreadable = true;
            return;
        };
        for chunk in webp.chunks() {
            let id = chunk.id();
            let data = chunk.content().data();
            match (&id, data) {
                (b"EXIF", Some(data)) => self.absorb_exif(data),
                (b"XMP ", Some(data)) => self.absorb_xmp(&String::from_utf8_lossy(data), XMP),
                (b"ICCP", Some(data)) => self.add_icc(data),
                (id, _) if WEBP_KEEP.contains(&id) => {}
                (id, _) => self.removable_entry(
                    OTHER,
                    format!("Chunk {}", String::from_utf8_lossy(id).trim()),
                    format!("{} bytes", chunk.len()),
                ),
            }
        }
    }

    fn inspect_gif(&mut self, bytes: &[u8]) {
        let Some(gif) = gif_blocks(bytes) else {
            self.unreadable = true;
            return;
        };
        for block in &gif.blocks {
            match &block.kind {
                GifBlock::Extension(0xFE, _) => {
                    let text = sub_block_data(&bytes[block.range.start + 2..block.range.end]);
                    self.removable_entry(COMMENT, "Comment", String::from_utf8_lossy(&text));
                }
                GifBlock::Extension(0xFF, Some(app)) => match app.as_slice() {
                    b"NETSCAPE2.0" | b"ANIMEXTS1.0" => {}
                    b"XMP DataXMP" => {
                        let raw =
                            &bytes[(block.range.start + 14).min(block.range.end)..block.range.end];
                        self.absorb_xmp(&String::from_utf8_lossy(raw), XMP);
                    }
                    b"ICCRGBG1012" => {
                        let profile =
                            sub_block_data(&bytes[block.range.start + 14..block.range.end]);
                        self.add_icc(&profile);
                    }
                    other => self.removable_entry(
                        OTHER,
                        "Application data",
                        String::from_utf8_lossy(other),
                    ),
                },
                _ => {}
            }
        }
        let trailing = &bytes[gif.end..];
        if trailing.iter().any(|&b| b != 0) {
            self.removable_entry(
                OTHER,
                "Data after the image",
                format!("{} bytes", trailing.len()),
            );
        }
    }

    fn inspect_svg(&mut self, bytes: &[u8]) {
        let text = String::from_utf8_lossy(bytes);
        for found in SVG_METADATA.find_iter(&text) {
            self.removable = true;
            let before = self.entries.len();
            self.absorb_xmp(found.as_str(), SVG);
            // Ignore the boilerplate every editor writes.
            self.entries.retain(|e| {
                !(e.group == SVG
                    && matches!(
                        e.key.as_str(),
                        "dc:format" | "dc:type" | "rdf:about" | "rdf:resource"
                    ))
            });
            if self.entries.len() == before {
                self.add(
                    SVG,
                    "Metadata element",
                    format!("{} characters", found.len()),
                );
            }
        }
        for capture in SVG_EDITOR_ATTRIBUTE.captures_iter(&text) {
            let label = match &capture[1] {
                "sodipodi:docname" => "Inkscape document name",
                "inkscape:export-filename" => "Export file name",
                _ => "Editor data",
            };
            self.removable_entry(SVG, label, xml_unescape(&capture[2]));
        }
    }

    /// AVIF (ISO-BMFF): EXIF and XMP are items of the `meta` box, found through `iinf` and
    /// `iloc`. A file whose boxes cannot be followed is marked unreadable and searched for the
    /// usual signatures instead.
    fn inspect_isobmff(&mut self, bytes: &[u8]) {
        let payloads = match isobmff::payloads(bytes) {
            Ok(payloads) => payloads,
            Err(_) => {
                self.unreadable = true;
                self.scan_isobmff(bytes);
                return;
            }
        };
        for payload in payloads {
            let len = payload.data.len();
            match payload.kind {
                MetadataKind::Exif => {
                    let tiff = isobmff::exif_tiff(&payload.data);
                    if Exif::parse(tiff).is_some() {
                        self.absorb_exif(tiff);
                    } else {
                        self.removable_entry(EXIF, "EXIF item", format!("{len} bytes"));
                    }
                }
                MetadataKind::Xmp if payload.encoded => {
                    self.removable_entry(XMP, "XMP item", format!("{len} bytes (compressed)"));
                }
                MetadataKind::Xmp => {
                    self.absorb_xmp(&String::from_utf8_lossy(&payload.data), XMP);
                }
            }
        }
    }

    /// Signature search for AVIF files whose structure could not be read.
    fn scan_isobmff(&mut self, bytes: &[u8]) {
        let head = &bytes[..bytes.len().min(1 << 20)];
        let mut start = 0;
        let mut items = HashSet::new();
        while let Some(found) = sniff::find(&head[start..], b"infe") {
            let at = start + found;
            start = at + 4;
            let version = head.get(at + 4).copied().unwrap_or(0);
            let type_at = match version {
                2 => at + 4 + 4 + 2 + 2,
                3 => at + 4 + 4 + 4 + 2,
                _ => continue,
            };
            if let Some(kind) = head.get(type_at..type_at + 4) {
                items.insert(kind.to_vec());
            }
        }
        if let Some(at) = sniff::find(bytes, b"Exif\0\0")
            && Exif::parse(&bytes[at..]).is_some()
        {
            self.absorb_exif(&bytes[at..]);
        } else if items.contains(b"Exif".as_slice()) {
            self.removable_entry(EXIF, "EXIF item", "present");
        }
        if let Some(start) = sniff::find(bytes, b"<x:xmpmeta") {
            let end = sniff::find(&bytes[start..], b"</x:xmpmeta>")
                .map_or(bytes.len(), |e| start + e + 12);
            self.absorb_xmp(&String::from_utf8_lossy(&bytes[start..end]), XMP);
        } else if items.contains(b"mime".as_slice()) {
            self.removable_entry(XMP, "XMP item", "present");
        }
    }
}

/// Inspects an image. `complete` is false when `bytes` is only the start of a JPEG (enough for
/// the header segments; data after the image is then not checked).
pub fn inspect(bytes: &Bytes, format: Format, complete: bool) -> Inspection {
    let mut inspection = Inspection::default();
    match format {
        Format::Jpeg => inspection.inspect_jpeg(bytes, complete, 0),
        Format::Png => inspection.inspect_png(bytes),
        Format::Webp => inspection.inspect_webp(bytes),
        Format::Gif => inspection.inspect_gif(bytes),
        Format::Svg => inspection.inspect_svg(bytes),
        Format::Avif => inspection.inspect_isobmff(bytes),
    }
    inspection
}

/// The main EXIF block (TIFF data, without the `Exif\0\0` prefix) of a JPEG, PNG or WebP.
pub fn exif_block(bytes: &Bytes, format: Format) -> Option<Bytes> {
    match format {
        Format::Jpeg => Jpeg::from_bytes(bytes.clone())
            .ok()?
            .segments()
            .iter()
            .find_map(|s| {
                let contents = s.contents();
                (classify_jpeg(s.marker(), contents) == JpegKind::Exif && contents.len() >= 6)
                    .then(|| contents.slice(6..))
            }),
        Format::Png => {
            let png = Png::from_bytes(bytes.clone()).ok()?;
            let data = png.chunk_by_type(*b"eXIf")?.contents();
            let skip = data.len() - exif::tiff_payload(data).len();
            Some(data.slice(skip..))
        }
        Format::Webp => {
            let webp = WebP::from_bytes(bytes.clone()).ok()?;
            let data = webp.chunk_by_id(*b"EXIF")?.content().data()?;
            let skip = data.len() - exif::tiff_payload(data).len();
            Some(data.slice(skip..))
        }
        _ => None,
    }
}

/// EXIF orientation 1–8 (1 when absent).
pub fn orientation(bytes: &Bytes, format: Format) -> u16 {
    exif_block(bytes, format)
        .and_then(|block| Exif::parse(&block))
        .and_then(|exif| exif.orientation())
        .unwrap_or(1)
}

/// The embedded ICC profile, for keeping colours right when an image is re-encoded.
pub fn icc_profile(bytes: &Bytes, format: Format) -> Option<Vec<u8>> {
    match format {
        Format::Jpeg => {
            let jpeg = Jpeg::from_bytes(bytes.clone()).ok()?;
            let mut parts: Vec<(u8, &[u8])> = jpeg
                .segments()
                .iter()
                .filter(|s| classify_jpeg(s.marker(), s.contents()) == JpegKind::Icc)
                .filter_map(|s| {
                    let c = s.contents();
                    Some((*c.get(ICC_PREFIX.len())?, c.get(ICC_PREFIX.len() + 2..)?))
                })
                .collect();
            parts.sort_by_key(|(seq, _)| *seq);
            let profile: Vec<u8> = parts.iter().flat_map(|(_, p)| p.iter().copied()).collect();
            (!profile.is_empty()).then_some(profile)
        }
        Format::Png => {
            let png = Png::from_bytes(bytes.clone()).ok()?;
            let (_, rest) = split_nul(png.chunk_by_type(*b"iCCP")?.contents());
            inflate(rest.get(1..)?)
        }
        Format::Webp => {
            let webp = WebP::from_bytes(bytes.clone()).ok()?;
            Some(webp.chunk_by_id(*b"ICCP")?.content().data()?.to_vec())
        }
        _ => None,
    }
}

/// The colour space an ICC profile is for (`RGB `, `GRAY`, `CMYK`…).
pub fn icc_color_space(profile: &[u8]) -> Option<&[u8]> {
    profile.get(16..20)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JpegKind {
    Exif,
    Xmp,
    XmpExtension,
    Photoshop,
    Icc,
    Comment,
    Jfif,
    JfifExtension,
    Adobe,
    Mpf,
    OtherApp,
    /// Tables, frame and scan headers: the image itself.
    Structural,
}

pub(crate) fn classify_jpeg(marker: u8, contents: &[u8]) -> JpegKind {
    match marker {
        markers::APP0 if contents.starts_with(b"JFIF\0") => JpegKind::Jfif,
        markers::APP0 if contents.starts_with(b"JFXX\0") => JpegKind::JfifExtension,
        markers::APP1 if contents.starts_with(b"Exif\0") => JpegKind::Exif,
        markers::APP1 if contents.starts_with(XMP_PREFIX) => JpegKind::Xmp,
        markers::APP1 if contents.starts_with(XMP_EXTENSION_PREFIX) => JpegKind::XmpExtension,
        markers::APP2 if contents.starts_with(ICC_PREFIX) => JpegKind::Icc,
        markers::APP2 if contents.starts_with(b"MPF\0") => JpegKind::Mpf,
        markers::APP13 if contents.starts_with(PHOTOSHOP_PREFIX) => JpegKind::Photoshop,
        markers::APP14 if contents.starts_with(b"Adobe") => JpegKind::Adobe,
        markers::COM => JpegKind::Comment,
        markers::APP0..=markers::APP15 => JpegKind::OtherApp,
        _ => JpegKind::Structural,
    }
}

pub(crate) fn is_app_or_comment(marker: u8) -> bool {
    matches!(marker, markers::APP0..=markers::APP15 | markers::COM)
}

/// A JFIF header with a thumbnail (width × height > 0 after the 14-byte header).
pub(crate) fn jfif_thumbnail(contents: &[u8]) -> bool {
    contents.len() > 14 || contents.get(12..14).is_some_and(|t| t[0] > 0 && t[1] > 0)
}

#[derive(Debug, Clone)]
pub(crate) struct EntropySegment {
    pub marker: u8,
    /// From the 0xFF of the marker to the end of the segment.
    pub whole: Range<usize>,
    pub contents: Range<usize>,
}

#[derive(Debug, Clone)]
pub(crate) struct EntropyScan {
    /// Marker segments between scans (progressive JPEGs), and anything an editor put there.
    pub segments: Vec<EntropySegment>,
    /// Just after the end-of-image marker (or the end of the data when there is none).
    pub end: usize,
}

/// Walks the data after the first scan header: entropy-coded bytes, more marker segments, up to
/// the end-of-image marker.
pub(crate) fn scan_entropy(data: &[u8]) -> EntropyScan {
    let mut segments = Vec::new();
    let mut i = 0;
    while i + 1 < data.len() {
        if data[i] != 0xFF {
            i += 1;
            continue;
        }
        match data[i + 1] {
            // Stuffed byte, restart markers, fill bytes.
            0x00 | 0xD0..=0xD7 => i += 2,
            0xFF => i += 1,
            markers::EOI => {
                return EntropyScan {
                    segments,
                    end: i + 2,
                };
            }
            0x01 | markers::SOI => i += 2,
            marker => {
                let Some(len) = be16(data, i + 2).map(usize::from) else {
                    break;
                };
                if len < 2 || i + 2 + len > data.len() {
                    break;
                }
                segments.push(EntropySegment {
                    marker,
                    whole: i..i + 2 + len,
                    contents: i + 4..i + 2 + len,
                });
                i += 2 + len;
            }
        }
    }
    EntropyScan {
        segments,
        end: data.len(),
    }
}

pub(crate) const PNG_KEEP: [&[u8; 4]; 17] = [
    b"tRNS", b"gAMA", b"cHRM", b"sRGB", b"iCCP", b"sBIT", b"bKGD", b"pHYs", b"hIST", b"sPLT",
    b"acTL", b"fcTL", b"fdAT", b"cICP", b"mDCV", b"cLLI", b"mDCv",
];

/// Critical chunks (upper-case first letter) and the ancillary chunks that affect rendering.
pub(crate) fn keep_png_chunk(kind: [u8; 4]) -> bool {
    kind[0].is_ascii_uppercase() || PNG_KEEP.contains(&&kind) || &kind == b"cLLi"
}

pub(crate) const WEBP_KEEP: [&[u8; 4]; 7] = [
    b"VP8X", b"VP8 ", b"VP8L", b"ALPH", b"ANIM", b"ANMF", b"ICCP",
];

#[derive(Debug, Clone)]
pub(crate) enum GifBlock {
    /// Signature, screen descriptor and global colour table.
    Header,
    Image,
    /// Label and, for application extensions, the 11-byte identifier.
    Extension(u8, Option<Vec<u8>>),
    Trailer,
}

#[derive(Debug, Clone)]
pub(crate) struct GifPart {
    pub kind: GifBlock,
    pub range: Range<usize>,
}

pub(crate) struct GifLayout {
    pub blocks: Vec<GifPart>,
    /// Just after the trailer.
    pub end: usize,
}

/// Splits a GIF into its blocks. `None` when the structure is broken.
pub(crate) fn gif_blocks(bytes: &[u8]) -> Option<GifLayout> {
    let color_table = |flags: u8| {
        if flags & 0x80 != 0 {
            3usize << ((flags & 7) + 1)
        } else {
            0
        }
    };
    let header_end = 13 + color_table(*bytes.get(10)?);
    if header_end > bytes.len() {
        return None;
    }
    let mut blocks = vec![GifPart {
        kind: GifBlock::Header,
        range: 0..header_end,
    }];
    let mut pos = header_end;
    loop {
        match *bytes.get(pos)? {
            0x2C => {
                let flags = *bytes.get(pos + 9)?;
                // Descriptor (10), local colour table, LZW minimum code size (1), data sub-blocks.
                let data = pos + 10 + color_table(flags) + 1;
                let end = skip_sub_blocks(bytes, data)?;
                blocks.push(GifPart {
                    kind: GifBlock::Image,
                    range: pos..end,
                });
                pos = end;
            }
            0x21 => {
                let label = *bytes.get(pos + 1)?;
                let app = (label == 0xFF && bytes.get(pos + 2) == Some(&11))
                    .then(|| bytes.get(pos + 3..pos + 14).map(<[u8]>::to_vec))
                    .flatten();
                let end = skip_sub_blocks(bytes, pos + 2)?;
                blocks.push(GifPart {
                    kind: GifBlock::Extension(label, app),
                    range: pos..end,
                });
                pos = end;
            }
            0x3B => {
                blocks.push(GifPart {
                    kind: GifBlock::Trailer,
                    range: pos..pos + 1,
                });
                return Some(GifLayout {
                    blocks,
                    end: pos + 1,
                });
            }
            _ => return None,
        }
    }
}

fn skip_sub_blocks(bytes: &[u8], mut pos: usize) -> Option<usize> {
    loop {
        let size = usize::from(*bytes.get(pos)?);
        pos += 1;
        if size == 0 {
            return Some(pos);
        }
        pos += size;
        if pos > bytes.len() {
            return None;
        }
    }
}

/// Concatenated contents of GIF data sub-blocks.
fn sub_block_data(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(&size) = bytes.get(pos) {
        if size == 0 {
            break;
        }
        let Some(chunk) = bytes.get(pos + 1..pos + 1 + usize::from(size)) else {
            break;
        };
        out.extend_from_slice(chunk);
        pos += 1 + usize::from(size);
    }
    out
}

static XMP_ATTRIBUTE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"\s([A-Za-z][\w.-]*):([A-Za-z][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap()
});
static XMP_ELEMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"<([A-Za-z][\w.-]*:[A-Za-z][\w.-]*)(?:\s[^>]*)?>([^<]*)</([A-Za-z][\w.-]*:[A-Za-z][\w.-]*)>").unwrap()
});
static XMP_CONTAINER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)<([A-Za-z][\w.-]*:[A-Za-z][\w.-]*)(?:\s[^>]*)?>\s*<rdf:(?:Seq|Bag|Alt)(?:\s[^>]*)?>(.*?)</rdf:(?:Seq|Bag|Alt)>")
        .unwrap()
});
static XMP_LIST_ITEM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<rdf:li(?:\s[^>]*)?>([^<]*)</rdf:li>").unwrap());
pub(crate) static SVG_METADATA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<metadata\b[^>]*?(?:/>|>.*?</metadata\s*>)").unwrap());
pub(crate) static SVG_EDITOR_ATTRIBUTE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"\s(sodipodi:docname|inkscape:export-filename)\s*=\s*"([^"]*)""#).unwrap()
});

/// `41,0.6N` or `41,0,36N` (XMP GPS coordinate) → decimal degrees.
fn xmp_coordinate(value: &str) -> Option<f64> {
    let value = value.trim();
    let sign = match value.chars().last()?.to_ascii_uppercase() {
        'N' | 'E' => 1.0,
        'S' | 'W' => -1.0,
        _ => return None,
    };
    let numbers = &value[..value.len() - 1];
    let parts: Vec<f64> = numbers
        .split(',')
        .map(|p| p.trim().parse::<f64>().ok())
        .collect::<Option<_>>()?;
    let decimal = match parts[..] {
        [d] => d,
        [d, m] => d + m / 60.0,
        [d, m, s] => d + m / 60.0 + s / 3600.0,
        _ => return None,
    };
    decimal.is_finite().then_some(sign * decimal)
}

fn xml_unescape(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest.find(';').filter(|&e| e <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn iptc_name(dataset: u8) -> Option<&'static str> {
    Some(match dataset {
        5 => "Title",
        7 => "Edit status",
        10 => "Urgency",
        15 => "Category",
        20 => "Supplemental category",
        40 => "Special instructions",
        55 => "Date created",
        60 => "Time created",
        62 => "Digital creation date",
        63 => "Digital creation time",
        65 => "Originating program",
        70 => "Program version",
        80 => "Author",
        85 => "Author title",
        90 => "City",
        92 => "Sublocation",
        95 => "Province or state",
        100 => "Country code",
        101 => "Country",
        103 => "Job identifier",
        105 => "Headline",
        110 => "Credit",
        115 => "Source",
        116 => "Copyright notice",
        118 => "Contact",
        120 => "Caption",
        122 => "Caption writer",
        _ => return None,
    })
}

/// The `desc` tag of an ICC profile (v2 `desc` or v4 `mluc`).
pub fn icc_description(profile: &[u8]) -> Option<String> {
    let count = be32(profile, 128)?.min(256);
    for i in 0..count {
        let entry = 132 + i * 12;
        if profile.get(entry..entry + 4)? != b"desc" {
            continue;
        }
        let offset = be32(profile, entry + 4)?;
        let size = be32(profile, entry + 8)?;
        let tag = profile.get(offset..offset.checked_add(size)?)?;
        let text = match tag.get(0..4)? {
            b"desc" => {
                let len = be32(tag, 8)?;
                let raw = tag.get(12..12usize.checked_add(len)?)?;
                String::from_utf8_lossy(raw).into_owned()
            }
            b"mluc" => {
                if be32(tag, 8)? == 0 {
                    return None;
                }
                let len = be32(tag, 20)?;
                let start = be32(tag, 24)?;
                let raw = tag.get(start..start.checked_add(len)?)?;
                let units: Vec<u16> = raw
                    .chunks_exact(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                String::from_utf16_lossy(&units)
            }
            _ => return None,
        };
        let text = text
            .trim_matches(|c: char| c == '\0' || c.is_whitespace())
            .to_string();
        return (!text.is_empty()).then_some(text);
    }
    None
}

fn decode_raw_profile(text: &str) -> Option<Vec<u8>> {
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    let _name = lines.next()?;
    let length: usize = lines.next()?.parse().ok()?;
    if length > MAX_INFLATED as usize {
        return None;
    }
    let digits: Vec<u8> = lines
        .flat_map(|l| l.bytes())
        .filter(u8::is_ascii_hexdigit)
        .collect();
    let mut out = Vec::with_capacity(length.min(digits.len() / 2));
    for pair in digits.chunks_exact(2).take(length) {
        let hex = |b: u8| (b as char).to_digit(16).unwrap_or(0) as u8;
        out.push((hex(pair[0]) << 4) | hex(pair[1]));
    }
    (!out.is_empty()).then_some(out)
}

fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    flate2::read::ZlibDecoder::new(data)
        .take(MAX_INFLATED)
        .read_to_end(&mut out)
        .ok()?;
    Some(out)
}

fn split_nul(data: &[u8]) -> (&[u8], &[u8]) {
    match data.iter().position(|&b| b == 0) {
        Some(at) => (&data[..at], &data[at + 1..]),
        None => (data, &[]),
    }
}

fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| char::from(b)).collect()
}

fn be16(data: &[u8], offset: usize) -> Option<u16> {
    let b = data.get(offset..offset.checked_add(2)?)?;
    Some(u16::from_be_bytes([b[0], b[1]]))
}

fn be32(data: &[u8], offset: usize) -> Option<usize> {
    let b = data.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_xmp_properties_and_coordinates() {
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description rdf:about=""
            xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="41,0.6N"
            exif:GPSLongitude="28,58,30W" tiff:Make="Apple" tiff:Model="iPhone 15"
            xmp:CreatorTool="Lightroom &amp; co">
            <dc:creator><rdf:Seq><rdf:li>Gizli Yazar</rdf:li></rdf:Seq></dc:creator>
            <photoshop:City>İstanbul</photoshop:City>
            </rdf:Description></rdf:RDF></x:xmpmeta>"#;
        let mut inspection = Inspection::default();
        inspection.absorb_xmp(xmp, XMP);
        let (lat, lon) = inspection.gps.unwrap();
        assert!((lat - 41.01).abs() < 1e-9);
        assert!((lon + 28.975).abs() < 1e-3);
        assert_eq!(inspection.camera.as_deref(), Some("Apple iPhone 15"));
        let find = |key: &str| {
            inspection
                .entries
                .iter()
                .find(|e| e.key == key)
                .map(|e| e.value.clone())
        };
        assert_eq!(find("dc:creator").as_deref(), Some("Gizli Yazar"));
        assert_eq!(find("photoshop:City").as_deref(), Some("İstanbul"));
        assert_eq!(find("xmp:CreatorTool").as_deref(), Some("Lightroom & co"));
        assert!(find("xmlns:exif").is_none());
        assert!(inspection.removable);
    }

    #[test]
    fn reads_iptc_records() {
        let mut iim = Vec::new();
        for (dataset, value) in [
            (80u8, "Ali"),
            (90, "Ankara"),
            (25, "a"),
            (25, "b"),
            (55, "20261003"),
        ] {
            iim.extend_from_slice(&[0x1C, 2, dataset]);
            iim.extend_from_slice(&(value.len() as u16).to_be_bytes());
            iim.extend_from_slice(value.as_bytes());
        }
        let mut block = b"8BIM\x04\x04\0\0".to_vec();
        block.extend_from_slice(&(iim.len() as u32).to_be_bytes());
        block.extend_from_slice(&iim);
        if iim.len() % 2 == 1 {
            block.push(0);
        }
        let mut inspection = Inspection::default();
        inspection.absorb_photoshop(&block);
        let values: Vec<(&str, &str)> = inspection
            .entries
            .iter()
            .map(|e| (e.key.as_str(), e.value.as_str()))
            .collect();
        assert!(values.contains(&("Author", "Ali")));
        assert!(values.contains(&("City", "Ankara")));
        assert!(values.contains(&("Keywords", "a, b")));
        assert_eq!(inspection.taken_at.as_deref(), Some("2026-10-03"));
        // Truncated data is ignored, not trusted.
        for len in 0..block.len() {
            Inspection::default().absorb_photoshop(&block[..len]);
        }
    }

    #[test]
    fn reads_icc_descriptions() {
        let mut profile = vec![0u8; 128];
        profile[16..20].copy_from_slice(b"RGB ");
        profile.extend_from_slice(&1u32.to_be_bytes());
        profile.extend_from_slice(b"desc");
        profile.extend_from_slice(&144u32.to_be_bytes());
        let text = b"Display P3\0";
        profile.extend_from_slice(&(12 + text.len() as u32).to_be_bytes());
        profile.extend_from_slice(b"desc\0\0\0\0");
        profile.extend_from_slice(&(text.len() as u32).to_be_bytes());
        profile.extend_from_slice(text);
        assert_eq!(icc_description(&profile).as_deref(), Some("Display P3"));
        assert_eq!(icc_color_space(&profile), Some(b"RGB ".as_slice()));
        for len in 0..profile.len() {
            let _ = icc_description(&profile[..len]);
        }
    }

    #[test]
    fn decodes_imagemagick_raw_profiles() {
        let text = "\nexif\n       4\n4578 6966\n";
        assert_eq!(decode_raw_profile(text), Some(b"Exif".to_vec()));
        assert_eq!(decode_raw_profile("garbage"), None);
    }

    #[test]
    fn finds_jpeg_end_and_inline_segments() {
        // scan data with a stuffed 0xFF, a restart marker, a COM segment, EOI, then a trailer.
        let data = [
            0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0xFF, 0xFE, 0x00, 0x04, b'h', b'i', 0x56, 0xFF,
            0xD9, 1, 2,
        ];
        let scan = scan_entropy(&data);
        assert_eq!(scan.end, 15);
        assert_eq!(scan.segments.len(), 1);
        assert_eq!(scan.segments[0].marker, markers::COM);
        assert_eq!(&data[scan.segments[0].contents.clone()], b"hi");
        for len in 0..data.len() {
            let _ = scan_entropy(&data[..len]);
        }
    }

    #[test]
    fn unescapes_xml() {
        assert_eq!(
            xml_unescape("a &amp; b &#x130; &#305; &bogus; &"),
            "a & b İ ı &bogus; &"
        );
    }
}
