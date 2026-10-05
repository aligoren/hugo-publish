//! A small, defensive TIFF/EXIF reader: IFD0, the Exif and GPS sub-IFDs, the interoperability
//! IFD and IFD1 (the embedded thumbnail). Every offset is bounds-checked; malformed data yields
//! fewer fields, never a panic.

use std::collections::HashSet;

/// Which directory a field came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Ifd {
    /// IFD0: the main image (camera make and model, software, artist…).
    Primary,
    Exif,
    Gps,
    Interop,
    /// IFD1: the embedded thumbnail.
    Thumbnail,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// BYTE, SBYTE and UNDEFINED.
    Bytes(Vec<u8>),
    Ascii(String),
    Short(Vec<u16>),
    Long(Vec<u32>),
    Rational(Vec<(u32, u32)>),
    SShort(Vec<i16>),
    SLong(Vec<i32>),
    SRational(Vec<(i32, i32)>),
    Float(Vec<f32>),
    Double(Vec<f64>),
}

impl Value {
    /// The first value as an unsigned integer (BYTE, SHORT, LONG).
    pub fn first_uint(&self) -> Option<u32> {
        match self {
            Value::Bytes(v) => v.first().map(|&b| u32::from(b)),
            Value::Short(v) => v.first().map(|&s| u32::from(s)),
            Value::Long(v) => v.first().copied(),
            Value::SShort(v) => v.first().and_then(|&s| u32::try_from(s).ok()),
            Value::SLong(v) => v.first().and_then(|&s| u32::try_from(s).ok()),
            _ => None,
        }
    }

    /// Value number `index` as a float (rationals divided, integers converted).
    pub fn float_at(&self, index: usize) -> Option<f64> {
        let value = match self {
            Value::Rational(v) => {
                let (n, d) = *v.get(index)?;
                (d != 0).then(|| f64::from(n) / f64::from(d))?
            }
            Value::SRational(v) => {
                let (n, d) = *v.get(index)?;
                (d != 0).then(|| f64::from(n) / f64::from(d))?
            }
            Value::Short(v) => f64::from(*v.get(index)?),
            Value::Long(v) => f64::from(*v.get(index)?),
            Value::SShort(v) => f64::from(*v.get(index)?),
            Value::SLong(v) => f64::from(*v.get(index)?),
            Value::Float(v) => f64::from(*v.get(index)?),
            Value::Double(v) => *v.get(index)?,
            Value::Bytes(v) => f64::from(*v.get(index)?),
            Value::Ascii(_) => return None,
        };
        value.is_finite().then_some(value)
    }

