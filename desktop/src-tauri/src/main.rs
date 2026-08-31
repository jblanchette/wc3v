// WC3V desktop: local replay auto-parse.
//
// Design invariants, enforced here rather than merely documented:
//   • The app only ever READS .w3g files the game already wrote. It never
//     touches the running game. No injection, no memory reads, no input.
//   • No outbound network calls. Nothing in this binary opens a socket.
//   • The webview gets no arbitrary-filesystem primitive. `read_replay` and
//     `read_map_file` resolve and canonicalise their argument and refuse
//     anything outside a discovered replay root or the local map cache.
//
// Parsing itself happens in the webview, in a Web Worker, using the existing
// browser parser bundle. There is deliberately no parser here: one parser,
// one behaviour, verified by tools/verify-bundle-parity.js.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod filter;
mod overlay;
mod replays;
mod stats;
mod w3c;
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

/// Store keys are `<size>-<xxh3 hex>`: decimal digits, hex digits and a dash.
/// Nothing else may ever reach a filename.
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
    // A cheap count. The real scan happens when the folder is selected, so
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
    // Take and release the lock before any await. A std MutexGuard held across
    // an await point would make this future non-Send.
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
/// Returns a raw IPC response, an ArrayBuffer on the JS side. A 500 KB replay
/// as a JSON array of numbers is ~4x the bytes and all of it parsed twice.
#[tauri::command]
async fn read_replay(
    path: String,
    state: State<'_, AppState>,
) -> Result<tauri::ipc::Response, String> {
    let allowed = { state.roots.lock().unwrap().clone() };
    let file = ensure_within(Path::new(&path), &allowed)?;
    if file
        .extension()
        .map(|e| !e.eq_ignore_ascii_case("w3g"))
        .unwrap_or(true)
    {
        return Err("not a .w3g file".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&file)
            .map(tauri::ipc::Response::new)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("read failed: {e}"))?
}

/// Read a cached map-data file (`wpm.json.gz` etc). Scoped to the map cache.
/// This is what lets the parser's injectable `mapDataLoader` work offline.
#[tauri::command]
fn read_map_file(
    map: String,
    file: String,
    app: tauri::AppHandle,
) -> Result<tauri::ipc::Response, String> {
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
    std::fs::read(&real)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// The three files a parse needs for one map. Must stay in step with
/// PARSE_FILES in tools/build-desktop-client.js, which stages the same set
/// into the installer.
const MAP_PARSE_FILES: [&str; 3] = ["wpm.json.gz", "doo.json.gz", "unit.json.gz"];

/// Where map parse data is published. The web client reaches the same objects
/// through a redirect in render.yaml (`/maps/*` → cdn.wc3v.com); the desktop
/// app has no origin of its own, so it addresses the CDN directly.
const MAP_CDN: &str = "https://cdn.wc3v.com/maps";

/// Fetch one map's parse data into the local cache.
///
/// The installer bundles the ladder pool, so this is the path for everything
/// else: custom maps, older ladder seasons, a map added after the installed
/// build was cut. Before it existed, those games failed with a named missing
/// map and the only fix was a developer running a tool.
///
/// Existing files are never overwritten: a bundled or already-downloaded map
/// is authoritative, and re-fetching one would be pure waste.
#[tauri::command]
async fn fetch_map(map: String, app: tauri::AppHandle) -> Result<u32, String> {
    // Same conservative charset as read_map_file. This name came out of a
    // replay a stranger made, and it is about to become a path and a URL.
    if map.is_empty()
        || map.len() >= 128
        || map.contains("..")
        || !map
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ' '))
    {
        return Err("invalid map name".into());
    }

    let dir = map_cache_dir(&app).join(&map);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut written = 0u32;
    for file in MAP_PARSE_FILES {
        let dest = dir.join(file);
        if dest.exists() {
            continue;
        }
        let url = format!("{MAP_CDN}/{}/{}", urlencoding(&map), file);
        let res = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("could not reach the map server: {e}"))?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(format!("no map data published for \"{map}\""));
        }
        if !res.status().is_success() {
            return Err(format!("map server returned {} for {file}", res.status()));
        }
        // Not decompressed; see the reqwest note in Cargo.toml. These bytes are
        // the .gz file itself.
        let bytes = res.bytes().await.map_err(|e| e.to_string())?;
        if bytes.is_empty() {
            return Err(format!("map server returned an empty {file}"));
        }

        // Temp + rename, so a half-written file can never be read as cached.
        let dir2 = dir.clone();
        let dest2 = dest.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            std::fs::create_dir_all(&dir2).map_err(|e| e.to_string())?;
            let tmp = dest2.with_extension("part");
            std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &dest2).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        written += 1;
    }
    Ok(written)
}

