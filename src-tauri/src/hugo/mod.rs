pub mod archetypes;
pub mod detect;
pub mod filehash;
pub mod list;
pub mod manager;
pub mod modget;
pub mod mounts;
pub mod output;
pub mod server;
pub mod submodule;
pub mod version;

use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;

/// Prevents a console window from flashing up when a GUI app starts a console program.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A `hugo` command for short-lived queries (`version`, `list`, `config`).
/// Long-running servers use [`server`], which also manages the process tree.
pub(crate) fn short_command(hugo: &Path) -> Command {
    let mut command = Command::new(hugo);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
