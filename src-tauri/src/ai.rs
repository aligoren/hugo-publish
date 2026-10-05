//! Opt-in AI assistant: meta descriptions, title ideas, image alt text and translation drafts,
//! through the Anthropic Messages API with the user's own API key.
//!
//! The assistant is off by default. The key lives in the OS credential store (Windows Credential
//! Manager, macOS Keychain, Secret Service) and never reaches the web view. Text is sent to
//! Anthropic only when the user asks for a suggestion.

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
pub const MODEL: &str = "claude-opus-5-5";
/// Server-side fallback: a declined request is re-run on Anthropic's recommended fallback model.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const KEYRING_SERVICE: &str = "hugo-publisher";
const KEYRING_USER: &str = "anthropic-api-key";
/// Images larger than this (bytes or longest side) are downscaled before sending.
const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_IMAGE_SIDE: u32 = 1568;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub enabled: bool,
    pub has_key: bool,
    pub model: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettings {
    #[serde(default)]
    enabled: bool,
}

/// One request to the Messages API whose answer must match `schema`.
#[derive(Debug, Clone)]
pub struct Request {
    pub system: String,
    pub content: Vec<Value>,
    pub schema: Value,
    /// low | medium | high
    pub effort: &'static str,
    pub max_tokens: u32,
}

pub fn request_body(request: &Request) -> Value {
    json!({
        "model": MODEL,
        "max_tokens": request.max_tokens,
        "system": request.system,
        "messages": [{ "role": "user", "content": request.content }],
        "output_config": {
            "effort": request.effort,
            "format": { "type": "json_schema", "schema": request.schema },
        },
        "fallbacks": "default",
    })
}

/// The JSON answer from a successful response body. Refusals and cut-off answers are errors.
pub fn parse_response(body: &Value) -> AppResult<Value> {
    match body["stop_reason"].as_str() {
        Some("refusal") => return Err(AppError::AiRefused),
        Some("max_tokens") => {
            return Err(AppError::Ai(
                "the answer was cut off (the text is too long)".into(),
            ));
        }
        _ => {}
    }
    let text: String = body["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect();
    serde_json::from_str(&text).map_err(|e| AppError::Ai(format!("unexpected answer format: {e}")))
}

/// A readable error for a failed HTTP response.
pub fn error_for_status(status: u16, body: &str) -> AppError {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(String::from))
        .unwrap_or_else(|| body.chars().take(300).collect());
    match status {
        401 => AppError::Ai("the API key was not accepted (401)".into()),
        402 => AppError::Ai(format!(
            "billing problem on the Anthropic account (402): {message}"
        )),
        403 => AppError::Ai(format!(
            "this API key is not allowed to do that (403): {message}"
        )),
        429 => AppError::Ai(format!(
            "rate limit reached, try again shortly (429): {message}"
        )),
        500..=599 => AppError::Ai(format!("Anthropic is having trouble ({status}): {message}")),
        _ => AppError::Ai(format!("{status}: {message}")),
    }
}

fn retryable(status: u16) -> bool {
    status == 429 || status == 529 || (500..600).contains(&status)
}

async fn send(key: &str, request: &Request) -> AppResult<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| AppError::Ai(e.to_string()))?;
    let body = request_body(request);
    let mut attempt = 0;
    loop {
        attempt += 1;
        let response = client
            .post(API_URL)
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("anthropic-beta", FALLBACK_BETA)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Ai(format!("could not reach api.anthropic.com: {e}")))?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(5)
            .min(30);
        let text = response
            .text()
            .await
            .map_err(|e| AppError::Ai(e.to_string()))?;
        if status == 200 {
            let json: Value =
                serde_json::from_str(&text).map_err(|e| AppError::Ai(e.to_string()))?;
            return parse_response(&json);
        }
        if attempt < 3 && retryable(status) {
            tokio::time::sleep(Duration::from_secs(retry_after)).await;
            continue;
        }
        return Err(error_for_status(status, &text));
    }
}

