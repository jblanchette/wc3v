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
            start_watching
        ])
        .run(tauri::generate_context!())
        .expect("error while running WC3V");
}
