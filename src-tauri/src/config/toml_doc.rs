//! Format-preserving edits to TOML config files (`hugo.toml`, `config/_default/*.toml`).
//!
//! Only the edited lines change: comments, blank lines, quoting, key order and line endings of
//! everything else stay byte-for-byte the same. New entries copy the indentation of their siblings.

use toml_edit::{Array, ArrayOfTables, DocumentMut, InlineTable, Item, Table, TableLike, Value};

use crate::error::{AppError, AppResult};
use crate::text::{self, TextShape};

pub struct TomlEditor {
    doc: DocumentMut,
    shape: TextShape,
}

impl TomlEditor {
    pub fn parse(source: &str) -> AppResult<Self> {
        let (normalized, shape) = text::normalize(source)?;
        let doc = normalized
            .parse::<DocumentMut>()
            .map_err(|e| AppError::Toml(e.to_string()))?;
        Ok(Self { doc, shape })
    }

    pub fn render(&self) -> String {
        text::restore(&self.doc.to_string(), self.shape)
    }

    pub fn get(&self, path: &[&str]) -> Option<&Item> {
        let mut item = self.doc.as_item();
        for key in path {
            item = item.get(key)?;
        }
        Some(item)
    }

    pub fn contains(&self, path: &[&str]) -> bool {
        self.get(path).is_some()
    }

    /// Sets a value. Replacing an existing value keeps its spacing and trailing comment;
    /// a new key gets the indentation of the other keys in its table.
    pub fn set_value(&mut self, path: &[&str], value: Value) -> AppResult<()> {
        self.set_at(&keys(path), value)
    }

    /// Removes a key or table. Returns whether something was removed.
    pub fn remove(&mut self, path: &[&str]) -> AppResult<bool> {
        self.remove_at(&keys(path))
    }

    /// Like [`Self::set_value`], with array-of-tables indexes in the path
    /// (`["menu", "main", 1, "weight"]`).
    pub fn set_at(&mut self, path: &[PathKey], mut value: Value) -> AppResult<()> {
        let (last, parents) = path
            .split_last()
            .ok_or_else(|| AppError::Invalid("empty key path".into()))?;
        let PathKey::Key(last) = last else {
            return Err(AppError::Invalid(format!(
                "`{}`: a whole array entry cannot be set, set its keys",
                display_path(path)
            )));
        };
        let table = navigate(self.doc.as_table_mut(), parents, true)?;
        match table.get_mut(last) {
            Some(Item::Value(existing)) => {
                value = keep_style(existing, value);
                *value.decor_mut() = existing.decor().clone();
                *existing = value;
            }
            Some(_) => {
                return Err(AppError::Invalid(format!(
                    "`{}` is a table, not a value",
                    display_path(path)
                )));
            }
            None => {
                let indent = key_indent(table);
                table.insert(last, Item::Value(value));
                if let Some(mut key) = table.key_mut(last) {
                    key.leaf_decor_mut().set_prefix(indent);
                }
            }
        }
        Ok(())
    }

    /// Removes a key, a table, or (path ending in an index) one array-of-tables entry.
    /// Returns whether something was removed.
    pub fn remove_at(&mut self, path: &[PathKey]) -> AppResult<bool> {
        match path.split_last() {
            None => Err(AppError::Invalid("empty key path".into())),
            Some((PathKey::Key(key), parents)) => {
                match missing(navigate(self.doc.as_table_mut(), parents, false))? {
                    Some(table) => Ok(table.remove(key).is_some()),
                    None => Ok(false),
                }
            }
            Some((PathKey::Index(index), parents)) => {
                let Some((PathKey::Key(key), grand)) = parents.split_last() else {
                    return Err(AppError::Invalid(format!(
                        "`{}` is not an array-of-tables entry",
                        display_path(path)
                    )));
                };
                let Some(table) = missing(navigate(self.doc.as_table_mut(), grand, false))? else {
                    return Ok(false);
                };
                match table.get_mut(key).and_then(Item::as_array_of_tables_mut) {
                    Some(array) if *index < array.len() => {
                        array.remove(*index);
                        Ok(true)
                    }
                    _ => Ok(false),
                }
            }
        }
    }

