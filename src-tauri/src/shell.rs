//! Desktop shell around the timer: floating mini timer, completion popup, tray, wake-ups and
//! fullscreen detection.
//!
//! The timer engine itself runs in the main webview (it owns the database logic). It publishes a
//! snapshot of the timer after every change (`timer_publish`); this module caches it, mirrors it into
//! the tray, re-broadcasts it to the other windows and wakes the engine exactly when a phase is due,
//! so transitions and notifications stay on time even while the main window is hidden and its
//! JavaScript timers are throttled. Other windows never run a timer of their own.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Same arguments for every webview: WebView2 refuses to create windows whose environments differ.
/// The first part is wry's default; autoplay lets timer sounds play while Interval is in the background.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

#[derive(Deserialize, Serialize, Clone, Copy, Debug)]
pub struct Pos {
    pub x: i32,
    pub y: i32,
}

/// Settings the shell needs without asking the webview.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub close_to_tray: bool,
    pub minimize_to_tray: bool,
    pub mini_auto: bool,
    pub mini_on_top: bool,
    pub mini_click_through: bool,
    pub mini_hide_fullscreen: bool,
    pub mini_layout: String,
    pub mini_pos: Option<Pos>,
    pub popup_over_fullscreen: bool,
    pub popup_takes_focus: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            close_to_tray: true,
            minimize_to_tray: false,
            mini_auto: true,
            mini_on_top: true,
            mini_click_through: false,
            mini_hide_fullscreen: true,
            mini_layout: "standard".into(),
            mini_pos: None,
            popup_over_fullscreen: false,
            popup_takes_focus: false,
        }
    }
}

/// The parts of the webview's TimerSnapshot the shell reads. Unknown fields are ignored.
#[derive(Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
struct Snap {
    rev: i64,
    status: String,
    label: String,
    category_name: String,
    title: Option<String>,
    countdown: bool,
    ends_at: Option<f64>,
    since: Option<f64>,
    base_ms: f64,
    frozen_ms: Option<f64>,
}

impl Snap {
    fn active(&self) -> bool {
        !self.status.is_empty() && self.status != "idle"
    }
    fn running(&self) -> bool {
        matches!(self.status.as_str(), "focusing" | "short_break" | "long_break")
    }
    fn on_break(&self) -> bool {
        matches!(self.status.as_str(), "short_break" | "long_break" | "break_paused")
    }
    fn paused(&self) -> bool {
        matches!(self.status.as_str(), "focus_paused" | "break_paused")
    }
    fn clock_ms(&self, now: f64) -> f64 {
        if let Some(f) = self.frozen_ms {
            return f;
        }
        if self.countdown {
            if let Some(e) = self.ends_at {
                return (e - now).max(0.0);
            }
        }
        if let Some(s) = self.since {
            return self.base_ms + (now - s).max(0.0);
        }
        0.0
    }
}

#[derive(Default)]
pub struct Shell {
    raw: Mutex<Option<Json>>,
    snap: Mutex<Snap>,
    pub prefs: Mutex<Prefs>,
    wake_at: Mutex<Option<f64>>,
    menu_key: Mutex<String>,
    tooltip: Mutex<String>,
    /// The mini timer was opened because Interval was minimized; it closes again on restore.
    mini_auto_shown: AtomicBool,
    /// The mini timer is hidden only because a fullscreen app is in front.
    mini_hidden_fullscreen: AtomicBool,
    main_minimized: AtomicBool,
    fullscreen: AtomicBool,
    last_move_save: AtomicU64,
}

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

