//! File names for imported images: lower-case ASCII slugs (Turkish letters mapped the same way as
//! `slugify` in `src/lib/slug.ts`), and no capture timestamps such as `IMG_20261003_123456`.

use super::sniff::Format;

/// Longest file name stem written; long camera names gain nothing from more.
const MAX_STEM_CHARS: usize = 80;

/// Words that only say which device or app made the file; dropped with the timestamp.
const DEVICE_WORDS: [&str; 26] = [
    "img",
    "image",
    "pxl",
    "dsc",
    "dscn",
    "dscf",
    "dji",
    "gopr",
    "vid",
    "mvimg",
    "photo",
    "pic",
    "screenshot",
    "scr",
    "whatsapp",
    "signal",
    "telegram",
    "at",
    "p",
    "hdr",
    "burst",
    "portrait",
    "edited",
    "copy",
    "jpg",
    "jpeg",
];

/// `Çiçek Bahçesi (1).JPG` → `cicek-bahcesi-1-jpg`: lower case, Turkish and other Latin accents
/// mapped to ASCII, apostrophes dropped, everything else turned into single dashes.
pub fn slugify(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_dash = false;
    for c in text.chars().flat_map(char::to_lowercase) {
        // Combining marks (İ lower-cases to i + U+0307) and apostrophes vanish.
        if ('\u{0300}'..='\u{036F}').contains(&c) || c == '\'' || c == '\u{2019}' {
            continue;
        }
        match fold(c) {
            Some(ascii) => {
                if pending_dash && !out.is_empty() {
                    out.push('-');
                }
                pending_dash = false;
                out.push(ascii);
            }
            None => pending_dash = true,
        }
    }
    out
}

/// A lower-case letter or digit as ASCII, the way NFKD plus removing marks would.
fn fold(c: char) -> Option<char> {
    if c.is_ascii_lowercase() || c.is_ascii_digit() {
        return Some(c);
    }
    let folded = match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' | 'ǎ' => 'a',
        'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => 'c',
        'ď' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => 'e',
        'ĝ' | 'ğ' | 'ġ' | 'ģ' => 'g',
        'ĥ' => 'h',
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' | 'ǐ' => 'i',
        'ĵ' => 'j',
        'ķ' => 'k',
        'ĺ' | 'ļ' | 'ľ' | 'ŀ' => 'l',
        'ñ' | 'ń' | 'ņ' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ō' | 'ŏ' | 'ő' | 'ǒ' => 'o',
        'ŕ' | 'ŗ' | 'ř' => 'r',
        'ś' | 'ŝ' | 'ş' | 'š' | 'ș' => 's',
        'ţ' | 'ť' | 'ț' => 't',
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' | 'ǔ' => 'u',
        'ŵ' => 'w',
        'ý' | 'ÿ' | 'ŷ' => 'y',
        'ź' | 'ż' | 'ž' => 'z',
        _ => return None,
    };
    Some(folded)
}

/// Removes capture dates and times (`img-20261003-123456` → `image`,
/// `tatil-2026-10-03` → `tatil`). Names without a recognisable date are returned unchanged.
pub fn without_timestamps(slug: &str) -> String {
    let tokens: Vec<&str> = slug.split('-').filter(|t| !t.is_empty()).collect();
    let digits = |t: &str| !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit());
    let compact_date = tokens
        .iter()
        .any(|t| t.len() >= 8 && digits(t) && is_date(&t[..4], &t[4..6], &t[6..8]));
    let split_date = tokens.windows(3).any(|w| {
        w[0].len() == 4
            && w[1].len() == 2
            && w[2].len() == 2
            && w.iter().all(|t| digits(t))
            && is_date(w[0], w[1], w[2])
    });
    if !compact_date && !split_date {
        return slug.to_string();
    }
    // With a date present, numbers (times, counters) and device words carry no meaning either.
    tokens
        .into_iter()
        .filter(|t| !digits(t) && !DEVICE_WORDS.contains(t) && !is_sequence_number(t))
        .collect::<Vec<_>>()
        .join("-")
}

fn is_date(year: &str, month: &str, day: &str) -> bool {
    let (Ok(year), Ok(month), Ok(day)) = (
        year.parse::<u32>(),
        month.parse::<u32>(),
        day.parse::<u32>(),
    ) else {
        return false;
    };
    (1990..=2100).contains(&year) && (1..=12).contains(&month) && (1..=31).contains(&day)
}

