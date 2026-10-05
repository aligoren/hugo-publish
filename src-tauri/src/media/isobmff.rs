//! AVIF (ISO base media file format): where EXIF and XMP live, and removing them in place.
//!
//! In AVIF, EXIF and XMP are *items* of the top-level `meta` box. `iinf` lists the items (an
//! `infe` with item type `Exif`, or `mime` with content type `application/rdf+xml`) and `iloc`
//! says where each item's bytes are: in `mdat` (construction method 0, file offsets) or in the
//! `idat` box inside `meta` (method 1).
//!
//! Removing an item for real would mean rewriting `iinf`, `iloc`, `iref` and `ipma` and moving
//! every file offset behind it. Instead, the item's bytes are overwritten with zeros and its type
//! is changed to [`CLEARED_ITEM_TYPE`]: readers (libavif, libheif, browsers) skip items whose type
//! they do not know, and every other byte of the file stays exactly where it was. A top-level
//! `uuid` box with XMP (an older way to store it) becomes a `free` box full of zeros.
//!
//! Everything here works on untrusted bytes: parsers bound-check and return an error instead of
//! guessing, so a file that cannot be read is never changed.

use std::ops::Range;

/// The type metadata items get once cleaned. It is not an image, metadata or derivation type, so
/// readers ignore the item.
pub const CLEARED_ITEM_TYPE: &[u8; 4] = b"skip";

/// `uuid` of the XMP box (Adobe XMP specification, part 3).
const XMP_UUID: [u8; 16] = [
    0xBE, 0x7A, 0xCF, 0xCB, 0x97, 0xA9, 0x42, 0xE8, 0x9C, 0x71, 0x99, 0x94, 0x91, 0xE3, 0xAF, 0xAC,
];

/// At most this many items or extents are read (real files have a handful).
const MAX_ENTRIES: usize = 4096;

pub type ParseResult<T> = Result<T, String>;

/// A box: its type and where its header, content and end are in the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoxRef {
    pub kind: [u8; 4],
    pub start: usize,
    /// First byte after the header (after the user type of a `uuid` box).
    pub content: usize,
    pub end: usize,
}

fn read_box(bytes: &[u8], at: usize, limit: usize) -> ParseResult<BoxRef> {
    let header = bytes
        .get(
            at..at
                .checked_add(8)
                .filter(|&e| e <= limit)
                .ok_or("truncated box header")?,
        )
        .ok_or("truncated box header")?;
    let kind = [header[4], header[5], header[6], header[7]];
    let (size, mut content) = match u32::from_be_bytes([header[0], header[1], header[2], header[3]])
    {
        // To the end of the enclosing box (or file).
        0 => ((limit - at) as u64, at + 8),
        1 => {
            let mut reader = Reader::new(bytes, at + 8, limit);
            (reader.u64()?, at + 16)
        }
        n => (u64::from(n), at + 8),
    };
    if &kind == b"uuid" {
        content += 16;
    }
    let end = usize::try_from(size)
        .ok()
        .and_then(|size| at.checked_add(size))
        .ok_or("box size overflows")?;
    if end < content || end > limit {
        return Err(format!(
            "the {} box does not fit its container",
            String::from_utf8_lossy(&kind)
        ));
    }
    Ok(BoxRef {
        kind,
        start: at,
        content,
        end,
    })
}

fn children(bytes: &[u8], start: usize, end: usize) -> ParseResult<Vec<BoxRef>> {
    let mut boxes = Vec::new();
    let mut at = start;
    while at < end {
        let found = read_box(bytes, at, end)?;
        at = found.end;
        boxes.push(found);
        if boxes.len() > MAX_ENTRIES {
            return Err("too many boxes".into());
        }
    }
    Ok(boxes)
}

