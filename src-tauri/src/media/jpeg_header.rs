//! Reading only what a JPEG says about itself: its segments up to the first scan, and the same
//! for the extra images its MPF index lists (the previews phones and cameras append after the
//! main image). No compressed image data is read, however large the file or its segments are.

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::ops::Range;
use std::path::Path;

const SOI: u8 = 0xD8;
const EOI: u8 = 0xD9;
const SOS: u8 = 0xDA;
const APP2: u8 = 0xE2;
/// MPF tag holding the list of images.
const MP_ENTRY: u16 = 0xB002;
/// At most this many embedded images are followed.
const MAX_EMBEDDED: usize = 8;

/// The header segments of a JPEG file and of the images its MPF index points to.
#[derive(Debug, Clone, Default)]
pub struct JpegHeaders {
    /// The start of the file, byte for byte, through the first scan header.
    pub main: Vec<u8>,
    /// The same for each image the MPF index lists after the main one.
    pub embedded: Vec<Vec<u8>>,
}

fn read_exact_or_end<R: Read>(reader: &mut R, buf: &mut [u8]) -> io::Result<bool> {
    match reader.read_exact(buf) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
        Err(e) => Err(e),
    }
}

fn next_byte<R: Read>(reader: &mut R) -> io::Result<Option<u8>> {
    let mut byte = [0u8];
    Ok(read_exact_or_end(reader, &mut byte)?.then_some(byte[0]))
}

/// Reads from SOI through the first SOS segment (or EOI), keeping every byte as it is in the
/// stream. `None` when the stream is not a JPEG, ends inside a segment, or the header grows past
/// `limit` bytes.
pub fn read_header<R: Read>(reader: &mut R, limit: u64) -> io::Result<Option<Vec<u8>>> {
    let mut out = vec![0u8; 2];
    if !read_exact_or_end(reader, &mut out)? || out != [0xFF, SOI] {
        return Ok(None);
    }
    loop {
        if next_byte(reader)? != Some(0xFF) {
            return Ok(None);
        }
        out.push(0xFF);
        // Any number of 0xFF fill bytes may come before the marker.
        let marker = loop {
            let Some(byte) = next_byte(reader)? else {
                return Ok(None);
            };
            out.push(byte);
            if byte != 0xFF {
                break byte;
            }
        };
        match marker {
            EOI => return Ok(Some(out)),
            // Markers without a length.
            0x01 | 0xD0..=0xD7 => continue,
            0x00 => return Ok(None),
            _ => {}
        }
        let mut length = [0u8; 2];
        if !read_exact_or_end(reader, &mut length)? {
            return Ok(None);
        }
        let len = usize::from(u16::from_be_bytes(length));
        if len < 2 {
            return Ok(None);
        }
        out.extend_from_slice(&length);
        let start = out.len();
        out.resize(start + len - 2, 0);
        if !read_exact_or_end(reader, &mut out[start..])? {
            return Ok(None);
        }
        if marker == SOS {
            return Ok(Some(out));
        }
        if out.len() as u64 > limit {
            return Ok(None);
        }
    }
}

/// `(marker, contents)` of each segment in a header read by [`read_header`].
fn segments(header: &[u8]) -> Vec<(u8, Range<usize>)> {
    let mut found = Vec::new();
    let mut pos = 2;
    while pos + 1 < header.len() {
        if header[pos] != 0xFF {
            break;
        }
        while pos + 1 < header.len() && header[pos + 1] == 0xFF {
            pos += 1;
        }
        let Some(&marker) = header.get(pos + 1) else {
            break;
        };
        pos += 2;
        if matches!(marker, 0x01 | 0xD0..=0xD7) {
            continue;
        }
        if marker == EOI {
            break;
        }
        let Some(len) = header
            .get(pos..pos + 2)
            .map(|b| usize::from(u16::from_be_bytes([b[0], b[1]])))
        else {
            break;
        };
        let end = pos + len.max(2);
        if end > header.len() {
            break;
        }
        found.push((marker, pos + 2..end));
        pos = end;
    }
    found
}

/// File offsets of the images an MPF segment lists after the main image.
pub fn mpf_images(header: &[u8]) -> Vec<u64> {
    let Some((_, contents)) = segments(header)
        .into_iter()
        .find(|(marker, c)| *marker == APP2 && header[c.clone()].starts_with(b"MPF\0"))
    else {
        return Vec::new();
    };
    let tiff_start = contents.start + 4;
    let tiff = &header[tiff_start..contents.end];
    let little = match tiff.get(0..4) {
        Some(b"II*\0") => true,
        Some(b"MM\0*") => false,
        _ => return Vec::new(),
    };
    let u16_at = |at: usize| {
        tiff.get(at..at.checked_add(2)?).map(|b| {
            if little {
                u16::from_le_bytes([b[0], b[1]])
            } else {
                u16::from_be_bytes([b[0], b[1]])
            }
        })
    };
    let u32_at = |at: usize| {
        tiff.get(at..at.checked_add(4)?).map(|b| {
            let b = [b[0], b[1], b[2], b[3]];
            if little {
                u32::from_le_bytes(b)
            } else {
                u32::from_be_bytes(b)
            }
        })
    };
    let Some(ifd) = u32_at(4).map(|o| o as usize) else {
        return Vec::new();
    };
    let count = usize::from(u16_at(ifd).unwrap_or(0));
    let mut images = Vec::new();
    for i in 0..count.min(64) {
        let entry = ifd + 2 + i * 12;
        if u16_at(entry) != Some(MP_ENTRY) {
            continue;
        }
        let Some(bytes) = u32_at(entry + 4).map(|n| n as usize) else {
            break;
        };
        let Some(data) = u32_at(entry + 8).map(|o| o as usize) else {
            break;
        };
        // 16 bytes per image: attributes, size, offset, two dependent image entries.
        for n in 0..(bytes / 16).min(MAX_EMBEDDED + 1) {
            let at = data + n * 16;
            let (Some(size), Some(offset)) = (u32_at(at + 4), u32_at(at + 8)) else {
                break;
            };
            // The first image (offset 0) is the file itself.
            if offset > 0 && size > 0 {
                images.push(tiff_start as u64 + u64::from(offset));
            }
        }
    }
    images.truncate(MAX_EMBEDDED);
    images
}

