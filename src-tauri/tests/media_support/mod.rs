//! Shared helpers for the media tests: tiny images built in memory and metadata injected with
//! `img-parts`.
#![allow(dead_code)]

use std::fs;
use std::io::Cursor;
use std::path::Path;

use image::{DynamicImage, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};
use img_parts::jpeg::{Jpeg, JpegSegment, markers};
use img_parts::png::{Png, PngChunk};
use img_parts::webp::WebP;
use img_parts::{Bytes, ImageEXIF, ImageICC};

pub fn site() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("hugo.toml"), "title = \"x\"\n").unwrap();
    fs::create_dir_all(dir.path().join("content")).unwrap();
    dir
}

pub fn write(root: &Path, relative: &str, bytes: &[u8]) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

pub fn rgb(width: u32, height: u32) -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_fn(width, height, |x, y| {
        Rgb([
            (x * 7 % 256) as u8,
            (y * 13 % 256) as u8,
            ((x + y) * 3 % 256) as u8,
        ])
    }))
}

pub fn rgba(width: u32, height: u32) -> DynamicImage {
    DynamicImage::ImageRgba8(RgbaImage::from_fn(width, height, |x, y| {
        Rgba([
            (x * 7 % 256) as u8,
            (y * 13 % 256) as u8,
            90,
            ((x * y) % 256) as u8,
        ])
    }))
}

pub fn encode(image: &DynamicImage, format: ImageFormat) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    image.write_to(&mut out, format).unwrap();
    out.into_inner()
}

pub fn jpeg(width: u32, height: u32) -> Vec<u8> {
    encode(&rgb(width, height), ImageFormat::Jpeg)
}

pub fn png(width: u32, height: u32) -> Vec<u8> {
    encode(&rgb(width, height), ImageFormat::Png)
}

pub fn webp(width: u32, height: u32) -> Vec<u8> {
    encode(&rgb(width, height), ImageFormat::WebP)
}

pub fn gif(width: u32, height: u32) -> Vec<u8> {
    encode(&rgb(width, height), ImageFormat::Gif)
}

pub fn pixels(bytes: &[u8]) -> Vec<u8> {
    image::load_from_memory(bytes)
        .unwrap()
        .to_rgba8()
        .into_raw()
}

pub const LAT: f64 = 41.0 + 0.0 / 60.0 + 36.0 / 3600.0;
pub const LON: f64 = 28.0 + 58.0 / 60.0 + 30.0 / 3600.0;

/// A big-endian TIFF block: camera, orientation, Exif IFD (date taken, lens, serial number) and a
/// GPS IFD at 41.01 N, 28.975 E.
pub fn camera_exif(orientation: u16) -> Vec<u8> {
    let mut tiff = Tiff::default();
    tiff.ascii(0, 0x010F, "Canon");
    tiff.ascii(0, 0x0110, "Canon EOS R6");
    tiff.short(0, 0x0112, orientation);
    tiff.ascii(0, 0x013B, "Gizli Yazar");
    tiff.ascii(1, 0x9003, "2026:10:03 12:34:56");
    tiff.ascii(1, 0x9011, "+03:00");
    tiff.ascii(1, 0xA434, "RF24-105mm F4 L IS USM");
    tiff.ascii(1, 0xA431, "012345678901");
    tiff.ascii(2, 0x0001, "N");
    tiff.rationals(2, 0x0002, &[(41, 1), (0, 1), (36, 1)]);
    tiff.ascii(2, 0x0003, "E");
    tiff.rationals(2, 0x0004, &[(28, 1), (58, 1), (3000, 100)]);
    tiff.build()
}

/// Only an orientation tag (what stripping keeps), little-endian.
pub fn orientation_exif(orientation: u16) -> Vec<u8> {
    let mut tiff = Tiff::default();
    tiff.short(0, 0x0112, orientation);
    tiff.build()
}

/// (tag, type, count, raw value bytes)
type TiffEntry = (u16, u16, u32, Vec<u8>);

