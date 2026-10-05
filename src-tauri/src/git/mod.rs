//! Git through the system `git` binary, so the user's existing credentials, SSH setup and
//! hooks keep working.

pub mod commands;
pub mod deploy;
pub mod errors;
pub mod ops;
pub mod runner;
pub mod status;