/// Big-endian fields of one box.
struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
    end: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8], pos: usize, end: usize) -> Self {
        Reader {
            bytes,
            pos,
            end: end.min(bytes.len()),
        }
    }

    fn take(&mut self, n: usize) -> ParseResult<&'a [u8]> {
        let end = self
            .pos
            .checked_add(n)
            .filter(|&e| e <= self.end)
            .ok_or("a box ends too early")?;
        let slice = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    fn u8(&mut self) -> ParseResult<u8> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> ParseResult<u16> {
        let b = self.take(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    fn u32(&mut self) -> ParseResult<u32> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn u64(&mut self) -> ParseResult<u64> {
        let b = self.take(8)?;
        Ok(u64::from_be_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }

    /// An unsigned field of 0, 4 or 8 bytes (`iloc`).
    fn sized(&mut self, size: u8) -> ParseResult<u64> {
        match size {
            0 => Ok(0),
            4 => self.u32().map(u64::from),
            8 => self.u64(),
            other => Err(format!("unsupported iloc field size {other}")),
        }
    }

    /// A NUL-terminated UTF-8 string; a missing terminator ends it at the box end.
    fn cstr(&mut self) -> String {
        let rest = &self.bytes[self.pos.min(self.end)..self.end];
        let len = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());
        self.pos = (self.pos + len + 1).min(self.end);
        String::from_utf8_lossy(&rest[..len]).into_owned()
    }

    fn at_end(&self) -> bool {
        self.pos >= self.end
    }
}

/// One `infe` entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub id: u32,
    /// `None` for version 0 and 1 entries, which have no item type.
    pub item_type: Option<[u8; 4]>,
    /// Offset of the item type in the file.
    pub type_at: Option<usize>,
    pub content_type: Option<String>,
    pub content_encoding: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Location {
    id: u32,
    construction_method: u8,
    data_reference_index: u16,
    base_offset: u64,
    /// (offset, length) pairs.
    extents: Vec<(u64, u64)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetadataKind {
    Exif,
    Xmp,
}

/// An EXIF or XMP item and where its bytes are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetadataItem {
    pub id: u32,
    pub kind: MetadataKind,
    pub type_at: Option<usize>,
    pub ranges: Vec<Range<usize>>,
    /// The payload is compressed (`content_encoding`), so it cannot be read as text.
    pub encoded: bool,
}

/// The parts of an AVIF file that matter for metadata.
#[derive(Debug, Clone, Default)]
pub struct Layout {
    pub items: Vec<Item>,
    locations: Vec<Location>,
    idat: Option<Range<usize>>,
    mdats: Vec<Range<usize>>,
    /// Top-level `uuid` boxes holding XMP.
    pub xmp_boxes: Vec<BoxRef>,
    len: usize,
}

/// Reads the box structure. Fails for anything it cannot follow exactly.
pub fn parse(bytes: &[u8]) -> ParseResult<Layout> {
    // Some writers pad the file with zeros after the last box.
    let end = bytes.len();
    let mut top = Vec::new();
    let mut at = 0;
    while at < end {
        if end - at < 8 && bytes[at..end].iter().all(|&b| b == 0) {
            break;
        }
        let found = read_box(bytes, at, end)?;
        at = found.end;
        top.push(found);
        if top.len() > MAX_ENTRIES {
            return Err("too many boxes".into());
        }
    }
    if top.first().map(|b| &b.kind) != Some(b"ftyp") {
        return Err("the file does not start with an ftyp box".into());
    }
    let metas: Vec<&BoxRef> = top.iter().filter(|b| &b.kind == b"meta").collect();
    let [meta] = metas[..] else {
        return Err(if metas.is_empty() {
            "there is no meta box".into()
        } else {
            "there is more than one meta box".into()
        });
    };
    let mut layout = Layout {
        len: bytes.len(),
        mdats: top
            .iter()
            .filter(|b| &b.kind == b"mdat")
            .map(|b| b.content..b.end)
            .collect(),
        xmp_boxes: top
            .iter()
            .filter(|b| {
                &b.kind == b"uuid" && bytes.get(b.content - 16..b.content) == Some(&XMP_UUID)
            })
            .copied()
            .collect(),
        ..Layout::default()
    };
    // `meta` is a full box: version and flags come first.
    let meta_children = children(bytes, meta.content + 4, meta.end)?;
    let single = |kind: &[u8; 4]| -> ParseResult<Option<BoxRef>> {
        let mut found = meta_children.iter().filter(|b| &b.kind == kind);
        let first = found.next().copied();
        if found.next().is_some() {
            return Err(format!(
                "more than one {} box",
                String::from_utf8_lossy(kind)
            ));
        }
        Ok(first)
    };
    if let Some(idat) = single(b"idat")? {
        layout.idat = Some(idat.content..idat.end);
    }
    if let Some(iinf) = single(b"iinf")? {
        layout.items = parse_iinf(bytes, &iinf)?;
    }
    if let Some(iloc) = single(b"iloc")? {
        layout.locations = parse_iloc(bytes, &iloc)?;
    }
    Ok(layout)
}

fn parse_iinf(bytes: &[u8], iinf: &BoxRef) -> ParseResult<Vec<Item>> {
    let mut reader = Reader::new(bytes, iinf.content, iinf.end);
    let version = reader.u8()?;
    reader.take(3)?;
    if version == 0 {
        reader.u16()?;
    } else {
        reader.u32()?;
    }
    let mut items = Vec::new();
    for entry in children(bytes, reader.pos, iinf.end)? {
        if &entry.kind == b"infe" {
            items.push(parse_infe(bytes, &entry)?);
        }
    }
    Ok(items)
}

fn parse_infe(bytes: &[u8], infe: &BoxRef) -> ParseResult<Item> {
    let mut reader = Reader::new(bytes, infe.content, infe.end);
    let version = reader.u8()?;
    reader.take(3)?;
    let mut item = Item {
        id: 0,
        item_type: None,
        type_at: None,
        content_type: None,
        content_encoding: None,
    };
    if version >= 2 {
        item.id = if version == 2 {
            u32::from(reader.u16()?)
        } else {
            reader.u32()?
        };
        reader.u16()?; // protection index
        item.type_at = Some(reader.pos);
        let kind = reader.take(4)?;
        let kind = [kind[0], kind[1], kind[2], kind[3]];
        item.item_type = Some(kind);
        reader.cstr(); // name
        if &kind == b"mime" {
            item.content_type = Some(reader.cstr());
            if !reader.at_end() {
                item.content_encoding = Some(reader.cstr());
            }
        }
    } else {
        item.id = u32::from(reader.u16()?);
        reader.u16()?;
        reader.cstr();
        item.content_type = Some(reader.cstr());
        if !reader.at_end() {
            item.content_encoding = Some(reader.cstr());
        }
    }
    Ok(item)
}

fn parse_iloc(bytes: &[u8], iloc: &BoxRef) -> ParseResult<Vec<Location>> {
    let mut reader = Reader::new(bytes, iloc.content, iloc.end);
    let version = reader.u8()?;
    reader.take(3)?;
    if version > 2 {
        return Err(format!("iloc version {version} is not supported"));
    }
    let sizes = reader.u16()?;
    let offset_size = (sizes >> 12) as u8;
    let length_size = ((sizes >> 8) & 0xF) as u8;
    let base_offset_size = ((sizes >> 4) & 0xF) as u8;
    let index_size = if version >= 1 { (sizes & 0xF) as u8 } else { 0 };
    let count = if version < 2 {
        u32::from(reader.u16()?)
    } else {
        reader.u32()?
    } as usize;
    if count > MAX_ENTRIES {
        return Err("too many items".into());
    }
    let mut locations = Vec::with_capacity(count);
    for _ in 0..count {
        let id = if version < 2 {
            u32::from(reader.u16()?)
        } else {
            reader.u32()?
        };
        let construction_method = if version >= 1 {
            (reader.u16()? & 0xF) as u8
        } else {
            0
        };
        let data_reference_index = reader.u16()?;
        let base_offset = reader.sized(base_offset_size)?;
        let extent_count = usize::from(reader.u16()?);
        let mut extents = Vec::with_capacity(extent_count.min(64));
        for _ in 0..extent_count {
            if index_size > 0 {
                reader.sized(index_size)?;
            }
            let offset = reader.sized(offset_size)?;
            let length = reader.sized(length_size)?;
            extents.push((offset, length));
        }
        locations.push(Location {
            id,
            construction_method,
            data_reference_index,
            base_offset,
            extents,
        });
    }
    Ok(locations)
}

fn metadata_kind(item: &Item) -> Option<MetadataKind> {
    match item.item_type.as_ref() {
        Some(b"Exif") => Some(MetadataKind::Exif),
        Some(b"mime") | None => {
            let content_type = item.content_type.as_deref()?;
            let essence = content_type.split(';').next().unwrap_or("").trim();
            essence
                .eq_ignore_ascii_case("application/rdf+xml")
                .then_some(MetadataKind::Xmp)
        }
        _ => None,
    }
}

impl Layout {
    /// Where an item's bytes are. `strict` refuses what cannot be pinned down to exact ranges of
    /// this file (data in other files or other items, "to the end" extents); otherwise those are
    /// widened (to the end of the file or `idat`) or skipped.
    fn ranges(&self, location: &Location, strict: bool) -> ParseResult<Vec<Range<usize>>> {
        if location.data_reference_index != 0 || location.construction_method == 2 {
            return if strict {
                Err(format!("item {} is stored by reference", location.id))
            } else {
                Ok(Vec::new())
            };
        }
        let container = match location.construction_method {
            0 => 0..self.len,
            1 => self
                .idat
                .clone()
                .ok_or_else(|| format!("item {} points into a missing idat box", location.id))?,
            other => return Err(format!("unknown construction method {other}")),
        };
        let mut ranges = Vec::with_capacity(location.extents.len());
        for &(offset, length) in &location.extents {
            let start = location
                .base_offset
                .checked_add(offset)
                .and_then(|o| usize::try_from(o).ok())
                .and_then(|o| o.checked_add(container.start))
                .ok_or("an item offset overflows")?;
            let end = if length == 0 {
                if strict {
                    return Err(format!("item {} has an open-ended extent", location.id));
                }
                container.end
            } else {
                usize::try_from(length)
                    .ok()
                    .and_then(|l| start.checked_add(l))
                    .ok_or("an item length overflows")?
            };
            if start > end || end > container.end {
                return Err(format!("item {} lies outside the file", location.id));
            }
            ranges.push(start..end);
        }
        Ok(ranges)
    }

    fn location(&self, id: u32) -> Option<&Location> {
        self.locations.iter().find(|l| l.id == id)
    }

    /// The EXIF and XMP items, with their exact byte ranges.
    pub fn metadata_items(&self) -> ParseResult<Vec<MetadataItem>> {
        let mut found = Vec::new();
        for item in &self.items {
            let Some(kind) = metadata_kind(item) else {
                continue;
            };
            let ranges = match self.location(item.id) {
                Some(location) => self.ranges(location, true)?,
                None => Vec::new(),
            };
            found.push(MetadataItem {
                id: item.id,
                kind,
                type_at: item.type_at,
                ranges,
                encoded: item
                    .content_encoding
                    .as_deref()
                    .is_some_and(|e| !e.trim().is_empty()),
            });
        }
        Ok(found)
    }

    /// Byte ranges of every item that is not EXIF or XMP (the image data).
    fn other_ranges(&self, metadata: &[MetadataItem]) -> ParseResult<Vec<Range<usize>>> {
        let mut ranges = Vec::new();
        for location in &self.locations {
            if metadata.iter().any(|m| m.id == location.id) {
                continue;
            }
            ranges.extend(self.ranges(location, false)?);
        }
        Ok(ranges)
    }
}

/// An EXIF or XMP payload found in the file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Payload {
    pub kind: MetadataKind,
    pub data: Vec<u8>,
    pub encoded: bool,
}

