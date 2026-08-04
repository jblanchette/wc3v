//! Loopback overlay server for OBS.
//!
//! OBS Browser Source is a separate Chromium process — it cannot see the
//! webview's state. The only bridge that works offline and stays read-only is
//! a local HTTP endpoint. Rules, enforced here rather than documented:
//!
//!   • Binds 127.0.0.1 ONLY. Never 0.0.0.0, never a real interface.
//!   • Every route requires the per-install token. No token, no bytes.
//!   • GET only. Three routes. No write path, no CORS headers (the page and
//!     its EventSource are same-origin, so none are needed — and their
//!     absence means a hostile website cannot read these endpoints either).
//!   • State flows one way: webview → `publish` → SSE clients. The server
//!     never computes anything; it relays the latest state blob.
//!
//! Hand-rolled on std::net deliberately: for a GET-only, token-gated,
//! loopback server, ~150 auditable lines beat an HTTP crate. Supply-chain
//! surface matters for something streamers run on their gaming PC.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The overlay page, embedded at compile time so the server has no filesystem
/// dependency at runtime (and no path to traverse).
///
/// It is three files rather than one because the live preview inside the WC3V
/// window renders from the SAME css and renderer — a preview drawn by separate
/// code is a preview that can lie about what OBS will show. They are stitched
/// back into one self-contained document here.
const OVERLAY_SHELL: &str = include_str!("../../src-frontend/overlay/shell.html");
const OVERLAY_CSS: &str = include_str!("../../src-frontend/overlay/overlay.css");
const OVERLAY_RENDER_JS: &str = include_str!("../../src-frontend/overlay/overlay-render.js");

fn overlay_html() -> String {
    OVERLAY_SHELL
        .replace("/*OVERLAY_CSS*/", OVERLAY_CSS)
        .replace("/*OVERLAY_RENDER_JS*/", OVERLAY_RENDER_JS)
}

/// The "hand this replay to the viewer" launcher page. Same deal: embedded,
/// served from loopback, no filesystem involvement.
const HANDOFF_HTML: &str = include_str!("../../src-frontend/handoff.html");

/// SSE clients get a comment ping so dead connections are noticed and
/// reaped even when no games are being played.
const KEEPALIVE: Duration = Duration::from_secs(20);

/// How long a staged replay stays available to the launcher page, and how many
/// can be pending at once. Bounded because these hold whole .w3g files in RAM.
const HANDOFF_TTL: Duration = Duration::from_secs(600);
const HANDOFF_MAX: usize = 4;

/// A replay staged for the browser. Reads do NOT consume it: the launcher page
/// is an ordinary web page a user can reload, and a single-use entry turns a
/// reload into a dead link for no security gain — the token already gates the
/// route, and anything holding the token can read /state and /overlay anyway.
/// Bounded lifetime and count do the actual work here.
struct Handoff {
    id: String,
    bytes: Vec<u8>,
    staged_at: Instant,
}

pub struct Overlay {
    /// 0 when the server failed to bind — commands must report, not panic.
    pub port: u16,
    token: String,
    latest: Mutex<String>,
    clients: Mutex<Vec<TcpStream>>,
    handoffs: Mutex<Vec<Handoff>>,
    /// Monotonic counter behind the handoff ids, so two stagings in the same
    /// millisecond cannot collide.
    handoff_seq: Mutex<u64>,
}

/// Token from OS entropy without a rand dependency: `RandomState` seeds from
/// the system RNG. Not a cryptographic construction, but the attacker model
/// is "another local process guessing a URL", and 128 unpredictable bits is
/// far beyond what that can brute-force over HTTP.
fn random_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::with_capacity(32);
    for round in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(round);
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        );
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn load_or_create(path: &Path, create: impl FnOnce() -> String) -> String {
    if let Ok(s) = std::fs::read_to_string(path) {
        let s = s.trim().to_string();
        if !s.is_empty() {
            return s;
        }
    }
    let fresh = create();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, &fresh);
    fresh
}

