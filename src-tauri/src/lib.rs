mod db;
mod obsidian;
mod shell;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

/// When true, closing the window hides it to the tray instead of quitting (Settings › Focus timer).
pub(crate) static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

/// Updates the tray tooltip (kept for older frontends; the shell now owns the tooltip).
#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(text)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch focuses the existing window instead of opening the database twice.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(db::Db::default())
        .manage(shell::Shell::default())
        .setup(|app| {
            let menu = shell::tray_menu(app.handle())?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("bundled icon"))
                .tooltip("Interval")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| shell::on_tray_menu(app, event.id.as_ref()))
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        shell::show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            shell::start_ticker(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::CloseRequested { api, .. }) if CLOSE_TO_TRAY.load(Ordering::Relaxed) => {
                api.prevent_close();
                let _ = window.hide();
                shell::main_went_away(window.app_handle());
            }
            // Quitting from the window closes the floating windows too.
            ("main", WindowEvent::Destroyed) => window.app_handle().exit(0),
            ("main", WindowEvent::Resized(_)) => shell::on_main_resized(window),
            ("mini", WindowEvent::Moved(p)) => shell::on_mini_moved(window.app_handle(), *p),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_select,
            db::db_batch,
            db::db_backup,
            db::db_backup_daily,
            db::db_backup_before_migration,
            db::write_vault_file,
            db::db_close,
            db::write_text_file,
            db::read_text_file,
            set_tray_tooltip,
            set_close_to_tray,
            shell::timer_publish,
            shell::timer_snapshot,
            shell::set_shell_prefs,
            shell::mini_show,
            shell::mini_is_open,
            shell::mini_click_through,
            shell::mini_expand,
            shell::popup_show,
            shell::popup_close,
            shell::popup_fit,
            shell::restore_main,
            shell::is_fullscreen_active,
            shell::import_sound,
            shell::read_sound,
            obsidian::tn_request,
            obsidian::tn_token_set,
            obsidian::tn_token_status,
            obsidian::vault_scan,
            obsidian::vault_read_yaml,
            obsidian::vault_probe,
            obsidian::vault_resolve_images
        ])
        .run(tauri::generate_context!())
        .expect("error while running Interval");
}
