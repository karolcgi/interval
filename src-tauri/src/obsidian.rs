//! Obsidian / TaskNotes bridge (integration Phase 1, read-only).
//!
//!  - `tn_request` talks to the TaskNotes HTTP API. It runs here rather than in the webview because the API
//!    only allows loopback browser origins, and so the bearer token never reaches the webview: it lives in
//!    the OS credential store (Windows Credential Manager / macOS Keychain) and is added to the request here.
//!    Only `http://localhost`, `127.0.0.1` or `[::1]` are accepted, and only paths under `/api/`.
//!  - `vault_scan` lists the Markdown notes in one folder of the vault and returns their YAML frontmatter as
//!    JSON. Strictly read-only; it never leaves the vault folder and skips `.obsidian/`, `.trash/` and dot folders.

use serde::Serialize;
use serde_json::Value as Json;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

const KEYRING_SERVICE: &str = "app.interval.desktop";
const KEYRING_USER: &str = "tasknotes-api-token";
const MAX_FILES: usize = 5000;
const MAX_DEPTH: usize = 8;
const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Credential store unavailable: {e}"))
}

fn read_token() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.trim().is_empty())
}

/// Saves the TaskNotes token in the OS credential store. Empty = remove it.
#[tauri::command]
pub fn tn_token_set(token: String) -> Result<(), String> {
    let e = entry()?;
    let t = token.trim();
    if t.is_empty() {
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        };
    }
    e.set_password(t).map_err(|err| format!("Couldn't save the token: {err}"))
}

/// Whether a token is saved. The token itself is never returned to the webview.
#[tauri::command]
pub fn tn_token_status() -> bool {
    read_token().is_some()
}

#[derive(Serialize)]
pub struct TnResponse {
    status: u16,
    body: Json,
}

/// Accepts `http://localhost[:port]`, `http://127.0.0.1[:port]` or `http://[::1][:port]` (optionally with a
/// trailing slash) and returns it without the slash.
fn loopback_base(base: &str) -> Result<String, String> {
    let b = base.trim().trim_end_matches('/');
    let rest = b.strip_prefix("http://").ok_or("The TaskNotes address must start with http://")?;
    let host = if let Some(stripped) = rest.strip_prefix('[') {
        let end = stripped.find(']').ok_or("Invalid address")?;
        format!("[{}]", &stripped[..end])
    } else {
        rest.split(':').next().unwrap_or("").to_string()
    };
    let after_host = &rest[host.len()..];
    let port_ok = after_host.is_empty() || (after_host.starts_with(':') && after_host[1..].chars().all(|c| c.is_ascii_digit()) && after_host.len() > 1);
    if !matches!(host.to_ascii_lowercase().as_str(), "localhost" | "127.0.0.1" | "[::1]") || !port_ok {
        return Err("For safety Interval only connects to TaskNotes on this computer (localhost / 127.0.0.1)".into());
    }
    Ok(b.to_string())
}

fn do_request(base: String, method: String, path: String, body: Option<Json>) -> Result<TnResponse, String> {
    let base = loopback_base(&base)?;
    if !path.starts_with("/api/") || path.contains("..") || path.contains('#') {
        return Err("Invalid TaskNotes API path".into());
    }
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(8)).redirects(0).build();
    let url = format!("{base}{path}");
    let mut req = match method.as_str() {
        "GET" => agent.get(&url),
        "POST" => agent.post(&url),
        "PUT" => agent.put(&url),
        _ => return Err("Unsupported method".into()),
    };
    if let Some(t) = read_token() {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    let res = match body {
        Some(b) => req.send_json(b),
        None => req.call(),
    };
    let resp = match res {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(ureq::Error::Transport(t)) => return Err(format!("offline: {}", t.kind())),
    };
    let status = resp.status();
    let text = resp.into_string().map_err(|e| format!("offline: {e}"))?;
    let body = serde_json::from_str::<Json>(&text).unwrap_or(Json::String(text.chars().take(500).collect()));
    Ok(TnResponse { status, body })
}

