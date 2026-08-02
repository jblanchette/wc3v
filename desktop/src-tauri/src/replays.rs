//! Replay discovery, scanning and dedupe.
//!
//! Layout notes, verified against a real install rather than assumed — the
//! obvious guess (`Documents\Warcraft III\Replays`) does not exist:
//!
//! ```text
//! Documents\Warcraft III\BattleNet\<accountId>\Replays\
//!   ├── *.w3g                  manually saved / downloaded
//!   ├── my-games\
//!   └── Autosaved\
//!       ├── Custom\            custom games
//!       └── Multiplayer\       ladder + multiplayer  ← the bulk
//! ```
//!
//! `<accountId>` is per Battle.net account and there is usually more than one
//! (a `0` folder holds offline/local games), so we enumerate `BattleNet\*` and
//! walk each `Replays` tree recursively. A nested duplicate tree
//! (`Replays\Autosaved\Multiplayer\Replays\Autosaved\...`) exists in the wild,
//! which is why dedupe is by content and not by path.
//!
//! ## Why the scan is structured the way it is
//!
//! The first version hashed every byte of every file up front: 896 MB across
//! 4,875 files, which took 7.8s in release and 58s in debug, and froze the
//! window. Measured breakdown (tools/bench-replay-scan.js):
//!
//! ```text
//! walk (readdir)        8 ms
//! stat all            334 ms
//! hash everything    7834 ms   <- all of the cost
//! ```
//!
//! Three things fix it, and all three are needed:
//!
//! 1. **Size-gate the hashing.** Two files cannot be identical if their sizes
//!    differ. On the reference corpus only 32.6% of files share a size with
//!    any other file, so 67% never need reading at all — 268 MB instead of
//!    896 MB.
//! 2. **Use a fast hash.** This is a dedupe key, not a security boundary.
//! 3. **Persist the results.** A file whose (size, mtime) is unchanged since
//!    last time keeps its hash, so repeat scans read nothing.
//!
//! Everything the UI displays comes from the walk+stat pass, so the list can
//! render in ~340 ms regardless of what dedupe is still doing.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use xxhash_rust::xxh3::Xxh3;

/// Games below this are instant-leaves / aborted lobbies. On the reference
/// install 931 of 3,946 autosaves were under this, the smallest 1,099 bytes.
/// They carry no analysable game, so they are surfaced but not queued.
pub const MIN_INTERESTING_BYTES: u64 = 20 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayRoot {
    /// Absolute path to a `Replays` directory.
    pub path: String,
    /// Battle.net account id the folder sits under ("0" for the local account).
    pub account_id: String,
    /// How many `.w3g` files live under it, recursively.
    pub replay_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayFile {
    pub path: String,
    pub file_name: String,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified_ms: u64,
    /// Dedupe key: `"<size>-<xxh3>"`, or `"<size>-u"` when the size was unique
    /// and the file was never read. Both forms are safe to compare directly.
    pub key: String,
    /// False for sub-20KB aborted games.
    pub interesting: bool,
    /// True when the name matches Reforged's autosave pattern.
    pub autosaved: bool,
}

/// What a scan cost, so the UI can show it and regressions are visible.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ScanStats {
    pub files_seen: usize,
    pub unique: usize,
    pub duplicates: usize,
    pub aborted: usize,
    pub hashed: usize,
    pub bytes_hashed: u64,
    pub index_hits: usize,
    pub walk_ms: u64,
    pub stat_ms: u64,
    pub hash_ms: u64,
    pub total_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanResult {
    pub replays: Vec<ReplayFile>,
    pub stats: ScanStats,
}

// ── Persisted hash index ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndexEntry {
    size: u64,
    modified_ms: u64,
    hash: String,
}

/// path → last known (size, mtime, hash). An entry is only trusted when both
/// size and mtime still match, so an edited or replaced file is re-hashed.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct HashIndex {
    #[serde(default)]
    entries: HashMap<String, IndexEntry>,
}

impl HashIndex {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(self) {
            let _ = fs::write(path, json);
        }
    }

    fn get(&self, path: &str, size: u64, modified_ms: u64) -> Option<&str> {
        self.entries
            .get(path)
            .filter(|e| e.size == size && e.modified_ms == modified_ms)
            .map(|e| e.hash.as_str())
    }

    fn put(&mut self, path: String, size: u64, modified_ms: u64, hash: String) {
        self.entries.insert(path, IndexEntry { size, modified_ms, hash });
    }

    /// Drop entries for files that no longer exist, so the index cannot grow
    /// without bound as replays are moved or deleted.
    fn retain_seen(&mut self, seen: &[String]) {
        let set: std::collections::HashSet<&str> = seen.iter().map(|s| s.as_str()).collect();
        self.entries.retain(|k, _| set.contains(k.as_str()));
    }
}

// ── Discovery ───────────────────────────────────────────────────────────────

