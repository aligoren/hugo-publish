//! Running the system `git` binary: the flags, environment, timeouts and write lock that every
//! git call needs, in one place.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{Mutex, MutexGuard};

use super::errors::{GitErrorKind, classify, git_error};
use crate::error::AppResult;

/// Environment variable that points the app at a specific `git` binary.
pub const GIT_PATH_ENV: &str = "HUGO_PUBLISHER_GIT";

/// Local queries: status, diff, config.
pub(crate) const LOCAL_TIMEOUT: Duration = Duration::from_secs(30);
/// Anything that may talk to a remote or run hooks: commit, pull, push, fetch.
pub(crate) const LONG_TIMEOUT: Duration = Duration::from_secs(300);

/// Finds `git`: the override variable, PATH, then well-known install locations (GUI apps do not
/// always inherit the shell's PATH). A found binary is remembered; a missing one is looked for
/// again next time, so installing git while the app runs works.
pub fn git_binary() -> Option<PathBuf> {
    static FOUND: OnceLock<PathBuf> = OnceLock::new();
    if let Some(path) = FOUND.get() {
        return Some(path.clone());
    }
    let path = find_git()?;
    Some(FOUND.get_or_init(|| path).clone())
}

fn find_git() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os(GIT_PATH_ENV).map(PathBuf::from)
        && custom.is_file()
    {
        return Some(custom);
    }
    if let Ok(path) = which::which("git") {
        return Some(path);
    }
    well_known_locations().into_iter().find(|p| p.is_file())
}

fn well_known_locations() -> Vec<PathBuf> {
    let mut list = Vec::new();
    #[cfg(windows)]
    {
        for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(dir) = std::env::var_os(var) {
                list.push(PathBuf::from(dir).join(r"Git\cmd\git.exe"));
            }
        }
        if let Some(dir) = std::env::var_os("LOCALAPPDATA") {
            list.push(PathBuf::from(dir).join(r"Programs\Git\cmd\git.exe"));
        }
        if let Some(dir) = std::env::var_os("USERPROFILE") {
            list.push(PathBuf::from(dir).join(r"scoop\shims\git.exe"));
        }
    }
    #[cfg(not(windows))]
    {
        for path in [
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/usr/bin/git",
        ] {
            list.push(PathBuf::from(path));
        }
    }
    list
}

/// Serializes commands that change the repository, so two never overlap within the app.
pub(crate) async fn write_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().await
}

pub(crate) struct GitOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl GitOutput {
    pub fn stdout_text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    /// stdout and stderr together, for showing to the user.
    pub fn combined(&self) -> String {
        let stdout = self.stdout_text();
        match (stdout.trim().is_empty(), self.stderr.trim().is_empty()) {
            (true, _) => self.stderr.trim().to_string(),
            (false, true) => stdout.trim().to_string(),
            (false, false) => format!("{}\n{}", stdout.trim_end(), self.stderr.trim()),
        }
    }

    /// The error to report for a failed command, classified from its output.
    pub fn failure(&self) -> crate::error::AppError {
        let text = self.combined();
        git_error(classify(&text), text)
    }
}

/// One `git -C <root> …` invocation.
pub(crate) struct Git<'a> {
    root: &'a Path,
    args: Vec<OsString>,
    read_only: bool,
    literal_pathspecs: bool,
    timeout: Duration,
    stdin: Option<Vec<u8>>,
}

impl<'a> Git<'a> {
    pub fn new(root: &'a Path) -> Self {
        Self {
            root,
            args: Vec::new(),
            read_only: false,
            literal_pathspecs: false,
            timeout: LOCAL_TIMEOUT,
            stdin: None,
        }
    }

    pub fn arg(mut self, arg: impl AsRef<OsStr>) -> Self {
        self.args.push(arg.as_ref().to_owned());
        self
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.args
            .extend(args.into_iter().map(|a| a.as_ref().to_owned()));
        self
    }

    /// Never takes optional locks (`GIT_OPTIONAL_LOCKS=0`), so it cannot disturb a running write.
    pub fn read_only(mut self) -> Self {
        self.read_only = true;
        self
    }

    /// Paths are file names, not glob patterns: `notlar[1].md` means exactly that file.
    pub fn literal_pathspecs(mut self) -> Self {
        self.literal_pathspecs = true;
        self
    }

    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn stdin(mut self, input: impl Into<Vec<u8>>) -> Self {
        self.stdin = Some(input.into());
        self
    }

    /// Runs git and returns its output whatever the exit code. Errors only when git cannot be
    /// started or does not finish in time.
    pub async fn output(self) -> AppResult<GitOutput> {
        let binary = git_binary().ok_or_else(|| {
            git_error(
                GitErrorKind::NotFound,
                "git was not found on PATH or in the usual install locations",
            )
        })?;
        let mut command = Command::new(&binary);
        command
            .arg("-C")
            .arg(self.root)
            .args(["-c", "core.quotepath=off", "-c", "color.ui=false"])
            .args(&self.args)
            // Never wait for input on a terminal nobody can see.
            .env("GIT_TERMINAL_PROMPT", "0")
            // ":" tells git not to start an editor at all.
            .env("GIT_EDITOR", ":")
            .env("GIT_MERGE_AUTOEDIT", "no")
            // English messages, so failures can be recognized; the character set is left alone.
            .env("LANGUAGE", "en")
            .env("LC_MESSAGES", "C")
            // The repository is the site folder, whatever the app was started from.
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_INDEX_FILE")
            .stdin(if self.stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if self.read_only {
            command.env("GIT_OPTIONAL_LOCKS", "0");
        }
        if self.literal_pathspecs {
            command.env("GIT_LITERAL_PATHSPECS", "1");
        }
        #[cfg(windows)]
        command.creation_flags(crate::hugo::CREATE_NO_WINDOW);

        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                git_error(
                    GitErrorKind::NotFound,
                    format!("{}: {error}", binary.display()),
                )
            } else {
                error.into()
            }
        })?;
        if let (Some(input), Some(mut pipe)) = (self.stdin, child.stdin.take()) {
            // Written concurrently with reading the output, so a large input cannot deadlock.
            tokio::spawn(async move {
                let _ = pipe.write_all(&input).await;
                let _ = pipe.shutdown().await;
            });
        }
        let what = self
            .args
            .iter()
            .find(|a| !a.to_string_lossy().starts_with('-') && !a.to_string_lossy().contains('='))
            .map(|a| a.to_string_lossy().into_owned())
            .unwrap_or_default();
        let output = tokio::time::timeout(self.timeout, child.wait_with_output())
            .await
            .map_err(|_| {
                git_error(
                    GitErrorKind::Timeout,
                    format!(
                        "`git {what}` did not finish within {} seconds",
                        self.timeout.as_secs()
                    ),
                )
            })??;
        Ok(GitOutput {
            success: output.status.success(),
            stdout: output.stdout,
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }

    /// Runs git and fails with a classified error when it exits with an error.
    pub async fn run(self) -> AppResult<GitOutput> {
        let output = self.output().await?;
        if output.success {
            Ok(output)
        } else {
            Err(output.failure())
        }
    }
}
