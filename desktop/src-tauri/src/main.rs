// WC3V desktop — local replay auto-parse.
//
// Design invariants, enforced here rather than merely documented:
//   • The app only ever READS .w3g files the game already wrote. It never
//     touches the running game — no injection, no memory reads, no input.
//   • No outbound network calls. Nothing in this binary opens a socket.
//   • The webview gets no arbitrary-filesystem primitive. `read_replay` and
//     `read_map_file` resolve and canonicalise their argument and refuse
//     anything outside a discovered replay root or the local map cache.
//
// Parsing itself happens in the webview, in a Web Worker, using the existing
// browser parser bundle. There is deliberately no parser here: one parser,
// one behaviour, verified by tools/verify-bundle-parity.js.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod replays;
mod watcher;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

/// Roots the user has actually opted into. Every scoped read is checked
/// against this list, so the set of readable paths is explicit and small.
#[derive(Default)]
struct AppState {
    roots: Mutex<Vec<PathBuf>>,
}

#[derive(Serialize)]
struct InitPayload {
    roots: Vec<replays::ReplayRoot>,
    map_cache_dir: String,
    data_dir: String,
}

fn map_cache_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("maps")
}

/// Persisted (path, size, mtime) → hash index, so repeat scans read no files.
fn hash_index_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("hash-index.json")
}

/// Where parsed-game summaries live. One gzipped JSON file per unique game,
/// named `<key>.summary.json.gz`.
fn parse_store_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("replays")
}

const SUMMARY_EXT: &str = ".summary.json.gz";
/// A parse that failed (corrupt replay, missing map data). Persisted so the
/// backfill never retries a known-bad replay on every restart; cleared
/// explicitly via `clear_parse_failures` (e.g. after seeding more maps).
const FAILED_EXT: &str = ".failed.json";

/// Store keys are `<size>-<xxh3 hex>` — decimal digits, hex digits and a
/// dash. Nothing else may ever reach a filename.
fn valid_store_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 40 && key.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Keys of every store file with the given suffix.
fn store_keys_with_ext(dir: &Path, ext: &str) -> Vec<String> {
    let mut keys = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            if let Some(name) = e.file_name().to_str() {
                if let Some(k) = name.strip_suffix(ext) {
                    keys.push(k.to_string());
                }
            }
        }
    }
    keys
}

/// Canonicalise `candidate` and require it to sit under one of `allowed`.
/// Canonicalising both sides is what makes `..` traversal and symlink escapes
/// fail closed rather than resolving somewhere unexpected.
fn ensure_within(candidate: &Path, allowed: &[PathBuf]) -> Result<PathBuf, String> {
    let real = candidate
        .canonicalize()
        .map_err(|e| format!("cannot resolve path: {e}"))?;
    for base in allowed {
        if let Ok(base_real) = base.canonicalize() {
            if real.starts_with(&base_real) {
                return Ok(real);
            }
        }
    }
    Err("path is outside the permitted directories".into())
}

#[tauri::command]
fn discover_roots(state: State<'_, AppState>) -> Vec<replays::ReplayRoot> {
    let found = replays::discover_roots();
    let mut roots = state.roots.lock().unwrap();
    for r in &found {
        let p = PathBuf::from(&r.path);
        if !roots.contains(&p) {
            roots.push(p);
        }
    }
    found
}

/// Register a folder the user picked by hand. Needed on Linux/SteamOS, where
/// the game lives inside a Wine/Proton prefix we may not guess.
#[tauri::command]
fn add_root(path: String, state: State<'_, AppState>) -> Result<replays::ReplayRoot, String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err("not a directory".into());
    }
    // Cheap count only — the real scan happens when the folder is selected, so
    // adding a folder never pays for a full dedupe pass.
    let mut count = 0;
    replays::count_replays(&p, &mut count);
    let mut roots = state.roots.lock().unwrap();
    if !roots.contains(&p) {
        roots.push(p.clone());
    }
    Ok(replays::ReplayRoot {
        path: p.to_string_lossy().to_string(),
        account_id: "manual".into(),
        replay_count: count,
    })
}