#[derive(Default)]
pub struct Tiff {
    /// Entries of IFD0, the Exif IFD and the GPS IFD.
    ifds: [Vec<TiffEntry>; 3],
}

impl Tiff {
    pub fn ascii(&mut self, ifd: usize, tag: u16, text: &str) {
        let mut raw = text.as_bytes().to_vec();
        raw.push(0);
        self.ifds[ifd].push((tag, 2, raw.len() as u32, raw));
    }

    pub fn short(&mut self, ifd: usize, tag: u16, value: u16) {
        self.ifds[ifd].push((tag, 3, 1, value.to_be_bytes().to_vec()));
    }

    pub fn rationals(&mut self, ifd: usize, tag: u16, values: &[(u32, u32)]) {
        let raw = values
            .iter()
            .flat_map(|(n, d)| [n.to_be_bytes(), d.to_be_bytes()].concat())
            .collect();
        self.ifds[ifd].push((tag, 5, values.len() as u32, raw));
    }

    pub fn build(mut self) -> Vec<u8> {
        let ifd_len = |entries: usize| 2 + entries * 12 + 4;
        // IFD0 gets pointer entries to the sub-IFDs that have entries.
        let has_exif = !self.ifds[1].is_empty();
        let has_gps = !self.ifds[2].is_empty();
        let ifd0_entries = self.ifds[0].len() + has_exif as usize + has_gps as usize;
        let ifd0_at = 8;
        let exif_at = ifd0_at + ifd_len(ifd0_entries);
        let gps_at = exif_at
            + if has_exif {
                ifd_len(self.ifds[1].len())
            } else {
                0
            };
        let mut data_at = gps_at
            + if has_gps {
                ifd_len(self.ifds[2].len())
            } else {
                0
            };
        if has_exif {
            self.ifds[0].push((0x8769, 4, 1, (exif_at as u32).to_be_bytes().to_vec()));
        }
        if has_gps {
            self.ifds[0].push((0x8825, 4, 1, (gps_at as u32).to_be_bytes().to_vec()));
        }
        let mut out = b"MM\0*".to_vec();
        out.extend_from_slice(&(ifd0_at as u32).to_be_bytes());
        let mut extra = Vec::new();
        for entries in &mut self.ifds {
            if entries.is_empty() {
                continue;
            }
            entries.sort_by_key(|e| e.0);
            out.extend_from_slice(&(entries.len() as u16).to_be_bytes());
            for (tag, kind, count, raw) in entries.iter() {
                out.extend_from_slice(&tag.to_be_bytes());
                out.extend_from_slice(&kind.to_be_bytes());
                out.extend_from_slice(&count.to_be_bytes());
                if raw.len() <= 4 {
                    let mut inline = raw.clone();
                    inline.resize(4, 0);
                    out.extend_from_slice(&inline);
                } else {
                    out.extend_from_slice(&(data_at as u32).to_be_bytes());
                    data_at += raw.len();
                    extra.extend_from_slice(raw);
                }
            }
            out.extend_from_slice(&0u32.to_be_bytes());
        }
        out.extend_from_slice(&extra);
        out
    }
}

/// A fake but well-formed RGB ICC profile with a `desc` tag.
pub fn icc_profile(description: &str) -> Vec<u8> {
    let mut profile = vec![0u8; 128];
    profile[12..16].copy_from_slice(b"mntr");
    profile[16..20].copy_from_slice(b"RGB ");
    profile[36..40].copy_from_slice(b"acsp");
    profile.extend_from_slice(&1u32.to_be_bytes());
    profile.extend_from_slice(b"desc");
    profile.extend_from_slice(&144u32.to_be_bytes());
    let text = format!("{description}\0");
    profile.extend_from_slice(&(12 + text.len() as u32).to_be_bytes());
    profile.extend_from_slice(b"desc\0\0\0\0");
    profile.extend_from_slice(&(text.len() as u32).to_be_bytes());
    profile.extend_from_slice(text.as_bytes());
    let len = profile.len() as u32;
    profile[0..4].copy_from_slice(&len.to_be_bytes());
    profile
}