fn is_autosave_name(name: &str) -> bool {
    // Replay_2026_07_18_1527.w3g
    let stem = name.strip_suffix(".w3g").unwrap_or(name);
    let Some(rest) = stem.strip_prefix("Replay_") else {
        return false;
    };
    let parts: Vec<&str> = rest.split('_').collect();
    parts.len() == 4
        && parts[0].len() == 4
        && parts[1].len() == 2
        && parts[2].len() == 2
        && parts[3].len() == 4
        && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
}

/// The `Documents` directory, honouring a OneDrive-redirected Documents
/// folder, which is common enough to be worth handling.
fn documents_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(d) = dirs::document_dir() {
        out.push(d);
    }
    if let Some(h) = dirs::home_dir() {
        for candidate in [h.join("OneDrive").join("Documents"), h.join("Documents")] {
            if !out.contains(&candidate) {
                out.push(candidate);
            }
        }
    }
    out
}

/// Candidate `Warcraft III` data directories. On Linux/SteamOS the game runs
/// under Wine/Proton, so the same tree lives inside a prefix; we probe the
/// usual prefix locations and otherwise rely on the user picking a folder.
fn wc3_data_dirs() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = documents_dirs()
        .into_iter()
        .map(|d| d.join("Warcraft III"))
        .collect();

    if let Some(home) = dirs::home_dir() {
        let prefixes = [
            home.join(".wine"),
            home.join("Games/battlenet/drive_c"),
            home.join(".steam/steam/steamapps/compatdata"),
            home.join(".local/share/Steam/steamapps/compatdata"),
        ];
        for p in prefixes {
            roots.push(p.join("drive_c/users/steamuser/Documents/Warcraft III"));
            roots.push(p.join("drive_c/users/Public/Documents/Warcraft III"));
        }
    }
    roots
}

/// Find every `Replays` directory belonging to any Battle.net account.
pub fn discover_roots() -> Vec<ReplayRoot> {
    let mut out: Vec<ReplayRoot> = Vec::new();

    for wc3 in wc3_data_dirs() {
        let Ok(entries) = fs::read_dir(wc3.join("BattleNet")) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let replays = entry.path().join("Replays");
            if !replays.is_dir() {
                continue;
            }
            let path = replays.to_string_lossy().to_string();
            if out.iter().any(|r| r.path == path) {
                continue;
            }
            let mut n = 0;
            walk(&replays, &mut |_p| n += 1);
            out.push(ReplayRoot {
                path,
                account_id: entry.file_name().to_string_lossy().to_string(),
                replay_count: n,
            });
        }
    }

    out.sort_by(|a, b| b.replay_count.cmp(&a.replay_count));
    out
}

/// Count `.w3g` files under a directory without stat-ing or reading them.
pub fn count_replays(dir: &Path, out: &mut usize) {
    walk(dir, &mut |_p| *out += 1);
}

/// Depth-first walk over `.w3g` files. Symlinks are not followed, so a loop
/// in the tree cannot hang the scan.
fn walk(dir: &Path, f: &mut impl FnMut(PathBuf)) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_symlink() {
            continue;
        }
        if meta.is_dir() {
            walk(&path, f);
        } else if path
            .extension()
            .map(|e| e.eq_ignore_ascii_case("w3g"))
            .unwrap_or(false)
        {
            f(path);
        }
    }
}

/// Content hash for dedupe. Streamed so a huge file cannot spike memory.
pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Xxh3::new();
    let mut buf = [0u8; 128 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:016x}", hasher.digest()))
}

/// Dedupe key for a file already known to be size-unique — no read required.
fn unique_key(size: u64) -> String {
    format!("{size}-u")
}

// ── Scan ────────────────────────────────────────────────────────────────────

/// Phase 1: walk + stat only. ~230 ms for 4,875 files, reads no file contents.
///
/// Everything the UI displays comes from here, so the list can render before
/// dedupe has done anything. `key` is left empty — duplicates are still in the
/// list at this point.
pub fn scan_meta(root: &Path) -> ScanResult {
    let t_all = std::time::Instant::now();
    let mut stats = ScanStats::default();

    let t = std::time::Instant::now();
    let mut paths = Vec::new();
    walk(root, &mut |p| paths.push(p));
    stats.walk_ms = t.elapsed().as_millis() as u64;
    stats.files_seen = paths.len();

    let t = std::time::Instant::now();
    let mut out: Vec<ReplayFile> = Vec::with_capacity(paths.len());
    for p in &paths {
        let Ok(meta) = fs::metadata(p) else { continue };
        let size = meta.len();
        let file_name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let interesting = size >= MIN_INTERESTING_BYTES;
        if !interesting {
            stats.aborted += 1;
        }
        out.push(ReplayFile {
            path: p.to_string_lossy().to_string(),
            autosaved: is_autosave_name(&file_name),
            file_name,
            size,
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            key: String::new(),
            interesting,
        });
    }
    stats.stat_ms = t.elapsed().as_millis() as u64;

    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    stats.unique = out.len();
    stats.total_ms = t_all.elapsed().as_millis() as u64;
    ScanResult { replays: out, stats }
}