fn settings_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Invalid(format!("no config folder: {e}")))?;
    Ok(dir.join("ai.json"))
}

fn load_settings(app: &AppHandle) -> AiSettings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn keyring_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AppError::Invalid(format!("credential store unavailable: {e}")))
}

fn stored_key() -> Option<String> {
    keyring_entry()
        .ok()?
        .get_password()
        .ok()
        .filter(|k| !k.is_empty())
}

/// The key, if the assistant is enabled and a key is stored.
fn usable_key(app: &AppHandle) -> AppResult<String> {
    if !load_settings(app).enabled {
        return Err(AppError::AiDisabled);
    }
    stored_key().ok_or(AppError::AiNoKey)
}

fn text_block(text: impl Into<String>) -> Value {
    json!({ "type": "text", "text": text.into() })
}

fn object_schema(field: &str, value: Value) -> Value {
    json!({
        "type": "object",
        "properties": { field: value },
        "required": [field],
        "additionalProperties": false,
    })
}

fn language_name(code: &str) -> String {
    match code
        .split(['-', '_'])
        .next()
        .unwrap_or(code)
        .to_ascii_lowercase()
        .as_str()
    {
        "tr" => "Turkish".into(),
        "en" => "English".into(),
        "de" => "German".into(),
        "fr" => "French".into(),
        "es" => "Spanish".into(),
        "ar" => "Arabic".into(),
        "fa" => "Persian".into(),
        "nl" => "Dutch".into(),
        "it" => "Italian".into(),
        "pt" => "Portuguese".into(),
        "ru" => "Russian".into(),
        "ja" => "Japanese".into(),
        other => format!("the language with code \"{other}\""),
    }
}

pub fn describe_request(title: &str, body: &str, language: &str) -> Request {
    Request {
        system: format!(
            "You write meta descriptions for blog posts. Write one description in {} of at most 155 characters that tells a reader what the post is about, in the post's own tone. No quotes around it, no hashtags, no clickbait, no emoji.",
            language_name(language)
        ),
        content: vec![text_block(format!("Title: {title}\n\n{body}"))],
        schema: object_schema("description", json!({ "type": "string" })),
        effort: "low",
        max_tokens: 16000,
    }
}

pub fn titles_request(title: &str, body: &str, language: &str) -> Request {
    Request {
        system: format!(
            "You suggest titles for blog posts. Suggest 5 different titles in {} that fit the post's content and tone: clear, specific, at most 70 characters, no clickbait, no emoji.",
            language_name(language)
        ),
        content: vec![text_block(format!("Current title: {title}\n\n{body}"))],
        schema: object_schema(
            "titles",
            json!({ "type": "array", "items": { "type": "string" } }),
        ),
        effort: "low",
        max_tokens: 16000,
    }
}

pub fn alt_text_request(
    media_type: &str,
    data_base64: String,
    context: &str,
    language: &str,
) -> Request {
    Request {
        system: format!(
            "You write alt text for images on a website. Describe what the image shows in {} in one or two short sentences (at most 125 characters), so that someone who cannot see it gets the same information. Do not start with \"Image of\". If the image contains important text, include it.",
            language_name(language)
        ),
        content: vec![
            json!({ "type": "image", "source": { "type": "base64", "media_type": media_type, "data": data_base64 } }),
            text_block(format!("The image appears in this context:\n{context}")),
        ],
        schema: object_schema("alt", json!({ "type": "string" })),
        effort: "low",
        max_tokens: 16000,
    }
}

pub fn translate_request(markdown: &str, from: &str, to: &str) -> Request {
    Request {
        system: format!(
            "You translate Hugo Markdown documents from {} to {}. Return the whole document translated, with the same structure. Keep unchanged: Markdown syntax, HTML tags and attributes, URLs and link targets, image paths, code blocks and inline code, Hugo shortcodes ({{{{< … >}}}} and {{{{% … %}}}}) including their names and parameters, and any block in a right-to-left script (for example Arabic quotations). Translate only the human-readable text. Do not add notes or explanations.",
            language_name(from),
            language_name(to)
        ),
        content: vec![text_block(markdown.to_string())],
        schema: object_schema("translation", json!({ "type": "string" })),
        effort: "medium",
        max_tokens: 32000,
    }
}