pub fn xmp_packet(extra: &str) -> String {
    format!(
        r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Lightroom" {extra}/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#
    )
}

pub fn with_jpeg_exif(jpeg: &[u8], tiff: Vec<u8>) -> Vec<u8> {
    let mut image = Jpeg::from_bytes(Bytes::copy_from_slice(jpeg)).unwrap();
    image.set_exif(Some(tiff.into()));
    image.encoder().bytes().to_vec()
}

pub fn with_jpeg_icc(jpeg: &[u8], profile: Vec<u8>) -> Vec<u8> {
    let mut image = Jpeg::from_bytes(Bytes::copy_from_slice(jpeg)).unwrap();
    image.set_icc_profile(Some(profile.into()));
    image.encoder().bytes().to_vec()
}

/// Inserts a raw segment right after SOI.
pub fn with_jpeg_segment(jpeg: &[u8], marker: u8, contents: Vec<u8>) -> Vec<u8> {
    let mut image = Jpeg::from_bytes(Bytes::copy_from_slice(jpeg)).unwrap();
    image
        .segments_mut()
        .insert(0, JpegSegment::new_with_contents(marker, contents.into()));
    image.encoder().bytes().to_vec()
}

pub fn jpeg_xmp(xmp: &str) -> Vec<u8> {
    let mut contents = b"http://ns.adobe.com/xap/1.0/\0".to_vec();
    contents.extend_from_slice(xmp.as_bytes());
    contents
}

/// APP13 contents with IPTC records (dataset, value).
pub fn jpeg_iptc(records: &[(u8, &str)]) -> Vec<u8> {
    let mut iim = Vec::new();
    for (dataset, value) in records {
        iim.extend_from_slice(&[0x1C, 2, *dataset]);
        iim.extend_from_slice(&(value.len() as u16).to_be_bytes());
        iim.extend_from_slice(value.as_bytes());
    }
    let mut contents = b"Photoshop 3.0\08BIM\x04\x04\0\0".to_vec();
    contents.extend_from_slice(&(iim.len() as u32).to_be_bytes());
    contents.extend_from_slice(&iim);
    if iim.len() % 2 == 1 {
        contents.push(0);
    }
    contents
}

pub const APP1: u8 = markers::APP1;
pub const APP13: u8 = markers::APP13;
pub const COM: u8 = markers::COM;

pub fn png_chunk(png: &[u8], kind: &[u8; 4], contents: &[u8], before_idat: bool) -> Vec<u8> {
    let mut image = Png::from_bytes(Bytes::copy_from_slice(png)).unwrap();
    let chunks = image.chunks_mut();
    let at = if before_idat {
        chunks.iter().position(|c| &c.kind() == b"IDAT").unwrap()
    } else {
        chunks.len() - 1
    };
    chunks.insert(at, PngChunk::new(*kind, Bytes::copy_from_slice(contents)));
    image.encoder().bytes().to_vec()
}

pub fn png_chunk_kinds(png: &[u8]) -> Vec<String> {
    Png::from_bytes(Bytes::copy_from_slice(png))
        .unwrap()
        .chunks()
        .iter()
        .map(|c| String::from_utf8_lossy(&c.kind()).into_owned())
        .collect()
}

pub fn png_chunk_data(png: &[u8], kind: &[u8; 4]) -> Vec<Vec<u8>> {
    Png::from_bytes(Bytes::copy_from_slice(png))
        .unwrap()
        .chunks()
        .iter()
        .filter(|c| &c.kind() == kind)
        .map(|c| c.contents().to_vec())
        .collect()
}

pub fn with_webp_exif(webp: &[u8], tiff: Vec<u8>) -> Vec<u8> {
    let mut image = WebP::from_bytes(Bytes::copy_from_slice(webp)).unwrap();
    image.set_exif(Some(tiff.into()));
    image.encoder().bytes().to_vec()
}