    /// The document as JSON, with the key casing and order used in the file.
    /// Dates and times become strings exactly as written.
    pub fn to_json(&self) -> serde_json::Value {
        table_to_json(self.doc.as_table())
    }

    /// Comments that describe keys and tables, by dotted path (indexes for array-of-tables
    /// entries): the comment lines directly above (no blank line in between) plus a trailing
    /// comment on the same line, without `#`.
    pub fn comments(&self) -> serde_json::Map<String, serde_json::Value> {
        let mut out = serde_json::Map::new();
        collect_comments(self.doc.as_table(), &mut Vec::new(), &mut out);
        out
    }

    /// Appends an entry to an array of tables such as `[[menus.main]]`, right after the last
    /// existing entry and formatted like it.
    pub fn append_array_table(
        &mut self,
        path: &[&str],
        entries: &[(String, Value)],
    ) -> AppResult<()> {
        let (last, parents) = split_path(path)?;
        let parent = self.table_mut(parents)?;
        if !parent.contains_key(last) {
            parent.insert(last, Item::ArrayOfTables(ArrayOfTables::new()));
        }
        let array = parent
            .get_mut(last)
            .and_then(Item::as_array_of_tables_mut)
            .ok_or_else(|| {
                AppError::Invalid(format!("`{}` is not an array of tables", path.join(".")))
            })?;

        let mut table = Table::new();
        let template = array.iter().last();
        let indent = template.map(key_indent).unwrap_or_default();
        for (key, value) in entries {
            table.insert(key, Item::Value(value.clone()));
            if let Some(mut key) = table.key_mut(key) {
                key.leaf_decor_mut().set_prefix(indent.clone());
            }
        }
        if let Some(template) = template {
            table.decor_mut().set_prefix(header_prefix(array, template));
            // Sharing the sibling's position keeps the new entry directly after it.
            table.set_position(template.position());
        }
        array.push(table);
        Ok(())
    }

    fn table_mut(&mut self, path: &[&str]) -> AppResult<&mut Table> {
        let mut table = self.doc.as_table_mut();
        for (depth, key) in path.iter().enumerate() {
            if !table.contains_key(key) {
                let mut child = Table::new();
                // Implicit: the `[a]` header is only written once the table holds key-values.
                child.set_implicit(true);
                table.insert(key, Item::Table(child));
            }
            table = table
                .get_mut(key)
                .and_then(Item::as_table_mut)
                .ok_or_else(|| {
                    AppError::Invalid(format!("`{}` is not a table", path[..=depth].join(".")))
                })?;
        }
        Ok(table)
    }
}

/// One step of a key path: a table key, or an index into an array of tables.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(untagged)]
pub enum PathKey {
    Index(usize),
    Key(String),
}

fn keys(path: &[&str]) -> Vec<PathKey> {
    path.iter().map(|k| PathKey::Key(k.to_string())).collect()
}

fn display_path(path: &[PathKey]) -> String {
    path.iter()
        .map(|k| match k {
            PathKey::Key(key) => key.clone(),
            PathKey::Index(index) => index.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".")
}

/// Walks to the table at `path`. A key followed by an index selects an array-of-tables entry.
/// Missing tables are created (implicit, so no empty header is written) when `create` is set.
fn navigate<'a>(
    root: &'a mut dyn TableLike,
    path: &[PathKey],
    create: bool,
) -> AppResult<&'a mut dyn TableLike> {
    let mut table = root;
    let mut i = 0;
    while i < path.len() {
        let PathKey::Key(key) = &path[i] else {
            return Err(AppError::Invalid(format!(
                "`{}`: an index must follow an array of tables",
                display_path(&path[..=i])
            )));
        };
        if let Some(PathKey::Index(index)) = path.get(i + 1) {
            let array = table
                .get_mut(key)
                .and_then(Item::as_array_of_tables_mut)
                .ok_or_else(|| {
                    AppError::Invalid(format!(
                        "`{}` is not an array of tables",
                        display_path(&path[..=i])
                    ))
                })?;
            let len = array.len();
            table = array.get_mut(*index).ok_or_else(|| {
                AppError::Invalid(format!(
                    "`{}` has only {len} entries",
                    display_path(&path[..=i])
                ))
            })?;
            i += 2;
        } else {
            if !table.contains_key(key) {
                if !create {
                    return Err(AppError::Invalid(format!(
                        "`{}` does not exist",
                        display_path(&path[..=i])
                    )));
                }
                let mut child = Table::new();
                // Implicit: the `[a]` header is only written once the table holds key-values.
                child.set_implicit(true);
                table.insert(key, Item::Table(child));
            }
            table = table
                .get_mut(key)
                .and_then(Item::as_table_like_mut)
                .ok_or_else(|| {
                    AppError::Invalid(format!("`{}` is not a table", display_path(&path[..=i])))
                })?;
            i += 1;
        }
    }
    Ok(table)
}