fn field(answer: &Value, name: &str) -> AppResult<String> {
    answer[name]
        .as_str()
        .map(|s| s.trim().to_string())
        .ok_or_else(|| AppError::Ai(format!("the answer has no `{name}`")))
}

/// Reads an image from the site and makes it acceptable for the API (format, size).
fn prepare_image(bytes: Vec<u8>) -> AppResult<(String, String)> {
    let format = image::guess_format(&bytes)
        .map_err(|_| AppError::Invalid("not a supported image".into()))?;
    let media_type = match format {
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Gif => "image/gif",
        image::ImageFormat::WebP => "image/webp",
        _ => {
            return Err(AppError::Invalid(
                "only JPEG, PNG, GIF and WebP images are supported".into(),
            ));
        }
    };
    let (width, height) = image::ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .ok()
        .and_then(|r| r.into_dimensions().ok())
        .unwrap_or((0, 0));
    if bytes.len() <= MAX_IMAGE_BYTES && width.max(height) <= MAX_IMAGE_SIDE {
        return Ok((
            media_type.to_string(),
            base64::engine::general_purpose::STANDARD.encode(bytes),
        ));
    }
    let decoded = image::load_from_memory(&bytes)
        .map_err(|e| AppError::Invalid(format!("could not read the image: {e}")))?;
    let resized = decoded.thumbnail(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE).to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85)
        .encode_image(&resized)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    Ok((
        "image/jpeg".to_string(),
        base64::engine::general_purpose::STANDARD.encode(out),
    ))
}

#[tauri::command]
pub async fn ai_status(app: AppHandle) -> AppResult<AiStatus> {
    Ok(AiStatus {
        enabled: load_settings(&app).enabled,
        has_key: stored_key().is_some(),
        model: MODEL.to_string(),
    })
}

#[tauri::command]
pub async fn ai_configure(app: AppHandle, enabled: bool) -> AppResult<AiStatus> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let settings = AiSettings { enabled };
    fs::write(
        &path,
        serde_json::to_string_pretty(&settings).map_err(|e| AppError::Invalid(e.to_string()))?,
    )?;
    ai_status(app).await
}

/// Stores the API key in the OS credential store; `None` deletes it.
#[tauri::command]
pub async fn ai_set_key(app: AppHandle, key: Option<String>) -> AppResult<AiStatus> {
    let entry = keyring_entry()?;
    match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(key) => entry
            .set_password(&key)
            .map_err(|e| AppError::Invalid(format!("could not store the key: {e}")))?,
        None => {
            let _ = entry.delete_credential();
        }
    }
    ai_status(app).await
}

#[tauri::command]
pub async fn ai_describe(
    app: AppHandle,
    title: String,
    body: String,
    language: String,
) -> AppResult<String> {
    let key = usable_key(&app)?;
    let answer = send(&key, &describe_request(&title, &body, &language)).await?;
    field(&answer, "description")
}

#[tauri::command]
pub async fn ai_titles(
    app: AppHandle,
    title: String,
    body: String,
    language: String,
) -> AppResult<Vec<String>> {
    let key = usable_key(&app)?;
    let answer = send(&key, &titles_request(&title, &body, &language)).await?;
    Ok(answer["titles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| t.as_str().map(|s| s.trim().to_string()))
        .filter(|t| !t.is_empty())
        .collect())
}

/// Alt text for an image inside the open site.
#[tauri::command]
pub async fn ai_alt_text(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    context: String,
    language: String,
) -> AppResult<String> {
    let key = usable_key(&app)?;
    let site = state.site()?;
    let file = crate::site::resolve(&site.root, &path)?;
    let bytes = fs::read(&file)?;
    let (media_type, data) = tauri::async_runtime::spawn_blocking(move || prepare_image(bytes))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))??;
    let answer = send(
        &key,
        &alt_text_request(&media_type, data, &context, &language),
    )
    .await?;
    field(&answer, "alt")
}