fn fmt_clock(ms: f64) -> String {
    let total = (ms / 1000.0).ceil().max(0.0) as i64;
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

fn tooltip_for(s: &Snap, now: f64) -> String {
    if !s.active() {
        return "Interval".into();
    }
    let name = s.title.clone().filter(|t| !t.is_empty()).unwrap_or_else(|| s.category_name.clone());
    let clock = fmt_clock(s.clock_ms(now));
    let clock = if s.paused() {
        format!("{clock} · paused")
    } else if s.countdown && s.status != "completed" {
        format!("{clock} left")
    } else if s.status == "completed" {
        String::new()
    } else {
        clock
    };
    let mut parts = vec![s.label.clone()];
    if !clock.is_empty() {
        parts.push(clock);
    }
    if !name.is_empty() && !s.on_break() {
        parts.push(name);
    }
    // Windows truncates tray tooltips at 127 characters.
    let text = format!("Interval · {}", parts.join(" · "));
    text.chars().take(120).collect()
}

// ------------------------------------------------------------------------------------- tray

pub fn tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let shell = app.state::<Shell>();
    let s = shell.snap.lock().unwrap().clone();
    let prefs = shell.prefs.lock().unwrap().clone();
    let status_text = if s.active() {
        let name = s.title.clone().filter(|t| !t.is_empty()).unwrap_or_else(|| s.category_name.clone());
        if name.is_empty() || s.on_break() {
            s.label.clone()
        } else {
            format!("{} · {}", s.label, name)
        }
    } else {
        "No timer running".into()
    };
    let status = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;
    let toggle_label = match s.status.as_str() {
        "focusing" | "short_break" | "long_break" => "Pause",
        "focus_paused" | "break_paused" => "Resume",
        "completed" => "Continue",
        _ => "Start focus",
    };
    let toggle = MenuItem::with_id(app, "toggle", toggle_label, true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop session", s.active(), None::<&str>)?;
    let skip = MenuItem::with_id(app, "skip-break", "Skip break", s.on_break() || s.status == "completed", None::<&str>)?;
    let mini_open = app.get_webview_window("mini").map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
    let mini = MenuItem::with_id(app, "mini", if mini_open { "Hide floating timer" } else { "Open floating timer" }, true, None::<&str>)?;
    let through = CheckMenuItem::with_id(app, "click-through", "Floating timer click-through", true, prefs.mini_click_through, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Restore Interval", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Exit Interval", true, None::<&str>)?;
    let s1 = PredefinedMenuItem::separator(app)?;
    let s2 = PredefinedMenuItem::separator(app)?;
    let s3 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&status, &s1, &toggle, &stop, &skip, &s2, &mini, &through, &s3, &show, &quit])
}

fn refresh_tray<R: Runtime>(app: &AppHandle<R>, force: bool) {
    let shell = app.state::<Shell>();
    let key = {
        let s = shell.snap.lock().unwrap();
        let p = shell.prefs.lock().unwrap();
        let mini = app.get_webview_window("mini").map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
        format!("{}|{}|{}|{:?}|{}|{}", s.status, s.label, s.category_name, s.title, p.mini_click_through, mini)
    };
    {
        let mut last = shell.menu_key.lock().unwrap();
        if !force && *last == key {
            return;
        }
        *last = key;
    }
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn refresh_tooltip<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell>();
    let text = tooltip_for(&shell.snap.lock().unwrap(), now_ms());
    let mut last = shell.tooltip.lock().unwrap();
    if *last != text {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(text.clone()));
        }
        *last = text;
    }
}

pub fn on_tray_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "show" => show_main(app),
        "quit" => app.exit(0),
        "mini" => {
            let open = app.get_webview_window("mini").map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
            if open {
                close_mini(app);
            } else {
                spawn_window(app, |a| {
                    if let Err(e) = open_mini(a, false) {
                        eprintln!("floating timer: {e}");
                    }
                    refresh_tray(a, true);
                });
            }
            refresh_tray(app, true);
        }
        "click-through" => {
            let on = !app.state::<Shell>().prefs.lock().unwrap().mini_click_through;
            set_click_through(app, on);
            // The webview stores the setting so it survives a restart.
            let _ = app.emit_to("main", "shell-pref", serde_json::json!({ "miniClickThrough": on }));
        }
        // Timer actions are handled by the engine in the main webview.
        other => {
            let _ = app.emit_to("main", "tray-action", other.to_string());
        }
    }
}

// ------------------------------------------------------------------------------------ windows

/// Creates a window off the main thread. On Windows, building a webview window from the main thread
/// (a synchronous command, a menu or window-event handler) deadlocks WebView2 (wry#583), so every
/// window is created from the async runtime.
fn spawn_window<R: Runtime, F: FnOnce(&AppHandle<R>) + Send + 'static>(app: &AppHandle<R>, f: F) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { f(&app) });
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let shell = app.state::<Shell>();
    shell.main_minimized.store(false, Ordering::Relaxed);
    if shell.mini_auto_shown.swap(false, Ordering::Relaxed) {
        close_mini(app);
    }
}