/// `wa0001`, `dsc01234`: a short prefix followed by a counter.
fn is_sequence_number(token: &str) -> bool {
    let letters = token.bytes().take_while(u8::is_ascii_lowercase).count();
    let rest = &token[letters..];
    letters <= 3 && rest.len() >= 3 && rest.bytes().all(|b| b.is_ascii_digit())
}

/// The file name for an imported image. `requested` (the user's choice) wins over the source
/// name; the extension follows the actual format (`.JPG` → `.jpg`, a PNG named `.jpg` → `.png`).
/// `drop_timestamps` removes capture times from source names (not from a requested name).
pub fn file_name_for(
    source_name: &str,
    requested: Option<&str>,
    format: Format,
    drop_timestamps: bool,
) -> String {
    let requested = requested.map(str::trim).filter(|n| !n.is_empty());
    let name = requested.unwrap_or(source_name);
    let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, ext)) if Format::from_extension(ext).is_some() => {
            (stem, Some(ext.to_ascii_lowercase()))
        }
        _ => (name, None),
    };
    let extension = extension
        .filter(|ext| Format::from_extension(ext) == Some(format))
        .unwrap_or_else(|| format.extension().to_string());
    let mut stem = slugify(stem);
    if drop_timestamps && requested.is_none() {
        stem = without_timestamps(&stem);
    }
    if stem.chars().count() > MAX_STEM_CHARS {
        stem = stem.chars().take(MAX_STEM_CHARS).collect();
        stem = stem.trim_end_matches('-').to_string();
    }
    if stem.is_empty() {
        stem = "image".into();
    }
    format!("{stem}.{extension}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugifies_like_the_frontend() {
        assert_eq!(slugify("Çiçek Bahçesi (1)"), "cicek-bahcesi-1");
        assert_eq!(slugify("IŞIK ılık İzmir"), "isik-ilik-izmir");
        assert_eq!(slugify("Ali'nin “Fotoğrafı”"), "alinin-fotografi");
        assert_eq!(slugify("Ağustos’ta Ürgüp"), "agustosta-urgup");
        assert_eq!(slugify("  --  "), "");
        assert_eq!(slugify("日本"), "");
        assert_eq!(slugify("Crème brûlée"), "creme-brulee");
    }

    #[test]
    fn removes_capture_timestamps() {
        assert_eq!(without_timestamps("img-20261003-123456"), "");
        assert_eq!(without_timestamps("pxl-20261003-123456789"), "");
        assert_eq!(without_timestamps("img-20261003-wa0001"), "");
        assert_eq!(
            without_timestamps("ekran-goruntusu-2026-10-03-123456"),
            "ekran-goruntusu"
        );
        assert_eq!(
            without_timestamps("whatsapp-image-2026-10-03-at-12-34-56"),
            ""
        );
        assert_eq!(without_timestamps("tatil-20261003"), "tatil");
        assert_eq!(
            without_timestamps("2026-annual-report"),
            "2026-annual-report"
        );
        assert_eq!(without_timestamps("cover-1"), "cover-1");
    }

    #[test]
    fn names_files() {
        let name = |source, requested, format, drop| file_name_for(source, requested, format, drop);
        assert_eq!(
            name("IMG_20261003_123456.JPG", None, Format::Jpeg, true),
            "image.jpg"
        );
        assert_eq!(
            name("IMG_20261003_123456.JPG", None, Format::Jpeg, false),
            "img-20261003-123456.jpg"
        );
        assert_eq!(
            name("Kapak Fotoğrafı.jpeg", None, Format::Jpeg, true),
            "kapak-fotografi.jpeg"
        );
        assert_eq!(
            name("actually-png.jpg", None, Format::Png, true),
            "actually-png.png"
        );
        assert_eq!(
            name("x.jpg", Some("Yeni Kapak"), Format::Jpeg, true),
            "yeni-kapak.jpg"
        );
        assert_eq!(name("x.jpg", Some("v1.2"), Format::Jpeg, true), "v1-2.jpg");
        assert_eq!(
            name("x.jpg", Some("../../evil.png"), Format::Png, true),
            "evil.png"
        );
        assert_eq!(
            name("C:\\Users\\ali\\Desktop\\a.webp", None, Format::Webp, true),
            "a.webp"
        );
        assert_eq!(name("noext", None, Format::Gif, true), "noext.gif");
        assert_eq!(name("", None, Format::Svg, true), "image.svg");
        assert_eq!(name(&"a".repeat(200), None, Format::Png, true).len(), 84);
    }
}
