//! Builds the site into a temporary folder, from the files on disk or from a git revision checked
//! out into a temporary worktree. Nothing is written to the site's `public/` or `resources/`.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use super::commands::{BuildFile, BuildOptions, BuildResult};
use crate::config::commands::{HugoMessage, messages};
use crate::error::{AppError, AppResult};
use crate::git::runner::{Git, LONG_TIMEOUT, git_binary, write_lock};
use crate::hugo::output::Level;
use crate::hugo::short_command;

/// A build that takes longer than this is stopped.
pub const BUILD_TIMEOUT: Duration = Duration::from_secs(300);
/// Name prefix of the temporary work folders; each holds `public/` (the output) and, for
/// revision builds, `src/` (the worktree).
pub const WORK_DIR_PREFIX: &str = "hugo-publisher-build-";
/// Leftovers of earlier sessions (a crash, a forgotten discard) are removed after this long.
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);
/// `read_build_file` refuses larger files: it is meant for HTML, CSS and similar text.
const MAX_READ_BYTES: u64 = 32 * 1024 * 1024;

/// Output folders created by [`build`]. Only these can be read or discarded.
static BUILDS: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// Builds the site at `root` (or `options.revision` of its repository) into a new temporary
/// folder. A Hugo failure is a result with `ok: false` and Hugo's messages; the folder is kept
/// (and registered) either way, so pass it to [`discard`] when done.
pub async fn build(hugo: &Path, root: &Path, options: &BuildOptions) -> AppResult<BuildResult> {
    remove_stale_work_dirs();
    let started = Instant::now();
    let work = new_work_dir()?;
    let output = work.join("public");
    fs::create_dir_all(&output)?;
    BUILDS.lock().unwrap().insert(output.clone());

    let result = build_into(hugo, root, options, &work, &output).await;
    match result {
        Ok((ok, messages)) => match list_output(&output) {
            Ok(files) => Ok(BuildResult {
                ok,
                output_dir: output.to_string_lossy().into_owned(),
                files,
                messages,
                duration_ms: started.elapsed().as_millis() as u64,
            }),
            Err(error) => {
                let _ = discard(&output.to_string_lossy());
                Err(error)
            }
        },
        Err(error) => {
            let _ = discard(&output.to_string_lossy());
            Err(error)
        }
    }
}

async fn build_into(
    hugo: &Path,
    root: &Path,
    options: &BuildOptions,
    work: &Path,
    output: &Path,
) -> AppResult<(bool, Vec<HugoMessage>)> {
    let Some(revision) = options.revision.as_deref() else {
        // The working tree: Hugo may rewrite `hugo_stats.json` in the site; put it back.
        let stats = FileSnapshot::take(&root.join("hugo_stats.json"));
        let result = run_hugo(hugo, root, root, output, options).await;
        stats.restore();
        return result;
    };
    check_revision(revision)?;
    let mut worktree = Worktree::add(root, revision, &work.join("src")).await?;
    let mut notes = Vec::new();
    let result = async {
        notes = worktree.init_submodules().await;
        run_hugo(hugo, &worktree.site_dir(), root, output, options).await
    }
    .await;
    worktree.remove().await;
    let (ok, mut messages) = result?;
    notes.append(&mut messages);
    Ok((ok, notes))
}

/// Runs `hugo build` on `source`; `site` (the site folder on disk) names the resource cache.
async fn run_hugo(
    hugo: &Path,
    source: &Path,
    site: &Path,
    output: &Path,
    options: &BuildOptions,
) -> AppResult<(bool, Vec<HugoMessage>)> {
    let cache = cache_root();
    let resources = cache.join("resources").join(site_key(site));
    fs::create_dir_all(&resources)?;
    let mut command = short_command(hugo);
    command
        .arg("build")
        .arg("--source")
        .arg(source)
        .arg("--destination")
        .arg(output)
        .arg("--noBuildLock")
        .arg("--cacheDir")
        .arg(cache.join("cache"))
        // Processed images and assets go here instead of the site's `resources/_gen`.
        .env("HUGO_RESOURCEDIR", &resources)
        // `js.Build` would otherwise write `assets/jsconfig.json` into the site.
        .env("HUGO_BUILD_NOJSCONFIGINASSETS", "true");
    if options.drafts {
        command.arg("--buildDrafts");
    }
    if options.future {
        command.arg("--buildFuture");
    }
    if let Some(environment) = options.environment.as_deref().map(str::trim)
        && !environment.is_empty()
    {
        command.arg(format!("--environment={environment}"));
    }
    let output = tokio::time::timeout(BUILD_TIMEOUT, command.output())
        .await
        .map_err(|_| {
            AppError::Hugo(format!(
                "`hugo build` did not finish within {} seconds",
                BUILD_TIMEOUT.as_secs()
            ))
        })??;
    Ok((output.status.success(), messages(&output.stderr)))
}

