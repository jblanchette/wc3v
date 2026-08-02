//! Replay-folder watcher.
//!
//! Emits a `replay-detected` event to the frontend when a game shows up.
//!
//! Two behaviours that come straight from how the game actually writes files:
//!
//! 1. **Debounce.** The game writes a replay progressively; `notify` will
//!    report several modify events for one file. Acting on the first one means
//!    parsing a truncated replay. We wait for a file's size to stop changing
//!    before announcing it.
//!
//! 2. **Content-hash dedupe.** Reforged writes each game to
//!    `Autosaved\Multiplayer\Replay_<stamp>.w3g` *and* keeps a `LastReplay.w3g`
//!    (which is not byte-identical), and a nested duplicate folder tree exists
//!    in the wild. Announcing per-path would double-count games; we announce
//!    per unique content hash.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::replays;

/// How long a file's size must hold steady before we treat it as complete.
const SETTLE: Duration = Duration::from_millis(1500);
/// How often the pending queue is re-checked.
const TICK: Duration = Duration::from_millis(500);

static STARTED: Mutex<bool> = Mutex::new(false);

/// Begin watching `roots`. Returns how many roots are being watched.
/// Idempotent — calling twice will not start a second watcher.
pub fn start(app: AppHandle, roots: Vec<PathBuf>) -> Result<usize, String> {
    {
        let mut started = STARTED.lock().unwrap();
        if *started {
            return Ok(roots.len());
        }
        *started = true;
    }

    let count = roots.len();

    std::thread::spawn(move || {
        let (tx, rx) = channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                let _ = app.emit("watcher-error", format!("{e}"));
                return;
            }
        };

        // Errors are reported by folder INDEX, never by path. Paths contain the
        // user's account name and this window is aimed at streamers.
        for (i, root) in roots.iter().enumerate() {
            if let Err(e) = watcher.watch(root, RecursiveMode::Recursive) {
                let _ = app.emit("watcher-error", format!("replay folder {}: {e}", i + 1));
            }
        }

        // Seed the seen-set with what is already on disk, so starting the app
        // does not replay the user's entire history as "new games".
        let mut seen: HashSet<String> = HashSet::new();
        for root in &roots {
            for rf in replays::scan_root(root) {
                seen.insert(rf.sha256);
            }
        }

        // path → (last observed size, when it was observed)
        let mut pending: HashMap<PathBuf, (u64, Instant)> = HashMap::new();

        loop {
            // Drain whatever the watcher has produced without blocking long,
            // so the settle check below still runs on a regular cadence.
            while let Ok(res) = rx.recv_timeout(TICK) {
                let Ok(event) = res else { continue };
                if !matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_)
                ) {
                    continue;
                }
                for path in event.paths {
                    let is_w3g = path
                        .extension()
                        .map(|e| e.eq_ignore_ascii_case("w3g"))
                        .unwrap_or(false);
                    if !is_w3g {
                        continue;
                    }
                    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    pending.insert(path, (size, Instant::now()));
                }
            }

            let now = Instant::now();
            let ready: Vec<PathBuf> = pending
                .iter()
                .filter(|(path, (size, seen_at))| {
                    if now.duration_since(*seen_at) < SETTLE {
                        return false;
                    }
                    // Size must match what we last saw, or it is still growing.
                    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) == *size && *size > 0
                })
                .map(|(p, _)| p.clone())
                .collect();

            for path in ready {
                pending.remove(&path);

                let Ok(sha) = replays::hash_file(&path) else {
                    continue;
                };
                if !seen.insert(sha.clone()) {
                    continue; // same game, another path
                }

                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                // `path` is needed to read the file back and never rendered;
                // the UI shows `fileName` only.
                let _ = app.emit(
                    "replay-detected",
                    serde_json::json!({
                        "path": path.to_string_lossy(),
                        "fileName": path.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default(),
                        "size": size,
                        "sha256": sha,
                        "interesting": size >= replays::MIN_INTERESTING_BYTES,
                    }),
                );
            }
        }
    });

    Ok(count)
}