/// Shows a window without activating it, so the app the user is typing in keeps keyboard focus.
fn show_quietly<R: Runtime>(w: &WebviewWindow<R>) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        if let Ok(h) = w.hwnd() {
            unsafe {
                ShowWindow(h.0 as _, SW_SHOWNOACTIVATE);
            }
            return;
        }
    }
    let _ = w.show();
}

/// A monitor that contains `p` (top-left plus a margin), so a saved position on a disconnected
/// monitor never strands the window off-screen.
fn position_on_screen<R: Runtime>(app: &AppHandle<R>, p: Pos) -> bool {
    app.available_monitors()
        .map(|ms| {
            ms.iter().any(|m| {
                let (mp, ms) = (m.position(), m.size());
                p.x + 24 >= mp.x && p.y + 24 >= mp.y && p.x + 24 < mp.x + ms.width as i32 && p.y + 24 < mp.y + ms.height as i32
            })
        })
        .unwrap_or(false)
}

/// Bottom-right corner of the work area of the monitor under the cursor (else the primary monitor).
fn corner<R: Runtime>(app: &AppHandle<R>, size: PhysicalSize<u32>, stack: u32) -> Option<PhysicalPosition<i32>> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let margin = (16.0 * monitor.scale_factor()) as i32;
    Some(PhysicalPosition::new(
        area.position.x + area.size.width as i32 - size.width as i32 - margin,
        area.position.y + area.size.height as i32 - size.height as i32 - margin - stack as i32,
    ))
}

fn mini_size(layout: &str) -> (f64, f64) {
    if layout == "compact" {
        (188.0, 40.0)
    } else {
        (288.0, 118.0)
    }
}

pub fn open_mini<R: Runtime>(app: &AppHandle<R>, auto: bool) -> tauri::Result<()> {
    let shell = app.state::<Shell>();
    let prefs = shell.prefs.lock().unwrap().clone();
    if let Some(w) = app.get_webview_window("mini") {
        if !w.is_visible().unwrap_or(false) && !(prefs.mini_hide_fullscreen && shell.fullscreen.load(Ordering::Relaxed)) {
            show_quietly(&w);
        }
        return Ok(());
    }
    let (w, h) = mini_size(&prefs.mini_layout);
    let win = WebviewWindowBuilder::new(app, "mini", WebviewUrl::App("index.html?window=mini".into()))
        .title("Interval timer")
        .inner_size(w, h)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(prefs.mini_on_top)
        .focused(false)
        .visible(false)
        .additional_browser_args(BROWSER_ARGS)
        .build()?;
    let size = win.outer_size().unwrap_or(PhysicalSize::new(w as u32, h as u32));
    let pos = prefs.mini_pos.filter(|p| position_on_screen(app, *p)).map(|p| PhysicalPosition::new(p.x, p.y)).or_else(|| corner(app, size, 0));
    if let Some(p) = pos {
        let _ = win.set_position(p);
    }
    if prefs.mini_click_through {
        let _ = win.set_ignore_cursor_events(true);
    }
    shell.mini_auto_shown.store(auto, Ordering::Relaxed);
    if !(prefs.mini_hide_fullscreen && shell.fullscreen.load(Ordering::Relaxed)) {
        show_quietly(&win);
    } else {
        shell.mini_hidden_fullscreen.store(true, Ordering::Relaxed);
    }
    refresh_tray(app, true);
    Ok(())
}

pub fn close_mini<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("mini") {
        let _ = w.destroy();
    }
    let shell = app.state::<Shell>();
    shell.mini_auto_shown.store(false, Ordering::Relaxed);
    shell.mini_hidden_fullscreen.store(false, Ordering::Relaxed);
    refresh_tray(app, true);
}

fn set_click_through<R: Runtime>(app: &AppHandle<R>, on: bool) {
    app.state::<Shell>().prefs.lock().unwrap().mini_click_through = on;
    if let Some(w) = app.get_webview_window("mini") {
        let _ = w.set_ignore_cursor_events(on);
    }
    let _ = app.emit("mini-click-through", on);
    refresh_tray(app, true);
}

