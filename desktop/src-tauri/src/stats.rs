//! Anonymous usage ping: a counter, not telemetry.
//!
//! One tiny POST to wc3v.com when the app starts and when the watcher lands a
//! new game. The whole body is the event name, the app version, and the OS
//! family. No replay data, no player names, no machine ID, no generated ID of
//! any kind. The server (workers/stats) stores no IP and no user agent, so two
//! pings from the same install are indistinguishable. That is what lets this
//! be on by default without a consent prompt: there is nothing in it about a
//! person.
//!
//! Properties, enforced here rather than documented elsewhere:
//!
//!   1. **The event names are an allowlist.** The webview cannot make this
//!      module say anything the list below does not contain.
//!   2. **Off is off.** Settings writes a marker file; when it exists, no
//!      socket is opened. Checked in the binary on every ping.
//!   3. **A failure is silent.** The ping is fire-and-forget with a short
//!      timeout. No retry, no queue, no error surfaced to the UI.
//!
//! The privacy policy (client/privacy.html, section on usage counts) describes
//! exactly these fields. Change one, change both.

use std::path::PathBuf;

use tauri::Manager;

const ENDPOINT: &str = "https://wc3v.com/api/event";

/// Events this app is willing to report. Mirrors the `app` allowlist in
/// workers/stats/src/index.js; anything else is dropped there anyway.
const ALLOWED_EVENTS: [&str; 2] = ["app_launch", "app_game_parsed"];

/// A ping that has not left in five seconds is not worth waiting on.
const TIMEOUT_SECS: u64 = 5;

/// The marker file IS the setting, same pattern as w3c.rs but inverted:
/// stats are on by default, and the file's existence turns them off. Deleting
/// the app data folder returns the install to its default.
fn opt_out_marker(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("stats-off")
}

#[tauri::command]
pub fn stats_enabled(app: tauri::AppHandle) -> bool {
    !opt_out_marker(&app).exists()
}

#[tauri::command]
pub async fn set_stats_enabled(enabled: bool, app: tauri::AppHandle) -> Result<bool, String> {
    let marker = opt_out_marker(&app);
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        if enabled {
            if marker.exists() {
                std::fs::remove_file(&marker).map_err(|e| e.to_string())?;
            }
        } else {
            if let Some(parent) = marker.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&marker, b"off").map_err(|e| e.to_string())?;
        }
        Ok(enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Send one anonymous event. Returns whether a request was attempted, which
/// the frontend ignores; it exists so tests can see the refusal paths.
#[tauri::command]
pub async fn stats_ping(event: String, app: tauri::AppHandle) -> bool {
    if !ALLOWED_EVENTS.contains(&event.as_str()) {
        return false;
    }
    if opt_out_marker(&app).exists() {
        return false;
    }

    let version = app.package_info().version.to_string();
    let os = if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    // Every value is from a closed set or a semver string, so hand-building
    // the JSON is safe and keeps serde out of the hot path.
    let body = format!(r#"{{"src":"app","e":"{event}","v":"{version}","os":"{os}"}}"#);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    // Fire and forget. The response body is never read; a failure is silence.
    let _ = client
        .post(ENDPOINT)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await;
    true
}

#[cfg(test)]
mod tests {
    use super::ALLOWED_EVENTS;

    #[test]
    fn the_allowlist_is_exactly_what_the_frontend_sends() {
        assert!(ALLOWED_EVENTS.contains(&"app_launch"));
        assert!(ALLOWED_EVENTS.contains(&"app_game_parsed"));
        assert_eq!(ALLOWED_EVENTS.len(), 2);
    }
}