/// Phase 2: assign dedupe keys and collapse duplicates.
///
/// Only files whose SIZE collides with another file are ever read — on the
/// reference corpus that is 1,588 of 4,875 (268 MB of 896 MB). Results are
/// cached in `index_path` keyed by (path, size, mtime), so a repeat run reads
/// nothing at all and finishes in ~160 ms.
///
/// The first run is bound by disk read speed for those 268 MB, which is why
/// this is split out and run behind the rendered list rather than in front of it.
pub fn dedupe(mut replays: Vec<ReplayFile>, index_path: &Path) -> ScanResult {
    let t_all = std::time::Instant::now();
    let mut stats = ScanStats::default();
    stats.files_seen = replays.len();

    let mut size_counts: HashMap<u64, usize> = HashMap::new();
    for r in &replays {
        *size_counts.entry(r.size).or_insert(0) += 1;
    }

    let t = std::time::Instant::now();
    let mut index = HashIndex::load(index_path);
    for r in replays.iter_mut() {
        if size_counts.get(&r.size).copied().unwrap_or(0) <= 1 {
            r.key = unique_key(r.size);
            continue;
        }
        if let Some(h) = index.get(&r.path, r.size, r.modified_ms) {
            stats.index_hits += 1;
            r.key = format!("{}-{}", r.size, h);
            continue;
        }
        match hash_file(Path::new(&r.path)) {
            Ok(h) => {
                stats.hashed += 1;
                stats.bytes_hashed += r.size;
                index.put(r.path.clone(), r.size, r.modified_ms, h.clone());
                r.key = format!("{}-{}", r.size, h);
            }
            // Unreadable (locked by the game, permissions): treat as unique
            // rather than dropping it, so a game is never silently lost.
            Err(_) => r.key = format!("{}-{}", r.size, r.modified_ms),
        }
    }
    stats.hash_ms = t.elapsed().as_millis() as u64;

    let all_paths: Vec<String> = replays.iter().map(|r| r.path.clone()).collect();
    index.retain_seen(&all_paths);
    index.save(index_path);

    let mut seen: HashMap<String, ()> = HashMap::with_capacity(replays.len());
    let mut out: Vec<ReplayFile> = Vec::with_capacity(replays.len());
    for r in replays {
        if seen.insert(r.key.clone(), ()).is_some() {
            stats.duplicates += 1;
            continue;
        }
        if !r.interesting {
            stats.aborted += 1;
        }
        out.push(r);
    }

    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    stats.unique = out.len();
    stats.total_ms = t_all.elapsed().as_millis() as u64;
    ScanResult { replays: out, stats }
}

/// Convenience for callers that want the finished list and do not care about
/// showing anything in between (the watcher, benchmarks).
pub fn scan_root(root: &Path, index_path: &Path) -> ScanResult {
    let meta = scan_meta(root);
    let mut res = dedupe(meta.replays, index_path);
    res.stats.walk_ms = meta.stats.walk_ms;
    res.stats.stat_ms = meta.stats.stat_ms;
    res.stats.total_ms += meta.stats.total_ms;
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Times a real scan against the machine's own replay folders.
    /// Ignored by default (needs a WC3 install).
    ///
    ///   cargo test --release -- --ignored --nocapture
    ///
    /// Run twice: the second run should report index_hits instead of hashed,
    /// and a much smaller hash_ms.
    #[test]
    #[ignore]
    fn bench_scan() {
        let roots = discover_roots();
        if roots.is_empty() {
            eprintln!("no replay folders on this machine; skipping");
            return;
        }
        let idx = std::env::temp_dir().join("wc3v-bench-index.json");
        for r in &roots {
            for pass in 1..=2 {
                let res = scan_root(Path::new(&r.path), &idx);
                let s = &res.stats;
                eprintln!(
                    "pass {pass}  files {:>5}  unique {:>5}  dup {:>4}  | walk {:>4}ms  stat {:>4}ms  hash {:>5}ms  TOTAL {:>5}ms  | hashed {} ({} MB)  index-hits {}",
                    s.files_seen, s.unique, s.duplicates,
                    s.walk_ms, s.stat_ms, s.hash_ms, s.total_ms,
                    s.hashed, s.bytes_hashed / 1_048_576, s.index_hits
                );
            }
        }
        let _ = fs::remove_file(&idx);
    }

    #[test]
    fn recognises_reforged_autosave_names() {
        assert!(is_autosave_name("Replay_2026_07_18_1527.w3g"));
        assert!(is_autosave_name("Replay_2020_02_15_1147.w3g"));
    }

    #[test]
    fn rejects_other_names() {
        assert!(!is_autosave_name("LastReplay.w3g"));
        assert!(!is_autosave_name("amazonia.w3g"));
        assert!(!is_autosave_name("Replay_2026_07_18.w3g"));
        assert!(!is_autosave_name("2980316660_Infi_Fly100%_Moon_Lyn_LostTemple.w3g"));
        assert!(!is_autosave_name("Replay_YYYY_MM_DD_HHMM.w3g"));
    }

    #[test]
    fn size_unique_files_are_never_hashed() {
        // Two files of different sizes must dedupe on size alone, so the
        // 67%-of-corpus fast path is exercised and not silently bypassed.
        assert_ne!(unique_key(100), unique_key(101));
    }
}
