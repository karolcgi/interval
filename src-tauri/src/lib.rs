mod db;

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, WindowEvent};

/// When true, closing the window hides it to the tray instead of quitting (Settings › Focus).
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Updates the tray tooltip with the running timer.
#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(text)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Timer state mirrored into the tray menu by the webview.
#[derive(Deserialize)]
struct TrayState {
    tooltip: String,
    status: String,
    running: bool,
    paused: bool,
    focus: bool,
}

fn tray_menu<R: Runtime>(app: &AppHandle<R>, st: Option<&TrayState>) -> tauri::Result<Menu<R>> {
    let running = st.map(|s| s.running).unwrap_or(false);
    let paused = st.map(|s| s.paused).unwrap_or(false);
    let focus = st.map(|s| s.focus).unwrap_or(false);
    let status_text = st.map(|s| s.status.as_str()).unwrap_or("No timer running");
    let status = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;
    let toggle_label = if running { "Pause" } else if paused { "Resume" } else { "Start timer" };
    let toggle = MenuItem::with_id(app, "toggle", toggle_label, true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop", running || paused || focus, None::<&str>)?;
    let pomodoro = MenuItem::with_id(app, "pomodoro", "Start Pomodoro", true, None::<&str>)?;
    let flowtime = MenuItem::with_id(app, "flowtime", "Start Flowtime", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Interval", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let s1 = PredefinedMenuItem::separator(app)?;
    let s2 = PredefinedMenuItem::separator(app)?;
    let s3 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&status, &s1, &toggle, &stop, &s2, &pomodoro, &flowtime, &s3, &show, &quit])
}

/// Mirrors the timer into the tray: tooltip, a status line and the right actions.
#[tauri::command]
fn set_tray_state(app: AppHandle, state: TrayState) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(state.tooltip.clone())).map_err(|e| e.to_string())?;
        let menu = tray_menu(&app, Some(&state)).map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(db::Db::default())
        .setup(|app| {
            let menu = tray_menu(app.handle(), None)?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("bundled icon"))
                .tooltip("Interval")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    // Timer actions are handled by the webview, which owns the database logic.
                    other => {
                        let _ = app.emit("tray-action", other.to_string());
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_select,
            db::db_batch,
            db::db_backup,
            db::db_backup_daily,
            db::db_close,
            db::write_text_file,
            db::read_text_file,
            set_tray_tooltip,
            set_tray_state,
            set_close_to_tray
        ])
        .run(tauri::generate_context!())
        .expect("error while running Interval");
}