/// Percent-encode the few characters a map folder is allowed to contain that
/// are not safe in a path segment. The charset check above has already ruled
/// out everything else.
fn urlencoding(s: &str) -> String {
    s.replace(' ', "%20")
}

/// Canonical identity of a replay file: `<size>-<xxh3>`, the same shape the
/// scan produces once it has actually hashed a file. The scan's lazy
/// `<size>-u` keys are not stable, because they change the first time another
/// file collides on that size, so persistence always hashes. The parse that
/// follows reads the whole file anyway; one extra streamed read is noise.
///
/// Also returns the file's mtime: that is when the game was PLAYED, which the
/// profile layer buckets by. (`savedAt` in the summary is merely when the
/// backfill got around to parsing it.)
#[tauri::command]
async fn replay_key(path: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let allowed = { state.roots.lock().unwrap().clone() };
    let file = ensure_within(Path::new(&path), &allowed)?;
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&file).map_err(|e| e.to_string())?;
        let hash = replays::hash_file(&file).map_err(|e| e.to_string())?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(serde_json::json!({
            "key": format!("{}-{hash}", meta.len()),
            "modifiedMs": modified_ms
        }))
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

/// Forget every recorded failure so those replays get retried. This is the
/// recovery path after seeding more map data. Returns how many were cleared.
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

/// User-written tags, keyed by the same content key a summary is stored under.
///
/// A SIDECAR rather than a field on the summary, which is deliberate: the
/// summary is rebuilt from the replay on every re-parse, and a schema upgrade
/// re-parses everything. Tags are the one thing in the store a person typed,
/// and a format bump must never be able to eat them.
///
/// One file for all of them rather than one per game. Tags are a few bytes each
/// and the Library filters on every game at once, so a thousand file reads to
/// draw one list would be the wrong shape entirely.
fn tags_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("labels.json")
}

/// Every tag, as `{ "<key>": ["tag", …] }`. Absent file means no tags, which is
/// the normal state and not an error.
#[tauri::command]
async fn read_tags(app: tauri::AppHandle) -> Result<String, String> {
    let path = tags_path(&app);
    tauri::async_runtime::spawn_blocking(move || match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".to_string()),
        Err(e) => Err(e.to_string()),
    })
    .await
    .map_err(|e| format!("read failed: {e}"))?
}

/// Replace the whole tag file. Written to a temp name and renamed, the same way
/// a summary is, so a crash mid-write cannot leave a truncated file that reads
/// as corrupt and silently loses every tag in it.
///
/// The frontend sends the whole map because it holds the whole map: it is a few
/// KB at any realistic history size, and a read-modify-write here would need a
/// lock this app has no other reason to own.
#[tauri::command]
async fn write_tags(json: String, app: tauri::AppHandle) -> Result<(), String> {
    // Parse before writing. This command takes a string so the frontend does not
    // have to model the shape twice, but nothing unparseable reaches the disk:
    // a corrupt labels.json is silent data loss the next time it is read.
    let parsed: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("not valid JSON: {e}"))?;
    let obj = parsed.as_object().ok_or("tags must be an object")?;
    for (key, value) in obj {
        if !valid_store_key(key) {
            return Err(format!("invalid store key: {key}"));
        }
        if !value.is_array() {
            return Err(format!("tags for {key} must be an array"));
        }
    }

    let path = tags_path(&app);
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("write failed: {e}"))?
}

/// What build this is.
///
/// From `package_info()`, which Tauri fills from `tauri.conf.json`, NOT from
/// `env!("CARGO_PKG_VERSION")`. Those two have disagreed since 0.7.0: the Cargo
/// manifest said 0.6.0 while the config said 0.7.4, and the config is the one
/// the installer and the updater use. A version display reading the macro would
/// have confidently reported the wrong number.
#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Whether the first-run screen has been through once.
///
/// A marker FILE rather than localStorage, for the same reason the W3Champions
/// opt-in is one: clearing the webview's storage is a normal thing to do while
/// debugging, and it should not put a setup screen back in front of somebody
/// who has been using the app for months.
fn setup_marker(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("setup-done")
}

#[tauri::command]
fn setup_done(app: tauri::AppHandle) -> bool {
    setup_marker(&app).exists()
}