/// Reads a text file from a build made by [`build`].
pub fn read_file(output_dir: &str, path: &str) -> AppResult<String> {
    let dir = registered(output_dir)?;
    let relative = path.trim_start_matches('/');
    let candidate = Path::new(relative);
    let outside = || AppError::PathOutsideSite(path.to_string());
    if relative.is_empty()
        || candidate
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(outside());
    }
    let full = dir.join(candidate);
    // Symlinks could point elsewhere: compare real locations.
    let real = fs::canonicalize(&full)?;
    if !real.starts_with(fs::canonicalize(&dir)?) {
        return Err(outside());
    }
    if !real.is_file() {
        return Err(AppError::Invalid(format!("not a file: {path}")));
    }
    let mut bytes = Vec::new();
    fs::File::open(&real)?
        .take(MAX_READ_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err(AppError::Invalid(format!("file is too large: {path}")));
    }
    String::from_utf8(bytes).map_err(|_| AppError::NotUtf8(path.to_string()))
}

/// Removes a build made by [`build`] and forgets it.
pub fn discard(output_dir: &str) -> AppResult<()> {
    let dir = registered(output_dir)?;
    BUILDS.lock().unwrap().remove(&dir);
    let work = dir
        .parent()
        .filter(|parent| is_work_dir_name(parent))
        .ok_or_else(|| AppError::Invalid(format!("not a build folder: {output_dir}")))?;
    match fs::remove_dir_all(work) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// True while `output_dir` is a build made by [`build`] and not yet discarded.
pub fn is_registered(output_dir: &str) -> bool {
    BUILDS.lock().unwrap().contains(&PathBuf::from(output_dir))
}

fn registered(output_dir: &str) -> AppResult<PathBuf> {
    let dir = PathBuf::from(output_dir);
    if BUILDS.lock().unwrap().contains(&dir) {
        Ok(dir)
    } else {
        Err(AppError::Invalid(format!(
            "not a build folder made by this app: {output_dir}"
        )))
    }
}

/// Every file of the output, sorted by path, with its SHA-256.
fn list_output(output: &Path) -> AppResult<Vec<BuildFile>> {
    let mut files = Vec::new();
    collect(output, output, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn collect(base: &Path, dir: &Path, files: &mut Vec<BuildFile>) -> AppResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            collect(base, &path, files)?;
        } else if kind.is_file() {
            let relative = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            let (size, hash) = hash_file(&path)?;
            files.push(BuildFile {
                path: relative,
                size,
                hash,
            });
        }
    }
    Ok(())
}

fn hash_file(path: &Path) -> AppResult<(u64, String)> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size += read as u64;
        hasher.update(&buffer[..read]);
    }
    let hash = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok((size, hash))
}

fn new_work_dir() -> AppResult<PathBuf> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let dir = std::env::temp_dir().join(format!(
        "{WORK_DIR_PREFIX}{}-{}-{stamp}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn is_work_dir_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(WORK_DIR_PREFIX))
}

/// Removes work folders left from earlier sessions. Folders of this session stay until discarded.
fn remove_stale_work_dirs() {
    let Ok(entries) = fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    let live: HashSet<PathBuf> = BUILDS
        .lock()
        .unwrap()
        .iter()
        .filter_map(|p| p.parent().map(Path::to_path_buf))
        .collect();
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_work_dir_name(&path) || live.contains(&path) {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > STALE_AFTER);
        if old && entry.file_type().is_ok_and(|t| t.is_dir()) {
            let _ = fs::remove_dir_all(&path);
        }
    }
}

/// Hugo's module and remote-resource cache, kept between builds (outside every site).
fn cache_root() -> PathBuf {
    std::env::temp_dir().join("hugo-publisher-cache")
}

