//! Running `hugo server` for the live preview.
//!
//! The process runs inside a Windows Job Object (or a Unix process group) with kill-on-drop, so
//! Hugo and anything it starts (Dart Sass, PostCSS…) die together, even if the app crashes.

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
#[cfg(windows)]
use process_wrap::tokio::{CreationFlags, JobObject};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::mpsc;

use super::output::{
    Level, SourceLocation, classify, is_port_failure, ready_url, source_location, strip_control,
};
use crate::error::{AppError, AppResult};

const START_TIMEOUT: Duration = Duration::from_secs(90);
const STOP_TIMEOUT: Duration = Duration::from_secs(10);
const PORT_ATTEMPTS: usize = 3;
const KEPT_ERROR_LINES: usize = 20;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerOptions {
    #[serde(default)]
    pub drafts: bool,
    #[serde(default)]
    pub future: bool,
    #[serde(default)]
    pub expired: bool,
    /// `development` when unset, as with a plain `hugo server`.
    #[serde(default)]
    pub environment: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerEvent {
    #[serde(rename_all = "camelCase")]
    Log {
        stream: Stream,
        level: Level,
        text: String,
        location: Option<SourceLocation>,
    },
    Ready {
        url: String,
    },
    /// The process ended: stopped by the app, or crashed.
    Exited,
}

pub struct RunningServer {
    child: Box<dyn ChildWrapper>,
    pub url: String,
    pub port: u16,
    pub site: PathBuf,
}

impl RunningServer {
    /// Kills the whole process tree and waits for it to go away.
    pub async fn stop(mut self) -> AppResult<()> {
        // The process may already have exited on its own.
        let _ = self.child.start_kill();
        let _ = tokio::time::timeout(STOP_TIMEOUT, self.child.wait()).await;
        Ok(())
    }
}

enum StartError {
    PortTaken(String),
    Failed(AppError),
}

/// Starts `hugo server` on a free loopback port and resolves once Hugo reports the preview URL.
/// Every output line, before and after that point, is passed to `on_event`.
pub async fn start<F>(
    hugo: &Path,
    site: &Path,
    options: &ServerOptions,
    on_event: F,
) -> AppResult<RunningServer>
where
    F: Fn(ServerEvent) + Send + Sync + Clone + 'static,
{
    let mut last_error = String::new();
    for _ in 0..PORT_ATTEMPTS {
        let port = free_port()?;
        match start_on_port(hugo, site, options, port, on_event.clone()).await {
            Ok(server) => return Ok(server),
            Err(StartError::PortTaken(detail)) => last_error = detail,
            Err(StartError::Failed(error)) => return Err(error),
        }
    }
    Err(AppError::Hugo(format!(
        "no free port for hugo server: {last_error}"
    )))
}

/// Picks a free port. `--port 0` is not an option: Hugo would report `localhost:0`.
fn free_port() -> AppResult<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

fn server_args(site: &Path, options: &ServerOptions, port: u16) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = vec!["server".into(), "--source".into(), site.into()];
    for arg in [
        "--bind",
        "127.0.0.1",
        "--port",
        &port.to_string(),
        // Serve from memory so the preview never touches the site's public/ folder.
        "--renderToMemory",
        // When a content file is saved, the preview jumps to that page.
        "--navigateToChanged",
        "--noHTTPCache",
    ] {
        args.push(arg.into());
    }
    if options.drafts {
        args.push("--buildDrafts".into());
    }
    if options.future {
        args.push("--buildFuture".into());
    }
    if options.expired {
        args.push("--buildExpired".into());
    }
    if let Some(environment) = &options.environment {
        args.push("--environment".into());
        args.push(environment.into());
    }
    args
}

async fn start_on_port<F>(
    hugo: &Path,
    site: &Path,
    options: &ServerOptions,
    port: u16,
    on_event: F,
) -> Result<RunningServer, StartError>
where
    F: Fn(ServerEvent) + Send + Sync + Clone + 'static,
{
    let args = server_args(site, options, port);
    let mut command = CommandWrap::with_new(hugo, |command| {
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
    });
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::PROCESS_CREATION_FLAGS;
        command.wrap(CreationFlags(PROCESS_CREATION_FLAGS(
            super::CREATE_NO_WINDOW,
        )));
        command.wrap(JobObject);
    }
    #[cfg(unix)]
    command.wrap(ProcessGroup::leader());
    command.wrap(KillOnDrop);

    let mut child = command.spawn().map_err(|e| StartError::Failed(e.into()))?;
    let (tx, mut rx) = mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout().take() {
        spawn_reader(stdout, Stream::Stdout, tx.clone());
    }
    if let Some(stderr) = child.stderr().take() {
        spawn_reader(stderr, Stream::Stderr, tx.clone());
    }
    drop(tx);

    let mut problems: Vec<String> = Vec::new();
    let deadline = tokio::time::Instant::now() + START_TIMEOUT;
    loop {
        let (stream, text) = match tokio::time::timeout_at(deadline, rx.recv()).await {
            Err(_) => {
                let _ = child.start_kill();
                return Err(StartError::Failed(AppError::Hugo(
                    "hugo server did not become ready in time".into(),
                )));
            }
            // Both pipes closed: Hugo exited before it was ready.
            Ok(None) => {
                let _ = child.wait().await;
                let detail = problems.join("\n");
                return Err(if problems.iter().any(|l| is_port_failure(l)) {
                    StartError::PortTaken(detail)
                } else {
                    StartError::Failed(AppError::Hugo(if detail.is_empty() {
                        "hugo server exited unexpectedly".into()
                    } else {
                        detail
                    }))
                });
            }
            Ok(Some(line)) => line,
        };

        let event = log_event(stream, &text);
        if let ServerEvent::Log { level, .. } = &event
            && (*level != Level::Info || is_port_failure(&text))
        {
            problems.push(text.clone());
            if problems.len() > KEPT_ERROR_LINES {
                problems.remove(0);
            }
        }
        on_event(event);

        if let Some(url) = ready_url(&text) {
            on_event(ServerEvent::Ready { url: url.clone() });
            let forward = on_event.clone();
            tokio::spawn(async move {
                while let Some((stream, text)) = rx.recv().await {
                    forward(log_event(stream, &text));
                }
                forward(ServerEvent::Exited);
            });
            return Ok(RunningServer {
                child,
                url,
                port,
                site: site.to_path_buf(),
            });
        }
    }
}

fn log_event(stream: Stream, text: &str) -> ServerEvent {
    let level = classify(text);
    let location = if level == Level::Info {
        None
    } else {
        source_location(text)
    };
    ServerEvent::Log {
        stream,
        level,
        text: text.to_string(),
        location,
    }
}

/// Forwards cleaned, non-empty output lines. Reads bytes rather than `lines()` so invalid UTF-8
/// in third-party tool output cannot stop the reader.
fn spawn_reader<R>(reader: R, stream: Stream, tx: mpsc::UnboundedSender<(Stream, String)>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let text = strip_control(&String::from_utf8_lossy(&buffer));
                    let text = text.trim_end();
                    if !text.trim().is_empty() && tx.send((stream, text.to_string())).is_err() {
                        break;
                    }
                }
            }
        }
    });
}