/// Start the server. The token persists per install so the OBS URL survives
/// reinstalls of the scene; the port persists so it survives app restarts —
/// if another process took it meanwhile, a fresh ephemeral port is used and
/// the user has to re-copy the URL (logged, not silent).
pub fn start(data_dir: PathBuf) -> Arc<Overlay> {
    let token = load_or_create(&data_dir.join("overlay-token"), random_token);

    let port_file = data_dir.join("overlay-port");
    let persisted: Option<u16> = std::fs::read_to_string(&port_file)
        .ok()
        .and_then(|s| s.trim().parse().ok());

    let listener = persisted
        .and_then(|p| TcpListener::bind(("127.0.0.1", p)).ok())
        .or_else(|| TcpListener::bind(("127.0.0.1", 0)).ok());

    let Some(listener) = listener else {
        return Arc::new(Overlay {
            port: 0,
            token,
            latest: Mutex::new("{}".into()),
            clients: Mutex::new(Vec::new()),
            handoffs: Mutex::new(Vec::new()),
            handoff_seq: Mutex::new(0),
        });
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let _ = std::fs::write(&port_file, port.to_string());

    let overlay = Arc::new(Overlay {
        port,
        token,
        latest: Mutex::new("{}".into()),
        clients: Mutex::new(Vec::new()),
        handoffs: Mutex::new(Vec::new()),
        handoff_seq: Mutex::new(0),
    });

    let accept = Arc::clone(&overlay);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let ov = Arc::clone(&accept);
            std::thread::spawn(move || handle(stream, ov));
        }
    });

    let pinger = Arc::clone(&overlay);
    std::thread::spawn(move || loop {
        std::thread::sleep(KEEPALIVE);
        pinger.broadcast(": keepalive\n\n");
    });

    overlay
}

impl Overlay {
    /// The OBS Browser Source URL. Contains the token — hand it to the
    /// clipboard, never to the DOM (it would end up on stream).
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/overlay?token={}", self.port, self.token)
    }

    pub fn publish(&self, state: String) {
        *self.latest.lock().unwrap() = state.clone();
        self.broadcast(&format!("data: {state}\n\n"));
    }

    /// Stage a replay for the browser and return the launcher URL.
    ///
    /// Chrome blocks a public page (wc3v.com) from reaching a loopback server
    /// at all — both `fetch` and an iframe were measured hanging, then aborted
    /// — so the browser has to START on this origin. The launcher page fetches
    /// the bytes same-origin and hands them to the site through a cross-origin
    /// postMessage, which needs no CORS and crosses private → public, the
    /// direction browsers do allow.
    ///
    /// Staging happens here, in-process, from a Tauri command. The HTTP side
    /// still only ever reads: no route mutates anything.
    pub fn stage_handoff(&self, bytes: Vec<u8>, at_ms: Option<u64>, key: &str) -> Option<String> {
        if self.port == 0 {
            return None;
        }
        let id = {
            let mut seq = self.handoff_seq.lock().unwrap();
            *seq += 1;
            format!("h{seq}")
        };

        {
            let mut pending = self.handoffs.lock().unwrap();
            pending.retain(|h| h.staged_at.elapsed() < HANDOFF_TTL);
            while pending.len() >= HANDOFF_MAX {
                pending.remove(0);
            }
            pending.push(Handoff { id: id.clone(), bytes, staged_at: Instant::now() });
        }

        let mut url = format!(
            "http://127.0.0.1:{}/open?token={}&h={}&key={}",
            self.port,
            self.token,
            id,
            url_encode(key)
        );
        if let Some(at) = at_ms {
            url.push_str(&format!("&at={at}"));
        }
        Some(url)
    }

    fn take_handoff(&self, id: &str) -> Option<Vec<u8>> {
        let pending = self.handoffs.lock().unwrap();
        pending
            .iter()
            .find(|h| h.id == id && h.staged_at.elapsed() < HANDOFF_TTL)
            .map(|h| h.bytes.clone())
    }

    /// Write to every SSE client, dropping the ones that are gone.
    fn broadcast(&self, msg: &str) {
        let mut clients = self.clients.lock().unwrap();
        clients.retain_mut(|c| c.write_all(msg.as_bytes()).and_then(|_| c.flush()).is_ok());
    }

    /// Timing-independent comparison — loopback timing attacks are mostly
    /// theoretical, but the constant-time fold costs nothing.
    fn token_ok(&self, presented: &str) -> bool {
        let a = self.token.as_bytes();
        let b = presented.as_bytes();
        if a.len() != b.len() {
            return false;
        }
        a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
    }
}

/// Percent-encode everything outside the unreserved set. Store keys are only
/// digits, hex and a dash today, but this is building a URL and a helper that
/// assumes its input is safe is exactly how that stops being true.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn respond_bytes(stream: &mut TcpStream, ctype: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    if stream.write_all(head.as_bytes()).is_ok() {
        let _ = stream.write_all(body);
    }
}

fn respond(stream: &mut TcpStream, status: &str, ctype: &str, body: &str) {
    let _ = stream.write_all(
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .as_bytes(),
    );
}

