//! The "only parse 1v1 games" filter for the history backfill.
//!
//! A marker file, same pattern as w3c.rs and stats.rs. This one is OPT-IN:
//! the file's existence turns the filter on, and its absence is today's
//! behaviour of reading every replay. Chosen that way for two reasons:
//!
//!   1. The costly failure is a dropped game, not a wasted parse. A filter
//!      that is on when nobody asked for it silently removes games from
//!      somebody's history; a filter that is off merely spends time. The
//!      default has to be the lossless one.
//!   2. Deleting the app data folder must return the install to a state that
//!      loses nothing, which is the same rule the W3C opt-in follows in the
//!      other direction.
//!
//! The frontend reads this at the START of every backfill run (backfill.js),
//! never per file, so flipping the switch mid-run changes the next run and
//! not the one in flight. Live watcher games bypass the filter entirely: a
//! game the user just finished is always read, whatever mode it was.

use std::path::{Path, PathBuf};

use tauri::Manager;

const MARKER: &str = "parse-1v1-only";

fn marker_in(dir: &Path) -> PathBuf {
    dir.join(MARKER)
}

fn enabled_in(dir: &Path) -> bool {
    marker_in(dir).exists()
}

fn set_in(dir: &Path, enabled: bool) -> Result<bool, String> {
    let marker = marker_in(dir);
    if enabled {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        std::fs::write(&marker, b"on").map_err(|e| e.to_string())?;
    } else if marker.exists() {
        std::fs::remove_file(&marker).map_err(|e| e.to_string())?;
    }
    Ok(enabled)
}

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

#[tauri::command]
pub fn only_1v1_enabled(app: tauri::AppHandle) -> bool {
    enabled_in(&data_dir(&app))
}

#[tauri::command]
pub async fn set_only_1v1_enabled(enabled: bool, app: tauri::AppHandle) -> Result<bool, String> {
    let dir = data_dir(&app);
    tauri::async_runtime::spawn_blocking(move || set_in(&dir, enabled))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_setting_round_trips_and_absent_means_off() {
        let dir = std::env::temp_dir().join(format!("wc3v-filter-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        assert!(!enabled_in(&dir), "no marker is OFF, which is today's read-everything");
        assert!(set_in(&dir, true).unwrap());
        assert!(enabled_in(&dir));
        assert!(!set_in(&dir, false).unwrap());
        assert!(!enabled_in(&dir));
        // Turning it off when it is already off must not error.
        assert!(!set_in(&dir, false).unwrap());
        assert!(!enabled_in(&dir));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