/// One HTTP request to the local TaskNotes API. Transport failures come back as `Err("offline: …")`;
/// HTTP errors come back as a normal response with their status.
#[tauri::command]
pub async fn tn_request(base: String, method: String, path: String, body: Option<Json>) -> Result<TnResponse, String> {
    tauri::async_runtime::spawn_blocking(move || do_request(base, method, path, body)).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct ScannedNote {
    /// Vault-relative path with forward slashes, e.g. `Projects/Roger AMEX.md`.
    path: String,
    mtime: u64,
    /// Frontmatter as JSON; null when unchanged since `known` (see `unchanged`) or when the note has none.
    frontmatter: Json,
    unchanged: bool,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct VaultScan {
    notes: Vec<ScannedNote>,
    truncated: bool,
}

fn mtime_of(p: &Path) -> u64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Frontmatter text between the leading `---` line and the next `---`/`...` line.
fn frontmatter_text(text: &str) -> Option<&str> {
    let t = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = t.split_inclusive('\n');
    let first = lines.next()?;
    if first.trim_end() != "---" {
        return None;
    }
    let start = first.len();
    let mut pos = start;
    for line in lines {
        let l = line.trim_end();
        if l == "---" || l == "..." {
            return Some(&t[start..pos]);
        }
        pos += line.len();
    }
    None
}

fn parse_frontmatter(text: &str) -> Result<Json, String> {
    match frontmatter_text(text) {
        None => Ok(Json::Null),
        Some(fm) if fm.trim().is_empty() => Ok(Json::Object(Default::default())),
        Some(fm) => {
            let y: serde_yaml::Value = serde_yaml::from_str(fm).map_err(|e| format!("Invalid frontmatter: {e}"))?;
            serde_json::to_value(y).map_err(|e| format!("Invalid frontmatter: {e}"))
        }
    }
}

fn walk(root: &Path, dir: &Path, depth: usize, known: &HashMap<String, u64>, out: &mut Vec<ScannedNote>, truncated: &mut bool) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        if out.len() >= MAX_FILES {
            *truncated = true;
            return;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_dir() {
            walk(root, &p, depth + 1, known, out, truncated);
        } else if ft.is_file() && name.to_ascii_lowercase().ends_with(".md") {
            let rel = p.strip_prefix(root).unwrap_or(&p).components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/");
            let mtime = mtime_of(&p);
            if known.get(&rel) == Some(&mtime) {
                out.push(ScannedNote { path: rel, mtime, frontmatter: Json::Null, unchanged: true, error: None });
                continue;
            }
            let too_big = fs::metadata(&p).map(|m| m.len() > MAX_NOTE_BYTES).unwrap_or(true);
            let (frontmatter, error) = if too_big {
                (Json::Null, Some("Note is too large to read".to_string()))
            } else {
                match fs::read_to_string(&p).map_err(|e| e.to_string()).and_then(|t| parse_frontmatter(&t)) {
                    Ok(v) => (v, None),
                    Err(e) => (Json::Null, Some(e)),
                }
            };
            out.push(ScannedNote { path: rel, mtime, frontmatter, unchanged: false, error });
        }
    }
}

fn scan(vault: String, folder: String, known: HashMap<String, u64>) -> Result<VaultScan, String> {
    let root = PathBuf::from(vault.trim());
    if vault.trim().is_empty() || !root.is_dir() {
        return Err(format!("The vault folder {} doesn't exist", root.display()));
    }
    let rel = folder.trim().trim_matches(|c| c == '/' || c == '\\');
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() || rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("The projects folder must be a folder inside the vault".into());
    }
    let dir = if rel.is_empty() { root.clone() } else { root.join(rel_path) };
    if !dir.is_dir() {
        return Err(format!("The folder {rel} doesn't exist in the vault"));
    }
    let mut notes = Vec::new();
    let mut truncated = false;
    walk(&root, &dir, 0, &known, &mut notes, &mut truncated);
    Ok(VaultScan { notes, truncated })
}

/// Lists the Markdown notes under `<vault>/<folder>` with their frontmatter. `known` maps vault-relative paths
/// to the modification time already cached, so unchanged notes aren't re-read.
#[tauri::command]
pub async fn vault_scan(vault: String, folder: String, known: Option<HashMap<String, u64>>) -> Result<VaultScan, String> {
    let known = known.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || scan(vault, folder, known)).await.map_err(|e| e.to_string())?
}

