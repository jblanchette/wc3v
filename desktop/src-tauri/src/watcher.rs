//! Replay-folder watcher.
//!
//! Emits a `replay-detected` event to the frontend when a game shows up.
//!
//! Three behaviours that come straight from how the game actually writes files:
//!
//! 1. **Debounce.** The game writes a replay progressively; `notify` will
//!    report several modify events for one file. Acting on the first one means
//!    parsing a truncated replay. We wait for a file's size to stop changing
//!    before announcing it.
//!
//! 2. **Content-hash dedupe.** A nested duplicate folder tree exists in the
//!    wild, and manually saved copies duplicate autosaves byte-for-byte.
//!    Announcing per-path would double-count games; we announce per unique
//!    content hash.
//!
//! 3. **`LastReplay.w3g` grace window.** Reforged writes each game to
//!    `Autosaved\Multiplayer\Replay_<stamp>.w3g` *and* to `LastReplay.w3g`,
//!    and the two are NOT byte-identical — verified against a real corpus,
//!    where no autosave even shared LastReplay's size. The content hash can
//!    therefore never collapse them, and without special handling every game
//!    would be announced twice. A settled `LastReplay.w3g` is held back for a
//!    grace window instead: if any other replay announces inside that window
//!    it is presumed to be the same game and dropped; if nothing else shows up
//!    (autosaves can be disabled) it is announced as the only record of the
//!    game.

use std::collections::HashMap;
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
/// How long a settled `LastReplay.w3g` waits for its autosave twin.
const LAST_REPLAY_GRACE: Duration = Duration::from_secs(30);

static STARTED: Mutex<bool> = Mutex::new(false);

/// One settled, deduped replay. `path` is needed to read the file back and is
/// never rendered; the UI shows `file_name` only.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    pub path: String,
    pub file_name: String,
    pub size: u64,
    /// Dedupe hash (xxh3, same as the scan) — empty when the size never
    /// collided with another file and the content was never read.
    pub hash: String,
    pub interesting: bool,
}

/// What the watch loop reports. Separated from Tauri so tests can drive the
/// loop against a channel instead of an `AppHandle`.
pub enum Note {
    Detected(Detected),
    Error(String),
}

/// Begin watching `roots`. Returns how many roots are being watched.
/// Idempotent — calling twice will not start a second watcher.
pub fn start(app: AppHandle, roots: Vec<PathBuf>, index_path: PathBuf) -> Result<usize, String> {
    {
        let mut started = STARTED.lock().unwrap();
        if *started {
            return Ok(roots.len());
        }
        *started = true;
    }

    let count = roots.len();
    spawn_with_sink(
        roots,
        index_path,
        SETTLE,
        TICK,
        LAST_REPLAY_GRACE,
        move |note| match note {
            Note::Detected(d) => {
                let _ = app.emit("replay-detected", &d);
            }
            Note::Error(e) => {
                let _ = app.emit("watcher-error", e);
            }
        },
    );
    Ok(count)
}

/// The watch loop with every knob exposed, so tests can run it fast against a
/// temp directory. Production goes through `start()`, which pins the real
/// constants and forwards notes to Tauri events.
pub(crate) fn spawn_with_sink(
    roots: Vec<PathBuf>,
    index_path: PathBuf,
    settle: Duration,
    tick: Duration,
    last_replay_grace: Duration,
    sink: impl Fn(Note) + Send + 'static,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || watch_loop(roots, index_path, settle, tick, last_replay_grace, sink))
}

fn is_last_replay(path: &PathBuf) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("LastReplay.w3g"))
        .unwrap_or(false)
}

