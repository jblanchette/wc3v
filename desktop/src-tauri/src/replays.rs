//! Replay discovery, scanning and watching.
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
//! (a `0` folder holds offline/local games). So we enumerate `BattleNet\*` and
//! walk each `Replays` tree recursively — a nested duplicate tree
//! (`Replays\Autosaved\Multiplayer\Replays\Autosaved\...`) exists in the wild,
//! which is exactly why dedupe is by content hash and not by path.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    /// SHA-256 of the file contents. The dedupe key — `LastReplay.w3g` and the
    /// nested duplicate tree both mean the same game can appear at several
    /// paths, and `LastReplay.w3g` is NOT byte-identical to its autosave.
    pub sha256: String,
    /// False for sub-20KB aborted games.
    pub interesting: bool,
    /// True when the name matches Reforged's autosave pattern
    /// `Replay_YYYY_MM_DD_HHMM.w3g`.
    pub autosaved: bool,
}

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
        let od = h.join("OneDrive").join("Documents");
        if !out.contains(&od) {
            out.push(od);
        }
        let d = h.join("Documents");
        if !out.contains(&d) {
            out.push(d);
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
        // Common Wine / Proton prefixes. `drive_c/users/steamuser/Documents`
        // is where Proton maps the Windows Documents folder.
        let prefixes = [
            home.join(".wine"),
            home.join("Games/battlenet/drive_c").to_path_buf(),
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
        let bnet = wc3.join("BattleNet");
        let Ok(entries) = fs::read_dir(&bnet) else {
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
            let account_id = entry.file_name().to_string_lossy().to_string();
            let count = count_replays(&replays);
            let path = replays.to_string_lossy().to_string();
            if out.iter().any(|r| r.path == path) {
                continue;
            }
            out.push(ReplayRoot {
                path,
                account_id,
                replay_count: count,
            });
        }
    }

    out.sort_by(|a, b| b.replay_count.cmp(&a.replay_count));
    out
}

fn count_replays(dir: &Path) -> usize {
    let mut n = 0;
    walk(dir, &mut |_p| n += 1);
    n
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

pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn describe(path: &Path) -> Option<ReplayFile> {
    let meta = fs::metadata(path).ok()?;
    let size = meta.len();
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let file_name = path.file_name()?.to_string_lossy().to_string();
    let sha256 = hash_file(path).ok()?;
    Some(ReplayFile {
        path: path.to_string_lossy().to_string(),
        autosaved: is_autosave_name(&file_name),
        file_name,
        size,
        modified_ms,
        sha256,
        interesting: size >= MIN_INTERESTING_BYTES,
    })
}

/// Scan a root, hashing every file and collapsing duplicates. The first path
/// seen for a given hash wins; later ones are dropped. Newest first.
pub fn scan_root(root: &Path) -> Vec<ReplayFile> {
    let mut paths = Vec::new();
    walk(root, &mut |p| paths.push(p));

    let mut by_hash: HashMap<String, ReplayFile> = HashMap::new();
    for p in paths {
        if let Some(rf) = describe(&p) {
            by_hash.entry(rf.sha256.clone()).or_insert(rf);
        }
    }

    let mut out: Vec<ReplayFile> = by_hash.into_values().collect();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_reforged_autosave_names() {
        assert!(is_autosave_name("Replay_2026_07_18_1527.w3g"));
        assert!(is_autosave_name("Replay_2020_02_15_1147.w3g"));
    }

    /// Times a real scan against the machine's own replay folders.
    /// Ignored by default (needs a WC3 install, and takes seconds).
    ///
    ///   cargo test -- --ignored --nocapture            # debug
    ///   cargo test --release -- --ignored --nocapture  # release
    ///
    /// The two numbers matter: sha2 without optimisations is far slower than
    /// the same code compiled in release, so a scan that feels broken in
    /// `tauri dev` may be fine in a shipped build. Measure before optimising.
    #[test]
    #[ignore]
    fn bench_scan() {
        let roots = discover_roots();
        if roots.is_empty() {
            eprintln!("no replay folders on this machine; skipping");
            return;
        }
        for r in &roots {
            let path = std::path::PathBuf::from(&r.path);

            let t = std::time::Instant::now();
            let mut paths = Vec::new();
            walk(&path, &mut |p| paths.push(p));
            let walk_ms = t.elapsed().as_millis();

            let t = std::time::Instant::now();
            let bytes: u64 = paths
                .iter()
                .filter_map(|p| fs::metadata(p).ok())
                .map(|m| m.len())
                .sum();
            let stat_ms = t.elapsed().as_millis();

            let t = std::time::Instant::now();
            let mut hashed = 0u32;
            for p in &paths {
                if hash_file(p).is_ok() {
                    hashed += 1;
                }
            }
            let hash_ms = t.elapsed().as_millis();

            eprintln!(
                "account {:>10}  files {:>5}  {:>5} MB | walk {:>5} ms  stat {:>5} ms  hash {:>6} ms  ({:.0} MB/s)",
                r.account_id,
                paths.len(),
                bytes / 1_048_576,
                walk_ms,
                stat_ms,
                hash_ms,
                if hash_ms > 0 {
                    (bytes as f64 / 1_048_576.0) / (hash_ms as f64 / 1000.0)
                } else {
                    0.0
                }
            );
            assert_eq!(hashed as usize, paths.len(), "some files failed to hash");
        }
    }

    #[test]
    fn rejects_other_names() {
        assert!(!is_autosave_name("LastReplay.w3g"));
        assert!(!is_autosave_name("amazonia.w3g"));
        assert!(!is_autosave_name("Replay_2026_07_18.w3g"));
        assert!(!is_autosave_name("2980316660_Infi_Fly100%_Moon_Lyn_LostTemple.w3g"));
        assert!(!is_autosave_name("Replay_YYYY_MM_DD_HHMM.w3g"));
    }
}