// ------------------------------------------------------------------ v0.12: .base files, vault check, covers

const MAX_YAML_BYTES: u64 = 1024 * 1024;
const MAX_INDEX_FILES: usize = 60_000;
const IMAGE_EXTS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"];

/// A vault-relative path that stays inside the vault (no `..`, not absolute).
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim().trim_matches(|c| c == '/' || c == '\\');
    let rel_path = Path::new(rel);
    if rel.is_empty() || rel_path.is_absolute() || rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("The path must be inside the vault".into());
    }
    Ok(root.join(rel_path))
}

fn read_yaml(vault: String, rel: String) -> Result<Json, String> {
    let root = PathBuf::from(vault.trim());
    let p = inside(&root, &rel)?;
    let ext = p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if !matches!(ext.as_str(), "base" | "yaml" | "yml") {
        return Err("Only .base files can be read here".into());
    }
    let meta = fs::metadata(&p).map_err(|_| format!("{rel} doesn't exist in the vault"))?;
    if meta.len() > MAX_YAML_BYTES {
        return Err(format!("{rel} is too large"));
    }
    let text = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let y: serde_yaml::Value = serde_yaml::from_str(&text).map_err(|e| format!("{rel} isn't valid YAML: {e}"))?;
    serde_json::to_value(y).map_err(|e| e.to_string())
}