fn table_to_json(table: &dyn TableLike) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (key, item) in table.iter() {
        map.insert(key.to_string(), item_to_json(item));
    }
    serde_json::Value::Object(map)
}

fn item_to_json(item: &Item) -> serde_json::Value {
    match item {
        Item::None => serde_json::Value::Null,
        Item::Value(value) => value_to_json(value),
        Item::Table(table) => table_to_json(table),
        Item::ArrayOfTables(array) => {
            serde_json::Value::Array(array.iter().map(|t| table_to_json(t)).collect())
        }
    }
}

fn value_to_json(value: &Value) -> serde_json::Value {
    use serde_json::Value as J;
    match value {
        Value::String(s) => J::String(s.value().clone()),
        Value::Integer(i) => J::from(*i.value()),
        Value::Float(f) => serde_json::Number::from_f64(*f.value()).map_or(J::Null, J::Number),
        Value::Boolean(b) => J::Bool(*b.value()),
        Value::Datetime(d) => J::String(d.value().to_string()),
        Value::Array(array) => J::Array(array.iter().map(value_to_json).collect()),
        Value::InlineTable(table) => table_to_json(table),
    }
}

fn collect_comments(
    table: &dyn TableLike,
    path: &mut Vec<String>,
    out: &mut serde_json::Map<String, serde_json::Value>,
) {
    let mut add = |path: &[String], parts: Vec<String>| {
        if !parts.is_empty() {
            out.insert(path.join("."), serde_json::Value::String(parts.join("\n")));
        }
    };
    let mut nested = Vec::new();
    for (key, item) in table.iter() {
        path.push(key.to_string());
        let mut parts = table
            .key(key)
            .and_then(|k| k.leaf_decor().prefix().and_then(|p| p.as_str()))
            .map(comment_block)
            .unwrap_or_default();
        match item {
            Item::Value(value) => {
                if let Some(trailing) = value
                    .decor()
                    .suffix()
                    .and_then(|s| s.as_str())
                    .and_then(trailing_comment)
                {
                    parts.push(trailing);
                }
            }
            Item::Table(child) => {
                if let Some(prefix) = child.decor().prefix().and_then(|p| p.as_str()) {
                    parts.extend(comment_block(prefix));
                }
                nested.push((path.clone(), NestedTables::One(child)));
            }
            Item::ArrayOfTables(array) => nested.push((path.clone(), NestedTables::Many(array))),
            Item::None => {}
        }
        add(path, parts);
        path.pop();
    }
    for (child_path, tables) in nested {
        match tables {
            NestedTables::One(child) => collect_comments(child, &mut child_path.clone(), out),
            NestedTables::Many(array) => {
                for (index, child) in array.iter().enumerate() {
                    let mut entry_path = child_path.clone();
                    entry_path.push(index.to_string());
                    if let Some(prefix) = child.decor().prefix().and_then(|p| p.as_str()) {
                        let parts = comment_block(prefix);
                        if !parts.is_empty() {
                            out.insert(
                                entry_path.join("."),
                                serde_json::Value::String(parts.join("\n")),
                            );
                        }
                    }
                    collect_comments(child, &mut entry_path, out);
                }
            }
        }
    }
}