    fn len(&self) -> usize {
        match self {
            Value::Bytes(v) => v.len(),
            Value::Ascii(s) => s.len(),
            Value::Short(v) => v.len(),
            Value::Long(v) => v.len(),
            Value::Rational(v) => v.len(),
            Value::SShort(v) => v.len(),
            Value::SLong(v) => v.len(),
            Value::SRational(v) => v.len(),
            Value::Float(v) => v.len(),
            Value::Double(v) => v.len(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub ifd: Ifd,
    pub tag: u16,
    pub value: Value,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Exif {
    pub fields: Vec<Field>,
    /// Size of the embedded JPEG thumbnail (IFD1), when there is one.
    pub thumbnail_len: Option<usize>,
    /// A GPS directory exists (even without usable coordinates).
    pub has_gps_ifd: bool,
}

pub mod tags {
    pub const IMAGE_DESCRIPTION: u16 = 0x010E;
    pub const MAKE: u16 = 0x010F;
    pub const MODEL: u16 = 0x0110;
    pub const ORIENTATION: u16 = 0x0112;
    pub const SOFTWARE: u16 = 0x0131;
    pub const DATE_TIME: u16 = 0x0132;
    pub const ARTIST: u16 = 0x013B;
    pub const COPYRIGHT: u16 = 0x8298;
    pub const EXIF_IFD: u16 = 0x8769;
    pub const GPS_IFD: u16 = 0x8825;
    pub const INTEROP_IFD: u16 = 0xA005;
    pub const THUMBNAIL_OFFSET: u16 = 0x0201;
    pub const THUMBNAIL_LENGTH: u16 = 0x0202;
    pub const DATE_TIME_ORIGINAL: u16 = 0x9003;
    pub const DATE_TIME_DIGITIZED: u16 = 0x9004;
    pub const OFFSET_TIME_ORIGINAL: u16 = 0x9011;
    pub const LENS_MODEL: u16 = 0xA434;
    pub const BODY_SERIAL_NUMBER: u16 = 0xA431;
    pub const GPS_LATITUDE_REF: u16 = 0x0001;
    pub const GPS_LATITUDE: u16 = 0x0002;
    pub const GPS_LONGITUDE_REF: u16 = 0x0003;
    pub const GPS_LONGITUDE: u16 = 0x0004;
}

/// Directories nested deeper than this are ignored (real files use at most 3 levels).
const MAX_DEPTH: usize = 4;
/// Entries read per directory; real directories have a few dozen.
const MAX_ENTRIES: usize = 1024;

struct Reader<'a> {
    data: &'a [u8],
    little_endian: bool,
}

impl Reader<'_> {
    fn bytes<const N: usize>(&self, offset: usize) -> Option<[u8; N]> {
        let end = offset.checked_add(N)?;
        self.data.get(offset..end)?.try_into().ok()
    }

    fn u16(&self, offset: usize) -> Option<u16> {
        let b = self.bytes::<2>(offset)?;
        Some(if self.little_endian {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        })
    }

    fn u32(&self, offset: usize) -> Option<u32> {
        let b = self.bytes::<4>(offset)?;
        Some(if self.little_endian {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        })
    }

    fn u64(&self, offset: usize) -> Option<u64> {
        let b = self.bytes::<8>(offset)?;
        Some(if self.little_endian {
            u64::from_le_bytes(b)
        } else {
            u64::from_be_bytes(b)
        })
    }

    fn decode(&self, kind: u16, count: usize, offset: usize) -> Option<Value> {
        let read = |size: usize| -> Option<Vec<usize>> {
            Some((0..count).map(|i| offset + i * size).collect())
        };
        Some(match kind {
            1 | 6 | 7 => Value::Bytes(self.data.get(offset..offset.checked_add(count)?)?.to_vec()),
            2 => {
                let raw = self.data.get(offset..offset.checked_add(count)?)?;
                let text = raw.split(|&b| b == 0).next().unwrap_or_default();
                Value::Ascii(String::from_utf8_lossy(text).trim().to_string())
            }
            3 => Value::Short(
                read(2)?
                    .into_iter()
                    .map(|o| self.u16(o))
                    .collect::<Option<_>>()?,
            ),
            4 | 13 => Value::Long(
                read(4)?
                    .into_iter()
                    .map(|o| self.u32(o))
                    .collect::<Option<_>>()?,
            ),
            5 => Value::Rational(
                read(8)?
                    .into_iter()
                    .map(|o| Some((self.u32(o)?, self.u32(o + 4)?)))
                    .collect::<Option<_>>()?,
            ),
            8 => Value::SShort(
                read(2)?
                    .into_iter()
                    .map(|o| self.u16(o).map(|v| v as i16))
                    .collect::<Option<_>>()?,
            ),
            9 => Value::SLong(
                read(4)?
                    .into_iter()
                    .map(|o| self.u32(o).map(|v| v as i32))
                    .collect::<Option<_>>()?,
            ),
            10 => Value::SRational(
                read(8)?
                    .into_iter()
                    .map(|o| Some((self.u32(o)? as i32, self.u32(o + 4)? as i32)))
                    .collect::<Option<_>>()?,
            ),
            11 => Value::Float(
                read(4)?
                    .into_iter()
                    .map(|o| self.u32(o).map(f32::from_bits))
                    .collect::<Option<_>>()?,
            ),
            12 => Value::Double(
                read(8)?
                    .into_iter()
                    .map(|o| self.u64(o).map(f64::from_bits))
                    .collect::<Option<_>>()?,
            ),
            _ => return None,
        })
    }
}

fn type_size(kind: u16) -> Option<usize> {
    match kind {
        1 | 2 | 6 | 7 => Some(1),
        3 | 8 => Some(2),
        4 | 9 | 11 | 13 => Some(4),
        5 | 10 | 12 => Some(8),
        _ => None,
    }
}

/// Removes the `Exif\0\0` prefix used by JPEG APP1 (and some PNG/WebP writers).
pub fn tiff_payload(data: &[u8]) -> &[u8] {
    data.strip_prefix(b"Exif\0\0")
        .or_else(|| data.strip_prefix(b"Exif\0\xFF"))
        .unwrap_or(data)
}

impl Exif {
    /// Parses a TIFF structure (`II*\0` / `MM\0*`), with or without the `Exif\0\0` prefix.
    /// Returns `None` when the header is not TIFF.
    pub fn parse(data: &[u8]) -> Option<Exif> {
        let data = tiff_payload(data);
        let little_endian = match data.get(0..4)? {
            b"II*\0" => true,
            b"MM\0*" => false,
            _ => return None,
        };
        let reader = Reader {
            data,
            little_endian,
        };
        let mut exif = Exif::default();
        let mut visited = HashSet::new();
        let first = reader.u32(4)? as usize;
        exif.read_ifd(&reader, first, Ifd::Primary, 0, &mut visited);
        Some(exif)
    }

    fn read_ifd(
        &mut self,
        reader: &Reader,
        offset: usize,
        ifd: Ifd,
        depth: usize,
        visited: &mut HashSet<usize>,
    ) {
        if depth > MAX_DEPTH || offset < 8 || !visited.insert(offset) {
            return;
        }
        let Some(declared) = reader.u16(offset) else {
            return;
        };
        if ifd == Ifd::Gps {
            self.has_gps_ifd = true;
        }
        let available = reader.data.len().saturating_sub(offset + 2) / 12;
        let count = usize::from(declared).min(available).min(MAX_ENTRIES);
        let mut nested = Vec::new();
        let mut thumbnail_offset = None;
        for i in 0..count {
            let entry = offset + 2 + i * 12;
            let (Some(tag), Some(kind), Some(n)) = (
                reader.u16(entry),
                reader.u16(entry + 2),
                reader.u32(entry + 4),
            ) else {
                continue;
            };
            let Some(size) = type_size(kind) else {
                continue;
            };
            let Some(total) = size.checked_mul(n as usize) else {
                continue;
            };
            if total > reader.data.len() {
                continue;
            }
            let data_offset = if total <= 4 {
                entry + 8
            } else {
                match reader.u32(entry + 8) {
                    Some(o) => o as usize,
                    None => continue,
                }
            };
            let Some(value) = reader.decode(kind, n as usize, data_offset) else {
                continue;
            };
            let pointer = value.first_uint().map(|v| v as usize);
            match (ifd, tag) {
                (Ifd::Primary, tags::EXIF_IFD) => nested.extend(pointer.map(|p| (p, Ifd::Exif))),
                (Ifd::Primary, tags::GPS_IFD) => nested.extend(pointer.map(|p| (p, Ifd::Gps))),
                (Ifd::Exif, tags::INTEROP_IFD) => nested.extend(pointer.map(|p| (p, Ifd::Interop))),
                (Ifd::Thumbnail, tags::THUMBNAIL_OFFSET) => thumbnail_offset = pointer,
                (Ifd::Thumbnail, tags::THUMBNAIL_LENGTH) => {
                    self.thumbnail_len = pointer.filter(|&len| len > 0);
                }
                _ => self.fields.push(Field { ifd, tag, value }),
            }
        }
        if thumbnail_offset.is_none() && ifd == Ifd::Thumbnail {
            self.thumbnail_len = None;
        }
        if ifd == Ifd::Primary
            && let Some(next) = reader.u32(offset + 2 + count * 12)
            && next != 0
        {
            nested.push((next as usize, Ifd::Thumbnail));
        }
        for (pointer, kind) in nested {
            self.read_ifd(reader, pointer, kind, depth + 1, visited);
        }
    }

    pub fn get(&self, ifd: Ifd, tag: u16) -> Option<&Value> {
        self.fields
            .iter()
            .find(|f| f.ifd == ifd && f.tag == tag)
            .map(|f| &f.value)
    }

    pub fn text(&self, ifd: Ifd, tag: u16) -> Option<String> {
        match self.get(ifd, tag)? {
            Value::Ascii(s) if !s.is_empty() => Some(s.clone()),
            _ => None,
        }
    }

    /// EXIF orientation (1–8) of the main image.
    pub fn orientation(&self) -> Option<u16> {
        let value = self.get(Ifd::Primary, tags::ORIENTATION)?.first_uint()?;
        u16::try_from(value).ok().filter(|v| (1..=8).contains(v))
    }

    /// Latitude and longitude in decimal degrees, when the GPS directory has valid coordinates.
    pub fn gps(&self) -> Option<(f64, f64)> {
        let mut lat = dms(self.get(Ifd::Gps, tags::GPS_LATITUDE)?)?;
        let mut lon = dms(self.get(Ifd::Gps, tags::GPS_LONGITUDE)?)?;
        if self
            .text(Ifd::Gps, tags::GPS_LATITUDE_REF)
            .is_some_and(|r| r.eq_ignore_ascii_case("S"))
        {
            lat = -lat;
        }
        if self
            .text(Ifd::Gps, tags::GPS_LONGITUDE_REF)
            .is_some_and(|r| r.eq_ignore_ascii_case("W"))
        {
            lon = -lon;
        }
        (lat.abs() <= 90.0 && lon.abs() <= 180.0).then_some((lat, lon))
    }

    /// "Make Model", without repeating the make when the model already starts with it.
    pub fn camera(&self) -> Option<String> {
        let make = self.text(Ifd::Primary, tags::MAKE);
        let model = self.text(Ifd::Primary, tags::MODEL);
        join_camera(make.as_deref(), model.as_deref())
    }

    /// When the photo was taken, as `YYYY-MM-DD HH:MM:SS[±HH:MM]`.
    pub fn taken_at(&self) -> Option<String> {
        let (date, offset) = match self.text(Ifd::Exif, tags::DATE_TIME_ORIGINAL) {
            Some(date) => (date, self.text(Ifd::Exif, tags::OFFSET_TIME_ORIGINAL)),
            None => (
                self.text(Ifd::Exif, tags::DATE_TIME_DIGITIZED)
                    .or_else(|| self.text(Ifd::Primary, tags::DATE_TIME))?,
                None,
            ),
        };
        let mut text = exif_date(&date);
        if let Some(offset) = offset {
            text.push_str(&offset);
        }
        Some(text)
    }

    /// True when the only data is an orientation tag (what stripping keeps).
    pub fn is_orientation_only(&self) -> bool {
        self.thumbnail_len.is_none()
            && !self.has_gps_ifd
            && self
                .fields
                .iter()
                .all(|f| f.ifd == Ifd::Primary && f.tag == tags::ORIENTATION)
    }
}

pub fn join_camera(make: Option<&str>, model: Option<&str>) -> Option<String> {
    match (make.map(str::trim), model.map(str::trim)) {
        (Some(make), Some(model)) if !make.is_empty() && !model.is_empty() => {
            if model.to_lowercase().starts_with(&make.to_lowercase()) {
                Some(model.to_string())
            } else {
                Some(format!("{make} {model}"))
            }
        }
        (Some(one), _) | (_, Some(one)) if !one.is_empty() => Some(one.to_string()),
        _ => None,
    }
}

/// `2026:10:03 12:34:56` → `2026-10-03 12:34:56`.
pub fn exif_date(text: &str) -> String {
    let text = text.trim();
    let bytes = text.as_bytes();
    // Only rewrite ASCII prefixes, so slicing stays on character boundaries.
    if bytes.len() >= 10 && bytes[..10].is_ascii() && bytes[4] == b':' && bytes[7] == b':' {
        format!(
            "{}-{}-{}{}",
            &text[..4],
            &text[5..7],
            &text[8..10],
            &text[10..]
        )
    } else {
        text.to_string()
    }
}

/// Degrees, minutes, seconds rationals → decimal degrees.
fn dms(value: &Value) -> Option<f64> {
    let degrees = value.float_at(0)?;
    let part = |index: usize| -> Option<f64> {
        match value.float_at(index) {
            Some(v) => Some(v),
            // Missing or 0/0 minutes and seconds are common; anything else is broken data.
            None => match value {
                Value::Rational(r) => match r.get(index) {
                    None | Some((0, _)) => Some(0.0),
                    _ => None,
                },
                _ => Some(0.0),
            },
        }
    };
    let total = degrees + part(1)? / 60.0 + part(2)? / 3600.0;
    total.is_finite().then_some(total)
}

/// A TIFF block holding only an Orientation tag, so stripped images keep their rotation.
pub fn orientation_only(orientation: u16) -> Vec<u8> {
    let mut out = Vec::with_capacity(26);
    out.extend_from_slice(b"II*\0");
    out.extend_from_slice(&8u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&tags::ORIENTATION.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes());
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&orientation.to_le_bytes());
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(&0u32.to_le_bytes());
    out
}

/// English name of a tag, for the details panel.
pub fn tag_name(ifd: Ifd, tag: u16) -> Option<&'static str> {
    if ifd == Ifd::Gps {
        return Some(match tag {
            0x0000 => "GPS version",
            0x0001 => "Latitude reference",
            0x0002 => "Latitude",
            0x0003 => "Longitude reference",
            0x0004 => "Longitude",
            0x0005 => "Altitude reference",
            0x0006 => "Altitude",
            0x0007 => "GPS time (UTC)",
            0x0008 => "Satellites",
            0x0009 => "GPS status",
            0x000A => "Measure mode",
            0x000B => "GPS precision (DOP)",
            0x000C => "Speed unit",
            0x000D => "Speed",
            0x000E => "Direction of movement reference",
            0x000F => "Direction of movement",
            0x0010 => "Image direction reference",
            0x0011 => "Image direction",
            0x0012 => "Map datum",
            0x0013..=0x001A => "Destination",
            0x001B => "Positioning method",
            0x001C => "Area information",
            0x001D => "GPS date",
            0x001E => "Differential correction",
            0x001F => "Horizontal positioning error",
            _ => return None,
        });
    }
    if ifd == Ifd::Interop {
        return Some(match tag {
            0x0001 => "Interoperability index",
            0x0002 => "Interoperability version",
            _ => return None,
        });
    }
    Some(match tag {
        0x00FE => "Subfile type",
        0x0100 => "Image width",
        0x0101 => "Image height",
        0x0102 => "Bits per sample",
        0x0103 => "Compression",
        0x0106 => "Photometric interpretation",
        tags::IMAGE_DESCRIPTION => "Image description",
        tags::MAKE => "Camera make",
        tags::MODEL => "Camera model",
        tags::ORIENTATION => "Orientation",
        0x0115 => "Samples per pixel",
        0x011A => "Horizontal resolution",
        0x011B => "Vertical resolution",
        0x0128 => "Resolution unit",
        tags::SOFTWARE => "Software",
        tags::DATE_TIME => "Modified",
        tags::ARTIST => "Artist",
        0x013C => "Host computer",
        0x0213 => "YCbCr positioning",
        tags::COPYRIGHT => "Copyright",
        0x829A => "Exposure time",
        0x829D => "F-number",
        0x8822 => "Exposure program",
        0x8827 => "ISO",
        0x8830 => "Sensitivity type",
        0x8832 => "Recommended exposure index",
        0x9000 => "EXIF version",
        tags::DATE_TIME_ORIGINAL => "Taken",
        tags::DATE_TIME_DIGITIZED => "Digitized",
        0x9010 => "Time zone",
        tags::OFFSET_TIME_ORIGINAL => "Time zone (taken)",
        0x9012 => "Time zone (digitized)",
        0x9101 => "Components configuration",
        0x9201 => "Shutter speed value",
        0x9202 => "Aperture value",
        0x9203 => "Brightness value",
        0x9204 => "Exposure compensation",
        0x9205 => "Max aperture",
        0x9206 => "Subject distance",
        0x9207 => "Metering mode",
        0x9208 => "Light source",
        0x9209 => "Flash",
        0x920A => "Focal length",
        0x9214 => "Subject area",
        0x927C => "Maker note",
        0x9286 => "User comment",
        0x9290 => "Sub-second time",
        0x9291 => "Sub-second time (taken)",
        0x9292 => "Sub-second time (digitized)",
        0x9C9B => "Title (Windows)",
        0x9C9C => "Comment (Windows)",
        0x9C9D => "Author (Windows)",
        0x9C9E => "Keywords (Windows)",
        0x9C9F => "Subject (Windows)",
        0xA000 => "FlashPix version",
        0xA001 => "Color space",
        0xA002 => "Pixel width",
        0xA003 => "Pixel height",
        0xA20E => "Focal plane X resolution",
        0xA20F => "Focal plane Y resolution",
        0xA210 => "Focal plane resolution unit",
        0xA217 => "Sensing method",
        0xA300 => "File source",
        0xA301 => "Scene type",
        0xA401 => "Custom rendered",
        0xA402 => "Exposure mode",
        0xA403 => "White balance",
        0xA404 => "Digital zoom ratio",
        0xA405 => "Focal length (35 mm)",
        0xA406 => "Scene capture type",
        0xA407 => "Gain control",
        0xA408 => "Contrast",
        0xA409 => "Saturation",
        0xA40A => "Sharpness",
        0xA40C => "Subject distance range",
        0xA420 => "Unique image ID",
        0xA430 => "Camera owner",
        tags::BODY_SERIAL_NUMBER => "Camera serial number",
        0xA432 => "Lens specification",
        0xA433 => "Lens make",
        tags::LENS_MODEL => "Lens model",
        0xA435 => "Lens serial number",
        0xA460 => "Composite image",
        _ => return None,
    })
}

