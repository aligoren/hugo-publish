pub mod ai;
pub mod backup;
pub mod commands;
pub mod config;
pub mod error;
pub mod git;
pub mod health;
pub mod history;
pub mod hugo;
pub mod media;
pub mod newsite;
pub mod site;
pub mod text;

use tauri::{Manager, RunEvent};

use commands::AppState;

/// `hugo-publisher <folder>` opens that folder. Flags (anything starting with `-`) are ignored.
fn startup_site_arg() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| !arg.starts_with('-'))
        .filter(|arg| std::path::Path::new(arg).is_dir())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::with_startup_site(startup_site_arg()))
        .setup(|app| {
            hugo::manager::init(app.handle());
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::hugo_detect,
            commands::hugo_server_start,
            commands::hugo_server_stop,
            commands::hugo_server_status,
            commands::hugo_list_pages,
            commands::startup_site,
            commands::paths_exist,
            commands::site_open,
            commands::site_refresh,
            commands::site_list_content,
            commands::site_read_text,
            commands::site_write_text,
            commands::config_preview_set_value,
            commands::config_preview_add_menu_entry,
            commands::site_list_files,
            config::commands::toml_read,
            config::commands::config_preview_ops,
            config::commands::config_validate,
            config::commands::config_validate_files,
            config::commands::config_effective,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_commit,
            git::commands::git_pull,
            git::commands::git_push,
            git::commands::git_fetch,
            git::deploy::commands::deploy_gh_pages,
            git::deploy::commands::deploy_status,
            git::deploy::commands::deploy_commit_files,
            git::deploy::commands::deploy_preview_push,
            git::deploy::commands::deploy_preview_delete,
            git::deploy::commands::deploy_preview_list,
            hugo::archetypes::hugo_list_archetypes,
            hugo::archetypes::hugo_new_content,
            commands::site_rename,
            commands::site_delete,
            backup::site_backup,
            ai::ai_status,
            ai::ai_configure,
            ai::ai_set_key,
            ai::ai_describe,
            ai::ai_titles,
            ai::ai_alt_text,
            ai::ai_translate,
            newsite::site_create,
            newsite::theme_install,
            newsite::theme_stage_update,
            newsite::theme_apply_update,
            newsite::theme_discard_update,
            newsite::theme_repo_info,
            hugo::mounts::hugo_module_list,
            hugo::mounts::hugo_module_list_files,
            hugo::mounts::hugo_module_read_text,
            hugo::mounts::hugo_module_hash_files,
            hugo::modget::hugo_mod_get,
            hugo::modget::hugo_mod_restore,
            hugo::modget::hugo_mod_vendor,
            hugo::submodule::theme_submodules,
            hugo::submodule::theme_submodule_status,
            hugo::submodule::theme_submodule_checkout,
            commands::site_hash_files,
            commands::site_delete_override,
            config::commands::toml_edit_text,
            config::commands::toml_parse_text,
            history::history_save,
            history::history_list,
            history::history_read,
            media::commands::media_list,
            media::commands::media_details,
            media::commands::media_import_files,
            media::commands::media_import_bytes,
            media::commands::media_strip_metadata,
            media::commands::media_delete,
            media::commands::media_thumbnail,
            health::commands::build_site,
            health::commands::read_build_file,
            health::commands::discard_build,
            health::commands::check_links,
            health::commands::fetch_preview,
            health::commands::fetch_page,
            hugo::manager::hugo_releases,
            hugo::manager::hugo_installed,
            hugo::manager::hugo_install,
            hugo::manager::hugo_uninstall,
            hugo::manager::hugo_set_preferred,
            hugo::manager::hugo_preferred,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        // Stop the preview server on a normal exit. A crash is covered by the job object / process group.
        if let RunEvent::Exit = event {
            let state = handle.state::<AppState>();
            tauri::async_runtime::block_on(async {
                let _ = state.stop_server().await;
            });
        }
    });
}