#[tauri::command]
fn mark_setup_done(app: tauri::AppHandle) -> Result<(), String> {
    let marker = setup_marker(&app);
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&marker, b"1").map_err(|e| e.to_string())
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
async fn read_parse(key: String, app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    if !valid_store_key(&key) {
        return Err("invalid store key".into());
    }
    let file = parse_store_dir(&app).join(format!("{key}{SUMMARY_EXT}"));
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&file)
            .map(tauri::ipc::Response::new)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("read failed: {e}"))?
}

// ── Overlay ────────────────────────────────────────────────────

/// The webview pushes fresh overlay state here; the loopback server relays it
/// to OBS over SSE. Size-capped so a bug cannot balloon every broadcast.
#[tauri::command]
fn publish_overlay_state(
    state_json: String,
    overlay: State<'_, std::sync::Arc<overlay::Overlay>>,
) -> Result<(), String> {
    if state_json.len() > 256 * 1024 {
        return Err("overlay state too large".into());
    }
    overlay.publish(state_json);
    Ok(())
}

/// The OBS URL, token and all, for the clipboard. Never render it: it would
/// end up on stream.
///
/// `orphaned` is the one field worth acting on. It lists ports this install
/// handed out that nothing is answering now, which is the only situation where a
/// URL already sitting in OBS is dead and has to be copied again.
#[tauri::command]
fn overlay_info(
    overlay: State<'_, std::sync::Arc<overlay::Overlay>>,
) -> Result<serde_json::Value, String> {
    if overlay.port == 0 {
        return Err("overlay server failed to start".into());
    }
    Ok(serde_json::json!({
        "url": overlay.url(),
        "port": overlay.port,
        "legacy": overlay.legacy_ports,
        "orphaned": overlay.orphaned_ports,
    }))
}

/// Is the overlay actually on a broadcast right now?
///
/// Its own command rather than a field on `overlay_info`, because this gets
/// asked on a 20-second poll and `overlay_info` returns the URL with the access
/// token in it. That value is built for the clipboard and has no business being
/// fetched into a variable every twenty seconds.
#[tauri::command]
fn overlay_clients(overlay: State<'_, std::sync::Arc<overlay::Overlay>>) -> usize {
    overlay.client_count()
}

/// Player-facing variant in the default browser (second-monitor view).
/// Open a replay in the wc3v.com viewer, optionally seeked to a moment.
///
/// The replay is read from disk (scoped to registered roots, same rule as
/// `read_replay`), staged in memory on the loopback server, and the default
/// browser is pointed at the launcher page that hands it over. Nothing is
/// uploaded: the bytes travel from this process to the browser over loopback
/// and then into the site through a same-machine postMessage.
///
/// Why the browser cannot simply fetch from here: Chrome blocks a public page
/// from reaching 127.0.0.1. Both `fetch` and an iframe were measured failing,
/// so the browser has to start on the loopback origin. See handoff.html.
#[tauri::command]
async fn open_in_viewer(
    path: String,
    at_ms: Option<u64>,
    key: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    overlay: State<'_, std::sync::Arc<overlay::Overlay>>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if overlay.port == 0 {
        return Err("the local server failed to start, so the viewer cannot be opened".into());
    }
    let allowed = { state.roots.lock().unwrap().clone() };
    let file = ensure_within(Path::new(&path), &allowed)?;
    if file
        .extension()
        .map(|e| !e.eq_ignore_ascii_case("w3g"))
        .unwrap_or(true)
    {
        return Err("not a .w3g file".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&file))
        .await
        .map_err(|e| format!("read failed: {e}"))?
        .map_err(|e| e.to_string())?;

    let url = overlay
        .stage_handoff(bytes, at_ms, &key)
        .ok_or_else(|| "the local server is not listening".to_string())?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Opened from Rust so the webview needs no opener capability grant.
#[tauri::command]
fn open_player_view(
    app: tauri::AppHandle,
    overlay: State<'_, std::sync::Arc<overlay::Overlay>>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if overlay.port == 0 {
        return Err("overlay server failed to start".into());
    }
    app.opener()
        .open_url(format!("{}&view=panel", overlay.url()), None::<&str>)
        .map_err(|e| e.to_string())
}

// ── Shell: first-run, autostart, updates ───────────────────────