/// A readable value for the details panel.
pub fn describe(field: &Field) -> String {
    let Field { ifd, tag, value } = field;
    let text = match (*ifd, *tag, value) {
        (Ifd::Primary | Ifd::Thumbnail, tags::ORIENTATION, v) => v
            .first_uint()
            .map(|o| orientation_name(o).to_string())
            .unwrap_or_else(|| generic(v)),
        (Ifd::Gps, tags::GPS_LATITUDE | tags::GPS_LONGITUDE, v) => match dms(v) {
            Some(decimal) => format!("{decimal:.6}°"),
            None => generic(v),
        },
        (Ifd::Gps, 0x0000, Value::Bytes(b)) => b
            .iter()
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join("."),
        (Ifd::Gps, 0x0005, v) => match v.first_uint() {
            Some(0) => "Above sea level".into(),
            Some(1) => "Below sea level".into(),
            _ => generic(v),
        },
        (Ifd::Gps, 0x0006, v) => v
            .float_at(0)
            .map(|m| format!("{m:.1} m"))
            .unwrap_or_else(|| generic(v)),
        (Ifd::Gps, 0x0007, v) if v.len() == 3 => {
            let part = |i| v.float_at(i).unwrap_or(0.0);
            format!(
                "{:02}:{:02}:{:02}",
                part(0) as u32,
                part(1) as u32,
                part(2) as u32
            )
        }
        (Ifd::Gps, 0x001B | 0x001C, Value::Bytes(b)) | (_, 0x9286, Value::Bytes(b)) => {
            encoded_text(b)
        }
        (_, 0x9C9B..=0x9C9F, Value::Bytes(b)) => utf16_le(b),
        (_, 0x9000 | 0xA000, Value::Bytes(b)) | (Ifd::Interop, 0x0002, Value::Bytes(b)) => {
            String::from_utf8_lossy(b).trim_matches('\0').to_string()
        }
        (_, 0x927C, Value::Bytes(b)) => format!("{} bytes of camera-specific data", b.len()),
        (_, 0x829A, v) => match value_rational(v) {
            Some((n, d)) if n > 0 && d > n && d % n == 0 => format!("1/{} s", d / n),
            _ => v
                .float_at(0)
                .map(|s| format!("{} s", trim_float(s)))
                .unwrap_or_else(|| generic(v)),
        },
        (_, 0x829D, v) => v
            .float_at(0)
            .map(|f| format!("f/{}", trim_float(f)))
            .unwrap_or_else(|| generic(v)),
        (_, 0x920A, v) => v
            .float_at(0)
            .map(|f| format!("{} mm", trim_float(f)))
            .unwrap_or_else(|| generic(v)),
        (_, 0x9209, v) => match v.first_uint() {
            Some(flash) if flash & 1 == 1 => "Fired".into(),
            Some(_) => "Did not fire".into(),
            None => generic(v),
        },
        (_, tags::DATE_TIME | tags::DATE_TIME_ORIGINAL | tags::DATE_TIME_DIGITIZED, v) => match v {
            Value::Ascii(s) => exif_date(s),
            _ => generic(v),
        },
        (_, _, v) => generic(v),
    };
    truncate(&text, 300)
}

