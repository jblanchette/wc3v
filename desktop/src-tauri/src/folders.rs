//! Replay folders: which directories get scanned, what each one is called,
//! and which are switched off.
//!
//! People sort replays into folders to label them: `Replays\Ladder`,
//! `Replays\vs Happy`, `Replays\Study`. Reforged adds its own two under
//! `Autosaved` (`Multiplayer` and `Custom`). Every directory that directly
//! holds a `.w3g` file is a folder here, shown as a tree under the root it
//! lives in, and each one can be renamed, switched off or removed. None of
//! that touches the disk: a label is a label, "off" means the scanner skips
//! the files directly inside, and "remove" means the app stops looking there.
//! No command in this module deletes, moves or renames anything on disk.
//!
//! ## What is persisted
//!
//! `<app_data>/folders.json`:
//!
//! ```text
//! manual_roots   folders the user pointed the app at by hand. Discovery
//!                cannot find these (a Wine prefix, a downloads folder), so
//!                they used to vanish on every restart.
//! folders        per-path prefs: label, enabled, removed. Keyed by absolute
//!                path, which is never rendered; the UI shows `label`.
//! ```
//!
//! `removed` is a flag rather than a deletion so that discovery does not put
//! a folder straight back the next time it runs.
//!
//! ## Roots versus folders
//!
//! A root is a directory the app may READ under: `ensure_within` in main.rs
//! checks every scoped read against the root list, and that list is the
//! security boundary. Folders are a finer grain inside the roots that only
//! decides what the scanner and the watcher LOOK at. A folder switched off
//! keeps its games readable (a stored summary from it can still open in the
//! viewer); a root removed takes its games out of the readable set too.
//!
//! ## Sources
//!
//! A stored summary carries no path, on purpose (paths hold the account name
//! and this window is aimed at streamers). Filtering the feed by folder still
//! needs to know which folder a game came from, so `sources.json` maps the
//! content key to the file it was parsed from. It is written as games parse
//! and back-filled for games parsed before it existed by `resolve_missing`,
//! which uses the same size-then-hash trick as the scan: a key's own prefix
//! is the file size, so most games match a single file without any read.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::replays;

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderPrefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub removed: bool,
}