/// Seed the map cache from maps bundled into the installer. Runs once per
/// install: a fresh install can parse ladder games with no extra steps and no
/// network. Existing files are never overwritten, so a map the user fetched
/// themselves always wins.
fn seed_maps_from_resources(app: &tauri::AppHandle) -> usize {
    let Ok(resource_dir) = app.path().resource_dir() else {
        return 0;
    };
    let src = resource_dir.join("resources").join("maps");
    if !src.is_dir() {
        return 0;
    }
    let dest = map_cache_dir(app);
    let Ok(entries) = std::fs::read_dir(&src) else {
        return 0;
    };
    let mut seeded = 0;
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let target = dest.join(entry.file_name());
        if std::fs::create_dir_all(&target).is_err() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(entry.path()) else {
            continue;
        };
        let mut wrote = false;
        for f in files.flatten() {
            let to = target.join(f.file_name());
            if to.exists() {
                continue;
            }
            if std::fs::copy(f.path(), &to).is_ok() {
                wrote = true;
            }
        }
        if wrote {
            seeded += 1;
        }
    }
    seeded
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(enabled: bool, app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())?;
    } else {
        mgr.disable().map_err(|e| e.to_string())?;
    }
    mgr.is_enabled().map_err(|e| e.to_string())
}

/// Check for an update and install it if the user consents. Returns a
/// description of what happened so the UI can report honestly, including
/// "updates aren't configured for this build", which is the state of any
/// build made without an updater endpoint (see desktop/README.md).
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle, install: bool) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            return Ok(serde_json::json!({
                "status": "unconfigured",
                "detail": e.to_string()
            }))
        }
    };

    let found = updater.check().await.map_err(|e| e.to_string())?;
    let Some(update) = found else {
        return Ok(serde_json::json!({ "status": "current" }));
    };

    if !install {
        return Ok(serde_json::json!({
            "status": "available",
            "version": update.version,
            "notes": update.body
        }));
    }

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "status": "installed", "version": update.version }))
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

/// Show and focus the main window, restoring it from the tray.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Tray icon: the app's whole point is running in the background while you
/// play, so closing the window hides it rather than quitting. "Quit" on this
/// menu is the only thing that actually exits.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open = MenuItem::with_id(app, "open", "Open WC3V", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("WC3V, watching for replays")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // FIRST, before every other plugin. Plugin setup runs in registration
        // order and the app `setup` below runs after all of them, so a second
        // launch is turned away here, before the overlay binds a port, before
        // a second tray icon exists, before the watcher touches the data dir.
        //
        // The lock is a named mutex keyed on the bundle identifier, so it is
        // per-Windows-session (two logged-in users each get an app) and it does
        // NOT tell a dev build apart from an installed one: quit the tray copy
        // before `npm run desktop`, or the dev build exits on launch and the
        // installed window pops up instead.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // The OS starting us at login while an instance is already up is
            // not a request for a window; that rule is the same one honoured
            // in `setup`.
            if args.iter().any(|a| a == "--autostart") {
                return;
            }
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Started by the OS at login: go straight to the tray rather than
            // throwing a window in the user's face every boot.
            Some(vec!["--autostart"]),
        ))
        .manage(AppState::default())
        .setup(|app| {
            // The loopback overlay server is the one socket this binary opens.
            // Listener only, 127.0.0.1 only. See overlay.rs for the rules.
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            app.manage(overlay::start(data_dir));

            let handle = app.handle();
            let seeded = seed_maps_from_resources(handle);
            if seeded > 0 {
                println!("seeded {seeded} bundled map(s) into the local cache");
            }
            build_tray(handle)?;

            // Launched by the OS at login, so stay in the tray.
            if std::env::args().any(|a| a == "--autostart") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close = hide to tray. Quitting is deliberate, via the tray menu.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            init,
            discover_roots,
            add_root,
            scan_replays,
            read_replay,
            read_map_file,
            fetch_map,
            replay_key,
            save_parse,
            list_parses,
            read_parse,
            save_parse_failure,
            list_parse_failures,
            clear_parse_failures,
            read_tags,
            write_tags,
            setup_done,
            mark_setup_done,
            app_version,
            scan_all,
            publish_overlay_state,
            overlay_info,
            overlay_clients,
            open_player_view,
            open_in_viewer,
            get_autostart,
            set_autostart,
            check_for_update,
            start_watching,
            w3c::w3c_enabled,
            w3c::set_w3c_enabled,
            w3c::w3c_lookup,
            stats::stats_enabled,
            stats::set_stats_enabled,
            stats::stats_ping,
            filter::only_1v1_enabled,
            filter::set_only_1v1_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running WC3V");
}