/// Scan a root. `async` is load-bearing, not stylistic: Tauri runs synchronous
/// commands on the MAIN thread, so the original blocking version stopped the
/// window pumping messages and Windows painted it "Not Responding" for the
/// whole scan. Async commands run on the async runtime, and the actual work is
/// pushed to the blocking pool so it cannot stall the runtime either.
#[tauri::command]
async fn scan_replays(
    root: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<replays::ScanResult, String> {
    // Take and release the lock before any await — a std MutexGuard held
    // across an await point would make this future non-Send.
    let allowed = { state.roots.lock().unwrap().clone() };
    let dir = ensure_within(Path::new(&root), &allowed)?;
    let index = hash_index_path(&app);

    // Phase 1: walk + stat only (~230 ms, reads no file contents). This is
    // everything the list needs, so it is what the caller gets back.
    let meta = tauri::async_runtime::spawn_blocking(move || replays::scan_meta(&dir))
        .await
        .map_err(|e| format!("scan failed: {e}"))?;

    // Phase 2: dedupe behind the rendered list, and emit the collapsed result
    // when it lands. The first run has to read ~268 MB to resolve size
    // collisions and is bound by disk speed; every run after that is index
    // hits and finishes in ~160 ms. Either way the user is looking at their
    // replays the whole time instead of a spinner.
    let pending = meta.replays.clone();
    let app_bg = app.clone();
    tauri::async_runtime::spawn(async move {
        let deduped =
            tauri::async_runtime::spawn_blocking(move || replays::dedupe(pending, &index)).await;
        if let Ok(result) = deduped {
            let _ = app_bg.emit("scan-deduped", result);
        }
    });

    Ok(meta)
}

/// Read a replay's bytes for the parser worker. Scoped to registered roots.
#[tauri::command]
fn read_replay(path: String, state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    let allowed = state.roots.lock().unwrap().clone();
    let file = ensure_within(Path::new(&path), &allowed)?;
    if file
        .extension()
        .map(|e| !e.eq_ignore_ascii_case("w3g"))
        .unwrap_or(true)
    {
        return Err("not a .w3g file".into());
    }
    std::fs::read(&file).map_err(|e| e.to_string())
}

/// Read a cached map-data file (`wpm.json.gz` etc). Scoped to the map cache.
/// This is what lets the parser's injectable `mapDataLoader` work offline.
#[tauri::command]
fn read_map_file(
    map: String,
    file: String,
    app: tauri::AppHandle,
) -> Result<Vec<u8>, String> {
    // Map and file names come from parsed replay metadata, so constrain them
    // to a conservative character set before they ever touch a path.
    let ok = |s: &str| {
        !s.is_empty()
            && s.len() < 128
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ' '))
            && !s.contains("..")
    };
    if !ok(&map) || !ok(&file) {
        return Err("invalid map or file name".into());
    }
    let base = map_cache_dir(&app);
    let candidate = base.join(&map).join(&file);
    if !candidate.exists() {
        return Err(format!("not cached: {map}/{file}"));
    }
    let real = ensure_within(&candidate, std::slice::from_ref(&base))?;
    std::fs::read(&real).map_err(|e| e.to_string())
}

/// Canonical identity of a replay file: `<size>-<xxh3>`, the same shape the
/// scan produces once it has actually hashed a file. The scan's lazy
/// `<size>-u` keys are NOT stable — they change the first time another file
/// collides on that size — so persistence always hashes. The parse that
/// follows reads the whole file anyway; one extra streamed read is noise.
#[tauri::command]
async fn replay_key(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let allowed = { state.roots.lock().unwrap().clone() };
    let file = ensure_within(Path::new(&path), &allowed)?;
    tauri::async_runtime::spawn_blocking(move || {
        let size = std::fs::metadata(&file).map_err(|e| e.to_string())?.len();
        let hash = replays::hash_file(&file).map_err(|e| e.to_string())?;
        Ok(format!("{size}-{hash}"))
    })
    .await
    .map_err(|e| format!("hash failed: {e}"))?
}

/// Persist a parsed game's summary. `bytes` is gzipped JSON built by the
/// frontend. Written to a temp name and renamed so a crash mid-write cannot
/// leave a truncated file that later reads as corrupt. Async because Windows
/// Defender scans new files on write and a sync command would block the main
/// thread for the duration.
#[tauri::command]
async fn save_parse(key: String, bytes: Vec<u8>, app: tauri::AppHandle) -> Result<(), String> {
    if !valid_store_key(&key) {
        return Err("invalid store key".into());
    }
    let dir = parse_store_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let tmp = dir.join(format!("{key}.tmp"));
        let done = dir.join(format!("{key}{SUMMARY_EXT}"));
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &done).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("save failed: {e}"))?
}