/// A short stable name for a site folder, so each site keeps its own processed images.
fn site_key(source: &Path) -> String {
    let digest = Sha256::digest(source.to_string_lossy().as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// A revision as typed by the user (`HEAD`, a branch, a hash): never an option for git.
pub fn check_revision(revision: &str) -> AppResult<()> {
    let ok = !revision.is_empty()
        && revision.len() <= 256
        && !revision.starts_with('-')
        && !revision
            .chars()
            .any(|c| c.is_whitespace() || c.is_control());
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("not a git revision: {revision}")))
    }
}

/// The bytes of a file before a build, put back afterwards if the build changed them.
struct FileSnapshot {
    path: PathBuf,
    bytes: Option<Vec<u8>>,
}

impl FileSnapshot {
    fn take(path: &Path) -> Self {
        Self {
            path: path.to_path_buf(),
            bytes: fs::read(path).ok(),
        }
    }

    fn restore(self) {
        let now = fs::read(&self.path).ok();
        if now == self.bytes {
            return;
        }
        let _ = match self.bytes {
            Some(bytes) => fs::write(&self.path, bytes),
            None => fs::remove_file(&self.path),
        };
    }
}

/// A detached checkout of a revision in a temporary folder, removed again with
/// `git worktree remove --force` (from [`Worktree::remove`], or on drop as a fallback).
struct Worktree {
    /// The repository the worktree belongs to.
    repo: PathBuf,
    /// The worktree folder.
    path: PathBuf,
    /// Where the site sits inside the repository (`git rev-parse --show-prefix`), e.g. `site/`.
    prefix: String,
    removed: bool,
}

impl Worktree {
    async fn add(root: &Path, revision: &str, path: &Path) -> AppResult<Self> {
        let prefix = Git::new(root)
            .args(["rev-parse", "--show-prefix"])
            .read_only()
            .run()
            .await?
            .stdout_text()
            .trim()
            .to_string();
        let commit = format!("{revision}^{{commit}}");
        let verify = Git::new(root)
            .args(["rev-parse", "--verify", "--quiet", &commit])
            .read_only()
            .output()
            .await?;
        if !verify.success {
            return Err(AppError::Invalid(format!("revision not found: {revision}")));
        }
        let hash = verify.stdout_text().trim().to_string();
        let _lock = write_lock().await;
        Git::new(root)
            .args(["worktree", "add", "--detach"])
            .arg(path)
            .arg(&hash)
            .timeout(LONG_TIMEOUT)
            .run()
            .await?;
        Ok(Self {
            repo: root.to_path_buf(),
            path: path.to_path_buf(),
            prefix,
            removed: false,
        })
    }

    fn site_dir(&self) -> PathBuf {
        let mut dir = self.path.clone();
        for part in self.prefix.split('/').filter(|p| !p.is_empty()) {
            dir.push(part);
        }
        dir
    }

    /// Checks out submodules (themes are often one). When that fails (offline, no access), the
    /// submodule folders are copied from the working tree instead; returns notes about that.
    async fn init_submodules(&self) -> Vec<HugoMessage> {
        if !self.path.join(".gitmodules").is_file() {
            return Vec::new();
        }
        let update = {
            let _lock = write_lock().await;
            Git::new(&self.path)
                .args(["submodule", "update", "--init", "--recursive"])
                .timeout(LONG_TIMEOUT)
                .output()
                .await
        };
        if update.as_ref().is_ok_and(|o| o.success) {
            return Vec::new();
        }
        let reason = match &update {
            Ok(output) => output.combined(),
            Err(error) => error.to_string(),
        };
        let mut notes = Vec::new();
        let top = Git::new(&self.repo)
            .args(["rev-parse", "--show-toplevel"])
            .read_only()
            .run()
            .await
            .map(|o| PathBuf::from(o.stdout_text().trim()));
        for sub in self.submodule_paths().await {
            let target = self.path.join(&sub);
            let has_files = fs::read_dir(&target).is_ok_and(|mut d| d.next().is_some());
            let source = top.as_ref().map(|top| top.join(&sub));
            let copied = !has_files
                && source
                    .as_ref()
                    .is_ok_and(|source| copy_without_git(source, &target).is_ok());
            notes.push(HugoMessage {
                level: Level::Warn,
                text: if copied {
                    format!(
                        "WARN  submodule {sub}: could not check it out ({}); used the copy from the working tree",
                        first_line(&reason)
                    )
                } else {
                    format!(
                        "WARN  submodule {sub}: could not check it out ({})",
                        first_line(&reason)
                    )
                },
            });
        }
        notes
    }