impl Default for FolderPrefs {
    fn default() -> Self {
        FolderPrefs { label: None, enabled: true, removed: false }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FolderConfig {
    #[serde(default)]
    pub manual_roots: Vec<String>,
    #[serde(default)]
    pub folders: HashMap<String, FolderPrefs>,
}

impl FolderConfig {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Temp-file-and-rename, like every other file this app writes, so a
    /// crash mid-write cannot leave a truncated config that reads as "no
    /// folders".
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    }

    pub fn prefs(&self, path: &str) -> FolderPrefs {
        self.folders.get(path).cloned().unwrap_or_default()
    }

    fn prefs_mut(&mut self, path: &str) -> &mut FolderPrefs {
        self.folders.entry(path.to_string()).or_default()
    }
}

/// One row of the tree the UI draws. `path` is the identity and is never
/// rendered; `label` is what the person sees.
#[derive(Debug, Clone, Serialize)]
pub struct Folder {
    pub path: String,
    /// The root this folder sits under (itself, for a root).
    pub root: String,
    /// 0 for a root, 1 for its children, and so on. Only directories that
    /// directly hold replays are listed, so depth can skip levels.
    pub depth: usize,
    /// Leaf directory name.
    pub name: String,
    pub label: String,
    /// True when `label` was typed by the person rather than defaulted.
    pub custom_label: bool,
    pub enabled: bool,
    /// `.w3g` files directly inside, not counting subfolders.
    pub direct_count: usize,
    /// Every `.w3g` under it, subfolders included.
    pub total_count: usize,
    /// Root picked by hand rather than found under Warcraft III\BattleNet.
    pub manual: bool,
}

/// Every directory under `root` (root included) that directly holds a `.w3g`
/// file, with counts. Sorted by path so parents precede children.
pub fn discover_in(root: &Path) -> Vec<(PathBuf, usize)> {
    let mut direct: HashMap<PathBuf, usize> = HashMap::new();
    direct.insert(root.to_path_buf(), 0);
    replays::walk(root, &mut |p| {
        if let Some(dir) = p.parent() {
            *direct.entry(dir.to_path_buf()).or_insert(0) += 1;
        }
    });
    let mut out: Vec<(PathBuf, usize)> = direct
        .into_iter()
        .filter(|(dir, n)| *n > 0 || dir == root)
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn leaf(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// The full tree: discovered roots (minus removed ones) plus manual roots,
/// each expanded into the folders under it, with prefs applied.
///
/// Default labels never carry a path. A discovered root is "Replays", and a
/// second account's is "Replays 2"; subfolders and manual roots take their
/// own directory name, which is the label the person chose when they made
/// the folder and is exactly what this feature exists to surface.
pub fn build_tree(config: &FolderConfig) -> Vec<Folder> {
    let mut roots: Vec<(PathBuf, bool)> = Vec::new();
    for r in replays::discover_roots() {
        let p = PathBuf::from(&r.path);
        if config.prefs(&r.path).removed {
            continue;
        }
        if !roots.iter().any(|(q, _)| *q == p) {
            roots.push((p, false));
        }
    }
    for m in &config.manual_roots {
        let p = PathBuf::from(m);
        if !p.is_dir() || config.prefs(m).removed {
            continue;
        }
        if !roots.iter().any(|(q, _)| *q == p) {
            roots.push((p, true));
        }
    }

    let mut out: Vec<Folder> = Vec::new();
    let mut discovered_n = 0;
    for (root, manual) in roots {
        let root_s = root.to_string_lossy().to_string();
        let found = discover_in(&root);
        let mut totals: HashMap<PathBuf, usize> = HashMap::new();
        for (dir, n) in &found {
            let mut cur: Option<&Path> = Some(dir.as_path());
            while let Some(d) = cur {
                *totals.entry(d.to_path_buf()).or_insert(0) += n;
                if d == root {
                    break;
                }
                cur = d.parent();
            }
        }
        if !manual {
            discovered_n += 1;
        }
        for (dir, n) in found {
            let path = dir.to_string_lossy().to_string();
            let prefs = config.prefs(&path);
            if prefs.removed {
                continue;
            }
            let is_root = dir == root;
            let depth = dir
                .strip_prefix(&root)
                .map(|rel| rel.components().count())
                .unwrap_or(0);
            let name = leaf(&dir);
            let default_label = if is_root && !manual {
                if discovered_n == 1 {
                    "Replays".to_string()
                } else {
                    format!("Replays {discovered_n}")
                }
            } else {
                name.clone()
            };
            let custom = prefs
                .label
                .as_deref()
                .map(|l| !l.trim().is_empty())
                .unwrap_or(false);
            let label = if custom {
                prefs.label.clone().unwrap_or_default()
            } else {
                default_label
            };
            out.push(Folder {
                root: root_s.clone(),
                depth,
                label,
                custom_label: custom,
                enabled: prefs.enabled,
                direct_count: n,
                total_count: totals.get(&dir).copied().unwrap_or(n),
                manual,
                name,
                path,
            });
        }
    }
    out
}

/// The readable set: every root in the tree.
pub fn roots_of(tree: &[Folder]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for f in tree {
        let p = PathBuf::from(&f.root);
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

/// Directories whose direct files the scanner and watcher skip: every
/// folder switched off, plus every folder marked removed that still sits
/// under a live root (removing `Autosaved\Custom` must not make its games
/// reappear through the root's recursive walk).
pub fn excluded_of(config: &FolderConfig, tree: &[Folder]) -> HashSet<PathBuf> {
    let mut out: HashSet<PathBuf> = HashSet::new();
    for f in tree {
        if !f.enabled {
            out.insert(PathBuf::from(&f.path));
        }
    }
    for (path, prefs) in &config.folders {
        if prefs.removed {
            out.insert(PathBuf::from(path));
        }
    }
    out
}

// ── Mutations. Each edits the config; the caller saves it. ─────────────────

pub fn set_label(config: &mut FolderConfig, path: &str, label: Option<&str>) {
    let p = config.prefs_mut(path);
    // Long enough for "Ladder, second account"; short enough that a label
    // cannot become a sentence the tree has to wrap.
    p.label = label
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(40).collect::<String>());
}

pub fn set_enabled(config: &mut FolderConfig, path: &str, enabled: bool) {
    config.prefs_mut(path).enabled = enabled;
}

/// Remove a folder from the app. A manual root leaves the root list; a
/// discovered folder is flagged so discovery does not bring it back. Either
/// way its label is kept, so restoring it restores the name.
pub fn remove(config: &mut FolderConfig, path: &str) {
    config.manual_roots.retain(|m| m != path);
    config.prefs_mut(path).removed = true;
}

/// Forget every removal, so the next tree shows everything on disk again.
/// Labels and on/off states survive it.
pub fn restore_removed(config: &mut FolderConfig) -> usize {
    let mut n = 0;
    for p in config.folders.values_mut() {
        if p.removed {
            p.removed = false;
            n += 1;
        }
    }
    n
}

pub fn add_manual_root(config: &mut FolderConfig, path: &str) {
    if !config.manual_roots.iter().any(|m| m == path) {
        config.manual_roots.push(path.to_string());
    }
    // Re-adding a folder that was removed is a request to see it again.
    config.prefs_mut(path).removed = false;
}

// ── Sources: content key → the file it was parsed from ─────────────────────

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Sources {
    #[serde(default)]
    pub files: HashMap<String, String>,
}

impl Sources {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    }

    /// key → the directory the file sits in, which is the folder it belongs
    /// to under the "every directory holding replays is a folder" rule.
    pub fn dirs(&self) -> HashMap<String, String> {
        self.files
            .iter()
            .map(|(k, f)| {
                let dir = Path::new(f)
                    .parent()
                    .map(|d| d.to_string_lossy().to_string())
                    .unwrap_or_default();
                (k.clone(), dir)
            })
            .collect()
    }
}

/// Fill in sources for stored games that have none. `files` is a scan of
/// every root with no exclusions (a game parsed from a folder that is off
/// now still came from somewhere). A key's size prefix narrows the
/// candidates; one candidate is a match without a read, several are told
/// apart by hash through the persisted index so the read happens once.
pub fn resolve_missing(
    sources: &mut Sources,
    keys: &[String],
    files: &[replays::ReplayFile],
    index_path: &Path,
) -> usize {
    let mut by_size: HashMap<u64, Vec<&replays::ReplayFile>> = HashMap::new();
    for f in files {
        by_size.entry(f.size).or_default().push(f);
    }
    let mut index = replays::HashIndex::load(index_path);
    let mut found = 0;
    for key in keys {
        if sources.files.contains_key(key) {
            continue;
        }
        let Some((size_s, hash)) = key.split_once('-') else { continue };
        let Ok(size) = size_s.parse::<u64>() else { continue };
        let Some(cands) = by_size.get(&size) else { continue };
        let hit = if cands.len() == 1 {
            Some(cands[0].path.clone())
        } else {
            cands.iter().find_map(|f| {
                let h = match index.get(&f.path, f.size, f.modified_ms) {
                    Some(h) => h.to_string(),
                    None => {
                        let h = replays::hash_file(Path::new(&f.path)).ok()?;
                        index.put(f.path.clone(), f.size, f.modified_ms, h.clone());
                        h
                    }
                };
                if h == hash {
                    Some(f.path.clone())
                } else {
                    None
                }
            })
        };
        if let Some(p) = hit {
            sources.files.insert(key.clone(), p);
            found += 1;
        }
    }
    if found > 0 {
        index.save(index_path);
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let base = std::env::temp_dir()
            .join(format!("wc3v-folders-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn discovery_lists_every_directory_holding_replays_and_nothing_else() {
        let base = temp("discover");
        let root = base.join("Replays");
        let multi = root.join("Autosaved").join("Multiplayer");
        let custom = root.join("Autosaved").join("Custom");
        let ladder = root.join("Ladder practice");
        let empty = root.join("nothing here");
        for d in [&multi, &custom, &ladder, &empty] {
            fs::create_dir_all(d).unwrap();
        }
        fs::write(root.join("downloaded.w3g"), b"x").unwrap();
        fs::write(multi.join("a.w3g"), b"x").unwrap();
        fs::write(multi.join("b.w3g"), b"x").unwrap();
        fs::write(custom.join("c.w3g"), b"x").unwrap();
        fs::write(ladder.join("d.w3g"), b"x").unwrap();
        fs::write(empty.join("notes.txt"), b"x").unwrap();

        let found = discover_in(&root);
        let dirs: Vec<PathBuf> = found.iter().map(|(d, _)| d.clone()).collect();
        assert!(dirs.contains(&root));
        assert!(dirs.contains(&multi));
        assert!(dirs.contains(&custom));
        assert!(dirs.contains(&ladder));
        // `Autosaved` holds no replay directly and is not a folder.
        assert!(!dirs.contains(&root.join("Autosaved")));
        assert!(!dirs.contains(&empty));
        let count = |d: &PathBuf| {
            found.iter().find(|(x, _)| x == d).map(|(_, n)| *n).unwrap()
        };
        assert_eq!(count(&multi), 2);
        assert_eq!(count(&root), 1);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn tree_applies_labels_switches_and_removal() {
        let base = temp("tree");
        let root = base.join("Replays");
        let multi = root.join("Autosaved").join("Multiplayer");
        let study = root.join("Study");
        fs::create_dir_all(&multi).unwrap();
        fs::create_dir_all(&study).unwrap();
        fs::write(multi.join("a.w3g"), b"x").unwrap();
        fs::write(study.join("b.w3g"), b"x").unwrap();
        let root_s = root.to_string_lossy().to_string();
        let multi_s = multi.to_string_lossy().to_string();
        let study_s = study.to_string_lossy().to_string();

        let mut config = FolderConfig::default();
        add_manual_root(&mut config, &root_s);
        let tree = build_tree(&config);
        // Discovery on this machine may add real roots; look at ours only.
        let ours: Vec<&Folder> = tree.iter().filter(|f| f.root == root_s).collect();
        assert_eq!(ours.len(), 3, "root + Multiplayer + Study");
        let r = ours.iter().find(|f| f.depth == 0).unwrap();
        assert!(r.manual);
        assert_eq!(r.label, "Replays");
        assert_eq!(r.total_count, 2);
        assert_eq!(r.direct_count, 0);
        let s = ours.iter().find(|f| f.name == "Study").unwrap();
        assert_eq!(s.depth, 1);
        assert_eq!(s.label, "Study");
        assert!(!s.custom_label);
        let m = ours.iter().find(|f| f.name == "Multiplayer").unwrap();
        assert_eq!(m.depth, 2);

        set_label(&mut config, &study_s, Some("  vs Happy  "));
        set_enabled(&mut config, &multi_s, false);
        let tree = build_tree(&config);
        let s = tree.iter().find(|f| f.path == study_s).unwrap();
        assert_eq!(s.label, "vs Happy");
        assert!(s.custom_label);
        let m = tree.iter().find(|f| f.path == multi_s).unwrap();
        assert!(!m.enabled);
        let ex = excluded_of(&config, &tree);
        assert!(ex.contains(&multi));
        assert!(!ex.contains(&study));

        // Blank label goes back to the default.
        set_label(&mut config, &study_s, Some("   "));
        let tree = build_tree(&config);
        let s = tree.iter().find(|f| f.path == study_s).unwrap();
        assert_eq!(s.label, "Study");

        // Removal hides it from the tree AND from the scan.
        remove(&mut config, &study_s);
        let tree = build_tree(&config);
        assert!(tree.iter().all(|f| f.path != study_s));
        assert!(excluded_of(&config, &tree).contains(&study));
        assert!(study.is_dir(), "removing never touches the disk");

        // Restoring brings it back with its state intact.
        assert_eq!(restore_removed(&mut config), 1);
        let tree = build_tree(&config);
        assert!(tree.iter().any(|f| f.path == study_s));

        // Removing a manual root drops it from the readable set.
        remove(&mut config, &root_s);
        let tree = build_tree(&config);
        assert!(!roots_of(&tree).contains(&root));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn config_round_trips_through_disk() {
        let base = temp("config");
        let file = base.join("folders.json");
        let mut c = FolderConfig::default();
        add_manual_root(&mut c, "C:\\x\\Replays");
        set_label(&mut c, "C:\\x\\Replays\\Study", Some("vs Happy"));
        set_enabled(&mut c, "C:\\x\\Replays\\Custom", false);
        c.save(&file).unwrap();
        let back = FolderConfig::load(&file);
        assert_eq!(back.manual_roots, vec!["C:\\x\\Replays".to_string()]);
        assert_eq!(back.prefs("C:\\x\\Replays\\Study").label.as_deref(), Some("vs Happy"));
        assert!(!back.prefs("C:\\x\\Replays\\Custom").enabled);
        assert!(back.prefs("C:\\x\\Replays\\Nope").enabled, "unknown folders are on");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sources_resolve_by_size_then_hash() {
        let base = temp("sources");
        let dir = base.join("Replays");
        fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.w3g");
        let b = dir.join("b.w3g");
        let c = dir.join("c.w3g");
        fs::write(&a, b"unique size").unwrap();
        fs::write(&b, b"same size 1").unwrap();
        fs::write(&c, b"same size 2").unwrap();
        let files = replays::scan_meta(&dir, &HashSet::new()).replays;
        let key_of = |p: &Path| {
            format!(
                "{}-{}",
                fs::metadata(p).unwrap().len(),
                replays::hash_file(p).unwrap()
            )
        };
        let key_a = key_of(&a);
        let key_c = key_of(&c);
        let mut s = Sources::default();
        let n = resolve_missing(
            &mut s,
            &[key_a.clone(), key_c.clone(), "1-nope".into()],
            &files,
            &base.join("index.json"),
        );
        assert_eq!(n, 2);
        assert_eq!(s.files.get(&key_a).map(PathBuf::from), Some(a.clone()));
        assert_eq!(s.files.get(&key_c).map(PathBuf::from), Some(c.clone()));
        assert_eq!(s.dirs().get(&key_a).map(PathBuf::from), Some(dir.clone()));
        let _ = fs::remove_dir_all(&base);
    }
}