#[tauri::command]
pub async fn ai_translate(
    app: AppHandle,
    markdown: String,
    from: String,
    to: String,
) -> AppResult<String> {
    let key = usable_key(&app)?;
    let answer = send(&key, &translate_request(&markdown, &from, &to)).await?;
    field(&answer, "translation")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_structured_request_with_fallbacks() {
        let body = request_body(&titles_request("Eski", "Gövde", "tr"));
        assert_eq!(body["model"], MODEL);
        assert_eq!(body["fallbacks"], "default");
        assert_eq!(body["output_config"]["effort"], "low");
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        let schema = &body["output_config"]["format"]["schema"];
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"], json!(["titles"]));
        assert_eq!(body["messages"][0]["role"], "user");
        assert!(body["system"].as_str().unwrap().contains("Turkish"));
        assert!(body.get("thinking").is_none());
    }

    #[test]
    fn puts_the_image_before_the_text() {
        let request = alt_text_request("image/png", "AAAA".into(), "Bir yazı", "en");
        let content = &request_body(&request)["messages"][0]["content"];
        assert_eq!(content[0]["type"], "image");
        assert_eq!(content[0]["source"]["media_type"], "image/png");
        assert_eq!(content[1]["type"], "text");
    }

    #[test]
    fn keeps_shortcode_braces_in_the_translation_prompt() {
        let request = translate_request("x", "tr", "en");
        assert!(request.system.contains("{{< … >}}"));
        assert!(request.system.contains("{{% … %}}"));
        assert!(request.system.contains("from Turkish to English"));
    }

    #[test]
    fn parses_answers_and_rejects_refusals_and_cut_offs() {
        let ok = json!({
            "stop_reason": "end_turn",
            "content": [
                { "type": "thinking", "thinking": "" },
                { "type": "text", "text": "{\"titles\":[\"Bir\",\"İki\"]}" }
            ]
        });
        assert_eq!(parse_response(&ok).unwrap()["titles"][1], "İki");
        let refused = json!({ "stop_reason": "refusal", "content": [] });
        assert!(matches!(parse_response(&refused), Err(AppError::AiRefused)));
        let cut =
            json!({ "stop_reason": "max_tokens", "content": [{ "type": "text", "text": "{" }] });
        assert!(matches!(parse_response(&cut), Err(AppError::Ai(_))));
        let garbage =
            json!({ "stop_reason": "end_turn", "content": [{ "type": "text", "text": "hi" }] });
        assert!(parse_response(&garbage).is_err());
    }

    #[test]
    fn explains_http_errors() {
        let body = r#"{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}"#;
        assert!(
            error_for_status(429, body)
                .to_string()
                .contains("slow down")
        );
        assert!(
            error_for_status(401, "")
                .to_string()
                .contains("not accepted")
        );
        assert!(retryable(529) && retryable(500) && retryable(429));
        assert!(!retryable(400) && !retryable(401));
    }

    #[test]
    fn downsizes_large_images_and_rejects_unsupported_ones() {
        let big = image::RgbImage::from_pixel(3000, 1000, image::Rgb([200, 10, 10]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(big)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let (media_type, data) = prepare_image(png).unwrap();
        assert_eq!(media_type, "image/jpeg");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(data)
            .unwrap();
        let (w, h) = image::load_from_memory(&decoded)
            .unwrap()
            .to_rgb8()
            .dimensions();
        assert_eq!((w, h), (1568, 523));

        let small = image::RgbImage::from_pixel(10, 10, image::Rgb([0, 0, 0]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(small)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        assert_eq!(prepare_image(png).unwrap().0, "image/png");

        assert!(prepare_image(b"<svg></svg>".to_vec()).is_err());
    }
}
