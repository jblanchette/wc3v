//! W3Champions lookups: the app's only optional outbound request.
//!
//! Everything else in WC3V reads files the game already wrote. This module
//! asks a public, unauthenticated ladder API for things a replay simply does
//! not contain: MMR, rank, league quantile, and who you are playing right now.
//! That last one is the reason it exists. A replay cannot tell you until the
//! game is over.
//!
//! Four properties, enforced here rather than documented elsewhere:
//!
//!   1. **Off unless switched on.** Every call fails closed unless the opt-in
//!      marker file exists. The setting is not a UI convenience the frontend
//!      could forget to check; it is checked in the binary, on every request.
//!   2. **One host.** The URL is built here from an allowlisted path. The
//!      webview passes a path and never a URL, so nothing it could be tricked
//!      into constructing can reach a different server.
//!   3. **Read only, and nothing of yours goes out.** GET only. The only thing
//!      that leaves this machine is a battle tag the user typed or that is
//!      already public on the ladder. **No replay, no summary, no file, no
//!      telemetry, ever.**
//!   4. **A failure is a shrug.** Timeouts and junk responses come back as
//!      errors the UI renders as "no online data", never as a broken screen.
//!      The API is undocumented and unversioned; it WILL change shape.
//!
//! Note on reqwest: the client here is built with no compression features for
//! the same reason `fetch_map` is (see Cargo.toml). The crate is shared, and
//! enabling gzip anywhere would corrupt the map cache.

use std::path::PathBuf;

use tauri::Manager;

/// The public W3Champions backend. The website's own API; no key, no account.
const W3C_HOST: &str = "https://website-backend.w3champions.com";

/// Path prefixes the webview may ask for. Anything else is refused before a
/// socket is opened. Kept deliberately narrow: these are the read-only
/// player/match endpoints the UI actually uses.
const ALLOWED_PREFIXES: [&str; 3] = ["/api/players/", "/api/matches/", "/api/player-stats/"];

/// Short on purpose. This runs while somebody is queuing for a game; a lookup
/// that has not answered in five seconds has already missed its moment.
const TIMEOUT_SECS: u64 = 5;

/// A response larger than this is not one of ours. Guards against a redirect
/// to something huge turning a stats lookup into a memory problem.
const MAX_BYTES: usize = 2 * 1024 * 1024;

fn opt_in_marker(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("w3c-online")
}

/// Whether online lookups are switched on. The marker file IS the setting:
/// no file, no network, and deleting the app data folder returns the install
/// to its default of never dialling out.
#[tauri::command]
pub fn w3c_enabled(app: tauri::AppHandle) -> bool {
    opt_in_marker(&app).exists()
}

#[tauri::command]
pub async fn set_w3c_enabled(enabled: bool, app: tauri::AppHandle) -> Result<bool, String> {
    let marker = opt_in_marker(&app);
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        if enabled {
            if let Some(parent) = marker.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&marker, b"on").map_err(|e| e.to_string())?;
        } else if marker.exists() {
            std::fs::remove_file(&marker).map_err(|e| e.to_string())?;
        }
        Ok(enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// True when `path` is a request this app is willing to make.
///
/// Rejects anything that is not a plain absolute path under an allowed
/// prefix. `..` and `//` are refused outright rather than normalised: the
/// only paths that should ever arrive here are ones this app's own frontend
/// built, so anything surprising is a bug worth failing on, not smoothing
/// over. A scheme-relative `//evil.example/x` would otherwise sail past a
/// naive prefix check on some URL parsers.
fn allowed(path: &str) -> bool {
    if path.len() > 512 || !path.starts_with('/') || path.starts_with("//") {
        return false;
    }
    if path.contains("..") || path.contains('\\') {
        return false;
    }
    // Control characters and spaces cannot appear in a URL we built.
    if path.chars().any(|c| c.is_control() || c == ' ') {
        return false;
    }
    ALLOWED_PREFIXES.iter().any(|p| path.starts_with(p))
}

/// Perform one allowlisted GET against the W3Champions API and return the raw
/// JSON text. The frontend parses and validates the shape. The API is
/// undocumented, so every consumer has to be written to survive a response
/// that is not what it expected.
#[tauri::command]
pub async fn w3c_lookup(path: String, app: tauri::AppHandle) -> Result<String, String> {
    if !w3c_enabled(app.clone()) {
        return Err("online lookups are off".into());
    }
    if !allowed(&path) {
        return Err("not an allowed lookup".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        // A redirect would leave the allowlisted host, which is the one thing
        // this module promises cannot happen.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(format!("{W3C_HOST}{path}"))
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("could not reach W3Champions: {e}"))?;

    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("not found on W3Champions".into());
    }
    if !res.status().is_success() {
        return Err(format!("W3Champions returned {}", res.status()));
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("W3Champions returned an unexpectedly large response".into());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "W3Champions returned invalid text".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_endpoints_the_ui_uses() {
        assert!(allowed("/api/matches/ongoing/orange%2314823"));
        assert!(allowed("/api/players/orange%2314823/game-mode-stats"));
        assert!(allowed("/api/player-stats/orange%2314823/race-on-map-versus-race"));
        assert!(allowed("/api/matches/search?playerId=x&gameMode=1"));
    }

    #[test]
    fn refuses_anything_off_the_allowlist() {
        assert!(!allowed("/swagger/index.html"));
        assert!(!allowed("/api/admin/ban"));
        assert!(!allowed("api/players/x"), "must be an absolute path");
    }

    /// The important ones: a path that is not a path. Without these a caller
    /// could aim the request at another host entirely, which would defeat the
    /// whole point of taking a path instead of a URL.
    #[test]
    fn refuses_paths_that_could_leave_the_host() {
        assert!(!allowed("//evil.example/api/players/x"));
        assert!(!allowed("/api/players/../../../etc/passwd"));
        assert!(!allowed("/api/players/x\\..\\y"));
        assert!(!allowed("https://evil.example/api/players/x"));
        assert!(!allowed("/api/players/x\nHost: evil.example"));
        assert!(!allowed("/api/players/x y"));
        assert!(!allowed(""));
    }

    #[test]
    fn refuses_absurd_lengths() {
        let long = format!("/api/players/{}", "a".repeat(600));
        assert!(!allowed(&long));
    }
}