/// Opens the completion popup. Returns false when it must not show (a fullscreen app is in front and
/// the user has not allowed popups over fullscreen work); the webview then falls back to a notification.
fn open_popup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<bool> {
    let shell = app.state::<Shell>();
    let prefs = shell.prefs.lock().unwrap().clone();
    if shell.fullscreen.load(Ordering::Relaxed) && !prefs.popup_over_fullscreen {
        return Ok(false);
    }
    if let Some(w) = app.get_webview_window("popup") {
        // Still open from the previous moment: reload it for this one (a destroyed label can't be reused at once).
        let _ = w.eval("location.reload()");
        if prefs.popup_takes_focus {
            let _ = w.show();
            let _ = w.set_focus();
        } else {
            show_quietly(&w);
        }
        return Ok(true);
    }
    let (w, h) = (320.0, 176.0);
    let win = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("index.html?window=popup".into()))
        .title("Interval")
        .inner_size(w, h)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(prefs.popup_takes_focus)
        .visible(false)
        .additional_browser_args(BROWSER_ARGS)
        .build()?;
    let size = win.outer_size().unwrap_or(PhysicalSize::new(w as u32, h as u32));
    // Sit above the mini timer when it occupies the default corner.
    let stack = app
        .get_webview_window("mini")
        .filter(|m| m.is_visible().unwrap_or(false) && prefs.mini_pos.is_none())
        .and_then(|m| m.outer_size().ok())
        .map(|s| s.height + 12)
        .unwrap_or(0);
    if let Some(p) = corner(app, size, stack) {
        let _ = win.set_position(p);
    }
    if prefs.popup_takes_focus {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        show_quietly(&win);
    }
    Ok(true)
}

// ------------------------------------------------------------------------- window events

pub fn on_main_resized<R: Runtime>(window: &tauri::Window<R>) {
    let app = window.app_handle();
    let shell = app.state::<Shell>();
    let minimized = window.is_minimized().unwrap_or(false);
    let was = shell.main_minimized.swap(minimized, Ordering::Relaxed);
    if minimized && !was {
        let prefs = shell.prefs.lock().unwrap().clone();
        if prefs.minimize_to_tray {
            let _ = window.hide();
        }
        main_went_away(app);
    } else if !minimized && was && shell.mini_auto_shown.swap(false, Ordering::Relaxed) {
        close_mini(app);
    }
}

/// Interval was minimized or closed to the tray: bring up the floating timer if a timer is active.
pub fn main_went_away<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell>();
    let prefs = shell.prefs.lock().unwrap().clone();
    let active = shell.snap.lock().unwrap().active();
    if prefs.mini_auto && active && app.get_webview_window("mini").is_none() {
        spawn_window(app, |a| {
            if let Err(e) = open_mini(a, true) {
                eprintln!("floating timer: {e}");
            }
        });
    }
}

pub fn on_mini_moved<R: Runtime>(app: &AppHandle<R>, p: PhysicalPosition<i32>) {
    let shell = app.state::<Shell>();
    shell.prefs.lock().unwrap().mini_pos = Some(Pos { x: p.x, y: p.y });
    // Persisted by the webview (debounced there).
    shell.last_move_save.store(now_ms() as u64, Ordering::Relaxed);
    let _ = app.emit_to("main", "shell-pref", serde_json::json!({ "miniPos": { "x": p.x, "y": p.y } }));
}

// ---------------------------------------------------------------------------- fullscreen

/// True when the foreground window covers its whole monitor (games, video, presentations,
/// borderless fullscreen apps), excluding the desktop and Interval's own windows.
#[cfg(windows)]
fn foreground_fullscreen<R: Runtime>(app: &AppHandle<R>) -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect};
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_null() {
            return false;
        }
        for label in ["main", "mini", "popup"] {
            if let Some(w) = app.get_webview_window(label) {
                if let Ok(h) = w.hwnd() {
                    if h.0 as isize == fg as isize {
                        return false;
                    }
                }
            }
        }
        let mut cls = [0u16; 64];
        let n = GetClassNameW(fg, cls.as_mut_ptr(), cls.len() as i32);
        let class = String::from_utf16_lossy(&cls[..n.max(0) as usize]);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return false;
        }
        let mut r: RECT = std::mem::zeroed();
        if GetWindowRect(fg, &mut r) == 0 {
            return false;
        }
        let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(mon, &mut mi) == 0 {
            return false;
        }
        let m = mi.rcMonitor;
        r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
    }
}

