use serde::Serialize;

/// Errors returned to the UI. The UI translates `code`; `message` is an English detail for logs.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Hugo was not found")]
    HugoNotFound,
    #[error("Hugo failed: {0}")]
    Hugo(String),
    #[error("no site is open")]
    NoSite,
    #[error("not a Hugo site: {0}")]
    NotASite(String),
    #[error("path is outside the site folder: {0}")]
    PathOutsideSite(String),
    #[error("the file changed on disk since it was opened")]
    Conflict,
    #[error("the file is not valid UTF-8: {0}")]
    NotUtf8(String),
    #[error("the file mixes LF and CRLF line endings")]
    MixedLineEndings,
    #[error("invalid TOML: {0}")]
    Toml(String),
    /// A git failure; `code` is one of the `git_*` codes in `crate::git::errors`.
    #[error("{detail}")]
    Git { code: &'static str, detail: String },
    /// Could not reach a server, or it answered with an error (GitHub, theme downloads…).
    #[error("{0}")]
    Network(String),
    #[error("the AI assistant is turned off")]
    AiDisabled,
    #[error("no API key is set for the AI assistant")]
    AiNoKey,
    #[error("the model declined this request")]
    AiRefused,
    #[error("AI request failed: {0}")]
    Ai(String),
    #[error("{0}")]
    Invalid(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Io(_) => "io",
            AppError::HugoNotFound => "hugo_not_found",
            AppError::Hugo(_) => "hugo_failed",
            AppError::NoSite => "no_site",
            AppError::NotASite(_) => "not_a_site",
            AppError::PathOutsideSite(_) => "path_outside_site",
            AppError::Conflict => "conflict",
            AppError::NotUtf8(_) => "not_utf8",
            AppError::MixedLineEndings => "mixed_line_endings",
            AppError::Toml(_) => "invalid_toml",
            AppError::Git { code, .. } => code,
            AppError::Network(_) => "network",
            AppError::AiDisabled => "ai_disabled",
            AppError::AiNoKey => "ai_no_key",
            AppError::AiRefused => "ai_refused",
            AppError::Ai(_) => "ai_failed",
            AppError::Invalid(_) => "invalid",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