/// The metadata payloads of a file.
pub fn payloads(bytes: &[u8]) -> ParseResult<Vec<Payload>> {
    let layout = parse(bytes)?;
    let mut found: Vec<Payload> = layout
        .metadata_items()?
        .into_iter()
        .map(|item| Payload {
            kind: item.kind,
            data: item
                .ranges
                .iter()
                .flat_map(|r| bytes[r.clone()].iter().copied())
                .collect(),
            encoded: item.encoded,
        })
        .collect();
    found.extend(layout.xmp_boxes.iter().map(|b| Payload {
        kind: MetadataKind::Xmp,
        data: bytes[b.content..b.end].to_vec(),
        encoded: false,
    }));
    Ok(found)
}

/// The TIFF data of an EXIF item: a 4-byte offset to the TIFF header comes first.
pub fn exif_tiff(payload: &[u8]) -> &[u8] {
    let Some(offset) = payload
        .get(0..4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
    else {
        return payload;
    };
    let rest = &payload[4..];
    match rest.get(offset..) {
        Some(tiff) if tiff.starts_with(b"II*\0") || tiff.starts_with(b"MM\0*") => tiff,
        _ => rest,
    }
}

/// The file with EXIF and XMP blanked out; every other byte is left where it was. A file without
/// metadata comes back unchanged.
pub fn strip(bytes: &[u8]) -> ParseResult<Vec<u8>> {
    let layout = parse(bytes)?;
    let metadata = layout.metadata_items()?;
    let mut out = bytes.to_vec();
    if metadata.is_empty() && layout.xmp_boxes.is_empty() {
        return Ok(out);
    }
    let image = layout.other_ranges(&metadata)?;
    let inside = |range: &Range<usize>| {
        layout
            .mdats
            .iter()
            .chain(layout.idat.iter())
            .any(|c| c.start <= range.start && range.end <= c.end)
    };
    for item in &metadata {
        for range in &item.ranges {
            if !inside(range) {
                return Err(format!(
                    "item {} is not inside an mdat or idat box",
                    item.id
                ));
            }
            if image
                .iter()
                .any(|r| r.start < range.end && range.start < r.end)
            {
                return Err(format!("item {} shares bytes with the image", item.id));
            }
        }
    }
    for item in &metadata {
        for range in &item.ranges {
            out[range.clone()].fill(0);
        }
        if let Some(at) = item.type_at {
            out[at..at + 4].copy_from_slice(CLEARED_ITEM_TYPE);
        }
    }
    for b in &layout.xmp_boxes {
        out[b.start + 4..b.start + 8].copy_from_slice(b"free");
        // The user type was part of the header; in a `free` box it is just content.
        out[b.content - 16..b.end].fill(0);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxed(kind: &[u8; 4], content: &[u8]) -> Vec<u8> {
        let mut out = ((content.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(content);
        out
    }

    #[test]
    fn reads_box_headers() {
        let data = boxed(b"ftyp", b"avif\0\0\0\0");
        assert_eq!(
            read_box(&data, 0, data.len()).unwrap(),
            BoxRef {
                kind: *b"ftyp",
                start: 0,
                content: 8,
                end: 16
            }
        );
        // 64-bit size.
        let mut large = 1u32.to_be_bytes().to_vec();
        large.extend_from_slice(b"mdat");
        large.extend_from_slice(&20u64.to_be_bytes());
        large.extend_from_slice(&[7, 7, 7, 7]);
        assert_eq!(read_box(&large, 0, large.len()).unwrap().content, 16);
        // Size 0: to the end.
        let open = [0, 0, 0, 0, b'm', b'd', b'a', b't', 1, 2, 3];
        assert_eq!(read_box(&open, 0, open.len()).unwrap().end, 11);
        assert!(read_box(&[0, 0, 0, 40, b'm', b'd', b'a', b't'], 0, 8).is_err());
        assert!(read_box(&[0, 0, 0, 4, b'm', b'd', b'a', b't'], 0, 8).is_err());
        assert!(read_box(&[0, 0, 0], 0, 3).is_err());
    }

    #[test]
    fn finds_exif_tiff_data() {
        let mut payload = vec![0, 0, 0, 6];
        payload.extend_from_slice(b"Exif\0\0MM\0*rest");
        assert_eq!(exif_tiff(&payload), b"MM\0*rest");
        let mut plain = vec![0, 0, 0, 0];
        plain.extend_from_slice(b"II*\0x");
        assert_eq!(exif_tiff(&plain), b"II*\0x");
        assert_eq!(exif_tiff(b"ab"), b"ab");
    }

    #[test]
    fn classifies_items() {
        let item = |item_type: Option<&[u8; 4]>, content_type: Option<&str>| Item {
            id: 1,
            item_type: item_type.copied(),
            type_at: None,
            content_type: content_type.map(str::to_string),
            content_encoding: None,
        };
        assert_eq!(
            metadata_kind(&item(Some(b"Exif"), None)),
            Some(MetadataKind::Exif)
        );
        assert_eq!(
            metadata_kind(&item(
                Some(b"mime"),
                Some("application/rdf+xml; charset=utf-8")
            )),
            Some(MetadataKind::Xmp)
        );
        assert_eq!(
            metadata_kind(&item(None, Some("APPLICATION/RDF+XML"))),
            Some(MetadataKind::Xmp)
        );
        assert_eq!(
            metadata_kind(&item(Some(b"mime"), Some("text/plain"))),
            None
        );
        assert_eq!(metadata_kind(&item(Some(b"av01"), None)), None);
        assert_eq!(metadata_kind(&item(Some(b"skip"), None)), None);
    }
}