fn value_rational(value: &Value) -> Option<(u32, u32)> {
    match value {
        Value::Rational(v) => v.first().copied(),
        _ => None,
    }
}

fn orientation_name(value: u32) -> &'static str {
    match value {
        1 => "Normal",
        2 => "Mirrored horizontally",
        3 => "Rotated 180°",
        4 => "Mirrored vertically",
        5 => "Mirrored horizontally, rotated 270°",
        6 => "Rotated 90° clockwise",
        7 => "Mirrored horizontally, rotated 90°",
        8 => "Rotated 90° counter-clockwise",
        _ => "Unknown",
    }
}

fn trim_float(value: f64) -> String {
    let text = format!("{value:.4}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    text.to_string()
}

fn generic(value: &Value) -> String {
    const MAX_ITEMS: usize = 8;
    fn list<T>(items: &[T], f: impl Fn(&T) -> String) -> String {
        let mut parts: Vec<String> = items.iter().take(MAX_ITEMS).map(f).collect();
        if items.len() > MAX_ITEMS {
            parts.push(format!("… ({} values)", items.len()));
        }
        parts.join(", ")
    }
    match value {
        Value::Ascii(s) => s.clone(),
        Value::Bytes(b) => {
            if b.len() > 16 {
                format!("{} bytes", b.len())
            } else if !b.is_empty() && b.iter().all(|c| c.is_ascii_graphic() || *c == b' ') {
                String::from_utf8_lossy(b).into_owned()
            } else {
                list(b, |n| n.to_string())
            }
        }
        Value::Short(v) => list(v, |n| n.to_string()),
        Value::Long(v) => list(v, |n| n.to_string()),
        Value::SShort(v) => list(v, |n| n.to_string()),
        Value::SLong(v) => list(v, |n| n.to_string()),
        Value::Rational(v) => list(v, |&(n, d)| {
            if d == 0 {
                "?".into()
            } else {
                trim_float(f64::from(n) / f64::from(d))
            }
        }),
        Value::SRational(v) => list(v, |&(n, d)| {
            if d == 0 {
                "?".into()
            } else {
                trim_float(f64::from(n) / f64::from(d))
            }
        }),
        Value::Float(v) => list(v, |n| trim_float(f64::from(*n))),
        Value::Double(v) => list(v, |n| trim_float(*n)),
    }
}

/// UserComment-style text: an 8-byte character code, then the text.
fn encoded_text(bytes: &[u8]) -> String {
    let (code, body) = bytes.split_at(bytes.len().min(8));
    let text = if code.starts_with(b"UNICODE") {
        let le = body.len() >= 2 && body[1] == 0 && body[0] != 0;
        if le {
            utf16_le(body)
        } else {
            let units: Vec<u16> = body
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&units)
        }
    } else if code.starts_with(b"ASCII") || code.iter().all(|&b| b == 0) {
        String::from_utf8_lossy(body).into_owned()
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    text.trim_matches(|c: char| c == '\0' || c.is_whitespace())
        .to_string()
}

fn utf16_le(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&units)
        .trim_matches('\0')
        .to_string()
}

