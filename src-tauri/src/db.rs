//! SQLite access for the frontend.
//!
//! One connection, owned by Rust, guarded by a mutex. The frontend sends SQL with positional
//! `?` parameters (the same SQL also runs on sql.js in tests). Writes arrive as batches and run
//! inside a single transaction, so each user action is atomic on disk.

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection, DatabaseName};
use serde::Deserialize;
use serde_json::{Map, Number, Value as Json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct Db(pub Mutex<Option<(Connection, PathBuf)>>);

impl Db {
    /// Folder holding the open database (the data folder).
    pub fn data_dir(&self) -> Option<PathBuf> {
        let guard = self.0.lock().ok()?;
        guard.as_ref().and_then(|(_, p)| p.parent().map(Path::to_path_buf))
    }
}

#[derive(Deserialize)]
pub struct Stmt {
    sql: String,
    #[serde(default)]
    params: Vec<Json>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn to_sql(v: &Json) -> Value {
    match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(*b as i64),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else {
                Value::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

fn to_json(v: ValueRef) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|x| Json::Number((*x).into())).collect()),
    }
}

/// Default data folder: %APPDATA%\app.interval.desktop on Windows.
fn default_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(err)
}

#[tauri::command]
pub fn db_open(app: AppHandle, state: State<Db>, data_dir: Option<String>, file_name: String) -> Result<String, String> {
    if file_name.contains(['/', '\\']) || !file_name.ends_with(".db") {
        return Err("Invalid database file name".into());
    }
    let dir = match data_dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => PathBuf::from(d),
        None => default_dir(&app)?,
    };
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create data folder {}: {e}", dir.display()))?;
    let path = dir.join(&file_name);
    let conn = Connection::open(&path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(err)?;
    let shown = path.display().to_string();
    *state.0.lock().map_err(err)? = Some((conn, path));
    Ok(shown)
}

#[tauri::command]
pub fn db_select(state: State<Db>, sql: String, params: Vec<Json>) -> Result<Vec<Map<String, Json>>, String> {
    let guard = state.0.lock().map_err(err)?;
    let (conn, _) = guard.as_ref().ok_or("Database is not open")?;
    let mut stmt = conn.prepare_cached(&sql).map_err(err)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(params.iter().map(to_sql))).map_err(err)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(err)? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), to_json(row.get_ref(i).map_err(err)?));
        }
        out.push(obj);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_batch(state: State<Db>, statements: Vec<Stmt>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(err)?;
    let (conn, _) = guard.as_mut().ok_or("Database is not open")?;
    let tx = conn.transaction().map_err(err)?;
    for s in &statements {
        let mut stmt = tx.prepare_cached(&s.sql).map_err(err)?;
        stmt.execute(params_from_iter(s.params.iter().map(to_sql))).map_err(|e| format!("{e} in: {}", s.sql.trim()))?;
    }
    tx.commit().map_err(err)
}

fn backup_to(conn: &Connection, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    conn.backup(DatabaseName::Main, dest, None).map_err(err)
}

#[tauri::command]
pub fn db_backup(state: State<Db>, dest: String) -> Result<(), String> {
    let guard = state.0.lock().map_err(err)?;
    let (conn, _) = guard.as_ref().ok_or("Database is not open")?;
    backup_to(conn, Path::new(&dest))
}

/// Once per calendar day, copy the database to `<dir>/<name>-YYYY-MM-DD.db` and keep only the
/// newest `keep` copies. `dir` defaults to `<data dir>/backups`. `force` re-writes today's copy
/// (used by "Back up now"). Returns the path written, or None if today's copy already existed.
#[tauri::command]
pub fn db_backup_daily(state: State<Db>, keep: usize, dir: Option<String>, force: Option<bool>) -> Result<Option<String>, String> {
    let guard = state.0.lock().map_err(err)?;
    let (conn, path) = guard.as_ref().ok_or("Database is not open")?;
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("interval").to_string();
    let dir = match dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => PathBuf::from(d),
        None => path.parent().map(|p| p.join("backups")).ok_or("No data folder")?,
    };
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let dest = dir.join(format!("{stem}-{today}.db"));
    if dest.exists() {
        if !force.unwrap_or(false) {
            return Ok(None);
        }
        // SQLite's backup API writes into an existing file; start from a clean one.
        fs::remove_file(&dest).map_err(err)?;
    }
    backup_to(conn, &dest)?;
    let prefix = format!("{stem}-");
    let mut existing: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(err)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(&prefix) && n.ends_with(".db") && n.len() == prefix.len() + 13)
                .unwrap_or(false)
        })
        .collect();
    existing.sort();
    while existing.len() > keep.max(1) {
        let old = existing.remove(0);
        let _ = fs::remove_file(old);
    }
    Ok(Some(dest.display().to_string()))
}

#[tauri::command]
pub fn db_close(state: State<Db>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(err)?;
    if let Some((conn, _)) = guard.take() {
        conn.close().map_err(|(_, e)| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------- files

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    // Write to a temp file first, then rename, so an export is never half-written.
    let target = PathBuf::from(&path);
    let tmp = target.with_extension("tmp-interval");
    fs::write(&tmp, contents.as_bytes()).map_err(err)?;
    fs::rename(&tmp, &target).map_err(err)
}

/// Write a generated Markdown note inside the user's Obsidian folder: `<dir>/<rel>`.
/// Creates missing folders. Never overwrites a file Interval did not write: an existing file is
/// replaced only if it contains the `generator: interval` frontmatter marker.
#[tauri::command]
pub fn write_vault_file(dir: String, rel: String, contents: String) -> Result<String, String> {
    let rel_path = Path::new(&rel);
    if rel_path.is_absolute() || rel_path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("Invalid file name".into());
    }
    let target = PathBuf::from(&dir).join(rel_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    if target.exists() {
        let existing = fs::read_to_string(&target).unwrap_or_default();
        if !existing.contains("generator: interval") {
            return Err(format!("{} already exists and was not written by Interval, so it was left alone", target.display()));
        }
    }
    let tmp = target.with_extension("tmp-interval");
    fs::write(&tmp, contents.as_bytes()).map_err(err)?;
    fs::rename(&tmp, &target).map_err(err)?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(err)
}