fn watch_loop(
    roots: Vec<PathBuf>,
    index_path: PathBuf,
    settle: Duration,
    tick: Duration,
    last_replay_grace: Duration,
    sink: impl Fn(Note),
) {
    let (tx, rx) = channel();
    let mut watcher = match notify::recommended_watcher(tx) {
        Ok(w) => w,
        Err(e) => {
            sink(Note::Error(format!("{e}")));
            return;
        }
    };

    // Errors are reported by folder INDEX, never by path. Paths contain the
    // user's account name and this window is aimed at streamers.
    for (i, root) in roots.iter().enumerate() {
        if let Err(e) = watcher.watch(root, RecursiveMode::Recursive) {
            sink(Note::Error(format!("replay folder {}: {e}", i + 1)));
        }
    }

    // Seed from what is already on disk, so starting the app does not
    // announce the user's entire history as "new games".
    //
    // The scan hashes only files whose SIZE collides with another file —
    // two thirds of the corpus is never read. So we cannot seed a set of
    // hashes and compare against it. Instead we keep size → paths, and
    // only hash when a new file's size actually collides with something,
    // which mirrors the scan's own rule and is almost always zero work.
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut hash_cache: HashMap<PathBuf, String> = HashMap::new();
    // One dedupe pass over ALL roots, not one per root — dedupe saves the
    // hash index when it finishes, so per-root passes would write it N times.
    let mut metas: Vec<replays::ReplayFile> = Vec::new();
    for root in &roots {
        metas.extend(replays::scan_meta(root).replays);
    }
    for rf in replays::dedupe(metas, &index_path).replays {
        let p = PathBuf::from(&rf.path);
        by_size.entry(rf.size).or_default().push(p);
    }

    let hash_of = |path: &PathBuf, cache: &mut HashMap<PathBuf, String>| -> Option<String> {
        if let Some(h) = cache.get(path) {
            return Some(h.clone());
        }
        let h = replays::hash_file(path).ok()?;
        cache.insert(path.clone(), h.clone());
        Some(h)
    };

    // path → (last observed size, when it was observed)
    let mut pending: HashMap<PathBuf, (u64, Instant)> = HashMap::new();
    // LastReplay.w3g announcements being held for their grace window.
    let mut deferred: HashMap<PathBuf, (Detected, Instant)> = HashMap::new();
    let mut last_regular_announce: Option<Instant> = None;

    loop {
        // Drain whatever the watcher has produced without blocking long,
        // so the settle check below still runs on a regular cadence.
        while let Ok(res) = rx.recv_timeout(tick) {
            let Ok(event) = res else { continue };
            if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
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
                if now.duration_since(*seen_at) < settle {
                    return false;
                }
                // Size must match what we last saw, or it is still growing.
                std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) == *size && *size > 0
            })
            .map(|(p, _)| p.clone())
            .collect();

        for path in ready {
            pending.remove(&path);

            // The file was just (re)written, so anything remembered about it
            // is stale — LastReplay.w3g in particular is overwritten by every
            // game. A stale cached hash would compare the OLD content: that
            // both double-announces the new game and could swallow a real one.
            hash_cache.remove(&path);
            for paths in by_size.values_mut() {
                paths.retain(|p| p != &path);
            }

            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let siblings = by_size.entry(size).or_default().clone();

            // No other file of this size exists, so this cannot be a
            // duplicate and nothing needs reading.
            let is_dup = if siblings.is_empty() {
                false
            } else {
                match hash_of(&path, &mut hash_cache) {
                    None => false,
                    Some(mine) => siblings.iter().any(|other| {
                        hash_of(other, &mut hash_cache).as_deref() == Some(mine.as_str())
                    }),
                }
            };

            by_size.entry(size).or_default().push(path.clone());
            if is_dup {
                continue; // same game, another path
            }

            let d = Detected {
                path: path.to_string_lossy().to_string(),
                file_name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                size,
                hash: hash_cache.get(&path).cloned().unwrap_or_default(),
                interesting: size >= replays::MIN_INTERESTING_BYTES,
            };

            if is_last_replay(&path) {
                // Different bytes from its autosave twin, so the hash above
                // cannot have collapsed it. If the twin already announced,
                // this is the same game — drop it. Otherwise hold it in case
                // the twin is still being written.
                let twin_announced = last_regular_announce
                    .map(|t| now.duration_since(t) < last_replay_grace)
                    .unwrap_or(false);
                if !twin_announced {
                    deferred.insert(path, (d, now));
                }
                continue;
            }

            last_regular_announce = Some(now);
            // Any held LastReplay.w3g is presumed to be this same game.
            deferred.clear();
            sink(Note::Detected(d));
        }

        // A held LastReplay whose grace expired had no autosave twin
        // (autosaving can be turned off) — it is the only record of that
        // game, so announce it.
        let expired: Vec<PathBuf> = deferred
            .iter()
            .filter(|(_, (_, held_at))| now.duration_since(*held_at) >= last_replay_grace)
            .map(|(p, _)| p.clone())
            .collect();
        for p in expired {
            if let Some((d, _)) = deferred.remove(&p) {
                sink(Note::Detected(d));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::sync::mpsc;

    // Small enough that the whole suite runs in seconds, large enough that a
    // write burst cannot outrun a settle window on a slow CI disk.
    const T_SETTLE: Duration = Duration::from_millis(250);
    const T_TICK: Duration = Duration::from_millis(50);
    const T_GRACE: Duration = Duration::from_millis(1000);

    /// A fresh fake `Replays` tree plus a hash-index path, both under temp.
    fn temp_root(name: &str) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("wc3v-watch-test-{name}"));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("Replays");
        fs::create_dir_all(root.join("Autosaved").join("Multiplayer")).unwrap();
        (root, base.join("index.json"))
    }

    /// Watcher wired to a channel. Waits long enough for the notify backend
    /// to arm and the seed scan to finish before the test starts writing.
    fn start_test_watcher(root: &PathBuf, index: &PathBuf) -> mpsc::Receiver<Detected> {
        let (tx, rx) = mpsc::channel();
        spawn_with_sink(
            vec![root.clone()],
            index.clone(),
            T_SETTLE,
            T_TICK,
            T_GRACE,
            move |note| {
                if let Note::Detected(d) = note {
                    let _ = tx.send(d);
                }
            },
        );
        std::thread::sleep(Duration::from_millis(300));
        rx
    }

    fn auto(root: &PathBuf, name: &str) -> PathBuf {
        root.join("Autosaved").join("Multiplayer").join(name)
    }

    fn expect_one(rx: &mpsc::Receiver<Detected>, what: &str) -> Detected {
        let d = rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or_else(|_| panic!("never announced: {what}"));
        assert!(
            rx.recv_timeout(T_GRACE + Duration::from_secs(1)).is_err(),
            "announced more than once: {what}"
        );
        d
    }

    #[test]
    fn debounce_announces_once_with_final_size() {
        let (root, index) = temp_root("debounce");
        let rx = start_test_watcher(&root, &index);

        // Progressive write with gaps shorter than the settle window — the
        // way the game writes. Announcing before the last chunk lands means
        // the debounce is broken and a truncated replay would be parsed.
        let file = auto(&root, "Replay_2026_08_03_1200.w3g");
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file)
            .unwrap();
        for _ in 0..4 {
            f.write_all(&[0xAB; 8 * 1024]).unwrap();
            f.sync_all().unwrap();
            std::thread::sleep(Duration::from_millis(120));
        }
        drop(f);

        let d = expect_one(&rx, "progressively written replay");
        assert_eq!(d.size, 32 * 1024, "announced a truncated file");
        assert!(d.interesting);
    }

    #[test]
    fn identical_content_on_two_paths_announces_once() {
        let (root, index) = temp_root("dupes");
        let rx = start_test_watcher(&root, &index);

        let body = vec![0x11u8; 24 * 1024];
        fs::write(auto(&root, "Replay_2026_08_03_1201.w3g"), &body).unwrap();
        fs::write(auto(&root, "Replay_2026_08_03_1201 - Copy.w3g"), &body).unwrap();

        expect_one(&rx, "byte-identical copies");
    }

    #[test]
    fn overwritten_file_is_rehashed_not_ghost_deduped() {
        let (root, index) = temp_root("stale");
        let rx = start_test_watcher(&root, &index);

        // Game 1: two identical copies → one announce, hashes now cached.
        let a = vec![0x22u8; 24 * 1024];
        fs::write(auto(&root, "Replay_2026_08_03_1300.w3g"), &a).unwrap();
        fs::write(auto(&root, "Replay_2026_08_03_1300 - Copy.w3g"), &a).unwrap();
        expect_one(&rx, "game 1");

        // Game 2 overwrites the copy with same-SIZE different bytes, plus a
        // fresh file with the same new content. A stale cached hash compares
        // game 1's content and announces twice; a stale by_size entry can
        // swallow the game entirely. Either failure shows up here.
        let b = vec![0x33u8; 24 * 1024];
        fs::write(auto(&root, "Replay_2026_08_03_1300 - Copy.w3g"), &b).unwrap();
        fs::write(auto(&root, "Replay_2026_08_03_1301.w3g"), &b).unwrap();
        expect_one(&rx, "game 2 after overwrite");
    }

    #[test]
    fn mid_write_at_startup_announces_once_complete() {
        let (root, index) = temp_root("midwrite");

        // The game is mid-write when the app starts.
        let file = auto(&root, "Replay_2026_08_03_1400.w3g");
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file)
            .unwrap();
        f.write_all(&[0xCD; 8 * 1024]).unwrap();
        f.sync_all().unwrap();

        let rx = start_test_watcher(&root, &index);

        for _ in 0..3 {
            f.write_all(&[0xCD; 8 * 1024]).unwrap();
            f.sync_all().unwrap();
            std::thread::sleep(Duration::from_millis(120));
        }
        drop(f);

        let d = expect_one(&rx, "file mid-write at startup");
        assert_eq!(d.size, 32 * 1024, "announced the startup-time partial size");
    }

    #[test]
    fn last_replay_after_autosave_is_suppressed() {
        let (root, index) = temp_root("lr-after");
        let rx = start_test_watcher(&root, &index);

        fs::write(auto(&root, "Replay_2026_08_03_1500.w3g"), vec![0x44u8; 24 * 1024]).unwrap();
        let d = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("autosave never announced");
        assert_eq!(d.file_name, "Replay_2026_08_03_1500.w3g");

        // The game also writes LastReplay.w3g — DIFFERENT bytes and size,
        // exactly as observed on a real corpus, so the hash cannot catch it.
        fs::write(root.join("LastReplay.w3g"), vec![0x55u8; 20 * 1024]).unwrap();
        assert!(
            rx.recv_timeout(T_SETTLE + T_GRACE + Duration::from_secs(1)).is_err(),
            "LastReplay.w3g announced as a second game"
        );
    }

    #[test]
    fn autosave_during_grace_cancels_deferred_last_replay() {
        let (root, index) = temp_root("lr-before");
        let rx = start_test_watcher(&root, &index);

        // LastReplay lands first this time.
        fs::write(root.join("LastReplay.w3g"), vec![0x66u8; 20 * 1024]).unwrap();
        std::thread::sleep(T_SETTLE + Duration::from_millis(150));
        assert!(rx.try_recv().is_err(), "LastReplay announced before its grace expired");

        fs::write(auto(&root, "Replay_2026_08_03_1600.w3g"), vec![0x77u8; 24 * 1024]).unwrap();
        let d = expect_one(&rx, "autosave arriving during grace");
        assert_eq!(d.file_name, "Replay_2026_08_03_1600.w3g");
    }

    #[test]
    fn last_replay_alone_is_announced_after_grace() {
        let (root, index) = temp_root("lr-alone");
        let rx = start_test_watcher(&root, &index);

        // Autosaving off: LastReplay.w3g is the only record of the game.
        fs::write(root.join("LastReplay.w3g"), vec![0x88u8; 24 * 1024]).unwrap();
        let d = rx
            .recv_timeout(T_SETTLE + T_GRACE + Duration::from_secs(4))
            .expect("lone LastReplay.w3g was never announced");
        assert_eq!(d.file_name, "LastReplay.w3g");
    }
}