#[cfg(not(windows))]
fn foreground_fullscreen<R: Runtime>(_app: &AppHandle<R>) -> bool {
    false
}

fn check_fullscreen<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell>();
    let fs = foreground_fullscreen(app);
    if shell.fullscreen.swap(fs, Ordering::Relaxed) == fs {
        return;
    }
    let hide = shell.prefs.lock().unwrap().mini_hide_fullscreen;
    if let Some(w) = app.get_webview_window("mini") {
        if fs && hide && w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            shell.mini_hidden_fullscreen.store(true, Ordering::Relaxed);
        } else if !fs && shell.mini_hidden_fullscreen.swap(false, Ordering::Relaxed) {
            show_quietly(&w);
        }
    }
    let _ = app.emit_to("main", "fullscreen", fs);
}

// ---------------------------------------------------------------------------------- ticker

/// One background thread: precise wake-ups for the engine, the tray tooltip clock, fullscreen
/// detection, and a nudge after the computer wakes from sleep.
pub fn start_ticker<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || {
        let mut last_loop = now_ms();
        let mut last_nudge = 0.0;
        let mut last_second = 0.0;
        loop {
            thread::sleep(Duration::from_millis(200));
            let now = now_ms();
            let shell = app.state::<Shell>();
            let slept = now - last_loop > 20_000.0;
            last_loop = now;
            let active = shell.snap.lock().unwrap().active();
            let due = {
                let mut w = shell.wake_at.lock().unwrap();
                match *w {
                    Some(t) if now >= t => {
                        *w = None;
                        true
                    }
                    _ => false,
                }
            };
            // While a timer is active, nudge the engine at least every 20 s: hidden webviews may throttle
            // their own timers to once a minute.
            if due || slept || (active && now - last_nudge >= 20_000.0) {
                last_nudge = now;
                let _ = app.emit_to("main", "timer-wake", now);
            }
            if now - last_second >= 1000.0 {
                last_second = now;
                refresh_tooltip(&app);
                check_fullscreen(&app);
            }
        }
    });
}

// -------------------------------------------------------------------------------- commands

/// Called by the engine after every change. Caches the snapshot, schedules the next wake-up,
/// updates the tray and re-broadcasts to the floating windows.
#[tauri::command]
pub fn timer_publish<R: Runtime>(app: AppHandle<R>, shell: tauri::State<'_, Shell>, snapshot: Json) {
    let snap: Snap = serde_json::from_value(snapshot.clone()).unwrap_or_default();
    let ends = if snap.running() && snap.countdown { snap.ends_at } else { None };
    *shell.wake_at.lock().unwrap() = ends;
    let active = snap.active();
    *shell.snap.lock().unwrap() = snap;
    *shell.raw.lock().unwrap() = Some(snapshot.clone());
    refresh_tray(&app, false);
    refresh_tooltip(&app);
    let _ = app.emit("timer-snapshot", snapshot);
    // A timer that ends while Interval is minimized leaves the floating timer up until restore;
    // one that starts while minimized brings it up.
    if active && shell.main_minimized.load(Ordering::Relaxed) {
        main_went_away(&app);
    }
}