    async fn submodule_paths(&self) -> Vec<String> {
        let Ok(output) = Git::new(&self.path)
            .args([
                "config",
                "--file",
                ".gitmodules",
                "--get-regexp",
                r"^submodule\..*\.path$",
            ])
            .read_only()
            .output()
            .await
        else {
            return Vec::new();
        };
        output
            .stdout_text()
            .lines()
            .filter_map(|line| {
                line.split_once(' ')
                    .map(|(_, path)| path.trim().to_string())
            })
            .filter(|path| {
                !path.is_empty()
                    && Path::new(path)
                        .components()
                        .all(|c| matches!(c, Component::Normal(_)))
            })
            .collect()
    }

    async fn remove(&mut self) {
        if self.removed {
            return;
        }
        self.removed = true;
        let removed = {
            let _lock = write_lock().await;
            Git::new(&self.repo)
                .args(["worktree", "remove", "--force", "--force"])
                .arg(&self.path)
                .timeout(LONG_TIMEOUT)
                .output()
                .await
                .is_ok_and(|o| o.success)
        };
        if !removed {
            self.remove_by_hand();
        }
    }

    /// Deletes the folder and lets git forget it.
    fn remove_by_hand(&self) {
        let _ = fs::remove_dir_all(&self.path);
        if let Some(git) = git_binary() {
            let mut command = std::process::Command::new(git);
            command
                .arg("-C")
                .arg(&self.repo)
                .args(["worktree", "prune"])
                .env("GIT_TERMINAL_PROMPT", "0")
                .env_remove("GIT_DIR")
                .env_remove("GIT_WORK_TREE")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(crate::hugo::CREATE_NO_WINDOW);
            }
            let _ = command.status();
        }
    }
}

impl Drop for Worktree {
    fn drop(&mut self) {
        if !self.removed {
            self.removed = true;
            // Only reached when the build future was dropped mid-way.
            if let Some(git) = git_binary() {
                let mut command = std::process::Command::new(git);
                command
                    .arg("-C")
                    .arg(&self.repo)
                    .args(["worktree", "remove", "--force", "--force"])
                    .arg(&self.path)
                    .env("GIT_TERMINAL_PROMPT", "0")
                    .env_remove("GIT_DIR")
                    .env_remove("GIT_WORK_TREE")
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(crate::hugo::CREATE_NO_WINDOW);
                }
                if command.status().is_ok_and(|s| s.success()) {
                    return;
                }
            }
            self.remove_by_hand();
        }
    }
}

/// The line of git's output that explains a failure (`fatal: …`), or its first line.
fn first_line(text: &str) -> &str {
    let lines = || text.lines().map(str::trim).filter(|l| !l.is_empty());
    lines()
        .find(|l| l.starts_with("fatal:") || l.starts_with("error:"))
        .or_else(|| lines().next())
        .unwrap_or("")
}

fn copy_without_git(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)?.flatten() {
        if entry.file_name() == ".git" {
            continue;
        }
        let source = entry.path();
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_without_git(&source, &target)?;
        } else if kind.is_file() {
            fs::copy(&source, &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_revisions_only() {
        for ok in ["HEAD", "main", "HEAD~2", "v1.2.0", "a1b2c3d", "origin/main"] {
            assert!(check_revision(ok).is_ok(), "{ok}");
        }
        for bad in ["", "-x", "--output=/tmp/x", "HEAD main", "a\nb", "\u{7}"] {
            assert!(check_revision(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn refuses_unregistered_folders() {
        let dir = std::env::temp_dir().join("hugo-publisher-build-not-registered");
        let text = dir.to_string_lossy().into_owned();
        assert!(read_file(&text, "index.html").is_err());
        assert!(discard(&text).is_err());
        assert!(!is_registered(&text));
    }

    #[test]
    fn work_dir_names() {
        assert!(is_work_dir_name(Path::new(
            "/tmp/hugo-publisher-build-1-2-3"
        )));
        assert!(!is_work_dir_name(Path::new("/tmp/hugo-publisher-cache")));
        assert!(!is_work_dir_name(Path::new("/home/me/site")));
    }

    #[test]
    fn site_keys_are_stable_and_distinct() {
        assert_eq!(site_key(Path::new("/a")), site_key(Path::new("/a")));
        assert_ne!(site_key(Path::new("/a")), site_key(Path::new("/b")));
        assert_eq!(site_key(Path::new("/a")).len(), 16);
    }
}