pub fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        let mut cut: String = text.chars().take(max_chars).collect();
        cut.push('…');
        cut
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a TIFF block from (ifd-local) entries. `big_endian` picks MM order.
    struct TiffBuilder {
        big_endian: bool,
    }

    enum Entry {
        Ascii(u16, &'static str),
        Short(u16, u16),
        Rationals(u16, Vec<(u32, u32)>),
        Pointer(u16),
    }

    impl TiffBuilder {
        fn u16(&self, v: u16) -> [u8; 2] {
            if self.big_endian {
                v.to_be_bytes()
            } else {
                v.to_le_bytes()
            }
        }
        fn u32(&self, v: u32) -> [u8; 4] {
            if self.big_endian {
                v.to_be_bytes()
            } else {
                v.to_le_bytes()
            }
        }

        /// IFD0 entries, plus an optional GPS IFD (pointed to by an `Entry::Pointer` in IFD0).
        fn build(&self, ifd0: &[Entry], gps: &[Entry]) -> Vec<u8> {
            let mut out = Vec::new();
            out.extend_from_slice(if self.big_endian { b"MM\0*" } else { b"II*\0" });
            out.extend_from_slice(&self.u32(8));
            let ifd0_len = 2 + ifd0.len() * 12 + 4;
            let gps_offset = 8 + ifd0_len;
            let gps_len = if gps.is_empty() {
                0
            } else {
                2 + gps.len() * 12 + 4
            };
            let mut data_offset = gps_offset + gps_len;
            let mut extra = Vec::new();
            for (entries, is_last) in [(ifd0, false), (gps, true)] {
                if is_last && entries.is_empty() {
                    break;
                }
                out.extend_from_slice(&self.u16(entries.len() as u16));
                for entry in entries {
                    match entry {
                        Entry::Ascii(tag, text) => {
                            let mut bytes = text.as_bytes().to_vec();
                            bytes.push(0);
                            out.extend_from_slice(&self.u16(*tag));
                            out.extend_from_slice(&self.u16(2));
                            out.extend_from_slice(&self.u32(bytes.len() as u32));
                            if bytes.len() <= 4 {
                                bytes.resize(4, 0);
                                out.extend_from_slice(&bytes);
                            } else {
                                out.extend_from_slice(&self.u32(data_offset as u32));
                                data_offset += bytes.len();
                                extra.extend_from_slice(&bytes);
                            }
                        }
                        Entry::Short(tag, value) => {
                            out.extend_from_slice(&self.u16(*tag));
                            out.extend_from_slice(&self.u16(3));
                            out.extend_from_slice(&self.u32(1));
                            out.extend_from_slice(&self.u16(*value));
                            out.extend_from_slice(&[0, 0]);
                        }
                        Entry::Rationals(tag, values) => {
                            out.extend_from_slice(&self.u16(*tag));
                            out.extend_from_slice(&self.u16(5));
                            out.extend_from_slice(&self.u32(values.len() as u32));
                            out.extend_from_slice(&self.u32(data_offset as u32));
                            for (n, d) in values {
                                extra.extend_from_slice(&self.u32(*n));
                                extra.extend_from_slice(&self.u32(*d));
                            }
                            data_offset += values.len() * 8;
                        }
                        Entry::Pointer(tag) => {
                            out.extend_from_slice(&self.u16(*tag));
                            out.extend_from_slice(&self.u16(4));
                            out.extend_from_slice(&self.u32(1));
                            out.extend_from_slice(&self.u32(gps_offset as u32));
                        }
                    }
                }
                out.extend_from_slice(&self.u32(0));
            }
            out.extend_from_slice(&extra);
            out
        }
    }

    fn sample(big_endian: bool) -> Vec<u8> {
        TiffBuilder { big_endian }.build(
            &[
                Entry::Ascii(tags::MAKE, "Canon"),
                Entry::Ascii(tags::MODEL, "Canon EOS R6"),
                Entry::Short(tags::ORIENTATION, 6),
                Entry::Pointer(tags::GPS_IFD),
            ],
            &[
                Entry::Ascii(tags::GPS_LATITUDE_REF, "N"),
                Entry::Rationals(tags::GPS_LATITUDE, vec![(41, 1), (0, 1), (3600, 100)]),
                Entry::Ascii(tags::GPS_LONGITUDE_REF, "W"),
                Entry::Rationals(tags::GPS_LONGITUDE, vec![(28, 1), (58, 1), (30, 1)]),
            ],
        )
    }

    #[test]
    fn reads_both_byte_orders() {
        for big_endian in [false, true] {
            let exif = Exif::parse(&sample(big_endian)).expect("valid TIFF");
            assert_eq!(exif.orientation(), Some(6));
            assert_eq!(exif.camera().as_deref(), Some("Canon EOS R6"));
            let (lat, lon) = exif.gps().expect("coordinates");
            assert!((lat - 41.01).abs() < 1e-9, "{lat}");
            assert!(
                (lon + (28.0 + 58.0 / 60.0 + 30.0 / 3600.0)).abs() < 1e-9,
                "{lon}"
            );
            assert!(!exif.is_orientation_only());
        }
    }

    #[test]
    fn accepts_the_exif_prefix() {
        let mut data = b"Exif\0\0".to_vec();
        data.extend(sample(false));
        assert!(Exif::parse(&data).unwrap().gps().is_some());
    }

    #[test]
    fn writes_a_minimal_orientation_block() {
        let block = orientation_only(8);
        let exif = Exif::parse(&block).unwrap();
        assert_eq!(exif.orientation(), Some(8));
        assert_eq!(exif.fields.len(), 1);
        assert!(exif.is_orientation_only());
    }

    #[test]
    fn never_panics_on_malformed_data() {
        let valid = sample(true);
        // Every truncation and a sweep of single-byte corruptions.
        for len in 0..valid.len() {
            let _ = Exif::parse(&valid[..len]);
        }
        for i in 0..valid.len() {
            for byte in [0x00, 0xFF, 0x7F, 0x80] {
                let mut corrupt = valid.clone();
                corrupt[i] = byte;
                if let Some(exif) = Exif::parse(&corrupt) {
                    let _ = (exif.gps(), exif.camera(), exif.taken_at());
                    for field in &exif.fields {
                        let _ = describe(field);
                    }
                }
            }
        }
        // A directory pointing at itself must not loop.
        let mut looped = b"II*\0\x08\0\0\0\x01\0".to_vec();
        looped.extend_from_slice(&tags::EXIF_IFD.to_le_bytes());
        looped.extend_from_slice(&4u16.to_le_bytes());
        looped.extend_from_slice(&1u32.to_le_bytes());
        looped.extend_from_slice(&8u32.to_le_bytes());
        looped.extend_from_slice(&8u32.to_le_bytes());
        assert!(Exif::parse(&looped).is_some());
        // Huge counts are refused rather than allocated.
        let mut huge = b"MM\0*\0\0\0\x08\0\x01".to_vec();
        huge.extend_from_slice(&tags::MAKE.to_be_bytes());
        huge.extend_from_slice(&2u16.to_be_bytes());
        huge.extend_from_slice(&u32::MAX.to_be_bytes());
        huge.extend_from_slice(&0u32.to_be_bytes());
        assert!(Exif::parse(&huge).unwrap().fields.is_empty());
        assert!(Exif::parse(b"not tiff").is_none());
    }

    #[test]
    fn ignores_invalid_coordinates() {
        let tiff = TiffBuilder { big_endian: false }.build(
            &[Entry::Pointer(tags::GPS_IFD)],
            &[
                Entry::Rationals(tags::GPS_LATITUDE, vec![(1, 0), (0, 0), (0, 0)]),
                Entry::Rationals(tags::GPS_LONGITUDE, vec![(28, 1), (0, 0), (0, 0)]),
            ],
        );
        let exif = Exif::parse(&tiff).unwrap();
        assert!(exif.has_gps_ifd);
        assert_eq!(exif.gps(), None);
    }

    #[test]
    fn describes_values_readably() {
        let exif = Exif::parse(&sample(false)).unwrap();
        let described: Vec<(String, String)> = exif
            .fields
            .iter()
            .map(|f| (tag_name(f.ifd, f.tag).unwrap().to_string(), describe(f)))
            .collect();
        assert!(described.contains(&("Orientation".into(), "Rotated 90° clockwise".into())));
        assert!(described.contains(&("Latitude".into(), "41.010000°".into())));
        assert_eq!(exif_date("2026:10:03 12:34:56"), "2026-10-03 12:34:56");
        assert_eq!(
            join_camera(Some("Apple"), Some("iPhone 15")).as_deref(),
            Some("Apple iPhone 15")
        );
    }
}