pub fn webp_chunk_ids(webp: &[u8]) -> Vec<String> {
    WebP::from_bytes(Bytes::copy_from_slice(webp))
        .unwrap()
        .chunks()
        .iter()
        .map(|c| String::from_utf8_lossy(&c.id()).into_owned())
        .collect()
}

/// The JPEG scan: from the first SOS marker through EOI.
pub fn jpeg_scan(jpeg: &[u8]) -> &[u8] {
    let start = jpeg.windows(2).position(|w| w == [0xFF, 0xDA]).unwrap();
    let end = jpeg.windows(2).rposition(|w| w == [0xFF, 0xD9]).unwrap() + 2;
    &jpeg[start..end]
}

// ---------------------------------------------------------------------------
// AVIF, built box by box (there is no AVIF encoder here; the image item is opaque bytes)

pub fn bmff_box(kind: &[u8; 4], content: &[u8]) -> Vec<u8> {
    let mut out = ((content.len() + 8) as u32).to_be_bytes().to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(content);
    out
}

pub fn full_box(kind: &[u8; 4], version: u8, content: &[u8]) -> Vec<u8> {
    let mut body = vec![version, 0, 0, 0];
    body.extend_from_slice(content);
    bmff_box(kind, &body)
}

/// One item of a hand-built AVIF file.
#[derive(Debug, Clone)]
pub struct AvifItem {
    pub id: u16,
    pub kind: [u8; 4],
    pub content_type: Option<&'static str>,
    pub data: Vec<u8>,
    /// Stored in `idat` (construction method 1) instead of `mdat`.
    pub in_idat: bool,
    /// Replaces the computed (file or idat) offset of the item's extent.
    pub offset: Option<u32>,
}

impl AvifItem {
    pub fn new(id: u16, kind: &[u8; 4], data: Vec<u8>) -> Self {
        AvifItem {
            id,
            kind: *kind,
            content_type: None,
            data,
            in_idat: false,
            offset: None,
        }
    }

    pub fn exif(id: u16, tiff: Vec<u8>) -> Self {
        let mut data = vec![0, 0, 0, 6];
        data.extend_from_slice(b"Exif\0\0");
        data.extend(tiff);
        AvifItem::new(id, b"Exif", data)
    }

    pub fn xmp(id: u16, packet: &str) -> Self {
        AvifItem {
            content_type: Some("application/rdf+xml"),
            ..AvifItem::new(id, b"mime", packet.as_bytes().to_vec())
        }
    }
}

/// Opaque bytes standing in for the AV1 bitstream of the primary image.
pub fn av1_data(len: usize) -> Vec<u8> {
    (0..len)
        .map(|i| (i as u8).wrapping_mul(31) ^ 0x5A)
        .collect()
}