/// The headers of a JPEG file and its MPF images. `None` when the file is not a JPEG whose header
/// can be read this way.
pub fn read_headers(path: &Path, limit: u64) -> io::Result<Option<JpegHeaders>> {
    let mut file = BufReader::new(File::open(path)?);
    let Some(main) = read_header(&mut file, limit)? else {
        return Ok(None);
    };
    let mut embedded = Vec::new();
    for offset in mpf_images(&main) {
        file.seek(SeekFrom::Start(offset))?;
        if let Some(header) = read_header(&mut file, limit)? {
            embedded.push(header);
        }
    }
    Ok(Some(JpegHeaders { main, embedded }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(marker: u8, contents: &[u8]) -> Vec<u8> {
        let mut out = vec![0xFF, marker];
        out.extend_from_slice(&((contents.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(contents);
        out
    }

    #[test]
    fn stops_at_the_first_scan() {
        let mut file = vec![0xFF, SOI];
        file.extend(segment(0xE1, b"Exif\0\0data"));
        file.extend([0xFF, 0xFF]); // fill bytes
        file.extend(segment(0xDB, &[0; 5]));
        file.extend(segment(SOS, &[1, 2, 3]));
        let header_len = file.len();
        file.extend([0x12, 0x34, 0xFF, 0x00, 0x56, 0xFF, EOI]);
        let header = read_header(&mut file.as_slice(), 1 << 20).unwrap().unwrap();
        assert_eq!(header, file[..header_len]);
        let markers: Vec<u8> = segments(&header).iter().map(|(m, _)| *m).collect();
        assert_eq!(markers, [0xE1, 0xDB, SOS]);
        assert_eq!(&header[segments(&header)[0].1.clone()], b"Exif\0\0data");
    }

    #[test]
    fn gives_up_on_broken_or_other_files() {
        let read = |bytes: &[u8]| read_header(&mut &bytes[..], 1 << 20).unwrap();
        assert_eq!(read(b"\x89PNG\r\n"), None);
        assert_eq!(read(&[0xFF, SOI, 0xFF, 0xE1, 0x00, 0x10, 1, 2]), None);
        assert_eq!(read(&[0xFF, SOI, 0x00]), None);
        assert_eq!(read(&[0xFF, SOI, 0xFF, 0xE1, 0x00, 0x01]), None);
        assert_eq!(read(&[]), None);
        // Over the limit.
        let mut big = vec![0xFF, SOI];
        big.extend(segment(0xE1, &[0; 100]));
        big.extend(segment(SOS, &[]));
        assert_eq!(read_header(&mut big.as_slice(), 50).unwrap(), None);
        // EOI before any scan still ends the header.
        assert_eq!(
            read(&[0xFF, SOI, 0xFF, EOI]),
            Some(vec![0xFF, SOI, 0xFF, EOI])
        );
    }

    #[test]
    fn reads_mpf_image_offsets() {
        // Big-endian MPF: IFD with one MPEntry tag pointing at two 16-byte entries.
        let mut tiff = b"MM\0*\0\0\0\x08".to_vec();
        tiff.extend_from_slice(&1u16.to_be_bytes());
        tiff.extend_from_slice(&MP_ENTRY.to_be_bytes());
        tiff.extend_from_slice(&7u16.to_be_bytes());
        tiff.extend_from_slice(&32u32.to_be_bytes());
        tiff.extend_from_slice(&26u32.to_be_bytes());
        tiff.extend_from_slice(&0u32.to_be_bytes());
        for (size, offset) in [(1000u32, 0u32), (500, 4000)] {
            tiff.extend_from_slice(&0u32.to_be_bytes());
            tiff.extend_from_slice(&size.to_be_bytes());
            tiff.extend_from_slice(&offset.to_be_bytes());
            tiff.extend_from_slice(&[0; 4]);
        }
        let mut contents = b"MPF\0".to_vec();
        contents.extend(tiff);
        let mut header = vec![0xFF, SOI];
        header.extend(segment(APP2, &contents));
        header.extend(segment(SOS, &[]));
        // TIFF data starts after SOI (2), marker and length (4) and "MPF\0" (4).
        assert_eq!(mpf_images(&header), vec![10 + 4000]);
        assert!(mpf_images(&[0xFF, SOI, 0xFF, EOI]).is_empty());
    }
}