/// The latest snapshot, for a window that just opened.
#[tauri::command]
pub fn timer_snapshot(shell: tauri::State<'_, Shell>) -> Option<Json> {
    shell.raw.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_shell_prefs<R: Runtime>(app: AppHandle<R>, shell: tauri::State<'_, Shell>, prefs: Prefs) {
    let old = shell.prefs.lock().unwrap().clone();
    *shell.prefs.lock().unwrap() = prefs.clone();
    crate::CLOSE_TO_TRAY.store(prefs.close_to_tray, Ordering::Relaxed);
    if let Some(w) = app.get_webview_window("mini") {
        if old.mini_on_top != prefs.mini_on_top {
            let _ = w.set_always_on_top(prefs.mini_on_top);
        }
        if old.mini_click_through != prefs.mini_click_through {
            let _ = w.set_ignore_cursor_events(prefs.mini_click_through);
        }
        if old.mini_layout != prefs.mini_layout {
            let (cw, ch) = mini_size(&prefs.mini_layout);
            let _ = w.set_size(tauri::LogicalSize::new(cw, ch));
        }
    }
    refresh_tray(&app, old.mini_click_through != prefs.mini_click_through);
}

// Window-creating commands are async: they run on the async runtime, not the main thread (see spawn_window).
#[tauri::command]
pub async fn mini_show<R: Runtime>(app: AppHandle<R>, open: bool) -> Result<(), String> {
    if open {
        open_mini(&app, false).map_err(|e| e.to_string())
    } else {
        close_mini(&app);
        Ok(())
    }
}

/// Grow the floating timer for its edit view (name, category, length) and shrink it back. The window
/// keeps its bottom edge, and is pulled back inside the monitor's work area when it would overflow.
#[tauri::command]
pub async fn mini_expand<R: Runtime>(app: AppHandle<R>, expanded: bool, height: Option<f64>) -> Result<(), String> {
    let Some(w) = app.get_webview_window("mini") else { return Ok(()) };
    let layout = app.state::<Shell>().prefs.lock().unwrap().mini_layout.clone();
    let (bw, bh) = mini_size(&layout);
    let (lw, lh) = if expanded { (bw.max(288.0), height.unwrap_or(330.0)) } else { (bw, bh) };
    let scale = w.scale_factor().unwrap_or(1.0);
    let before = w.outer_size().map_err(|e| e.to_string())?;
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let new_h = (lh * scale) as i32;
    let mut y = pos.y + before.height as i32 - new_h;
    let mut x = pos.x;
    if let Ok(Some(m)) = w.current_monitor() {
        let a = m.work_area();
        let new_w = (lw * scale) as i32;
        y = y.clamp(a.position.y, a.position.y + a.size.height as i32 - new_h);
        x = x.clamp(a.position.x, a.position.x + a.size.width as i32 - new_w);
    }
    w.set_size(tauri::LogicalSize::new(lw, lh)).map_err(|e| e.to_string())?;
    let _ = w.set_position(PhysicalPosition::new(x, y));
    Ok(())
}

#[tauri::command]
pub fn mini_is_open<R: Runtime>(app: AppHandle<R>) -> bool {
    app.get_webview_window("mini").is_some()
}

#[tauri::command]
pub fn mini_click_through<R: Runtime>(app: AppHandle<R>, on: bool) {
    set_click_through(&app, on);
}

#[tauri::command]
pub async fn popup_show<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    open_popup(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn popup_close<R: Runtime>(app: AppHandle<R>) {
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.destroy();
    }
}

#[tauri::command]
pub fn restore_main<R: Runtime>(app: AppHandle<R>) {
    show_main(&app);
}

#[tauri::command]
pub fn is_fullscreen_active(shell: tauri::State<'_, Shell>) -> bool {
    shell.fullscreen.load(Ordering::Relaxed)
}

/// Copies a custom sound into `<data folder>/sounds/<name>.<ext>` and returns the new path.
#[tauri::command]
pub fn import_sound(db: tauri::State<'_, crate::db::Db>, src: String, name: String) -> Result<String, String> {
    let src = std::path::PathBuf::from(src);
    let meta = std::fs::metadata(&src).map_err(|e| e.to_string())?;
    if meta.len() > 8 * 1024 * 1024 {
        return Err("That sound file is larger than 8 MB.".into());
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !matches!(ext.as_str(), "wav" | "mp3" | "ogg" | "m4a" | "flac" | "opus" | "webm") {
        return Err("Use a WAV, MP3, OGG, M4A, FLAC or Opus file.".into());
    }
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid sound name.".into());
    }
    let dir = db.data_dir().ok_or("Database not open")?.join("sounds");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Remove an older import of this sound with another extension.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            if e.path().file_stem().and_then(|s| s.to_str()) == Some(name.as_str()) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let dest = dir.join(format!("{name}.{ext}"));
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Reads an imported sound. Only files inside `<data folder>/sounds` can be read.
#[tauri::command]
pub fn read_sound(db: tauri::State<'_, crate::db::Db>, path: String) -> Result<tauri::ipc::Response, String> {
    let dir = db.data_dir().ok_or("Database not open")?.join("sounds");
    let p = std::path::PathBuf::from(&path);
    let canon = p.canonicalize().map_err(|e| e.to_string())?;
    let root = dir.canonicalize().map_err(|e| e.to_string())?;
    if !canon.starts_with(&root) {
        return Err("Not an imported sound.".into());
    }
    let bytes = std::fs::read(&canon).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}