/// An AVIF file: ftyp, meta (hdlr, pitm, iloc v1, iinf, iref, iprp with ispe, idat) and mdat.
/// Item 1 is the primary image; every other item describes it (`cdsc`).
pub fn avif(width: u32, height: u32, items: &[AvifItem], extra_top: &[Vec<u8>]) -> Vec<u8> {
    let build = |mdat_content: u32| -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let mut mdat = Vec::new();
        let mut idat = Vec::new();
        let mut iloc = vec![0x44, 0x00]; // offset 4, length 4, base offset 0, index 0
        iloc.extend_from_slice(&(items.len() as u16).to_be_bytes());
        for item in items {
            let offset = if item.in_idat {
                let at = idat.len() as u32;
                idat.extend_from_slice(&item.data);
                at
            } else {
                let at = mdat_content + mdat.len() as u32;
                mdat.extend_from_slice(&item.data);
                at
            };
            iloc.extend_from_slice(&item.id.to_be_bytes());
            iloc.extend_from_slice(&u16::from(item.in_idat).to_be_bytes());
            iloc.extend_from_slice(&0u16.to_be_bytes()); // data reference index
            iloc.extend_from_slice(&1u16.to_be_bytes()); // extent count
            iloc.extend_from_slice(&item.offset.unwrap_or(offset).to_be_bytes());
            iloc.extend_from_slice(&(item.data.len() as u32).to_be_bytes());
        }
        let mut iinf = (items.len() as u16).to_be_bytes().to_vec();
        for item in items {
            let mut infe = item.id.to_be_bytes().to_vec();
            infe.extend_from_slice(&[0, 0]);
            infe.extend_from_slice(&item.kind);
            infe.push(0); // empty name
            if let Some(content_type) = item.content_type {
                infe.extend_from_slice(content_type.as_bytes());
                infe.push(0);
            }
            iinf.extend(full_box(b"infe", 2, &infe));
        }
        let mut cdsc = Vec::new();
        for item in items.iter().filter(|i| i.id != 1) {
            let mut reference = item.id.to_be_bytes().to_vec();
            reference.extend_from_slice(&1u16.to_be_bytes());
            reference.extend_from_slice(&1u16.to_be_bytes());
            cdsc.extend(bmff_box(b"cdsc", &reference));
        }
        let mut ispe = width.to_be_bytes().to_vec();
        ispe.extend_from_slice(&height.to_be_bytes());
        let ipco = bmff_box(b"ipco", &full_box(b"ispe", 0, &ispe));
        let ipma = full_box(b"ipma", 0, &[0, 0, 0, 1, 0, 1, 1, 0x01]);
        let mut iprp = ipco;
        iprp.extend(ipma);
        let mut hdlr = vec![0; 4];
        hdlr.extend_from_slice(b"pict");
        hdlr.extend_from_slice(&[0; 13]);
        let mut meta = full_box(b"hdlr", 0, &hdlr);
        meta.extend(full_box(b"pitm", 0, &1u16.to_be_bytes()));
        meta.extend(full_box(b"iloc", 1, &iloc));
        meta.extend(full_box(b"iinf", 0, &iinf));
        meta.extend(full_box(b"iref", 0, &cdsc));
        meta.extend(bmff_box(b"iprp", &iprp));
        if !idat.is_empty() {
            meta.extend(bmff_box(b"idat", &idat));
        }
        (full_box(b"meta", 0, &meta), mdat, idat)
    };
    let ftyp = bmff_box(b"ftyp", b"avif\0\0\0\0avifmif1miaf");
    let (meta, _, _) = build(0);
    let extra: Vec<u8> = extra_top.concat();
    let mdat_content = (ftyp.len() + meta.len() + extra.len() + 8) as u32;
    let (meta, mdat, _) = build(mdat_content);
    let mut out = ftyp;
    out.extend(meta);
    out.extend(extra);
    out.extend(bmff_box(b"mdat", &mdat));
    out
}

/// A JPEG with an MPF index (APP2 right after SOI) listing `appended` as a second image placed
/// after the main one.
pub fn with_mpf_image(main: &[u8], appended: &[u8]) -> Vec<u8> {
    let mpf = |offset: u32| {
        let mut contents = b"MPF\0MM\0*\0\0\0\x08".to_vec();
        contents.extend_from_slice(&1u16.to_be_bytes());
        contents.extend_from_slice(&0xB002u16.to_be_bytes());
        contents.extend_from_slice(&7u16.to_be_bytes());
        contents.extend_from_slice(&32u32.to_be_bytes());
        contents.extend_from_slice(&26u32.to_be_bytes());
        contents.extend_from_slice(&0u32.to_be_bytes());
        for (size, at) in [(0u32, 0u32), (appended.len() as u32, offset)] {
            contents.extend_from_slice(&0u32.to_be_bytes());
            contents.extend_from_slice(&size.to_be_bytes());
            contents.extend_from_slice(&at.to_be_bytes());
            contents.extend_from_slice(&[0; 4]);
        }
        contents
    };
    let first = with_jpeg_segment(main, markers::APP2, mpf(0));
    // Offsets count from the TIFF header: SOI (2), marker and length (4), "MPF\0" (4).
    let offset = (first.len() - 10) as u32;
    let mut out = with_jpeg_segment(main, markers::APP2, mpf(offset));
    out.extend_from_slice(appended);
    out
}