/// Keys of every stored summary, so the frontend can skip re-parsing.
#[tauri::command]
async fn list_parses(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = parse_store_dir(&app);
    tauri::async_runtime::spawn_blocking(move || Ok(store_keys_with_ext(&dir, SUMMARY_EXT)))
        .await
        .map_err(|e| format!("list failed: {e}"))?
}

/// Record a failed parse so the backfill can skip it next time round.
#[tauri::command]
async fn save_parse_failure(
    key: String,
    code: String,
    message: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if !valid_store_key(&key) {
        return Err("invalid store key".into());
    }
    let dir = parse_store_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let body = serde_json::json!({ "code": code, "message": message }).to_string();
        let tmp = dir.join(format!("{key}.failed.tmp"));
        let done = dir.join(format!("{key}{FAILED_EXT}"));
        std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &done).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("save failed: {e}"))?
}

#[tauri::command]
async fn list_parse_failures(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = parse_store_dir(&app);
    tauri::async_runtime::spawn_blocking(move || Ok(store_keys_with_ext(&dir, FAILED_EXT)))
        .await
        .map_err(|e| format!("list failed: {e}"))?
}

/// Forget every recorded failure so those replays get retried — the recovery
/// path after seeding more map data. Returns how many were cleared.
#[tauri::command]
async fn clear_parse_failures(app: tauri::AppHandle) -> Result<usize, String> {
    let dir = parse_store_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let mut n = 0;
        for key in store_keys_with_ext(&dir, FAILED_EXT) {
            if std::fs::remove_file(dir.join(format!("{key}{FAILED_EXT}"))).is_ok() {
                n += 1;
            }
        }
        Ok(n)
    })
    .await
    .map_err(|e| format!("clear failed: {e}"))?
}

/// Scan every registered root and dedupe across ALL of them in one pass, so
/// a game copied between accounts collapses too. This is the backfill queue
/// source; the interactive per-root scan stays `scan_replays`.
#[tauri::command]
async fn scan_all(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<replays::ScanResult, String> {
    let roots = { state.roots.lock().unwrap().clone() };
    let index = hash_index_path(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let mut all: Vec<replays::ReplayFile> = Vec::new();
        let mut walk_ms = 0;
        let mut stat_ms = 0;
        for root in &roots {
            let meta = replays::scan_meta(root);
            walk_ms += meta.stats.walk_ms;
            stat_ms += meta.stats.stat_ms;
            all.extend(meta.replays);
        }
        let mut res = replays::dedupe(all, &index);
        res.stats.walk_ms = walk_ms;
        res.stats.stat_ms = stat_ms;
        Ok(res)
    })
    .await
    .map_err(|e| format!("scan failed: {e}"))?
}

/// Read one stored summary back (gzipped JSON, as written by `save_parse`).
#[tauri::command]
async fn read_parse(key: String, app: tauri::AppHandle) -> Result<Vec<u8>, String> {
    if !valid_store_key(&key) {
        return Err("invalid store key".into());
    }
    let file = parse_store_dir(&app).join(format!("{key}{SUMMARY_EXT}"));
    tauri::async_runtime::spawn_blocking(move || std::fs::read(&file).map_err(|e| e.to_string()))
        .await
        .map_err(|e| format!("read failed: {e}"))?
}

#[tauri::command]
fn init(app: tauri::AppHandle, state: State<'_, AppState>) -> InitPayload {
    let roots = discover_roots(state);
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(map_cache_dir(&app));
    let _ = std::fs::create_dir_all(data_dir.join("replays"));
    InitPayload {
        roots,
        map_cache_dir: map_cache_dir(&app).to_string_lossy().to_string(),
        data_dir: data_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn start_watching(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let roots = state.roots.lock().unwrap().clone();
    let index = hash_index_path(&app);
    watcher::start(app, roots, index)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            init,
            discover_roots,
            add_root,
            scan_replays,
            read_replay,
            read_map_file,
            replay_key,
            save_parse,
            list_parses,
            read_parse,
            save_parse_failure,
            list_parse_failures,
            clear_parse_failures,
            scan_all,
            start_watching
        ])
        .run(tauri::generate_context!())
        .expect("error while running WC3V");
}