enum NestedTables<'a> {
    One(&'a Table),
    Many(&'a ArrayOfTables),
}

/// The comment lines directly above an item: the last run of `#` lines in its prefix that is
/// not separated from the item by a blank line.
fn comment_block(prefix: &str) -> Vec<String> {
    let mut lines: Vec<&str> = prefix.split('\n').collect();
    // The last piece is the indentation in front of the item itself.
    if lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    let mut block = Vec::new();
    for line in lines.iter().rev() {
        let trimmed = line.trim();
        match trimmed.strip_prefix('#') {
            Some(text) => block.push(text.trim().to_string()),
            None => break,
        }
    }
    block.reverse();
    block
}

fn trailing_comment(suffix: &str) -> Option<String> {
    let text = suffix.trim_start().strip_prefix('#')?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// Treats "this path does not exist" as `None`, so removing a missing key is not an error.
fn missing(result: AppResult<&mut dyn TableLike>) -> AppResult<Option<&mut dyn TableLike>> {
    match result {
        Ok(table) => Ok(Some(table)),
        Err(AppError::Invalid(_)) => Ok(None),
        Err(other) => Err(other),
    }
}

fn split_path<'a>(path: &'a [&'a str]) -> AppResult<(&'a str, &'a [&'a str])> {
    path.split_last()
        .map(|(last, parents)| (*last, parents))
        .ok_or_else(|| AppError::Invalid("empty key path".into()))
}

/// The whitespace before the first key of a table, e.g. `"    "` in an indented `[[menu.main]]`.
fn key_indent(table: &(impl TableLike + ?Sized)) -> String {
    table
        .iter()
        .filter_map(|(key, _)| table.key(key))
        .filter_map(|key| key.leaf_decor().prefix().and_then(|p| p.as_str()))
        .map(|prefix| prefix.rsplit('\n').next().unwrap_or_default())
        .find(|indent| indent.chars().all(|c| c == ' ' || c == '\t'))
        .unwrap_or_default()
        .to_string()
}

/// What goes before a new `[[header]]`: a sibling's prefix when it is plain whitespace,
/// otherwise a blank line plus the sibling header's indentation.
fn header_prefix(array: &ArrayOfTables, last: &Table) -> String {
    let whitespace_only = |s: &str| s.chars().all(char::is_whitespace);
    if array.len() >= 2
        && let Some(prefix) = last.decor().prefix().and_then(|p| p.as_str())
        && whitespace_only(prefix)
    {
        return prefix.to_string();
    }
    let indent = last
        .decor()
        .prefix()
        .and_then(|p| p.as_str())
        .map(|p| p.rsplit('\n').next().unwrap_or_default().to_string())
        .filter(|indent| whitespace_only(indent))
        .unwrap_or_default();
    format!("\n{indent}")
}

/// Gives a replacement value the look of the value it replaces: JSON has no dates or quote
/// styles, so a bare date-time stays bare, a 'literal' string stays literal, and a multi-line
/// array keeps one item per line.
fn keep_style(existing: &Value, value: Value) -> Value {
    match (existing, value) {
        (Value::Datetime(_), Value::String(s)) => match s.value().parse::<Value>() {
            Ok(date @ Value::Datetime(_)) => date,
            _ => Value::String(s),
        },
        (Value::String(old), Value::String(s)) => {
            let literal = old
                .as_repr()
                .and_then(|repr| repr.as_raw().as_str())
                .is_some_and(|raw| raw.starts_with('\'') && !raw.starts_with("'''"));
            let text = s.value();
            if literal
                && !text.contains(['\'', '\n', '\r'])
                && let Ok(value @ Value::String(_)) = format!("'{text}'").parse::<Value>()
            {
                return value;
            }
            Value::String(s)
        }
        (Value::Array(old), Value::Array(mut array)) => {
            if let Some(template) = old.iter().last() {
                for (index, item) in array.iter_mut().enumerate() {
                    let source = old.get(index).unwrap_or(template);
                    let replaced = keep_style(source, std::mem::replace(item, Value::from(false)));
                    *item = replaced;
                    *item.decor_mut() = source.decor().clone();
                }
                array.set_trailing(old.trailing().clone());
                array.set_trailing_comma(old.trailing_comma());
            }
            Value::Array(array)
        }
        (_, value) => value,
    }
}

/// Converts a JSON value from the UI into a TOML value. `null` has no TOML equivalent.
pub fn json_to_value(value: &serde_json::Value) -> AppResult<Value> {
    use serde_json::Value as J;
    Ok(match value {
        J::Null => return Err(AppError::Invalid("null cannot be stored in TOML".into())),
        J::Bool(b) => Value::from(*b),
        J::Number(n) => match n.as_i64() {
            Some(i) => Value::from(i),
            None => Value::from(
                n.as_f64()
                    .ok_or_else(|| AppError::Invalid(format!("unsupported number {n}")))?,
            ),
        },
        J::String(s) => Value::from(s.as_str()),
        J::Array(items) => {
            let mut array = Array::new();
            for item in items {
                array.push(json_to_value(item)?);
            }
            Value::Array(array)
        }
        J::Object(map) => {
            let mut table = InlineTable::new();
            for (key, item) in map {
                table.insert(key, json_to_value(item)?);
            }
            Value::InlineTable(table)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = include_str!("../../tests/fixtures/config/commented.toml");

    fn menu_entry(identifier: &str, name: &str, url: &str, weight: i64) -> Vec<(String, Value)> {
        vec![
            ("identifier".into(), Value::from(identifier)),
            ("name".into(), Value::from(name)),
            ("url".into(), Value::from(url)),
            ("weight".into(), Value::from(weight)),
        ]
    }

    /// Lines of `after` that are not in `before`, in order.
    fn added_lines(before: &str, after: &str) -> Vec<String> {
        let mut old = before.lines().peekable();
        let mut added = Vec::new();
        for line in after.lines() {
            if old.peek() == Some(&line) {
                old.next();
            } else {
                added.push(line.to_string());
            }
        }
        assert!(
            old.next().is_none(),
            "a line of the original file was removed or changed"
        );
        added
    }

    #[test]
    fn untouched_document_is_byte_identical() {
        let editor = TomlEditor::parse(SAMPLE).unwrap();
        assert_eq!(editor.render(), SAMPLE);
    }

    #[test]
    fn crlf_and_bom_survive_edits() {
        let crlf = format!("\u{feff}{}", SAMPLE.replace('\n', "\r\n"));
        let mut editor = TomlEditor::parse(&crlf).unwrap();
        assert_eq!(editor.render(), crlf);
        editor
            .set_value(&["title"], Value::from("Yeni Başlık"))
            .unwrap();
        let out = editor.render();
        assert!(out.starts_with('\u{feff}'));
        assert_eq!(out.matches("\r\n").count(), out.matches('\n').count());
        assert_eq!(out.replace("Yeni Başlık", "Örnek Site"), crlf);
    }

    #[test]
    fn replacing_a_value_keeps_its_trailing_comment() {
        let mut editor = TomlEditor::parse(SAMPLE).unwrap();
        editor.set_value(&["locale"], Value::from("en")).unwrap();
        let out = editor.render();
        assert!(out.contains("locale = \"en\"  # eski adı: languageCode\n"));
        assert_eq!(out.replace("locale = \"en\"", "locale = \"tr\""), SAMPLE);
    }

    #[test]
    fn new_key_uses_sibling_indentation() {
        let mut editor = TomlEditor::parse(SAMPLE).unwrap();
        editor
            .set_value(&["params", "ShowToc"], Value::from(true))
            .unwrap();
        let out = editor.render();
        assert_eq!(added_lines(SAMPLE, &out), vec!["  ShowToc = true"]);
    }

    #[test]
    fn new_nested_table_is_created_at_the_end() {
        let mut editor = TomlEditor::parse(SAMPLE).unwrap();
        editor
            .set_value(&["pagination", "pagerSize"], Value::from(20))
            .unwrap();
        let out = editor.render();
        assert_eq!(
            added_lines(SAMPLE, &out),
            vec!["", "[pagination]", "pagerSize = 20"]
        );
        assert!(out.ends_with("[pagination]\npagerSize = 20\n"));
    }

    #[test]
    fn menu_entry_follows_its_sibling_and_keeps_comments() {
        let mut editor = TomlEditor::parse(SAMPLE).unwrap();
        editor
            .append_array_table(
                &["menu", "main"],
                &menu_entry("arsiv", "Arşiv", "/arsiv/", 50),
            )
            .unwrap();
        let out = editor.render();
        // Directly after the existing entry, indented like it, before the commented example.
        let inserted = "\n  [[menu.main]]\n    identifier = \"arsiv\"\n    name = \"Arşiv\"\n    url = \"/arsiv/\"\n    weight = 50\n";
        let anchor = "    weight = 100\n";
        assert!(
            out.contains(&format!("{anchor}{inserted}\n  # Örnek: bir kategori")),
            "{out}"
        );
        // Nothing else changed.
        assert_eq!(
            out.replacen(&format!("{anchor}{inserted}"), anchor, 1),
            SAMPLE
        );
        // And it parses back as the second menu entry.
        let reparsed = TomlEditor::parse(&out).unwrap();
        let menu = reparsed
            .get(&["menu", "main"])
            .unwrap()
            .as_array_of_tables()
            .unwrap();
        assert_eq!(menu.len(), 2);
    }

    #[test]
    fn third_entry_copies_spacing_between_entries() {
        let mut editor = TomlEditor::parse(SAMPLE).unwrap();
        editor
            .append_array_table(&["menu", "main"], &menu_entry("a", "A", "/a/", 10))
            .unwrap();
        editor
            .append_array_table(&["menu", "main"], &menu_entry("b", "B", "/b/", 20))
            .unwrap();
        let out = editor.render();
        assert!(out.contains("    weight = 10\n\n  [[menu.main]]\n    identifier = \"b\""));
    }

    #[test]
    fn creates_array_of_tables_when_missing() {
        let mut editor = TomlEditor::parse("title = \"x\"\n").unwrap();
        editor
            .append_array_table(&["menus", "main"], &menu_entry("home", "Home", "/", 1))
            .unwrap();
        let out = editor.render();
        let reparsed = TomlEditor::parse(&out).unwrap();
        assert!(reparsed.contains(&["menus", "main"]));
        assert!(out.starts_with("title = \"x\"\n"));
    }

    #[test]
    fn remove_deletes_only_that_key() {
        let mut editor = TomlEditor::parse(SAMPLE).unwrap();
        assert!(editor.remove(&["params", "ShowWordCount"]).unwrap());
        assert!(!editor.remove(&["params", "DoesNotExist"]).unwrap());
        assert!(!editor.remove(&["nope", "x"]).unwrap());
        let out = editor.render();
        assert!(!out.contains("ShowWordCount"));
        assert_eq!(out.lines().count(), SAMPLE.lines().count() - 1);
    }

    #[test]
    fn refuses_to_overwrite_a_table_with_a_value() {
        let mut editor = TomlEditor::parse(SAMPLE).unwrap();
        assert!(editor.set_value(&["params"], Value::from(1)).is_err());
    }

    fn path(parts: &[&str]) -> Vec<PathKey> {
        parts
            .iter()
            .map(|p| match p.parse::<usize>() {
                Ok(index) => PathKey::Index(index),
                Err(_) => PathKey::Key(p.to_string()),
            })
            .collect()
    }

    #[test]
    fn sets_keys_inside_an_array_of_tables_entry() {
        let mut editor = TomlEditor::parse(SAMPLE).unwrap();
        editor
            .set_at(&path(&["menu", "main", "0", "weight"]), Value::from(5))
            .unwrap();
        editor
            .set_at(&path(&["menu", "main", "0", "pre"]), Value::from("<i></i>"))
            .unwrap();
        let out = editor.render();
        assert_eq!(
            added_lines(&SAMPLE.replace("weight = 100", "weight = 5"), &out),
            vec!["    pre = \"<i></i>\""]
        );
        assert!(
            editor
                .set_at(&path(&["menu", "main", "3", "weight"]), Value::from(1))
                .is_err()
        );
        assert!(
            editor
                .set_at(&path(&["menu", "main", "0"]), Value::from(1))
                .is_err()
        );
    }

    #[test]
    fn removes_an_array_of_tables_entry_cleanly() {
        let mut editor = TomlEditor::parse(SAMPLE).unwrap();
        editor
            .append_array_table(&["menu", "main"], &menu_entry("a", "A", "/a/", 1))
            .unwrap();
        assert!(editor.remove_at(&path(&["menu", "main", "1"])).unwrap());
        assert_eq!(editor.render(), SAMPLE);
        assert!(!editor.remove_at(&path(&["menu", "main", "7"])).unwrap());
        assert!(!editor.remove_at(&path(&["nothing", "here", "0"])).unwrap());
    }

    #[test]
    fn converts_to_json_with_file_casing() {
        let editor = TomlEditor::parse(SAMPLE).unwrap();
        let json = editor.to_json();
        assert_eq!(json["params"]["ShowReadingTime"], serde_json::json!(true));
        assert_eq!(json["params"]["homeInfoParams"]["Title"], "Örnek Site");
        assert_eq!(json["menu"]["main"][0]["weight"], 100);
        assert_eq!(
            json["outputs"]["home"],
            serde_json::json!(["HTML", "RSS", "llms"])
        );
        let keys: Vec<&String> = json.as_object().unwrap().keys().collect();
        assert_eq!(
            &keys[..4],
            ["baseURL", "locale", "defaultContentLanguage", "title"]
        );
        let dates = TomlEditor::parse("d = 2026-10-03T00:11:40+03:00\n").unwrap();
        assert_eq!(dates.to_json()["d"], "2026-10-03T00:11:40+03:00");
    }

    #[test]
    fn extracts_comments_as_help_text() {
        let comments = TomlEditor::parse(SAMPLE).unwrap().comments();
        let get = |key: &str| comments.get(key).and_then(|v| v.as_str()).map(String::from);
        assert_eq!(get("locale").as_deref(), Some("eski adı: languageCode"));
        assert_eq!(
            get("removePathAccents").as_deref(),
            Some("Türkçe harfler adreste sadeleşsin: \"gündem\" -> \"gundem\".")
        );
        assert_eq!(
            get("markup.goldmark.renderer.unsafe").as_deref(),
            Some("Ham HTML bloklarına izin ver.")
        );
        assert_eq!(
            get("menu").as_deref(),
            Some("Üst menü yalnızca aşağıdaki girdilerden oluşur.")
        );
        // The commented-out example is separated by a blank line, so it describes nothing.
        assert!(
            comments
                .values()
                .all(|v| !v.as_str().unwrap().contains("Örnek: bir"))
        );
        assert_eq!(get("title"), None);
    }

    #[test]
    fn rejects_invalid_toml_and_mixed_endings() {
        assert!(matches!(TomlEditor::parse("a = "), Err(AppError::Toml(_))));
        assert!(matches!(
            TomlEditor::parse("a = 1\r\nb = 2\n"),
            Err(AppError::MixedLineEndings)
        ));
    }

    #[test]
    fn converts_json_values() {
        let json = serde_json::json!({"s": "x", "n": 3, "f": 1.5, "b": true, "list": ["a", "b"]});
        let value = json_to_value(&json).unwrap();
        assert_eq!(
            value.to_string(),
            "{ s = \"x\", n = 3, f = 1.5, b = true, list = [\"a\", \"b\"] }"
        );
        assert!(json_to_value(&serde_json::Value::Null).is_err());
    }

    #[test]
    fn replacements_keep_dates_quotes_and_array_layout() {
        let source =
            "date = 2024-05-01T10:00:00+03:00\ntitle = 'Old'\ntags = [\n  \"a\",\n  \"b\",\n]\n";
        let mut editor = TomlEditor::parse(source).unwrap();
        let set = |editor: &mut TomlEditor, key: &str, json: serde_json::Value| {
            editor
                .set_at(&[PathKey::Key(key.into())], json_to_value(&json).unwrap())
                .unwrap();
        };
        set(
            &mut editor,
            "date",
            serde_json::json!("2024-06-02T09:30:00+03:00"),
        );
        set(&mut editor, "title", serde_json::json!("New"));
        set(&mut editor, "tags", serde_json::json!(["a", "c", "d"]));
        assert_eq!(
            editor.render(),
            "date = 2024-06-02T09:30:00+03:00\ntitle = 'New'\ntags = [\n  \"a\",\n  \"c\",\n  \"d\",\n]\n"
        );
        // A quote inside the text cannot go in a literal string.
        set(&mut editor, "title", serde_json::json!("It's"));
        assert!(editor.render().contains("title = \"It's\"\n"));
        // Text that is not a date stays a string.
        set(&mut editor, "date", serde_json::json!("soon"));
        assert!(editor.render().contains("date = \"soon\"\n"));
    }
}
