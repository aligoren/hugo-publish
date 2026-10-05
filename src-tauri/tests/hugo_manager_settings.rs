//! The preferred Hugo binary in `settings.json`: round trips that keep every other key.

use std::fs;
use std::path::PathBuf;

use hugo_publisher_lib::hugo::manager::settings::{
    PREFERRED_HUGO_KEY, SETTINGS_FILE, read_preferred, write_preferred,
};

#[test]
fn missing_file_means_no_preference_and_is_created_on_write() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("nested").join(SETTINGS_FILE);
    assert_eq!(read_preferred(&file), None);
    write_preferred(&file, Some(r"C:\Tools\hugo.exe")).unwrap();
    assert_eq!(
        read_preferred(&file),
        Some(PathBuf::from(r"C:\Tools\hugo.exe"))
    );
    let json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(json[PREFERRED_HUGO_KEY], r"C:\Tools\hugo.exe");
    // No temp files left next to it.
    assert_eq!(fs::read_dir(file.parent().unwrap()).unwrap().count(), 1);
}

#[test]
fn round_trip_keeps_unknown_keys_and_their_order() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(SETTINGS_FILE);
    fs::write(
        &file,
        "\u{feff}{\n  \"language\": \"tr\",\n  \"recentSites\": [\"D:/blog\", \"D:/notes\"],\n  \"editor\": {\"fontSize\": 15, \"spell\": true},\n  \"zzz\": null\n}\n",
    )
    .unwrap();

    write_preferred(&file, Some("/opt/hugo/0.167.0/hugo")).unwrap();
    let text = fs::read_to_string(&file).unwrap();
    let json: serde_json::Value = serde_json::from_str(&text).unwrap();
    let keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "language",
            "recentSites",
            "editor",
            "zzz",
            PREFERRED_HUGO_KEY
        ]
    );
    assert_eq!(json["recentSites"][1], "D:/notes");
    assert_eq!(json["editor"]["fontSize"], 15);
    assert!(json["zzz"].is_null());
    assert!(text.ends_with("}\n"));
    assert_eq!(
        read_preferred(&file),
        Some(PathBuf::from("/opt/hugo/0.167.0/hugo"))
    );

    // Changing it keeps its place; clearing removes only that key.
    write_preferred(&file, Some("/usr/bin/hugo")).unwrap();
    let json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(
        json.as_object().unwrap().keys().next_back().unwrap(),
        PREFERRED_HUGO_KEY
    );
    write_preferred(&file, None).unwrap();
    let json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    let keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["language", "recentSites", "editor", "zzz"]);
    assert_eq!(read_preferred(&file), None);
}

#[test]
fn a_broken_settings_file_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(SETTINGS_FILE);
    for broken in ["{ \"language\": ", "[1, 2]"] {
        fs::write(&file, broken).unwrap();
        assert_eq!(read_preferred(&file), None);
        assert!(write_preferred(&file, Some("/usr/bin/hugo")).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), broken);
    }
}

#[test]
fn blank_or_non_string_values_mean_no_preference() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(SETTINGS_FILE);
    fs::write(&file, "{\"preferredHugo\": \"  \"}").unwrap();
    assert_eq!(read_preferred(&file), None);
    fs::write(&file, "{\"preferredHugo\": 42}").unwrap();
    assert_eq!(read_preferred(&file), None);
    fs::write(&file, "").unwrap();
    assert_eq!(read_preferred(&file), None);
    write_preferred(&file, Some("/usr/bin/hugo")).unwrap();
    assert_eq!(read_preferred(&file), Some(PathBuf::from("/usr/bin/hugo")));
}