fn handle(mut stream: TcpStream, ov: Arc<Overlay>) {
    // A client that never finishes its request must not pin a thread.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));

    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.len() > 4096 {
        return;
    }
    // Drain headers (bounded); their content is irrelevant to a GET-only API.
    for _ in 0..64 {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(_) if line == "\r\n" || line == "\n" || line.is_empty() => break,
            Ok(_) if line.len() <= 4096 => continue,
            _ => return,
        }
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    if method != "GET" {
        return respond(&mut stream, "405 Method Not Allowed", "text/plain", "GET only");
    }

    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };

    // Browsers request this unprompted and it carries no token. Answering
    // "no content" keeps a red 403 out of the OBS/browser console, where it
    // reads as a broken overlay.
    if path == "/favicon.ico" {
        return respond(&mut stream, "204 No Content", "image/x-icon", "");
    }
    let token = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("token="))
        .unwrap_or("");
    if !ov.token_ok(token) {
        return respond(&mut stream, "403 Forbidden", "text/plain", "bad token");
    }

    match path {
        "/overlay" => respond(&mut stream, "200 OK", "text/html; charset=utf-8", &overlay_html()),
        // The launcher page. Its query string (h / key / at) is read by the
        // page itself in the browser; the server just serves the document.
        "/open" => respond(&mut stream, "200 OK", "text/html; charset=utf-8", HANDOFF_HTML),
        "/handoff" => {
            let id = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("h="))
                .unwrap_or("");
            match ov.take_handoff(id) {
                Some(bytes) => respond_bytes(&mut stream, "application/octet-stream", &bytes),
                // Expired or never staged. The launcher page turns this into
                // "click Watch again in WC3V" rather than a blank failure.
                None => respond(&mut stream, "404 Not Found", "text/plain", "no such handoff"),
            }
        }
        "/state" => {
            let latest = ov.latest.lock().unwrap().clone();
            respond(&mut stream, "200 OK", "application/json", &latest);
        }
        "/events" => {
            // Greeting and registration happen under the clients lock: a
            // concurrent publish either already put its state in this hello,
            // or blocks until the client is registered and delivers to it.
            // Without this there is a window where an update is lost.
            // (publish never holds `latest` while taking `clients`, so the
            // nested acquisition here cannot deadlock.)
            let mut clients = ov.clients.lock().unwrap();
            let hello = {
                let latest = ov.latest.lock().unwrap();
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\nretry: 3000\n\ndata: {latest}\n\n"
                )
            };
            if stream.write_all(hello.as_bytes()).is_ok() {
                let _ = stream.set_read_timeout(None);
                // The stream lives in the client list from here on; this
                // handler thread ends but the socket stays open for
                // broadcast writes.
                clients.push(stream);
            }
        }
        _ => respond(&mut stream, "404 Not Found", "text/plain", "not found"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn served(name: &str) -> Arc<Overlay> {
        let dir = std::env::temp_dir().join(format!("wc3v-overlay-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ov = start(dir);
        assert_ne!(ov.port, 0, "server failed to bind");
        ov
    }

    /// Plain GET; reads until the server closes (all non-SSE routes do).
    fn get(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        write!(s, "GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn every_route_requires_the_token() {
        let ov = served("token");
        assert!(get(ov.port, "/state").starts_with("HTTP/1.1 403"));
        assert!(get(ov.port, "/overlay?token=wrong").starts_with("HTTP/1.1 403"));
        assert!(get(ov.port, "/events?token=").starts_with("HTTP/1.1 403"));
    }

    #[test]
    fn non_get_and_unknown_paths_are_refused() {
        let ov = served("methods");
        let mut s = TcpStream::connect(("127.0.0.1", ov.port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        write!(s, "POST /state?token={} HTTP/1.1\r\nHost: x\r\n\r\n", ov.token).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        assert!(out.starts_with("HTTP/1.1 405"));

        let resp = get(ov.port, &format!("/secrets?token={}", ov.token));
        assert!(resp.starts_with("HTTP/1.1 404"));
    }

    /// Raw GET returning the body bytes, so a binary route can be checked
    /// byte-for-byte rather than through a lossy String conversion.
    fn get_bytes(port: u16, target: &str) -> (String, Vec<u8>) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        write!(s, "GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        let mut buf = Vec::new();
        let _ = s.read_to_end(&mut buf);
        let split = buf
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|i| i + 4)
            .unwrap_or(buf.len());
        let head = String::from_utf8_lossy(&buf[..split]).to_string();
        (head, buf[split..].to_vec())
    }

    /// The overlay is three files stitched into one document. If a placeholder
    /// is ever renamed on one side only, the page still serves 200 — it just
    /// arrives with no styling or no renderer, which looks like a broken OBS
    /// source rather than a broken build. Assert the seam.
    #[test]
    fn overlay_page_has_its_css_and_renderer_inlined() {
        let html = overlay_html();
        assert!(!html.contains("/*OVERLAY_CSS*/"), "css placeholder was not replaced");
        assert!(!html.contains("/*OVERLAY_RENDER_JS*/"), "renderer placeholder was not replaced");
        assert!(html.contains(".wc3v-ov .card"), "overlay css missing from the page");
        assert!(html.contains("window.OverlayRender"), "renderer missing from the page");
        // Self-contained is a hard requirement: OBS may have no network at all,
        // and an overlay that phones out is not auditable.
        assert!(!html.contains("<script src="), "overlay must not load external scripts");
        assert!(!html.contains("<link rel=\"stylesheet\""), "overlay must not load external css");
    }

    #[test]
    fn handoff_routes_require_the_token() {
        let ov = served("handoff-token");
        assert!(get(ov.port, "/open").starts_with("HTTP/1.1 403"));
        assert!(get(ov.port, "/handoff?h=h1").starts_with("HTTP/1.1 403"));
        assert!(get(ov.port, "/open?token=wrong").starts_with("HTTP/1.1 403"));
    }

    #[test]
    fn staged_replay_is_served_verbatim_and_unknown_ids_404() {
        let ov = served("handoff-serve");
        let payload: Vec<u8> = (0u8..=255).cycle().take(5000).collect();
        let url = ov.stage_handoff(payload.clone(), Some(522000), "137081-abc").unwrap();

        // The launcher URL has to carry everything the browser needs, or the
        // page opens with nothing to hand over.
        assert!(url.contains("/open?token="));
        assert!(url.contains("&at=522000"));
        assert!(url.contains("&key=137081-abc"));

        let id = url.split("&h=").nth(1).unwrap().split('&').next().unwrap().to_string();
        let (head, body) = get_bytes(ov.port, &format!("/handoff?token={}&h={id}", ov.token));
        assert!(head.starts_with("HTTP/1.1 200"), "{head}");
        assert_eq!(body, payload, "staged bytes must arrive unchanged");

        // Reading does not consume: the launcher is a page a user can reload,
        // and a dead link on refresh buys nothing the token does not already.
        let (_, again) = get_bytes(ov.port, &format!("/handoff?token={}&h={id}", ov.token));
        assert_eq!(again, payload);

        assert!(get(ov.port, &format!("/handoff?token={}&h=nope", ov.token))
            .starts_with("HTTP/1.1 404"));
    }

    #[test]
    fn staged_replays_are_capped_so_memory_cannot_grow() {
        let ov = served("handoff-cap");
        let mut ids = Vec::new();
        for i in 0..(HANDOFF_MAX + 2) {
            let url = ov.stage_handoff(vec![i as u8; 16], None, "k").unwrap();
            ids.push(url.split("&h=").nth(1).unwrap().split('&').next().unwrap().to_string());
        }
        assert_eq!(ov.handoffs.lock().unwrap().len(), HANDOFF_MAX);
        // Oldest evicted, newest still there.
        assert!(get(ov.port, &format!("/handoff?token={}&h={}", ov.token, ids[0]))
            .starts_with("HTTP/1.1 404"));
        let (head, _) = get_bytes(
            ov.port,
            &format!("/handoff?token={}&h={}", ov.token, ids[ids.len() - 1]),
        );
        assert!(head.starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn state_roundtrip_and_sse_broadcast() {
        let ov = served("sse");

        // SSE client connects first and must receive the initial (empty)
        // state, then the published update, without reconnecting.
        let mut sse = TcpStream::connect(("127.0.0.1", ov.port)).unwrap();
        sse.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        write!(sse, "GET /events?token={} HTTP/1.1\r\nHost: x\r\n\r\n", ov.token).unwrap();
        let mut reader = BufReader::new(sse);

        let read_until = |reader: &mut BufReader<TcpStream>, needle: &str| -> bool {
            for _ in 0..64 {
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    return false;
                }
                if line.contains(needle) {
                    return true;
                }
            }
            false
        };
        assert!(read_until(&mut reader, "data: {}"), "no initial state on connect");

        ov.publish(r#"{"game":"one"}"#.into());
        assert!(
            read_until(&mut reader, r#"data: {"game":"one"}"#),
            "published state never reached the SSE client"
        );

        // /state serves the same latest blob to a fresh request.
        let resp = get(ov.port, &format!("/state?token={}", ov.token));
        assert!(resp.contains(r#"{"game":"one"}"#));
    }
}