/// Reads and parses a `.base` file in the vault (read-only).
#[tauri::command]
pub async fn vault_read_yaml(vault: String, rel: String) -> Result<Json, String> {
    tauri::async_runtime::spawn_blocking(move || read_yaml(vault, rel)).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct ChildVault {
    name: String,
    tasknotes: bool,
}

#[derive(Serialize)]
pub struct VaultProbe {
    exists: bool,
    obsidian: bool,
    tasknotes: bool,
    children: Vec<ChildVault>,
}

fn has_tasknotes(dir: &Path) -> bool {
    dir.join(".obsidian").join("plugins").join("tasknotes").is_dir()
}

/// What the chosen vault folder looks like: is it a vault, does it have TaskNotes, and which of its direct
/// sub-folders are vaults themselves (to spot a vault folder chosen one level too high).
#[tauri::command]
pub fn vault_probe(path: String) -> VaultProbe {
    let root = PathBuf::from(path.trim());
    if path.trim().is_empty() || !root.is_dir() {
        return VaultProbe { exists: false, obsidian: false, tasknotes: false, children: vec![] };
    }
    let mut children = Vec::new();
    if let Ok(rd) = fs::read_dir(&root) {
        for e in rd.flatten().take(500) {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || !p.is_dir() || !p.join(".obsidian").is_dir() {
                continue;
            }
            children.push(ChildVault { tasknotes: has_tasknotes(&p), name });
        }
    }
    children.sort_by(|a, b| a.name.cmp(&b.name));
    VaultProbe { exists: true, obsidian: root.join(".obsidian").is_dir(), tasknotes: has_tasknotes(&root), children }
}

struct FileIndex {
    root: PathBuf,
    built: Instant,
    by_name: HashMap<String, PathBuf>,
}

static INDEX: Mutex<Option<FileIndex>> = Mutex::new(None);

fn index_walk(dir: &Path, depth: usize, out: &mut HashMap<String, PathBuf>, count: &mut usize) {
    if depth > 12 || *count >= MAX_INDEX_FILES {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            index_walk(&e.path(), depth + 1, out, count);
        } else if ft.is_file() {
            *count += 1;
            let ext = Path::new(&name).extension().map(|x| x.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if IMAGE_EXTS.contains(&ext.as_str()) {
                out.entry(name.to_lowercase()).or_insert_with(|| e.path());
            }
        }
    }
}

fn is_image(p: &Path) -> bool {
    let ext = p.extension().map(|x| x.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    IMAGE_EXTS.contains(&ext.as_str())
}

/// Finds an image the way Obsidian resolves an embed: a vault-relative path first, else a unique file name
/// anywhere in the vault (attachments folder included).
fn resolve_one(root: &Path, target: &str, idx: &mut Option<FileIndex>) -> Option<PathBuf> {
    let t = target.trim().replace('\\', "/");
    if t.is_empty() || t.contains("..") {
        return None;
    }
    if t.contains('/') {
        if let Ok(p) = inside(root, &t) {
            if p.is_file() && is_image(&p) {
                return Some(p);
            }
        }
    }
    let name = t.rsplit('/').next().unwrap_or(&t).to_lowercase();
    let stale = match idx {
        Some(i) => i.root != root || i.built.elapsed() > Duration::from_secs(600),
        None => true,
    };
    let rebuild = |idx: &mut Option<FileIndex>| {
        let mut by_name = HashMap::new();
        let mut count = 0;
        index_walk(root, 0, &mut by_name, &mut count);
        *idx = Some(FileIndex { root: root.to_path_buf(), built: Instant::now(), by_name });
    };
    if stale {
        rebuild(idx);
    }
    let hit = idx.as_ref().and_then(|i| i.by_name.get(&name).cloned()).filter(|p| p.is_file());
    if hit.is_some() {
        return hit;
    }
    // A new attachment since the index was built: rebuild once (at most every 30 s).
    if idx.as_ref().map(|i| i.built.elapsed() > Duration::from_secs(30)).unwrap_or(true) {
        rebuild(idx);
        return idx.as_ref().and_then(|i| i.by_name.get(&name).cloned());
    }
    None
}

/// Resolves cover images to files on this computer and lets the webview show just those files (asset protocol).
/// Returns target → absolute path (missing = not found). Read-only.
#[tauri::command]
pub async fn vault_resolve_images(app: tauri::AppHandle, vault: String, targets: Vec<String>) -> Result<HashMap<String, String>, String> {
    use tauri::Manager;
    let root = PathBuf::from(vault.trim());
    if vault.trim().is_empty() || !root.is_dir() {
        return Ok(HashMap::new());
    }
    let found = tauri::async_runtime::spawn_blocking(move || {
        let mut guard = INDEX.lock().unwrap_or_else(|e| e.into_inner());
        let mut out = HashMap::new();
        for t in targets.into_iter().take(500) {
            if let Some(p) = resolve_one(&root, &t, &mut guard) {
                out.insert(t, p);
            }
        }
        out
    })
    .await
    .map_err(|e| e.to_string())?;
    let scope = app.asset_protocol_scope();
    let mut res = HashMap::new();
    for (t, p) in found {
        if scope.allow_file(&p).is_ok() {
            res.insert(t, p.to_string_lossy().to_string());
        }
    }
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_loopback_addresses() {
        assert_eq!(loopback_base("http://localhost:8080/").unwrap(), "http://localhost:8080");
        assert!(loopback_base("http://127.0.0.1:8080").is_ok());
        assert!(loopback_base("http://[::1]:8080").is_ok());
        assert!(loopback_base("http://localhost").is_ok());
        assert!(loopback_base("https://localhost:8080").is_err());
        assert!(loopback_base("http://192.168.1.5:8080").is_err());
        assert!(loopback_base("http://localhost.evil.com:8080").is_err());
        assert!(loopback_base("http://localhost:8080@evil.com").is_err());
        assert!(loopback_base("http://127.0.0.1:80x").is_err());
    }

    #[test]
    fn reads_frontmatter() {
        let v = parse_frontmatter("---\nstatus: Active\ntags: [project, client]\ncover: \"[[cover.png]]\"\n---\n# Body\n").unwrap();
        assert_eq!(v["status"], "Active");
        assert_eq!(v["tags"][1], "client");
        assert_eq!(v["cover"], "[[cover.png]]");
        assert_eq!(parse_frontmatter("# no frontmatter").unwrap(), Json::Null);
        assert!(parse_frontmatter("---\n: : bad\n  - x\n---\n").is_err());
        assert_eq!(parse_frontmatter("\u{feff}---\r\nstatus: x\r\n---\r\n").unwrap()["status"], "x");
    }

    #[test]
    fn paths_stay_inside_the_vault() {
        let root = Path::new("/v");
        assert!(inside(root, "02_ACTIONS/PROJECTS.base").is_ok());
        assert!(inside(root, "../x.base").is_err());
        assert!(inside(root, "a/../../x.base").is_err());
        assert_eq!(inside(root, "/x.base").unwrap(), root.join("x.base"));
        assert!(inside(root, "").is_err());
    }
}
